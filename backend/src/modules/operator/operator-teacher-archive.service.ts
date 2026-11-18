import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import {
  OperatorScopeService,
  type OperatorScope,
} from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TEACHER_MONTH } from '../partner/dto/partner-teacher-performance.dto';
import { resolvePartnerPeriodRange } from '../partner/partner-period';
import type {
  OperatorTeacherArchivesQueryDto,
  OperatorTeacherHistoryQueryDto,
  OperatorTeacherMonthQueryDto,
} from './dto/operator-teacher-archive.dto';

type Client = Prisma.TransactionClient;
const evaluationValues = {
  teachingRating: true,
  communicationRating: true,
  attendanceRating: true,
  overallRating: true,
  guidance: true,
  authorName: true,
} as const;

@Injectable()
export class OperatorTeacherArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: OperatorScopeService,
  ) {}

  list(actor: AuthenticatedUser, query: OperatorTeacherArchivesQueryDto) {
    return this.snapshot(
      actor,
      async (tx, owner) => {
        const keyword = query.query?.trim();
        const where: Prisma.TeacherProfileWhereInput = {
          ...this.teacherWhere(owner.campusId),
          ...(keyword
            ? {
                user: {
                  ...this.teacherUserWhere(owner.campusId),
                  displayName: { contains: keyword, mode: 'insensitive' },
                },
              }
            : {}),
        };
        const total = await tx.teacherProfile.count({ where });
        const rows = await tx.teacherProfile.findMany({
          where,
          orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: {
            id: true,
            specialties: true,
            user: { select: { displayName: true } },
            classGroups: {
              where: { campusId: owner.campusId, status: 'ACTIVE' },
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
              select: { id: true, name: true, courseName: true },
            },
          },
        });
        return {
          data: rows.map((row) => ({
            id: row.id,
            displayName: row.user.displayName,
            specialties: row.specialties,
            classes: row.classGroups.map((group) => ({
              id: group.id,
              className: group.name,
              courseName: group.courseName,
            })),
          })),
          meta: this.meta(total, query),
        };
      },
      (result) => result.data.map((teacher) => teacher.id),
    );
  }

  performance(
    actor: AuthenticatedUser,
    teacherId: string,
    query: OperatorTeacherMonthQueryDto,
    now = new Date(),
  ) {
    return this.snapshot(
      actor,
      async (tx, owner) => {
        const teacher = await this.teacher(tx, owner, teacherId);
        const { month, start, end } = this.range(
          query.month,
          teacher.campus.timezone,
          now,
        );
        const where: Prisma.LessonSessionWhereInput = {
          teacherId,
          campusId: owner.campusId,
          classGroup: { campusId: owner.campusId },
          status: { not: 'CANCELLED' },
          startsAt: { gte: start, lt: end, lte: now },
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
        const evaluation = await tx.partnerTeacherEvaluation.findFirst({
          where: { teacherId, campusId: owner.campusId, periodMonth: month },
          select: {
            id: true,
            teacherId: true,
            periodMonth: true,
            version: true,
            ...evaluationValues,
            createdAt: true,
            updatedAt: true,
          },
        });
        return {
          teacherId,
          periodMonth: month,
          timezone: teacher.campus.timezone,
          asOf: now.toISOString(),
          scheduledLessonCount: scheduled,
          completedLessonCount: completed,
          completionRateBasisPoints: scheduled
            ? Math.round((completed * 10000) / scheduled)
            : null,
          evaluation: evaluation
            ? {
                ...evaluation,
                canEdit: false as const,
                createdAt: evaluation.createdAt.toISOString(),
                updatedAt: evaluation.updatedAt.toISOString(),
              }
            : null,
        };
      },
      () => [teacherId],
    );
  }

  history(
    actor: AuthenticatedUser,
    teacherId: string,
    query: OperatorTeacherHistoryQueryDto,
    now = new Date(),
  ) {
    return this.snapshot(
      actor,
      async (tx, owner) => {
        const teacher = await this.teacher(tx, owner, teacherId);
        const { month } = this.range(query.month, teacher.campus.timezone, now);
        const where = {
          evaluation: {
            teacherId,
            campusId: owner.campusId,
            periodMonth: month,
          },
        };
        const total = await tx.partnerTeacherEvaluationRevision.count({
          where,
        });
        const rows = await tx.partnerTeacherEvaluationRevision.findMany({
          where,
          orderBy: [{ version: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { version: true, ...evaluationValues, savedAt: true },
        });
        return {
          data: rows.map((row) => ({
            ...row,
            periodMonth: month,
            savedAt: row.savedAt.toISOString(),
          })),
          meta: this.meta(total, query),
        };
      },
      () => [teacherId],
    );
  }

  private teacherUserWhere(campusId: string): Prisma.UserWhereInput {
    const role = { roleCode: 'TEACHER' as const, campusId };
    return { status: 'ACTIVE', roles: { some: role, every: role } };
  }

  private teacherWhere(campusId: string): Prisma.TeacherProfileWhereInput {
    return { campusId, isActive: true, user: this.teacherUserWhere(campusId) };
  }

  private async teacher(tx: Client, owner: OperatorScope, teacherId: string) {
    const row = await tx.teacherProfile.findFirst({
      where: { ...this.teacherWhere(owner.campusId), id: teacherId },
      select: { campus: { select: { timezone: true } } },
    });
    if (!row) {
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        '未找到本校区教师',
        404,
      );
    }
    return row;
  }

  private async current(tx: Client, owner: OperatorScope) {
    const user = await tx.user.findUnique({
      where: { id: owner.userId },
      select: {
        status: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError(
        ErrorCode.UNAUTHORIZED,
        '登录已失效，请重新登录',
        401,
      );
    }
    if (
      user.roles.length !== 1 ||
      user.roles[0].roleCode !== 'OPERATOR' ||
      user.roles[0].campusId !== owner.campusId
    ) {
      throw new DomainError(
        ErrorCode.FORBIDDEN,
        '当前账号没有本校区教师档案读取权限',
        403,
      );
    }
  }

  private async snapshot<T>(
    actor: AuthenticatedUser,
    read: (tx: Client, owner: OperatorScope) => Promise<T>,
    returnedTeacherIds: (result: T) => string[],
  ) {
    const owner = this.scope.require(actor);
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.current(tx, owner);
        return read(tx, owner);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        timeout: 15000,
      },
    );
    // A fresh transaction catches revocation that an older repeatable snapshot cannot see.
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${owner.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "UserRole" WHERE "userId" = ${owner.userId}::uuid ORDER BY "id" FOR UPDATE`;
        await this.current(tx, owner);
        const ids = [...new Set(returnedTeacherIds(result))].sort();
        if (ids.length) {
          const parameters = Prisma.join(
            ids.map((id) => Prisma.sql`${id}::uuid`),
          );
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User"
            WHERE "id" IN (SELECT "userId" FROM "TeacherProfile" WHERE "id" IN (${parameters}))
            ORDER BY "id" FOR SHARE`);
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "UserRole"
            WHERE "userId" IN (SELECT "userId" FROM "TeacherProfile" WHERE "id" IN (${parameters}))
            ORDER BY "id" FOR SHARE`);
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "TeacherProfile"
            WHERE "id" IN (${parameters}) ORDER BY "id" FOR SHARE`);
          const count = await tx.teacherProfile.count({
            where: { ...this.teacherWhere(owner.campusId), id: { in: ids } },
          });
          if (count !== ids.length) {
            throw new DomainError(
              ErrorCode.RESOURCE_NOT_FOUND,
              '未找到本校区教师',
              404,
            );
          }
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      },
    );
    return result;
  }

  private range(month: string | undefined, timezone: string, now: Date) {
    if (month !== undefined && !TEACHER_MONTH.test(month)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, '月份格式无效', 400);
    }
    const range = resolvePartnerPeriodRange(
      'MONTH',
      month ? `${month}-01` : undefined,
      timezone,
      now,
    );
    return { ...range, month: range.anchorDate.slice(0, 7) };
  }

  private meta(total: number, query: { page: number; pageSize: number }) {
    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
}
