export const ACTIVITY_TYPES = ['GRANT', 'CONSUME', 'REVERSAL', 'REFUND', 'CORRECTION', 'ADJUSTMENT'] as const;
export interface Campus { id: string; name: string; timezone: string }
export interface DirectoryQuery { page: number; pageSize: number; query: string }
export interface Directory {
  data: Campus[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface Account {
  mainBalanceUnits: number; giftBalanceUnits: number; totalBalanceUnits: number;
  mainReservedUnits: number; giftReservedUnits: number; reservedTotalUnits: number;
  mainAvailableUnits: number; giftAvailableUnits: number; availableTotalUnits: number;
  enrollmentSummary: {
    receivedAmountFen: number | null; refundedAmountFen: number | null;
    initialMainUnits: number | null; initialGiftUnits: number | null; pendingIssuanceCount: number;
  };
  lessonActivityTotals: Array<{
    entryType: typeof ACTIVITY_TYPES[number];
    mainDeltaUnits: number | null; giftDeltaUnits: number | null; totalDeltaUnits: number | null;
  }>;
}
export interface Summary {
  activeStudentCount: number; todayLessonCount: number; account: Account;
  earnings: { estimatedTotalFen: number | null; pendingReviewFen: number | null; currency: 'CNY' };
  serverTime: string;
}
export interface CampusSummary extends Summary { campus: Campus }
export interface TotalSummary extends Summary {
  campusCount: number; studentCountBasis: 'SUM_OF_CAMPUS_ACTIVE_STUDENT_RECORDS';
}
