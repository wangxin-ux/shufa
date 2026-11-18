import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  OperatorCancelLessonSessionDto,
  OperatorCreateLessonSessionDto,
  OperatorLessonSessionsQueryDto,
  OperatorUpdateLessonSessionDto,
} from './dto/operator-scheduling.dto';
import {
  assertOperatorScheduleAvailable,
  lockOperatorScheduleResources,
} from './operator-scheduling-conflicts';

const CREATE_ROUTE = '/operators/me/lesson-sessions';

const lessonViewSelect = {
  id: true,
  campusId: true,
  classGroupId: true,
  seriesId: true,
  teacherId: true,
  startsAt: true,
  endsAt: true,
  kind: true,
  lessonUnits: true,
  status: true,
  version: true,
  classGroup: {
    select: {
      name: true,
      courseName: true,
    },
  },
  teacher: {
    select: {
      user: { select: { displayName: true } },
    },
  },
} satisfies Prisma.LessonSessionSelect;

type LessonViewRecord = Prisma.LessonSessionGetPayload<{
  select: typeof lessonViewSelect;
}>;

@Injectable()
export class OperatorSchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OperatorScopeService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(user: AuthenticatedUser, query: OperatorLessonSessionsQueryDto) {
    const scope = this.scopeService.require(user);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to) {
      this.badRequest('The range start must be earlier than the range end');
    }

    const where: Prisma.LessonSessionWhereInput = {
      campusId: scope.campusId,
      ...(query.status ? { status: query.status } : {}),
      ...(from || to
        ? {
            startsAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lt: to } : {}),
            },
          }
        : {}),
    };
    const [total, sessions] = await Promise.all([
      this.prisma.lessonSession.count({ where }),
      this.prisma.lessonSession.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: lessonViewSelect,
      }),
    ]);

    return {
      data: sessions.map((session) => this.toView(session)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    };
  }

  async create(
    user: AuthenticatedUser,
    dto: OperatorCreateLessonSessionDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route: CREATE_ROUTE,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }
      const times = this.validateFutureTimes(dto.startsAt, dto.endsAt);

      const classGroup = await transaction.classGroup.findFirst({
        where: {
          id: dto.classGroupId,
          campusId: scope.campusId,
          status: 'ACTIVE',
          teacher: { isActive: true, user: { status: 'ACTIVE' } },
        },
        select: {
          id: true,
          teacherId: true,
          defaultLessonUnits: true,
          teacher: { select: { userId: true } },
        },
      });
      if (!classGroup) {
        this.notFound('The selected class is unavailable in this campus');
      }
      await lockOperatorScheduleResources(
        transaction,
        classGroup.teacherId,
        classGroup.id,
      );
      await transaction.$queryRaw`SELECT "id" FROM "User"
        WHERE "id" = ${classGroup.teacher.userId}::uuid FOR SHARE`;
      await transaction.$queryRaw`SELECT "id" FROM "TeacherProfile"
        WHERE "id" = ${classGroup.teacherId}::uuid FOR SHARE`;
      await transaction.$queryRaw`SELECT "id" FROM "ClassGroup"
        WHERE "id" = ${classGroup.id}::uuid AND "campusId" = ${scope.campusId}::uuid FOR SHARE`;
      const currentClass = await transaction.classGroup.findFirst({
        where: {
          id: classGroup.id,
          campusId: scope.campusId,
          status: 'ACTIVE',
          teacher: { isActive: true, user: { status: 'ACTIVE' } },
        },
        select: {
          id: true,
          teacherId: true,
          defaultLessonUnits: true,
          teacher: { select: { userId: true } },
        },
      });
      if (
        !currentClass ||
        currentClass.teacherId !== classGroup.teacherId ||
        currentClass.teacher.userId !== classGroup.teacher.userId ||
        currentClass.defaultLessonUnits !== classGroup.defaultLessonUnits
      ) {
        throw new DomainError(
          ErrorCode.CONFLICT,
          'The selected class changed; reload scheduling options',
          409,
        );
      }
      this.validateFutureTimes(dto.startsAt, dto.endsAt);
      await assertOperatorScheduleAvailable(transaction, {
        campusId: scope.campusId,
        teacherId: classGroup.teacherId,
        classGroupId: classGroup.id,
        ...times,
      });

      const created = await transaction.lessonSession.create({
        data: {
          campusId: scope.campusId,
          classGroupId: classGroup.id,
          teacherId: classGroup.teacherId,
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          kind: dto.kind,
          lessonUnits: classGroup.defaultLessonUnits,
          status: 'SCHEDULED',
          version: 1,
        },
        select: lessonViewSelect,
      });
      const result = this.toView(created);
      await this.writeAudit(transaction, {
        campusId: scope.campusId,
        actorUserId: scope.userId,
        action: 'OPERATOR_SCHEDULE_CREATE',
        resourceId: created.id,
        details: {
          classGroupId: created.classGroupId,
          teacherId: created.teacherId,
          startsAt: result.startsAt,
          endsAt: result.endsAt,
          kind: created.kind,
          lessonUnits: created.lessonUnits,
          version: created.version,
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route: CREATE_ROUTE,
        responseBody: this.asJson(result),
      });
      return result;
    });
  }

  async update(
    user: AuthenticatedUser,
    lessonSessionId: string,
    dto: OperatorUpdateLessonSessionDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    const route = `${CREATE_ROUTE}/${lessonSessionId}`;

    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      await this.lockLesson(transaction, scope.campusId, lessonSessionId);
      const times = this.validateFutureTimes(dto.startsAt, dto.endsAt);
      const current = await transaction.lessonSession.findFirst({
        where: { id: lessonSessionId, campusId: scope.campusId },
        select: lessonViewSelect,
      });
      if (!current) {
        this.notFound();
      }
      this.assertScheduled(current.status);
      this.assertNotStarted(current.startsAt);
      this.assertVersion(current.version, dto.version);
      await lockOperatorScheduleResources(
        transaction,
        current.teacherId,
        current.classGroupId,
      );
      this.assertNotStarted(current.startsAt);
      this.validateFutureTimes(dto.startsAt, dto.endsAt);
      await assertOperatorScheduleAvailable(transaction, {
        campusId: scope.campusId,
        teacherId: current.teacherId,
        classGroupId: current.classGroupId,
        excludeId: current.id,
        ...times,
      });

      const updatedCount = await transaction.lessonSession.updateMany({
        where: {
          id: lessonSessionId,
          campusId: scope.campusId,
          status: 'SCHEDULED',
          startsAt: { gt: new Date() },
          version: dto.version,
        },
        data: {
          startsAt: times.startsAt,
          endsAt: times.endsAt,
          kind: dto.kind,
          version: { increment: 1 },
        },
      });
      if (updatedCount.count !== 1) {
        await this.throwCurrentConflict(
          transaction,
          scope.campusId,
          lessonSessionId,
        );
      }

      const updated = await transaction.lessonSession.findUniqueOrThrow({
        where: { id: lessonSessionId },
        select: lessonViewSelect,
      });
      const result = this.toView(updated);
      await this.writeAudit(transaction, {
        campusId: scope.campusId,
        actorUserId: scope.userId,
        action: 'OPERATOR_SCHEDULE_UPDATE',
        resourceId: lessonSessionId,
        details: {
          before: {
            startsAt: current.startsAt.toISOString(),
            endsAt: current.endsAt.toISOString(),
            kind: current.kind,
            version: current.version,
          },
          after: {
            startsAt: result.startsAt,
            endsAt: result.endsAt,
            kind: result.kind,
            version: result.version,
          },
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: this.asJson(result),
      });
      return result;
    });
  }

  async cancel(
    user: AuthenticatedUser,
    lessonSessionId: string,
    dto: OperatorCancelLessonSessionDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    const route = `${CREATE_ROUTE}/${lessonSessionId}/cancel`;

    return this.prisma.$transaction(async (transaction) => {
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: scope.campusId,
        actorUserId: scope.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      await this.lockLesson(transaction, scope.campusId, lessonSessionId);
      const current = await transaction.lessonSession.findFirst({
        where: { id: lessonSessionId, campusId: scope.campusId },
        select: lessonViewSelect,
      });
      if (!current) {
        this.notFound();
      }
      this.assertScheduled(current.status);
      this.assertNotStarted(current.startsAt);
      this.assertVersion(current.version, dto.version);

      const updatedCount = await transaction.lessonSession.updateMany({
        where: {
          id: lessonSessionId,
          campusId: scope.campusId,
          status: 'SCHEDULED',
          startsAt: { gt: new Date() },
          version: dto.version,
        },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      if (updatedCount.count !== 1) {
        await this.throwCurrentConflict(
          transaction,
          scope.campusId,
          lessonSessionId,
        );
      }

      const cancelled = await transaction.lessonSession.findUniqueOrThrow({
        where: { id: lessonSessionId },
        select: lessonViewSelect,
      });
      const result = this.toView(cancelled);
      await this.writeAudit(transaction, {
        campusId: scope.campusId,
        actorUserId: scope.userId,
        action: 'OPERATOR_SCHEDULE_CANCEL',
        resourceId: lessonSessionId,
        details: {
          previousStatus: current.status,
          previousVersion: current.version,
          status: result.status,
          version: result.version,
        },
      });
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: this.asJson(result),
      });
      return result;
    });
  }

  private validateFutureTimes(startsAtValue: string, endsAtValue: string) {
    const startsAt = new Date(startsAtValue);
    const endsAt = new Date(endsAtValue);
    if (startsAt >= endsAt) {
      this.badRequest('The lesson start must be earlier than the lesson end');
    }
    if (startsAt <= new Date()) {
      this.badRequest('Only future lesson sessions can be scheduled');
    }
    return { startsAt, endsAt };
  }

  private async lockLesson(
    transaction: Prisma.TransactionClient,
    campusId: string,
    lessonSessionId: string,
  ): Promise<void> {
    // Recheck the clock after any competing attendance write releases this row.
    await transaction.$queryRaw`
      SELECT "id" FROM "LessonSession"
      WHERE "id" = ${lessonSessionId}::uuid AND "campusId" = ${campusId}::uuid
      FOR UPDATE
    `;
  }

  private assertScheduled(status: LessonViewRecord['status']): void {
    if (status !== 'SCHEDULED') {
      throw new DomainError(
        ErrorCode.CONFLICT,
        'Only scheduled lesson sessions can be changed',
        409,
        { currentStatus: status },
      );
    }
  }

  private assertNotStarted(startsAt: Date): void {
    if (startsAt <= new Date()) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        'Only lesson sessions that have not started can be changed',
        409,
      );
    }
  }

  private assertVersion(
    currentVersion: number,
    requestedVersion: number,
  ): void {
    if (currentVersion !== requestedVersion) {
      this.versionConflict(currentVersion);
    }
  }

  private async throwCurrentConflict(
    transaction: Prisma.TransactionClient,
    campusId: string,
    lessonSessionId: string,
  ): Promise<never> {
    const current = await transaction.lessonSession.findFirst({
      where: { id: lessonSessionId, campusId },
      select: { status: true, startsAt: true, version: true },
    });
    if (!current) {
      this.notFound();
    }
    this.assertScheduled(current.status);
    this.assertNotStarted(current.startsAt);
    this.versionConflict(current.version);
  }

  private toView(session: LessonViewRecord) {
    return {
      id: session.id,
      campusId: session.campusId,
      classGroupId: session.classGroupId,
      seriesId: session.seriesId,
      className: session.classGroup.name,
      courseName: session.classGroup.courseName,
      teacherId: session.teacherId,
      teacherName: session.teacher.user.displayName,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      kind: session.kind,
      lessonUnits: session.lessonUnits,
      status: session.status,
      version: session.version,
    };
  }

  private writeAudit(
    transaction: Prisma.TransactionClient,
    input: {
      campusId: string;
      actorUserId: string;
      action: string;
      resourceId: string;
      details: Prisma.InputJsonValue;
    },
  ) {
    return transaction.auditLog.create({
      data: {
        campusId: input.campusId,
        actorUserId: input.actorUserId,
        action: input.action,
        resourceType: 'LessonSession',
        resourceId: input.resourceId,
        outcome: 'SUCCESS',
        details: input.details,
      },
    });
  }

  private badRequest(message: string): never {
    throw new DomainError(ErrorCode.BAD_REQUEST, message, 400);
  }

  private notFound(message = 'Lesson session was not found'): never {
    throw new DomainError(ErrorCode.RESOURCE_NOT_FOUND, message, 404);
  }

  private versionConflict(currentVersion: number): never {
    throw new DomainError(
      ErrorCode.LESSON_VERSION_CONFLICT,
      'The lesson session version has changed',
      409,
      { currentVersion },
    );
  }

  private asJson(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
