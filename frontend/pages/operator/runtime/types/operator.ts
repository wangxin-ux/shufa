export interface OperatorDashboard {
  manager: {
    displayName: string;
  };
  campus: {
    id: string;
    name: string;
  };
  activeStudentCount: number;
  todayLessonCount: number;
  pendingLeaveCount: number;
  latestPendingLeave: {
    id: string;
    studentName: string;
    courseName: string;
    startsAt: string;
  } | null;
  serverTime: string;
}

export interface OperatorProfile {
  displayName: string;
  roleCode: "OPERATOR";
  campusId: string;
  campusName: string;
}

export interface OperatorPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface OperatorPage<T> {
  data: T[];
  meta: OperatorPageMeta;
}

export interface OperatorStudent {
  id: string;
  campusId: string;
  displayName: string;
  ageYears: number | null;
  classNames: string[];
}

export interface OperatorStudentDetail extends OperatorStudent, LessonAvailability {
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  recentAttendanceCount: number;
  recentConsumedUnits: number;
}

export interface OperatorStudentMedia {
  id: string;
  mimeType: string;
  sizeBytes: number;
  accessUrl: string;
}

export interface OperatorStudentArchive {
  id: string;
  displayName: string;
  ageYears: number | null;
  photo: OperatorStudentMedia | null;
  classes: Array<{ id: string; className: string; courseName: string; teacherName: string }>;
  enrollmentSummary: {
    receivedAmountFen: number | null;
    refundedAmountFen: number | null;
    initialMainUnits: number | null;
    initialGiftUnits: number | null;
    pendingIssuanceCount: number;
  };
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  mainReservedUnits: number;
  giftReservedUnits: number;
  reservedTotalUnits: number;
  mainAvailableUnits: number;
  giftAvailableUnits: number;
  availableTotalUnits: number;
  warningThresholdUnits: number;
  lowBalance: boolean;
  attendance: {
    presentCount: number;
    absentCount: number;
    leaveCount: number;
    recordedCount: number;
    attendanceRateBasisPoints: number | null;
  };
  serverTime: string;
}

export interface OperatorStudentGrowth {
  lessonSessionId: string;
  studentId: string;
  courseName: string;
  campusName: string;
  teacherName: string;
  startsAt: string;
  lessonStatus: 'COMPLETED' | 'REVERSED';
  attendanceStatus: 'PRESENT' | 'ABSENT' | 'LEAVE' | null;
  feedback: string | null;
  performanceRating: number | null;
  teacherRatings: {
    classroomPerformance: number | null;
    workCompletion: number | null;
    communication: number | null;
    overall: number | null;
  } | null;
  feedbackVersion: number;
  feedbackAuthorName: string | null;
  feedbackValid: boolean;
  review: {
    id: string;
    lessonSessionId: string;
    studentId: string;
    teaching: number;
    communication: number;
    environment: number;
    overall: number;
    note: string;
    createdAt: string;
    valid: boolean;
  } | null;
  reviewAuthorName: string | null;
  feedbackImages: OperatorStudentMedia[];
  feedbackUpdatedAt: string | null;
}

export interface OperatorStudentQuery {
  page: number;
  pageSize: number;
  query?: string;
}

export interface OperatorTeacherArchive {
  id: string;
  displayName: string;
  specialties: string[];
  classes: Array<{ id: string; className: string; courseName: string }>;
}

export interface OperatorTeacherRatings {
  teachingRating: number;
  communicationRating: number;
  attendanceRating: number;
  overallRating: number;
}

export interface OperatorTeacherEvaluation extends OperatorTeacherRatings {
  id: string;
  teacherId: string;
  periodMonth: string;
  version: number;
  guidance: string;
  authorName: string;
  canEdit: false;
  createdAt: string;
  updatedAt: string;
}

export interface OperatorTeacherPerformance {
  teacherId: string;
  periodMonth: string;
  timezone: string;
  asOf: string;
  scheduledLessonCount: number;
  completedLessonCount: number;
  completionRateBasisPoints: number | null;
  evaluation: OperatorTeacherEvaluation | null;
}

export interface OperatorTeacherEvaluationRevision extends OperatorTeacherRatings {
  periodMonth: string;
  version: number;
  guidance: string;
  authorName: string;
  savedAt: string;
}

export interface OperatorTeacherHistoryQuery {
  month?: string;
  page: number;
  pageSize: number;
}

