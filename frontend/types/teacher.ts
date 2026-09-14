export type LessonSessionStatus =
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'REVERSED'
  | 'CANCELLED';

export type AttendanceStatus = 'PRESENT' | 'LEAVE' | 'ABSENT';
export type LessonUnitBucket = 'MAIN' | 'GIFT';
export type LessonLedgerEntryType = 'CONSUME' | 'REVERSAL' | 'ADJUSTMENT';
export type LessonKind = 'REGULAR' | 'MAKEUP' | 'TRIAL';
export type ConfigurationStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type TeacherEarningBasisType =
  | 'PER_COMPLETED_SESSION'
  | 'PER_LESSON_UNIT'
  | 'PER_PRESENT_ATTENDEE';
export type TeacherEarningEntryType = 'ACCRUAL' | 'REVERSAL';
export type TeacherEarningStatus =
  | 'PENDING_REVIEW'
  | 'AVAILABLE'
  | 'REJECTED'
  | 'REVERSED';
export type TeacherWithdrawalStatus =
  | 'SUBMITTED'
  | 'APPROVED'
  | 'PAYING'
  | 'PAID'
  | 'CANCELLED'
  | 'REJECTED'
  | 'FAILED';

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export interface TeacherIdentity {
  displayName: string;
  subjectLabel: string;
  campusName: string;
}

export interface TeacherLessonSession {
  id: string;
  version: number;
  className: string;
  courseName: string;
  campusName: string;
  startsAt: string;
  endsAt: string;
  lessonUnits: number;
  status: LessonSessionStatus;
  studentCount: number;
}

export interface TeacherDashboard {
  teacher: TeacherIdentity;
  nextLesson: TeacherLessonSession | null;
  todayPendingCount: number;
  todayCompletedCount: number;
  responsibleStudentCount: number;
  serverTime: string;
}

export interface TeacherProfile extends TeacherIdentity {
  responsibleStudentCount: number;
  roleCode: 'TEACHER';
}

export interface AttendancePolicy {
  PRESENT: { consumesLessonUnits: true };
  LEAVE: { consumesLessonUnits: boolean };
  ABSENT: { consumesLessonUnits: boolean };
}

export interface TeacherLessonStudent {
  id: string;
  displayName: string;
  attendanceStatus: AttendanceStatus | null;
  expectedConsumeUnits: number;
  feedback: string | null;
  feedbackImages: FeedbackImage[];
}

export interface TeacherLessonDetail extends TeacherLessonSession {
  attendancePolicy: AttendancePolicy;
  students: TeacherLessonStudent[];
  canComplete: boolean;
  canReverse: boolean;
}

export interface TeacherStudent {
  id: string;
  displayName: string;
  classNames: string[];
  nextLessonAt: string | null;
  latestFeedbackAt: string | null;
}

export interface TeacherStudentDetail extends TeacherStudent {
  classes: Array<{
    id: string;
    className: string;
    courseName: string;
  }>;
  nextLesson: {
    id: string;
    className: string;
    courseName: string;
    startsAt: string;
    endsAt: string;
  } | null;
  attendance: {
    presentCount: number;
    leaveCount: number;
    absentCount: number;
    recordedCount: number;
    attendanceRateBasisPoints: number;
  };
  recentAttendance: Array<{
    id: string;
    courseName: string;
    startsAt: string;
    status: AttendanceStatus;
  }>;
  latestFeedback: {
    content: string;
    courseName: string;
    updatedAt: string;
  } | null;
}

export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface DatePageQuery extends PageQuery {
  from?: string;
  to?: string;
}

export interface LessonSessionQuery extends DatePageQuery {
  status?: LessonSessionStatus;
}

export interface TeacherStudentQuery extends PageQuery {
  query?: string;
}

export interface AttendanceItem {
  studentId: string;
  status: AttendanceStatus;
}

export interface AttendanceDraft {
  lessonSessionId: string;
  lessonVersion: number;
  attendance: AttendanceItem[];
}

export type CompleteLessonDraft = AttendanceDraft;

export interface ReverseLessonDraft {
  lessonSessionId: string;
  lessonVersion: number;
  reason: string;
}

export interface FeedbackDraft {
  lessonSessionId: string;
  studentId: string;
  content: string;
  imageFileIds: string[];
}

export interface FeedbackImageUploadDraft {
  lessonSessionId: string;
  studentId: string;
  filePath: string;
}

export interface FeedbackImage {
  id: string;
  mimeType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
  accessUrl: string;
  accessUrlExpiresAt: string;
}

export interface CompleteLessonResult {
  lessonSessionId: string;
  lessonVersion: number;
  status: 'COMPLETED' | 'REVERSED';
  teachingRecordId: string;
  consumed: Array<{
    studentId: string;
    mainUnits: number;
    giftUnits: number;
  }>;
}

export interface StudentFeedback {
  lessonSessionId: string;
  studentId: string;
  content: string;
  images: FeedbackImage[];
  updatedAt: string;
}

export interface TeachingRecord {
  id: string;
  lessonSessionId: string;
  className: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  attendeeCount: number;
  lessonUnits: number;
  feedbackCompletedCount: number;
  feedbackRequiredCount: number;
  status: 'COMPLETED' | 'REVERSED';
}

export interface TeacherLedgerRecord {
  id: string;
  lessonSessionId: string;
  studentId: string;
  studentName: string;
  occurredAt: string;
  entryType: LessonLedgerEntryType;
  bucket: LessonUnitBucket;
  deltaUnits: number;
}

export interface TeacherEarningSummary {
  todayEstimatedFen: number;
  weekEstimatedFen: number;
  monthEstimatedFen: number;
  estimatedTotalFen: number;
  pendingReviewFen: number;
  availableFen: number;
  withdrawingFen: number;
  currency: 'CNY';
}

export interface TeacherEarningRuleView {
  id: string;
  campusId: string;
  teacherId: string | null;
  basisType: TeacherEarningBasisType;
  unitAmountFen: number;
  eligibleLessonKinds: LessonKind[];
  countedAttendanceStatuses: AttendanceStatus[];
  settlementDelayDays: number;
  version: number;
  status: ConfigurationStatus;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
}

export interface TeacherEarningEntry {
  id: string;
  campusId: string;
  teacherId: string;
  teacherName: string;
  teachingRecordId: string;
  lessonSessionId: string;
  courseName: string;
  lessonStartsAt: string;
  entryType: TeacherEarningEntryType;
  amountFen: number;
  status: TeacherEarningStatus;
  basisType: TeacherEarningBasisType;
  unitAmountFen: number;
  lessonUnits: number;
  attendeeCount: number;
  reviewableAt: string;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  version: number;
}

export interface TeacherWithdrawal {
  id: string;
  requestNo: string;
  campusId: string;
  teacherId: string;
  teacherName: string;
  amountFen: number;
  status: TeacherWithdrawalStatus;
  requestedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  rejectionReason: string | null;
  failureReason: string | null;
  payoutReference: string | null;
  payoutProofFileId: string | null;
  version: number;
}

export interface TeacherEarningQuery extends DatePageQuery {
  status?: TeacherEarningStatus;
}

export interface TeacherWithdrawalQuery extends PageQuery {
  status?: TeacherWithdrawalStatus;
}
