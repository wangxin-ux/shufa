import { TeacherFeedbackRatings } from './teacher-feedback';

export interface ParentStudentSummary {
  id: string;
  name: string;
  age: number;
}

export interface ParentHomeSummary {
  profileSetupRequired?: boolean;
  student: ParentStudentSummary;
  nextLesson: {
    id: string;
    dateLabel: string;
    timeLabel: string;
    campusName: string;
    courseName: string;
    teacherName: string;
  } | null;
  remainingHoursLabel: string;
  attendanceRateLabel: string;
  teachers?: Array<{ id: string; name: string; specialties: string[] }>;
  reminders?: Array<NonNullable<ParentHomeSummary['nextLesson']>>;
}

export interface ParentHoursEntry {
  id: string;
  title: string;
  occurredAtLabel: string;
  detailLabel: string;
  summaryLabel?: string;
  delta: number;
  courseName?: string;
}

export interface ParentHoursQuery {
  page: number;
  pageSize: number;
  courseName?: string;
  direction: 'all' | 'debit' | 'credit';
}

export interface ParentHoursView {
  grantedPaidHours?: number | null;
  grantedGiftHours?: number | null;
  courseNames?: string[];
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
  grossTotal?: number;
  reservedPaidHours?: number;
  reservedGiftHours?: number;
  remainingTotal: number;
  paidHours: number;
  giftHours: number | null;
  paidAmountFen: number;
  validUntil: string;
  entries: ParentHoursEntry[];
}

export interface LeaveDraft {
  studentId: string;
  lessonId: string;
  reason: string;
}

export type LeaveStatus = 'pending' | 'approved' | 'rejected';

export interface LeaveWeekWarning {
  weekStart: string;
  weekEnd: string;
  consecutiveCount: number;
  lessonSessionIds: string[];
  campusName: string;
  contactPhone: string | null;
}

export interface LeaveRecord {
  contactWarning?: LeaveWeekWarning | null;
  id: string;
  courseName: string;
  lessonTimeLabel: string;
  reason: string;
  status: LeaveStatus;
  reviewerName?: string | null;
  reviewedAt?: string | null;
  reviewReason?: string | null;
}

export interface LeavePageView {
  weeklyWarnings?: LeaveWeekWarning[];
  students: Array<{ id: string; name: string }>;
  lessons: Array<{ id: string; title: string; startsAt: string }>;
  records: LeaveRecord[];
  cutoffHours: number;
}

export interface ParentProfileView {
  student: (ParentStudentSummary & {
    homeAddress: string | null;
    profileVersion: number;
    profileSetupCompleted?: boolean;
  }) | null;
  unreadMessageCount: number;
}

export interface ParentProfileUpdateInput {
  age?: number;
  homeAddress: string;
  expectedVersion: number;
}

export type ParentLessonStatus = 'COMPLETED' | 'REVERSED';
export type ParentAttendanceStatus = 'PRESENT' | 'LEAVE' | 'ABSENT' | null;

export interface ParentUpdateRecord {
  lessonSessionId: string;
  courseName: string;
  teacherName: string;
  startsAt: string;
  lessonStatus: ParentLessonStatus;
  attendanceStatus: ParentAttendanceStatus;
  feedback: string | null;
  performanceRating?: number | null;
  teacherRatings?: TeacherFeedbackRatings | null;
  feedbackVersion?: number;
  feedbackAuthorName?: string | null;
  feedbackImages: ParentFeedbackImage[];
  studentId?: string;
  campusName?: string;
  review?: ParentLessonReview | null;
  canReview?: boolean;
}

export interface ParentFeedbackImage {
  id: string;
  mimeType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
  accessUrl: string;
  accessUrlExpiresAt: string;
}

export interface ParentUpdatesView {
  records: ParentUpdateRecord[];
  student?: ParentGrowthStudent | null;
}

export interface ParentGrowthStudent extends ParentStudentSummary {
  profileVersion: number;
  photo: ParentFeedbackImage | null;
}

export interface ParentProfileSetupView {
  required: boolean;
  student: (ParentGrowthStudent & { birthDate: string | null }) | null;
}

export interface ParentProfileSetupInput {
  name: string;
  birthDate: string;
  fileId: string;
  expectedVersion: number;
}

export interface ParentReviewDraft {
  teaching: number;
  communication: number;
  environment: number;
  overall: number;
  note: string;
}

export interface ParentLessonReview extends ParentReviewDraft {
  id: string;
  lessonSessionId: string;
  studentId: string;
  createdAt: string;
  valid: boolean;
}

export interface ParentPhotoUpload {
  id: string;
  mimeType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
}

export interface ParentCampusLocation {
  id: string;
  name: string;
  address: string;
  contactPhone: string | null;
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
}

export interface ParentCampusQuery {
  page: number;
  pageSize: number;
  latitude?: number;
  longitude?: number;
}

export interface ParentCampusPage {
  data: ParentCampusLocation[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ParentCourseQuote {
  productId: string;
  productName: string;
  classType: string;
  priceFen: number;
  mainUnits: number;
  giftUnits: number;
  validityDays: number;
  campus: Omit<ParentCampusLocation, 'distanceMeters'>;
}

export interface ParentCourseCatalogItem {
  courseName: string;
  primaryQuote: ParentCourseQuote;
  classTypes: Array<{ name: string; quotes: ParentCourseQuote[] }>;
}

export interface ParentCourseCatalogQuery {
  page: number;
  pageSize: number;
  courseName?: string;
}

export interface ParentCourseCatalogPage {
  data: ParentCourseCatalogItem[];
  meta: ParentCampusPage['meta'];
}

export type {
  GroupCampaignView,
  GroupJoinInput,
  GroupJoinView,
  GroupOrderQuery,
  GroupOrderView,
  GroupPrepayView,
  ParentGroupCampaignQuery,
} from './group-buying';