export interface OperatorCreateStudentDraft {
  displayName: string;
  birthDate?: string;
  classGroupId?: string;
}

export interface OperatorCreateStudentInput {
  displayName: string;
  birthDate: string | null;
  classGroupId: string | null;
}

export interface OperatorSchedulingOption {
  classGroupId: string;
  className: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
  defaultLessonUnits: number;
}

export interface OperatorSchedulingOptions {
  classes: OperatorSchedulingOption[];
}

export type OperatorLessonKind = "REGULAR" | "MAKEUP" | "TRIAL";

export type OperatorLessonStatus =
  "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "REVERSED" | "CANCELLED";

export interface OperatorLessonSession {
  id: string;
  seriesId?: string | null;
  campusId: string;
  classGroupId: string;
  className: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  kind: OperatorLessonKind;
  lessonUnits: number;
  status: OperatorLessonStatus;
  version: number;
}

export interface OperatorLessonQuery {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  status?: OperatorLessonStatus;
}

export interface OperatorScheduleDraft {
  classGroupId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  kind: OperatorLessonKind;
}

export interface OperatorScheduleInput {
  classGroupId: string;
  startsAt: string;
  endsAt: string;
  kind: OperatorLessonKind;
}

export interface OperatorUpdateScheduleInput {
  version: number;
  startsAt: string;
  endsAt: string;
  kind: OperatorLessonKind;
}

export interface OperatorSeriesPattern {
  classGroupId: string;
  startDate: string;
  endDate: string;
  intervalWeeks: 1 | 2;
  weekdays: number[];
  startTime: string;
  endTime: string;
  kind: OperatorLessonKind;
}
export interface OperatorSeriesPlannedSession {
  date: string;
  startsAt: string;
  endsAt: string;
}
export interface OperatorSeriesPreview {
  timezone: "Asia/Shanghai";
  previewHash: string;
  sessions: OperatorSeriesPlannedSession[];
  conflictDates: string[];
}
export interface OperatorSeriesCreateInput extends OperatorSeriesPattern {
  previewHash: string;
}
export interface OperatorSeriesSelectedSession {
  id: string;
  version: number;
  startsAt: string;
  endsAt: string;
}
export interface OperatorSeriesCreated {
  seriesId: string;
  version: number;
  sessions: OperatorSeriesSelectedSession[];
}
export type OperatorCancellationMode = "THIS" | "FOLLOWING";
export interface OperatorCancellationInput {
  mode: OperatorCancellationMode;
  previewHash: string;
}
export interface OperatorCancellationPreview {
  seriesId: string | null;
  previewHash: string;
  sessions: OperatorSeriesSelectedSession[];
}
export interface OperatorSeriesCancelled {
  seriesId: string | null;
  sessions: Array<OperatorSeriesSelectedSession & { status: "CANCELLED" }>;
}

export type OperatorLeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface OperatorLeaveRequest {
  id: string;
  studentId: string;
  studentName: string;
  lessonSessionId: string;
  courseName: string;
  startsAt: string;
  reason: string;
  status: OperatorLeaveStatus;
  // Legacy successful idempotency receipts may omit this capability.
  canReview?: boolean;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  version: number;
  createdAt: string;
}

export type OperatorLeaveQuery = {
  page: number;
  pageSize: number;
} & (
  | { status?: OperatorLeaveStatus; reviewedOnly?: never }
  | { status?: never; reviewedOnly?: boolean }
);

export interface OperatorWarning extends LessonAvailability {
  studentId: string;
  studentName: string;
  classNames: string[];
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  thresholdUnits: number;
}

export interface OperatorWarningQuery {
  page: number;
  pageSize: number;
  query?: string;
}

export interface OperatorCampusSettings {
  id: string;
  code: string;
  name: string;
  timezone: string;
  contactPhone: string | null;
  address: string | null;
  lessonWarningThresholdUnits: number;
  version: number;
}

export interface OperatorSettingsDraft {
  name: string;
  contactPhone: string;
  address: string;
  lessonWarningThresholdHours: string;
}

export interface OperatorUpdateSettingsInput {
  version: number;
  name: string;
  contactPhone: string | null;
  address: string | null;
  lessonWarningThresholdUnits: number;
}
import type { LessonAvailability } from '../../../../services/lesson-availability';
