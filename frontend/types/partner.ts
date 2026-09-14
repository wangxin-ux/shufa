export interface PartnerCampusSummary {
  id: string;
  code: string;
  name: string;
  timezone: string;
  lessonWarningThresholdUnits: number;
}

export interface PartnerWarning extends LessonAvailability {
  studentId: string;
  studentName: string;
  classNames: string[];
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  thresholdUnits: number;
}

export interface PartnerDashboard {
  partner: { displayName: string };
  campus: PartnerCampusSummary;
  activeStudentCount: number;
  activeClassCount: number;
  activeTeacherCount: number;
  remainingMainUnits: number;
  remainingGiftUnits: number;
  monthConsumedUnits: number;
  attendanceRateBasisPoints: number | null;
  highlight: PartnerWarning | null;
  serverTime: string;
}

export interface PartnerProfile {
  displayName: string;
  roleCode: 'PARTNER';
  campus: PartnerCampusSummary & {
    contactPhone: string | null;
    address: string | null;
  };
}

export interface PartnerPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PartnerPage<T> {
  data: T[];
  meta: PartnerPageMeta;
}

export interface PartnerPageQuery {
  page: number;
  pageSize: number;
}

export interface PartnerSearchQuery extends PartnerPageQuery {
  query?: string;
}

export interface PartnerStudent extends LessonAvailability {
  id: string;
  displayName: string;
  birthDate: string | null;
  classNames: string[];
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
}

export type PartnerAttendanceStatus = 'PRESENT' | 'LEAVE' | 'ABSENT';

export interface PartnerAttendanceSummary {
  presentCount: number;
  absentCount: number;
  leaveCount: number;
  recordedCount: number;
  attendanceRateBasisPoints: number | null;
}

export interface PartnerAttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  courseName: string;
  teacherName: string;
  startsAt: string;
  status: PartnerAttendanceStatus;
  recordedAt: string;
}

export interface PartnerAttendance extends PartnerAttendanceSummary {
  items: PartnerAttendanceRecord[];
  meta: PartnerPageMeta;
}

export interface PartnerStudentClass {
  id: string;
  className: string;
  courseName: string;
  teacherName: string;
}

export interface PartnerStudentDetail extends PartnerStudent {
  classes: PartnerStudentClass[];
  attendance: PartnerAttendanceSummary;
  recentAttendance: PartnerAttendanceRecord[];
  recentLessonLedger: PartnerLessonLedgerEntry[];
}

export interface PartnerTeacher {
  id: string;
  displayName: string;
  employeeCode: string;
  specialties: string[];
  classNames: string[];
  activeStudentCount: number;
  monthCompletedLessonCount: number;
}

export interface PartnerLessonLedgerEntry {
  id: string;
  studentId: string;
  studentName: string;
  packageName: string;
  entryType: 'CONSUME' | 'REVERSAL' | 'ADJUSTMENT' | 'REFUND' | 'GRANT' | 'CORRECTION';
  bucket: 'MAIN' | 'GIFT';
  deltaUnits: number;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
  reason: string | null;
  createdAt: string;
}

export interface PartnerLessonAccount {
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  items: PartnerLessonLedgerEntry[];
  meta: PartnerPageMeta;
}

export type PartnerReportPeriod = 'DAY' | 'MONTH' | 'QUARTER';

export interface PartnerPeriodQuery {
  period: PartnerReportPeriod;
  anchorDate?: string;
}

export interface PartnerEarningPeriodQuery {
  period?: PartnerReportPeriod;
  anchorDate?: string;
}

export interface PartnerTeacherOperationMetric {
  teacherId: string;
  displayName: string;
  completedLessonCount: number;
  attendeeCount: number;
}

export interface PartnerOperationsSummary extends PartnerAttendanceSummary {
  period: PartnerReportPeriod;
  anchorDate: string;
  rangeStart: string;
  rangeEnd: string;
  consumedLessonUnits: number;
  completedLessonCount: number;
  teacherMetrics: PartnerTeacherOperationMetric[];
}

export type PartnerEarningStatus =
  | 'PENDING_REVIEW'
  | 'AVAILABLE'
  | 'REJECTED'
  | 'REVERSED';

export type PartnerEarningEntryType = 'ACCRUAL' | 'REVERSAL';

export interface PartnerEarningSummary {
  estimatedTotalFen: number;
  pendingReviewFen: number;
  availableFen: number;
  reversedNetFen: number;
  currency: 'CNY';
}

export interface PartnerEarningRule {
  id: string;
  campusId: string;
  campusName: string;
  unitPriceFen: number;
  shareBasisPoints: number;
  eligibleLessonKinds: Array<'REGULAR' | 'MAKEUP' | 'TRIAL'>;
  countedAttendanceStatuses: PartnerAttendanceStatus[];
  settlementDelayDays: number;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface PartnerEarningEntry {
  id: string;
  campusId: string;
  campusName: string;
  teachingRecordId: string;
  lessonSessionId: string;
  courseName: string;
  lessonStartsAt: string;
  completedAt: string;
  entryType: PartnerEarningEntryType;
  amountFen: number;
  status: PartnerEarningStatus;
  unitPriceFen: number;
  shareBasisPoints: number;
  actualAttendeeCount: number;
  countedAttendeeCount: number;
  perAttendeeAmountFen: number;
  reviewableAt: string;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  version: number;
}

export interface PartnerEarningQuery
  extends PartnerPageQuery,
    PartnerEarningPeriodQuery {
  status?: PartnerEarningStatus;
}
import type { LessonAvailability } from '../services/lesson-availability';
