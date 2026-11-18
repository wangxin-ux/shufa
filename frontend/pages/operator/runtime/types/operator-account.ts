import type { OperatorPageMeta } from './operator';

export const OPERATOR_ACCOUNT_CATEGORIES = [
  { value: '', label: '全部类别' },
  { value: 'GRANT', label: '发放' },
  { value: 'CONSUME', label: '消费' },
  { value: 'REVERSAL', label: '反向恢复' },
  { value: 'ADJUSTMENT', label: '调整' },
  { value: 'REFUND', label: '退费' },
  { value: 'CORRECTION', label: '纠错' },
] as const;
export type OperatorAccountEntryType = Exclude<typeof OPERATOR_ACCOUNT_CATEGORIES[number]['value'], ''>;
export interface OperatorAccountQuery {
  page: number; pageSize: number; entryType?: OperatorAccountEntryType; subjectId?: string;
}
export interface OperatorAccountSubjectQuery { page: number; pageSize: number; query?: string }
export interface OperatorAccountSubject { id: string; name: string; isActive: boolean; version: number }
export interface OperatorAccountSubjects {
  data: OperatorAccountSubject[]; meta: OperatorPageMeta; serverTime: string; timezone: string;
}
export interface OperatorAccountLedgerRow {
  id: string; studentId: string; studentName: string; packageName: string;
  subject: { id: string; name: string } | null;
  entryType: OperatorAccountEntryType; bucket: 'MAIN' | 'GIFT';
  deltaUnits: number; balanceBeforeUnits: number; balanceAfterUnits: number;
  reason: string | null; createdAt: string;
  paymentContext: { receivedOn: string } | { paidAt: string } | null;
  teachingContext: { courseName: string; teacherName: string; lessonStartsAt: string } | null;
}
export interface OperatorAccount {
  mainBalanceUnits: number; giftBalanceUnits: number; totalBalanceUnits: number;
  mainReservedUnits: number; giftReservedUnits: number; reservedTotalUnits: number;
  mainAvailableUnits: number; giftAvailableUnits: number; availableTotalUnits: number;
  enrollmentSummary: {
    receivedAmountFen: number | null; refundedAmountFen: number | null;
    initialMainUnits: number | null; initialGiftUnits: number | null; pendingIssuanceCount: number;
  };
  lessonActivityTotals: Array<{
    entryType: OperatorAccountEntryType; mainDeltaUnits: number | null;
    giftDeltaUnits: number | null; totalDeltaUnits: number | null;
  }>;
  items: OperatorAccountLedgerRow[]; meta: OperatorPageMeta; serverTime: string; timezone: string;
}
