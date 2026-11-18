import type { OperatorEarningEntry, OperatorEarningSummary } from '../../types/operator-earning';

// Deterministic demonstration facts; the summary is supplied independently from journal pages.
export const OPERATOR_EARNING_SUMMARY: OperatorEarningSummary = {
  estimatedTotalFen: 20888, pendingReviewFen: 4088, currency: 'CNY',
  serverTime: '2026-10-29T04:00:00Z', timezone: 'Asia/Shanghai',
};
export const OPERATOR_EARNING_ENTRIES: OperatorEarningEntry[] = Array.from({ length: 48 }, (_, index) => {
  const reversal = index % 6 === 1;
  return {
    id: `ae200000-0000-4000-8000-${String(48 - index).padStart(12, '0')}`,
    entryType: reversal ? 'REVERSAL' : 'ACCRUAL',
    status: reversal ? 'REVERSED' : index % 6 === 2 ? 'REJECTED' : index % 6 === 3 ? 'AVAILABLE' : 'PENDING_REVIEW',
    amountFen: reversal ? -100 : 100,
    createdAt: new Date(Date.UTC(2026, 9, 29, 4, 0, -index)).toISOString(),
    completedAt: '2026-10-28T03:00:00Z',
  };
});
