export interface ParentStudentSummary {
  id: string;
  name: string;
  age: number;
}

export interface ParentHomeSummary {
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
}

export interface ParentHoursEntry {
  id: string;
  title: string;
  occurredAtLabel: string;
  detailLabel: string;
  delta: number;
}

export interface ParentHoursView {
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

export interface LeaveRecord {
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
  students: Array<{ id: string; name: string }>;
  lessons: Array<{ id: string; title: string; startsAt: string }>;
  records: LeaveRecord[];
  cutoffHours: number;
}

export interface ParentProfileView {
  student: (ParentStudentSummary & {
    homeAddress: string | null;
    profileVersion: number;
  }) | null;
  unreadMessageCount: number;
}

export interface ParentProfileUpdateInput {
  age: number;
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
  feedbackImages: ParentFeedbackImage[];
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

export type {
  GroupCampaignView,
  GroupJoinInput,
  GroupJoinView,
  GroupOrderQuery,
  GroupOrderView,
  GroupPrepayView,
  ParentGroupCampaignQuery,
} from './group-buying';
