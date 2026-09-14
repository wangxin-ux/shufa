import { DomainError } from '../../common/errors/domain-error';

export const REFUND_STATUSES = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'PAYING',
  'UNCERTAIN',
  'PAID',
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const REFUND_ACTIONS = [
  'APPROVE',
  'REJECT',
  'WITHDRAW',
  'START_PAYMENT',
  'MARK_UNCERTAIN',
  'REQUEST_CANCELLATION',
  'CONFIRM_CANCELLATION',
  'DENY_CANCELLATION',
  'RECORD_PAYMENT',
] as const;
export type RefundAction = (typeof REFUND_ACTIONS)[number];
export const RESERVED_REFUND_STATUSES: RefundStatus[] = [
  'SUBMITTED',
  'APPROVED',
  'CANCEL_REQUESTED',
  'PAYING',
  'UNCERTAIN',
];
export const REVIEW_ACTIONS: RefundAction[] = [
  'APPROVE',
  'REJECT',
  'CONFIRM_CANCELLATION',
  'DENY_CANCELLATION',
];

const transitions: Partial<
  Record<RefundStatus, Partial<Record<RefundAction, RefundStatus>>>
> = {
  SUBMITTED: { APPROVE: 'APPROVED', REJECT: 'REJECTED', WITHDRAW: 'WITHDRAWN' },
  APPROVED: {
    START_PAYMENT: 'PAYING',
    REQUEST_CANCELLATION: 'CANCEL_REQUESTED',
  },
  CANCEL_REQUESTED: {
    CONFIRM_CANCELLATION: 'CANCELLED',
    DENY_CANCELLATION: 'APPROVED',
  },
  PAYING: { MARK_UNCERTAIN: 'UNCERTAIN', RECORD_PAYMENT: 'PAID' },
  UNCERTAIN: { RECORD_PAYMENT: 'PAID' },
};

export function refundTransition(
  status: RefundStatus,
  action: RefundAction,
): RefundStatus {
  const next = transitions[status]?.[action];
  if (!next)
    throw new DomainError(
      'CONFLICT',
      'Refund state does not allow this action',
      409,
    );
  return next;
}

export function refundReferenceFen(
  amountFen: number,
  initialMainUnits: number,
  mainUnits: number,
): number {
  if (
    ![amountFen, initialMainUnits, mainUnits].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    amountFen > 2147483647 ||
    initialMainUnits > 100000000 ||
    mainUnits > initialMainUnits
  ) {
    throw new DomainError(
      'BAD_REQUEST',
      'Invalid original refund ratio or lesson quantity',
      400,
    );
  }
  const numerator = BigInt(amountFen) * BigInt(mainUnits);
  const denominator = BigInt(initialMainUnits);
  return Number((2n * numerator + denominator) / (2n * denominator));
}
