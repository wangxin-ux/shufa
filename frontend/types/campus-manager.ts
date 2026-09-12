export interface CampusManagerDashboard {
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

export interface CampusManagerProfile {
  displayName: string;
  roleCode: "CAMPUS_MANAGER";
  campusId: string;
  campusName: string;
}

export interface CampusManagerPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CampusManagerPage<T> {
  data: T[];
  meta: CampusManagerPageMeta;
}

export interface CampusManagerStudent {
  id: string;
  campusId: string;
  displayName: string;
  birthDate: string | null;
  classNames: string[];
}

export interface CampusManagerStudentDetail extends CampusManagerStudent, LessonAvailability {
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  recentAttendanceCount: number;
  recentConsumedUnits: number;
}

export interface CampusManagerStudentQuery {
  page: number;
  pageSize: number;
  query?: string;
}

export interface CampusManagerCreateStudentDraft {
  displayName: string;
  birthDate?: string;
  classGroupId?: string;
}

export interface CampusManagerCreateStudentInput {
  displayName: string;
  birthDate: string | null;
  classGroupId: string | null;
}

export interface CampusManagerSchedulingOption {
  classGroupId: string;
  className: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
  defaultLessonUnits: number;
}

export interface CampusManagerSchedulingOptions {
  classes: CampusManagerSchedulingOption[];
}

export type CampusManagerLessonKind = "REGULAR" | "MAKEUP" | "TRIAL";

export type CampusManagerLessonStatus =
  "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "REVERSED" | "CANCELLED";

export interface CampusManagerLessonSession {
  id: string;
  campusId: string;
  classGroupId: string;
  className: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  kind: CampusManagerLessonKind;
  lessonUnits: number;
  status: CampusManagerLessonStatus;
  version: number;
}

export interface CampusManagerLessonQuery {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  status?: CampusManagerLessonStatus;
}

export interface CampusManagerScheduleDraft {
  classGroupId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  kind: CampusManagerLessonKind;
}

export interface CampusManagerScheduleInput {
  classGroupId: string;
  startsAt: string;
  endsAt: string;
  kind: CampusManagerLessonKind;
}

export interface CampusManagerUpdateScheduleInput {
  version: number;
  startsAt: string;
  endsAt: string;
  kind: CampusManagerLessonKind;
}

export type CampusManagerLeaveStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface CampusManagerLeaveRequest {
  id: string;
  studentId: string;
  studentName: string;
  lessonSessionId: string;
  courseName: string;
  startsAt: string;
  reason: string;
  status: CampusManagerLeaveStatus;
  reviewerName: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  version: number;
  createdAt: string;
}

export interface CampusManagerLeaveQuery {
  page: number;
  pageSize: number;
  status?: CampusManagerLeaveStatus;
}

export interface CampusManagerWarning extends LessonAvailability {
  studentId: string;
  studentName: string;
  classNames: string[];
  mainBalanceUnits: number;
  giftBalanceUnits: number;
  totalBalanceUnits: number;
  thresholdUnits: number;
}

export interface CampusManagerWarningQuery {
  page: number;
  pageSize: number;
  query?: string;
}

export interface CampusManagerCampusSettings {
  id: string;
  code: string;
  name: string;
  timezone: string;
  contactPhone: string | null;
  address: string | null;
  lessonWarningThresholdUnits: number;
  version: number;
}

export interface CampusManagerSettingsDraft {
  name: string;
  contactPhone: string;
  address: string;
  lessonWarningThresholdHours: string;
}

export interface CampusManagerUpdateSettingsInput {
  version: number;
  name: string;
  contactPhone: string | null;
  address: string | null;
  lessonWarningThresholdUnits: number;
}
import type { LessonAvailability } from '../services/lesson-availability';
