import {
  AttendanceStatus,
  TeacherStudent,
  TeacherStudentDetail,
  TeacherStudentQuery,
} from '../types/teacher';
import { parseZonedDateTime } from '../utils/format';

export interface TeacherStudentItemModel {
  id: string;
  displayName: string;
  classLabel: string;
  nextLessonLabel: string;
  latestFeedbackLabel: string;
}

export interface TeacherStudentDetailPageModel {
  displayName: string;
  classLabel: string;
  classes: TeacherStudentDetail['classes'];
  nextLessonTitle: string;
  nextLessonClassLabel: string;
  nextLessonTime: string;
  attendanceSummary: string;
  attendanceRateLabel: string;
  recentAttendance: Array<{
    id: string;
    courseName: string;
    timeLabel: string;
    statusLabel: string;
    statusTone: 'success' | 'warning' | 'danger';
  }>;
  latestFeedbackContent: string;
  latestFeedbackMeta: string;
}

const CHINESE_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDateTime(value: string | null, includeWeekday: boolean): string {
  if (!value) {
    return '';
  }
  const parts = parseZonedDateTime(value);
  if (!parts) {
    return '';
  }
  return includeWeekday
    ? `${parts.month}月${parts.day}日 ${CHINESE_WEEKDAYS[parts.weekday]} ${parts.time}`
    : `${parts.month}月${parts.day}日 ${parts.time}`;
}

export function normalizeTeacherStudentSearch(value: string): string {
  return value.trim();
}

export function buildTeacherStudentQuery(
  value: string,
  page: number,
  pageSize: number,
): TeacherStudentQuery {
  const query = normalizeTeacherStudentSearch(value);
  return {
    page,
    pageSize,
    ...(query ? { query } : {}),
  };
}

export function buildTeacherStudentPageModel(
  students: readonly TeacherStudent[],
): TeacherStudentItemModel[] {
  return students.map((student) => ({
    id: student.id,
    displayName: student.displayName,
    classLabel: student.classNames.length > 0 ? student.classNames.join('、') : '暂未分班',
    nextLessonLabel:
      formatDateTime(student.nextLessonAt, true) || '暂无后续课程',
    latestFeedbackLabel:
      formatDateTime(student.latestFeedbackAt, false) || '暂无课堂反馈',
  }));
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  const start = parseZonedDateTime(startsAt);
  const end = parseZonedDateTime(endsAt);
  if (!start || !end) {
    return '时间待确认';
  }
  return `${start.month}月${start.day}日 ${CHINESE_WEEKDAYS[start.weekday]} ${start.time}-${end.time}`;
}

function attendanceStatus(status: AttendanceStatus) {
  const labels = {
    PRESENT: { statusLabel: '到课', statusTone: 'success' as const },
    LEAVE: { statusLabel: '请假', statusTone: 'warning' as const },
    ABSENT: { statusLabel: '缺勤', statusTone: 'danger' as const },
  };
  return labels[status];
}

export function buildTeacherStudentDetailPageModel(
  student: TeacherStudentDetail,
): TeacherStudentDetailPageModel {
  const nextLesson = student.nextLesson;
  const latestFeedback = student.latestFeedback;
  return {
    displayName: student.displayName,
    classLabel:
      student.classNames.length > 0 ? student.classNames.join('、') : '暂未分班',
    classes: student.classes.map((item) => ({ ...item })),
    nextLessonTitle: nextLesson?.courseName ?? '暂无后续课程',
    nextLessonClassLabel: nextLesson?.className ?? '排课后会在这里显示',
    nextLessonTime: nextLesson
      ? formatTimeRange(nextLesson.startsAt, nextLesson.endsAt)
      : '时间待安排',
    attendanceSummary: `出勤 ${student.attendance.presentCount} 次 · 请假 ${student.attendance.leaveCount} 次 · 缺勤 ${student.attendance.absentCount} 次`,
    attendanceRateLabel: `${Math.round(student.attendance.attendanceRateBasisPoints / 100)}%`,
    recentAttendance: student.recentAttendance.map((item) => ({
      id: item.id,
      courseName: item.courseName,
      timeLabel: formatDateTime(item.startsAt, false) || '时间待确认',
      ...attendanceStatus(item.status),
    })),
    latestFeedbackContent: latestFeedback?.content ?? '暂无课堂反馈',
    latestFeedbackMeta: latestFeedback
      ? `${latestFeedback.courseName} · ${formatDateTime(latestFeedback.updatedAt, false)}`
      : '完成课堂反馈后会在这里显示',
  };
}

export function mergeTeacherStudentItems(
  current: readonly TeacherStudentItemModel[],
  incoming: readonly TeacherStudentItemModel[],
  page: number,
): TeacherStudentItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export class TeacherStudentSearchDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly callback: (query: string) => void,
    private readonly delayMs = 300,
  ) {}

  schedule(value: string): void {
    this.cancel();
    const query = normalizeTeacherStudentSearch(value);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.callback(query);
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
