import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type WithdrawalStatus =
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PAYING'
  | 'PAID'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FAILED';

const transitions: Readonly<
  Record<WithdrawalStatus, readonly WithdrawalStatus[]>
> = {
  SUBMITTED: ['APPROVED', 'CANCELLED', 'REJECTED'],
  APPROVED: ['PAYING', 'FAILED'],
  PAYING: ['PAID', 'FAILED'],
  PAID: [],
  CANCELLED: [],
  REJECTED: [],
  FAILED: [],
};

export function assertWithdrawalTransition(
  from: WithdrawalStatus,
  to: WithdrawalStatus,
): void {
  if (!transitions[from].includes(to)) {
    throw new DomainError(
      ErrorCode.WITHDRAWAL_STATUS_CONFLICT,
      'Withdrawal status transition is not allowed',
      409,
      { from, to },
    );
  }
}
