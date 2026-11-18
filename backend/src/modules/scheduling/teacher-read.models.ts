export interface TeacherIdentityView {
  displayName: string;
  subjectLabel: string;
  campusName: string;
}

export interface TeacherLessonRosterSummaryView {
  expectedCount: number;
  leaveCount: number;
  warningCount: number;
  thresholdUnits: number;
  asOf: string;
  source: 'CURRENT' | 'HISTORICAL_ATTENDANCE';
}

export interface TeacherLessonSummaryView {
  id: string;
  version: number;
  className: string;
  courseName: string;
  campusName: string;
  startsAt: string;
  endsAt: string;
  lessonUnits: number;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'REVERSED' | 'CANCELLED';
  studentCount: number;
  rosterSummary?: TeacherLessonRosterSummaryView;
}

export interface PaginationMetaView {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PageView<T> {
  data: T[];
  meta: PaginationMetaView;
}
