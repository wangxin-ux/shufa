import { Injectable } from '@nestjs/common';
import { Prisma, type PartnerTeacherEvaluation } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  PartnerScopeService,
  type PartnerScope,
} from '../../common/auth/partner-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  PartnerTeacherEvaluationDto,
  PartnerTeacherPerformanceQueryDto,
  TEACHER_MONTH,
  TEACHER_RATING_FIELDS,
} from './dto/partner-teacher-performance.dto';
import { resolvePartnerPeriodRange } from './partner-period';

type Client = Prisma.TransactionClient;
const missing = (): never => {
  throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, '未找到本校区教师', 404);
};
const forbidden = (): never => {
  throw new DomainError(ErrorCode.FORBIDDEN, '当前账号无权修改此评价', 403);
};
const conflict = (): never => {
  throw new DomainError(
    ErrorCode.CONFLICT,
    '评价已更新，请重新读取后修改',
    409,
  );
};

@Injectable()
export class PartnerTeacherPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: PartnerScopeService,
  ) {}

  async performance(
    actor: AuthenticatedUser,
    teacherId: string,
    query: PartnerTeacherPerformanceQueryDto,
    now = new Date(),
  ) {
    return this.snapshot(actor, teacherId, async (tx, owner, timezone) => {
      const range = this.range(query.month, timezone, now);
      const where: Prisma.LessonSessionWhereInput = {
        teacherId,
        campusId: owner.campusId,
        status: { not: 'CANCELLED' },
        startsAt: { gte: range.start, lt: range.end, lte: now },
      };
      const scheduled = await tx.lessonSession.count({ where });
      const completed = await tx.lessonSession.count({
        where: {
          ...where,
          status: 'COMPLETED',
          teachingRecord: {
            is: { teacherId, campusId: owner.campusId, status: 'COMPLETED' },
          },
        },
      });
      const evaluation = await tx.partnerTeacherEvaluation.findUnique({
        where: {
          teacherId_periodMonth: { teacherId, periodMonth: range.month },
        },
      });
      return {
        teacherId,
        periodMonth: range.month,
        timezone,
        asOf: now.toISOString(),
        scheduledLessonCount: scheduled,
        completedLessonCount: completed,
        completionRateBasisPoints: scheduled
          ? Math.round((completed * 10000) / scheduled)
          : null,
        evaluation: evaluation ? this.present(evaluation, owner.userId) : null,
      };
    });
  }

  async history(
    actor: AuthenticatedUser,
    teacherId: string,
    query: PartnerTeacherPerformanceQueryDto,
    now = new Date(),
  ) {
    return this.snapshot(actor, teacherId, async (tx, owner, timezone) => {
      const { month } = this.range(query.month, timezone, now);
      const where = {
        evaluation: { teacherId, campusId: owner.campusId, periodMonth: month },
      };
      const total = await tx.partnerTeacherEvaluationRevision.count({ where });
      const rows = await tx.partnerTeacherEvaluationRevision.findMany({
        where,
        orderBy: { version: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      });
      return {
        data: rows.map((r) => ({
          version: r.version,
          ...this.values(r),
          authorName: r.authorName,
          savedAt: r.savedAt.toISOString(),
        })),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.ceil(total / query.pageSize),
        },
      };
    });
  }

  async save(
    actor: AuthenticatedUser,
    teacherId: string,
    input: PartnerTeacherEvaluationDto,
  ) {
    if (
      !TEACHER_MONTH.test(input.periodMonth) ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      input.expectedVersion > 2147483646 ||
      TEACHER_RATING_FIELDS.some(
        (k) => !Number.isInteger(input[k]) || input[k] < 1 || input[k] > 10,
      ) ||
      typeof input.guidance !== 'string' ||
      Array.from(input.guidance).length > 1000 ||
      input.guidance.includes(String.fromCharCode(0)) ||
      /[\uD800-\uDFFF]/u.test(input.guidance)
    )
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        '评分或指导意见不符合要求',
        400,
      );
    const owner = this.scope.require(actor);
    return this.withActor(owner, async (tx) => {
      await this.teacher(tx, owner, teacherId, true);
      const previous = await tx.partnerTeacherEvaluation.findUnique({
        where: {
          teacherId_periodMonth: { teacherId, periodMonth: input.periodMonth },
        },
      });
      if (previous && previous.authorUserId !== owner.userId) forbidden();
      const values = this.values({ ...input, guidance: input.guidance.trim() });
      if (previous) {
        const same =
          TEACHER_RATING_FIELDS.every((k) => previous[k] === values[k]) &&
          previous.guidance === values.guidance;
        if (
          same &&
          [previous.version, previous.version - 1].includes(
            input.expectedVersion,
          )
        )
          return this.present(previous, owner.userId);
        if (input.expectedVersion !== previous.version) conflict();
      } else if (input.expectedVersion !== 0) conflict();
      const author = await tx.user.findUniqueOrThrow({
        where: { id: owner.userId },
        select: { displayName: true },
      });
      const row = previous
        ? await tx.partnerTeacherEvaluation.update({
            where: { id: previous.id },
            data: { ...values, version: { increment: 1 } },
          })
        : await tx.partnerTeacherEvaluation.create({
            data: {
              ...values,
              teacherId,
              campusId: owner.campusId,
              periodMonth: input.periodMonth,
              authorUserId: owner.userId,
              authorName: author.displayName,
            },
          });
      await tx.partnerTeacherEvaluationRevision.create({
        data: {
          evaluationId: row.id,
          version: row.version,
          ...values,
          authorName: row.authorName,
          savedAt: row.updatedAt,
        },
      });
      await tx.auditLog.create({
        data: {
          campusId: owner.campusId,
          actorUserId: owner.userId,
          action: 'PARTNER_TEACHER_EVALUATION_SAVED',
          resourceType: 'PartnerTeacherEvaluation',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: {
            periodMonth: row.periodMonth,
            previousVersion: previous?.version ?? 0,
            version: row.version,
          },
        },
      });
      return this.present(row, owner.userId);
    });
  }

  private values(
    row: Pick<
      PartnerTeacherEvaluation,
      (typeof TEACHER_RATING_FIELDS)[number] | 'guidance'
    >,
  ) {
    return {
      teachingRating: row.teachingRating,
      communicationRating: row.communicationRating,
      attendanceRating: row.attendanceRating,
      overallRating: row.overallRating,
      guidance: row.guidance,
    };
  }
  private present(row: PartnerTeacherEvaluation, actorId: string) {
    return {
      id: row.id,
      teacherId: row.teacherId,
      periodMonth: row.periodMonth,
      version: row.version,
      ...this.values(row),
      authorName: row.authorName,
      canEdit: row.authorUserId === actorId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  private range(month: string | undefined, timezone: string, now: Date) {
    if (month !== undefined && !TEACHER_MONTH.test(month))
      throw new DomainError(ErrorCode.VALIDATION_FAILED, '月份格式无效', 400);
    const range = resolvePartnerPeriodRange(
      'MONTH',
      month ? `${month}-01` : undefined,
      timezone,
      now,
    );
    return { ...range, month: range.anchorDate.slice(0, 7) };
  }
  private async current(tx: Client, owner: PartnerScope) {
    const user = await tx.user.findUnique({
      where: { id: owner.userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE')
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        '登录已失效，请重新登录',
        401,
      );
    if (
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'PARTNER' ||
      user.roles[0].campusId !== owner.campusId
    )
      forbidden();
  }
  private withActor<T>(
    owner: PartnerScope,
    action: (tx: Client) => Promise<T>,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${owner.userId}::uuid ORDER BY "id" FOR UPDATE`;
        await this.current(tx, owner);
        return action(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
        maxWait: 10000,
      },
    );
  }
  private async teacher(
    tx: Client,
    owner: PartnerScope,
    id: string,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const teacher = await tx.teacherProfile.findFirst({
      where: { id, campusId: owner.campusId, isActive: true },
      select: { campus: { select: { timezone: true } } },
    });
    return teacher?.campus.timezone ?? missing();
  }
  private async snapshot<T>(
    actor: AuthenticatedUser,
    id: string,
    read: (tx: Client, owner: PartnerScope, timezone: string) => Promise<T>,
  ) {
    const owner = this.scope.require(actor);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.current(tx, owner);
        const timezone = await this.teacher(tx, owner, id);
        return read(tx, owner, timezone);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
    return this.withActor(owner, async (tx) => {
      await this.teacher(tx, owner, id, true);
      return result;
    });
  }
}
