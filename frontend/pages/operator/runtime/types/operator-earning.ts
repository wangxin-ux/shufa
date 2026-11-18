import type { OperatorPageMeta } from './operator';

export const OPERATOR_EARNING_STATUSES = [
  { value: '', label: '全部状态' },
  { value: 'PENDING_REVIEW', label: '待审核' },
  { value: 'AVAILABLE', label: '已确认' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'REVERSED', label: '已冲正' },
] as const;
export const OPERATOR_EARNING_TYPES = [
  { value: '', label: '全部类型' },
  { value: 'ACCRUAL', label: '收益登记' },
  { value: 'REVERSAL', label: '收益冲正' },
] as const;
export type OperatorEarningStatus = Exclude<typeof OPERATOR_EARNING_STATUSES[number]['value'], ''>;
export type OperatorEarningEntryType = Exclude<typeof OPERATOR_EARNING_TYPES[number]['value'], ''>;
export interface OperatorEarningQuery {
  page: number; pageSize: number; status?: OperatorEarningStatus; entryType?: OperatorEarningEntryType;
}
export interface OperatorEarningSummary {
  estimatedTotalFen: number | null; pendingReviewFen: number | null;
  currency: 'CNY'; serverTime: string; timezone: string;
}
export interface OperatorEarningEntry {
  id: string; entryType: OperatorEarningEntryType; status: OperatorEarningStatus;
  amountFen: number; createdAt: string; completedAt: string;
}
export interface OperatorEarningEntries {
  data: OperatorEarningEntry[]; meta: OperatorPageMeta; serverTime: string; timezone: string;
}
