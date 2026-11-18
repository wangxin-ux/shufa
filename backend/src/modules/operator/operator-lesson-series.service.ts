import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { OperatorScopeService } from '../../common/auth/operator-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  OperatorCancellationPreviewDto,
  OperatorCancelSelectionDto,
  OperatorCreateSeriesDto,
  OperatorSeriesPatternDto,
} from './dto/operator-lesson-series.dto';
import {
  expandOperatorSeries,
  SHANGHAI_TIMEZONE,
} from './operator-series-dates';
import { lockOperatorScheduleResources } from './operator-scheduling-conflicts';

const ROUTE = '/operators/me/lesson-series';
const groupSelect = {
  id: true,
  campusId: true,
  teacherId: true,
  status: true,
  defaultLessonUnits: true,
  updatedAt: true,
  teacher: {
    select: {
      id: true,
      userId: true,
      campusId: true,
      isActive: true,
      updatedAt: true,
      user: { select: { status: true, updatedAt: true, accountVersion: true } },
    },
  },
} satisfies Prisma.ClassGroupSelect;
const sessionSelect = {
  id: true,
  campusId: true,
  seriesId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  version: true,
} satisfies Prisma.LessonSessionSelect;
type Group = Prisma.ClassGroupGetPayload<{ select: typeof groupSelect }>;
type Session = Prisma.LessonSessionGetPayload<{ select: typeof sessionSelect }>;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const view = (
  row: Pick<Session, 'id' | 'startsAt' | 'endsAt' | 'version'>,
) => ({
  id: row.id,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  version: row.version,
});

