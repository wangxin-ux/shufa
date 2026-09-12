import { DomainError } from '../../common/errors/domain-error';

export const CORRECTION_STATUSES = [
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
  'APPLIED',
] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CORRECTION_ACTIONS = [
  'APPROVE',
  'REJECT',
  'WITHDRAW',
  'APPLY',
] as const;
export type CorrectionAction = (typeof CORRECTION_ACTIONS)[number];
export type CorrectionType = 'VOID' | 'REPLACE';

export const CORRECTION_REVIEW_ACTIONS: CorrectionAction[] = [
  'APPROVE',
  'REJECT',
];

const transitions: Partial<
  Record<CorrectionStatus, Partial<Record<CorrectionAction, CorrectionStatus>>>
> = {
  SUBMITTED: {
    APPROVE: 'APPROVED',
    REJECT: 'REJECTED',
    WITHDRAW: 'WITHDRAWN',
  },
  APPROVED: { APPLY: 'APPLIED' },
};

export function correctionTransition(
  status: CorrectionStatus,
  action: CorrectionAction,
): CorrectionStatus {
  const next = transitions[status]?.[action];
  if (!next) {
    throw new DomainError(
      'CONFLICT',
      'Finance correction state does not allow this action',
      409,
    );
  }
  return next;
}

export function correctionEffectFen(
  type: CorrectionType,
  originalAmountFen: number,
  replacementAmountFen: number | null,
): number {
  if (
    !Number.isSafeInteger(originalAmountFen) ||
    originalAmountFen <= 0 ||
    (type === 'REPLACE' &&
      (!Number.isSafeInteger(replacementAmountFen) ||
        (replacementAmountFen ?? 0) <= 0))
  ) {
    throw new DomainError('BAD_REQUEST', 'Invalid correction amount', 400);
  }
  return type === 'VOID'
    ? -originalAmountFen
    : (replacementAmountFen as number) - originalAmountFen;
}
