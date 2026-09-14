export interface TeacherIdentityView {
  displayName: string;
  subjectLabel: string;
  campusName: string;
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