@Injectable()
export class OperatorLessonSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OperatorScopeService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async preview(user: AuthenticatedUser, dto: OperatorSeriesPatternDto) {
    const scope = this.scopeService.require(user);
    return this.prisma.$transaction(
      async (tx) => {
        const built = await this.buildPreview(tx, scope.campusId, dto);
        return built.preview;
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(
    user: AuthenticatedUser,
    dto: OperatorCreateSeriesDto,
    key: string,
  ) {
    const scope = this.scopeService.require(user);
    return this.prisma.$transaction(
      async (tx) => {
        const claim = await this.idempotency.claim(tx, {
          key,
          route: ROUTE,
          request: dto,
          campusId: scope.campusId,
          actorUserId: scope.userId,
        });
        if (claim.replayed) return claim.responseBody;
        const initial = await this.group(tx, scope.campusId, dto.classGroupId);
        await lockOperatorScheduleResources(tx, initial.teacherId, initial.id);
        // Staff changes lock User before TeacherProfile. Keep the same order.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${initial.teacher.userId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "TeacherProfile" WHERE "id" = ${initial.teacherId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "ClassGroup" WHERE "id" = ${initial.id}::uuid AND "campusId" = ${scope.campusId}::uuid FOR SHARE`;
        const built = await this.buildPreview(tx, scope.campusId, dto);
        if (
          built.group.teacherId !== initial.teacherId ||
          built.group.teacher.userId !== initial.teacher.userId
        )
          conflict('The selected teacher changed; preview again');
        if (built.preview.conflictDates.length) {
          conflict('The teacher or class has overlapping lessons', {
            conflictDates: built.preview.conflictDates,
          });
        }
        if (built.preview.previewHash !== dto.previewHash)
          conflict('The preview or class configuration changed; preview again');
        const series = await tx.lessonSeries.create({
          data: {
            campusId: scope.campusId,
            createdByUserId: scope.userId,
            configuration: json(built.configuration),
            version: 1,
          },
        });
        const sessions = [];
        for (const times of built.dates) {
          this.future(times.startsAt);
          const created = await tx.lessonSession.create({
            data: {
              campusId: scope.campusId,
              seriesId: series.id,
              classGroupId: built.group.id,
              teacherId: built.group.teacherId,
              startsAt: times.startsAt,
              endsAt: times.endsAt,
              kind: dto.kind,
              lessonUnits: built.group.defaultLessonUnits,
              status: 'SCHEDULED',
              version: 1,
            },
            select: sessionSelect,
          });
          sessions.push(view(created));
          await this.audit(
            tx,
            scope,
            'OPERATOR_SCHEDULE_CREATE',
            'LessonSession',
            created.id,
            {
              seriesId: series.id,
              ...view(created),
              classGroupId: built.group.id,
              teacherId: built.group.teacherId,
              lessonUnits: built.group.defaultLessonUnits,
              kind: dto.kind,
            },
          );
        }
        this.future(built.dates[0].startsAt);
        const result = {
          seriesId: series.id,
          version: series.version,
          sessions,
        };
        await this.audit(
          tx,
          scope,
          'OPERATOR_SERIES_CREATE',
          'LessonSeries',
          series.id,
          {
            configuration: built.configuration,
            sessionIds: sessions.map((row) => row.id),
            version: series.version,
          },
        );
        await this.idempotency.complete(tx, {
          key,
          route: ROUTE,
          responseBody: json(result),
        });
        return result;
      },
      { isolationLevel: 'ReadCommitted', timeout: 15_000 },
    );
  }

  async previewCancellation(
    user: AuthenticatedUser,
    id: string,
    dto: OperatorCancellationPreviewDto,
  ) {
    const scope = this.scopeService.require(user);
    return this.prisma.$transaction(
      (tx) => this.cancellation(tx, scope.campusId, id, dto.mode),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async cancelSelection(
    user: AuthenticatedUser,
    id: string,
    dto: OperatorCancelSelectionDto,
    key: string,
  ) {
    const scope = this.scopeService.require(user);
    const route = `/operators/me/lesson-sessions/${id}/cancel-selection`;
    return this.prisma.$transaction(
      async (tx) => {
        const claim = await this.idempotency.claim(tx, {
          key,
          route,
          request: dto,
          campusId: scope.campusId,
          actorUserId: scope.userId,
        });
        if (claim.replayed) return claim.responseBody;
        const initial = await this.session(tx, scope.campusId, id);
        if (dto.mode === 'FOLLOWING') {
          if (!initial.seriesId)
            conflict('The selected lesson is not part of a series');
          // Lock every existing member in one stable order; time edits cannot slip across the boundary.
          await tx.$queryRaw`SELECT "id" FROM "LessonSession"
          WHERE "seriesId" = ${initial.seriesId}::uuid AND "campusId" = ${scope.campusId}::uuid
          ORDER BY "id" FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT "id" FROM "LessonSession"
          WHERE "id" = ${id}::uuid AND "campusId" = ${scope.campusId}::uuid FOR UPDATE`;
        }
        const current = await this.cancellation(
          tx,
          scope.campusId,
          id,
          dto.mode,
        );
        if (current.previewHash !== dto.previewHash)
          conflict('The affected lessons changed; preview again');
        const sessions = [];
        for (const row of current.sessions) {
          const changed = await tx.lessonSession.updateMany({
            where: {
              id: row.id,
              campusId: scope.campusId,
              version: row.version,
              status: 'SCHEDULED',
              startsAt: { gt: new Date() },
            },
            data: { status: 'CANCELLED', version: { increment: 1 } },
          });
          if (changed.count !== 1)
            conflict('A selected lesson changed or started; preview again');
          const cancelled = {
            ...row,
            version: row.version + 1,
            status: 'CANCELLED' as const,
          };
          sessions.push(cancelled);
          await this.audit(
            tx,
            scope,
            'OPERATOR_SCHEDULE_CANCEL',
            'LessonSession',
            row.id,
            {
              seriesId: current.seriesId,
              mode: dto.mode,
              before: row,
              after: cancelled,
            },
          );
        }
        if (current.seriesId) {
          const series = await tx.lessonSeries.update({
            where: { id: current.seriesId },
            data: { version: { increment: 1 } },
          });
          await this.audit(
            tx,
            scope,
            'OPERATOR_SERIES_CANCEL',
            'LessonSeries',
            series.id,
            {
              mode: dto.mode,
              selectedId: id,
              sessionIds: sessions.map((row) => row.id),
              version: series.version,
            },
          );
        }
        const result = { seriesId: current.seriesId, sessions };
        await this.idempotency.complete(tx, {
          key,
          route,
          responseBody: json(result),
        });
        return result;
      },
      { isolationLevel: 'ReadCommitted', timeout: 15_000 },
    );
  }

  private async buildPreview(
    tx: Prisma.TransactionClient,
    campusId: string,
    dto: OperatorSeriesPatternDto,
  ) {
    const dates = expandOperatorSeries(dto);
    this.future(dates[0].startsAt);
    const group = await this.group(tx, campusId, dto.classGroupId);
    const existing = await tx.lessonSession.findMany({
      where: {
        campusId,
        status: { not: 'CANCELLED' },
        OR: [{ classGroupId: group.id }, { teacherId: group.teacherId }],
        startsAt: { lt: dates[dates.length - 1].endsAt },
        endsAt: { gt: dates[0].startsAt },
      },
      select: { startsAt: true, endsAt: true },
    });
    const conflictDates = dates
      .filter((candidate) =>
        existing.some(
          (row) =>
            row.startsAt < candidate.endsAt && row.endsAt > candidate.startsAt,
        ),
      )
      .map((row) => row.date);
    const configuration = {
      pattern: {
        classGroupId: dto.classGroupId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        intervalWeeks: dto.intervalWeeks,
        weekdays: [...dto.weekdays].sort((a, b) => a - b),
        startTime: dto.startTime,
        endTime: dto.endTime,
        kind: dto.kind,
      },
      class: {
        id: group.id,
        teacherId: group.teacherId,
        lessonUnits: group.defaultLessonUnits,
        updatedAt: group.updatedAt.toISOString(),
      },
      teacher: {
        id: group.teacher.id,
        userId: group.teacher.userId,
        updatedAt: group.teacher.updatedAt.toISOString(),
        userUpdatedAt: group.teacher.user.updatedAt.toISOString(),
        accountVersion: group.teacher.user.accountVersion,
      },
    };
    const sessions = dates.map((row) => ({
      date: row.date,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    }));
    return {
      dates,
      group,
      configuration,
      preview: {
        timezone: SHANGHAI_TIMEZONE,
        sessions,
        conflictDates,
        previewHash: hash({ campusId, configuration, sessions, conflictDates }),
      },
    };
  }

  private async group(
    tx: Prisma.TransactionClient,
    campusId: string,
    id: string,
  ): Promise<Group> {
    const group = await tx.classGroup.findFirst({
      where: {
        id,
        campusId,
        status: 'ACTIVE',
        teacher: { campusId, isActive: true, user: { status: 'ACTIVE' } },
      },
      select: groupSelect,
    });
    if (!group)
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'The selected class or teacher is unavailable',
        404,
      );
    return group;
  }

  private async session(
    tx: Prisma.TransactionClient,
    campusId: string,
    id: string,
  ): Promise<Session> {
    const session = await tx.lessonSession.findFirst({
      where: { id, campusId },
      select: sessionSelect,
    });
    if (!session)
      throw new DomainError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Lesson session was not found',
        404,
      );
    return session;
  }

  private async cancellation(
    tx: Prisma.TransactionClient,
    campusId: string,
    id: string,
    mode: 'THIS' | 'FOLLOWING',
  ) {
    const selected = await this.session(tx, campusId, id);
    const now = new Date();
    if (selected.status !== 'SCHEDULED' || selected.startsAt <= now)
      conflict('Only future scheduled lessons can be cancelled');
    if (mode === 'FOLLOWING' && !selected.seriesId)
      conflict('The selected lesson is not part of a series');
    const rows =
      mode === 'THIS'
        ? [selected]
        : await tx.lessonSession.findMany({
            where: { campusId, seriesId: selected.seriesId },
            select: sessionSelect,
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          });
    const sessions = rows
      .filter(
        (row) =>
          row.campusId === campusId &&
          row.status === 'SCHEDULED' &&
          row.startsAt > now &&
          row.startsAt >= selected.startsAt,
      )
      .sort(
        (a, b) =>
          a.startsAt.getTime() - b.startsAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .map(view);
    if (sessions.length < 1 || sessions.length > 50)
      conflict('The affected lesson selection is invalid');
    return {
      seriesId: selected.seriesId,
      sessions,
      previewHash: hash({
        campusId,
        selectedId: id,
        mode,
        seriesId: selected.seriesId,
        sessions,
      }),
    };
  }

  private future(start: Date) {
    if (start <= new Date())
      throw new DomainError(
        ErrorCode.BAD_REQUEST,
        'Every generated lesson must still be in the future',
        400,
      );
  }

  private audit(
    tx: Prisma.TransactionClient,
    scope: { campusId: string; userId: string },
    action: string,
    resourceType: string,
    resourceId: string,
    details: unknown,
  ) {
    return tx.auditLog.create({
      data: {
        campusId: scope.campusId,
        actorUserId: scope.userId,
        action,
        resourceType,
        resourceId,
        outcome: 'SUCCESS',
        details: json(details),
      },
    });
  }
}

function conflict(
  message: string,
  details: Record<string, unknown> = {},
): never {
  throw new DomainError(ErrorCode.CONFLICT, message, 409, details);
}
