import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ReasonedActionDto, VersionedActionDto } from './dto/earning.dto';
import { EarningQueryService } from './earning-query.service';

@Injectable()
export class EarningReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
    private readonly earningQueryService: EarningQueryService,
  ) {}

  approve(
    actor: AuthenticatedUser,
    entryId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    return this.review(actor, entryId, dto, idempotencyKey, 'APPROVE');
  }

  reject(
    actor: AuthenticatedUser,
    entryId: string,
    dto: ReasonedActionDto,
    idempotencyKey: string,
  ) {
    return this.review(actor, entryId, dto, idempotencyKey, 'REJECT');
  }

  private async review(
    actor: AuthenticatedUser,
    entryId: string,
    dto: VersionedActionDto | ReasonedActionDto,
    idempotencyKey: string,
    action: 'APPROVE' | 'REJECT',
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "TeacherEarningEntry"
        WHERE "id" = ${entryId}::uuid
        FOR UPDATE
      `;
      if (!locked[0]) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'The teacher earning entry was not found',
          404,
        );
      }
      const entry = await transaction.teacherEarningEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: { teacher: { select: { userId: true } } },
      });
      const route = `/management/teacher-earnings/${entryId}/${action.toLowerCase()}`;
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: entry.campusId,
        actorUserId: actor.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      if (entry.teacher.userId === actor.userId) {
        throw new DomainError(
          ErrorCode.FORBIDDEN,
          'A teacher cannot review their own earning',
          403,
        );
      }
      if (entry.status === 'REVERSED') {
        throw new DomainError(
          ErrorCode.EARNING_REVERSED,
          'A reversed earning cannot be reviewed',
          409,
        );
      }
      if (entry.status !== 'PENDING_REVIEW') {
        throw new DomainError(
          ErrorCode.EARNING_ALREADY_REVIEWED,
          'The earning has already been reviewed',
          409,
        );
      }
      if (entry.version !== dto.expectedVersion) {
        throw new DomainError(
          ErrorCode.EARNING_ALREADY_REVIEWED,
          'The earning version has changed',
          409,
          { currentVersion: entry.version },
        );
      }
      const reviewedAt = new Date();
      if (entry.reviewableAt > reviewedAt) {
        throw new DomainError(
          ErrorCode.EARNING_NOT_REVIEWABLE,
          'The earning has not reached its review time',
          409,
          { reviewableAt: entry.reviewableAt.toISOString() },
        );
      }

      const updated = await transaction.teacherEarningEntry.updateMany({
        where: {
          id: entry.id,
          version: entry.version,
          status: 'PENDING_REVIEW',
        },
        data: {
          status: action === 'APPROVE' ? 'AVAILABLE' : 'REJECTED',
          reviewedByUserId: actor.userId,
          reviewedAt,
          reviewReason:
            action === 'REJECT' && 'reason' in dto ? dto.reason.trim() : null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new DomainError(
          ErrorCode.EARNING_ALREADY_REVIEWED,
          'The earning was changed by another reviewer',
          409,
        );
      }
      await transaction.auditLog.create({
        data: {
          campusId: entry.campusId,
          actorUserId: actor.userId,
          action: `TEACHER_EARNING_${action}`,
          resourceType: 'TeacherEarningEntry',
          resourceId: entry.id,
          outcome: 'SUCCESS',
          details: {
            beforeStatus: entry.status,
            afterStatus: action === 'APPROVE' ? 'AVAILABLE' : 'REJECTED',
            beforeVersion: entry.version,
          },
        },
      });
      const result = await this.earningQueryService.getEntryView(
        entry.id,
        transaction,
      );
      await this.idempotencyService.complete(transaction, {
        key: idempotencyKey,
        route,
        responseBody: asJson(result),
      });
      return result;
    });
  }
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
