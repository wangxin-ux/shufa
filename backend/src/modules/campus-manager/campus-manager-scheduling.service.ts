import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { CampusManagerScopeService } from '../../common/auth/campus-manager-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  CampusManagerCancelLessonSessionDto,
  CampusManagerCreateLessonSessionDto,
  CampusManagerLessonSessionsQueryDto,
  CampusManagerUpdateLessonSessionDto,
} from './dto/campus-manager-scheduling.dto';

const CREATE_ROUTE = '/campus-managers/me/lesson-sessions';

const lessonViewSelect = {
  id: true,
  campusId: true,
  classGroupId: true,
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
export class CampusManagerSchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: CampusManagerScopeService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: CampusManagerLessonSessionsQueryDto,
  ) {
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
    dto: CampusManagerCreateLessonSessionDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    const times = this.validateFutureTimes(dto.startsAt, dto.endsAt);

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
        },
      });
      if (!classGroup) {
        this.notFound('The selected class is unavailable in this campus');
      }

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
        action: 'CAMPUS_SCHEDULE_CREATE',
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
    dto: CampusManagerUpdateLessonSessionDto,
    idempotencyKey: string,
  ) {
    const scope = this.scopeService.require(user);
    const times = this.validateFutureTimes(dto.startsAt, dto.endsAt);
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

      const current = await transaction.lessonSession.findFirst({
        where: { id: lessonSessionId, campusId: scope.campusId },
        select: lessonViewSelect,
      });
      if (!current) {
        this.notFound();
      }
      this.assertScheduled(current.status);
      this.assertVersion(current.version, dto.version);

      const updatedCount = await transaction.lessonSession.updateMany({
        where: {
          id: lessonSessionId,
          campusId: scope.campusId,
          status: 'SCHEDULED',
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
        action: 'CAMPUS_SCHEDULE_UPDATE',
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
    dto: CampusManagerCancelLessonSessionDto,
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

      const current = await transaction.lessonSession.findFirst({
        where: { id: lessonSessionId, campusId: scope.campusId },
        select: lessonViewSelect,
      });
      if (!current) {
        this.notFound();
      }
      this.assertScheduled(current.status);
      this.assertVersion(current.version, dto.version);

      const updatedCount = await transaction.lessonSession.updateMany({
        where: {
          id: lessonSessionId,
          campusId: scope.campusId,
          status: 'SCHEDULED',
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
        action: 'CAMPUS_SCHEDULE_CANCEL',
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
      select: { status: true, version: true },
    });
    if (!current) {
      this.notFound();
    }
    this.assertScheduled(current.status);
    this.versionConflict(current.version);
  }

  private toView(session: LessonViewRecord) {
    return {
      id: session.id,
      campusId: session.campusId,
      classGroupId: session.classGroupId,
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
