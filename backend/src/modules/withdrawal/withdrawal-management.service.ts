import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { ManualPayoutAdapter } from '../../infrastructure/payout/manual-payout.adapter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  ReasonedActionDto,
  VersionedActionDto,
} from '../earning/dto/earning.dto';
import type { MarkWithdrawalPaidDto } from './dto/withdrawal.dto';
import { lockWithdrawal, WithdrawalService } from './withdrawal.service';
import {
  assertWithdrawalTransition,
  type WithdrawalStatus,
} from './withdrawal-state';

type WithdrawalAction =
  'approve' | 'reject' | 'mark-paying' | 'mark-paid' | 'mark-failed';

@Injectable()
export class WithdrawalManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencyService: IdempotencyService,
    private readonly manualPayoutAdapter: ManualPayoutAdapter,
    private readonly withdrawalService: WithdrawalService,
  ) {}

  approve(
    actor: AuthenticatedUser,
    withdrawalId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      withdrawalId,
      dto,
      idempotencyKey,
      'approve',
      'APPROVED',
    );
  }

  reject(
    actor: AuthenticatedUser,
    withdrawalId: string,
    dto: ReasonedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      withdrawalId,
      dto,
      idempotencyKey,
      'reject',
      'REJECTED',
    );
  }

  markPaying(
    actor: AuthenticatedUser,
    withdrawalId: string,
    dto: VersionedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      withdrawalId,
      dto,
      idempotencyKey,
      'mark-paying',
      'PAYING',
    );
  }

  markFailed(
    actor: AuthenticatedUser,
    withdrawalId: string,
    dto: ReasonedActionDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      withdrawalId,
      dto,
      idempotencyKey,
      'mark-failed',
      'FAILED',
    );
  }

  markPaid(
    actor: AuthenticatedUser,
    withdrawalId: string,
    dto: MarkWithdrawalPaidDto,
    idempotencyKey: string,
  ) {
    return this.transition(
      actor,
      withdrawalId,
      dto,
      idempotencyKey,
      'mark-paid',
      'PAID',
    );
  }

  private async transition(
    actor: AuthenticatedUser,
    withdrawalId: string,
    dto: VersionedActionDto | ReasonedActionDto | MarkWithdrawalPaidDto,
    idempotencyKey: string,
    action: WithdrawalAction,
    targetStatus: WithdrawalStatus,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      await lockWithdrawal(transaction, withdrawalId);
      const withdrawal = await transaction.withdrawal.findUnique({
        where: { id: withdrawalId },
      });
      if (!withdrawal) {
        throw new DomainError(
          ErrorCode.RESOURCE_NOT_FOUND,
          'The withdrawal was not found',
          404,
        );
      }
      const route = `/management/withdrawals/${withdrawalId}/${action}`;
      const claim = await this.idempotencyService.claim(transaction, {
        key: idempotencyKey,
        route,
        request: dto,
        campusId: withdrawal.campusId,
        actorUserId: actor.userId,
      });
      if (claim.replayed) {
        return claim.responseBody;
      }

      if (
        (action === 'approve' || action === 'reject') &&
        withdrawal.requestedByUserId === actor.userId
      ) {
        throw new DomainError(
          ErrorCode.WITHDRAWAL_SELF_REVIEW_FORBIDDEN,
          'A teacher cannot review their own withdrawal',
          403,
        );
      }
      if (withdrawal.version !== dto.expectedVersion) {
        this.statusConflict(withdrawal);
      }
      assertWithdrawalTransition(withdrawal.status, targetStatus);

      const now = new Date();
      const update: Prisma.WithdrawalUncheckedUpdateManyInput = {
        status: targetStatus,
        version: { increment: 1 },
      };
      if (action === 'approve') {
        update.reviewedByUserId = actor.userId;
        update.reviewedAt = now;
        update.rejectionReason = null;
      } else if (action === 'reject') {
        update.reviewedByUserId = actor.userId;
        update.reviewedAt = now;
        update.rejectionReason = readReason(dto);
      } else if (action === 'mark-paying') {
        update.payingAt = now;
      } else if (action === 'mark-failed') {
        update.failedAt = now;
        update.failureReason = readReason(dto);
      } else {
        const paid = dto as MarkWithdrawalPaidDto;
        const proof = await transaction.storedFile.findFirst({
          where: { id: paid.payoutProofFileId, purpose: 'PAYOUT_PROOF' },
          select: { id: true },
        });
        if (!proof) {
          throw new DomainError(
            ErrorCode.PAYOUT_PROOF_REQUIRED,
            'A valid local payout proof is required',
            400,
          );
        }
        const payout = await this.manualPayoutAdapter.markPaid({
          withdrawalId,
          payoutReference: paid.payoutReference,
          payoutProofFileId: proof.id,
        });
        update.paidByUserId = actor.userId;
        update.paidAt = payout.paidAt;
        update.payoutReference = paid.payoutReference.trim();
        update.payoutProofFileId = proof.id;
      }

      const changed = await transaction.withdrawal.updateMany({
        where: {
          id: withdrawal.id,
          version: withdrawal.version,
          status: withdrawal.status,
        },
        data: update,
      });
      if (changed.count !== 1) {
        this.statusConflict(withdrawal);
      }
      await transaction.auditLog.create({
        data: {
          campusId: withdrawal.campusId,
          actorUserId: actor.userId,
          action: `TEACHER_WITHDRAWAL_${action.toUpperCase().replace('-', '_')}`,
          resourceType: 'Withdrawal',
          resourceId: withdrawal.id,
          outcome: 'SUCCESS',
          details: {
            beforeStatus: withdrawal.status,
            afterStatus: targetStatus,
            beforeVersion: withdrawal.version,
          },
        },
      });
      const result = await this.withdrawalService.getView(
        withdrawal.id,
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

  private statusConflict(withdrawal: {
    id: string;
    status: string;
    version: number;
  }): never {
    throw new DomainError(
      ErrorCode.WITHDRAWAL_STATUS_CONFLICT,
      'The withdrawal status or version has changed',
      409,
      withdrawal,
    );
  }
}

function readReason(
  dto: VersionedActionDto | ReasonedActionDto | MarkWithdrawalPaidDto,
): string {
  return 'reason' in dto ? dto.reason.trim() : '';
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
