import {
  LessonSessionQuery,
  LessonSessionStatus,
  TeacherLessonSession,
} from '../types/teacher';
import { parseZonedDateTime } from '../utils/format';

export type TeacherScheduleStatusFilter = 'ALL' | LessonSessionStatus;

export interface TeacherScheduleFilterInput {
  date: string;
  status: TeacherScheduleStatusFilter;
  page: number;
  pageSize: number;
}

export interface TeacherScheduleItemModel {
  id: string;
  courseName: string;
  className: string;
  campusName: string;
  dateLabel: string;
  timeLabel: string;
  studentCountLabel: string;
  statusLabel: string;
  statusTone: 'success' | 'warning' | 'muted' | 'danger';
  actionDisabled: boolean;
}

export const TEACHER_SCHEDULE_STATUS_FILTERS: ReadonlyArray<{
  value: TeacherScheduleStatusFilter;
  label: string;
}> = [
  { value: 'ALL', label: '全部' },
  { value: 'SCHEDULED', label: '待上课' },
  { value: 'IN_PROGRESS', label: '上课中' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REVERSED', label: '已撤销' },
  { value: 'CANCELLED', label: '已取消' },
];

const STATUS_PRESENTATION: Record<
  LessonSessionStatus,
  {
    label: string;
    tone: TeacherScheduleItemModel['statusTone'];
    actionDisabled: boolean;
  }
> = {
  SCHEDULED: { label: '待上课', tone: 'success', actionDisabled: false },
  IN_PROGRESS: { label: '上课中', tone: 'warning', actionDisabled: false },
  COMPLETED: { label: '已完成', tone: 'muted', actionDisabled: true },
  REVERSED: { label: '已撤销', tone: 'danger', actionDisabled: true },
  CANCELLED: { label: '已取消', tone: 'muted', actionDisabled: true },
};

const CHINESE_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDate(value: string): string {
  const parts = parseZonedDateTime(value);
  if (!parts) {
    return '日期待定';
  }
  return `${parts.month}月${parts.day}日 ${CHINESE_WEEKDAYS[parts.weekday]}`;
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  const start = parseZonedDateTime(startsAt)?.time ?? '--:--';
  const end = parseZonedDateTime(endsAt)?.time ?? '--:--';
  return `${start}-${end}`;
}

function nextDate(date: string): string {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return '';
  }
  const value = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1),
  );
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

export function buildTeacherScheduleQuery(
  input: TeacherScheduleFilterInput,
): LessonSessionQuery {
  const query: LessonSessionQuery = {
    page: input.page,
    pageSize: input.pageSize,
  };
  const date = input.date.trim();
  const followingDate = nextDate(date);
  if (date && followingDate) {
    query.from = `${date}T00:00:00+08:00`;
    query.to = `${followingDate}T00:00:00+08:00`;
  }
  if (input.status !== 'ALL') {
    query.status = input.status;
  }
  return query;
}

export function buildTeacherSchedulePageModel(
  lessons: readonly TeacherLessonSession[],
): TeacherScheduleItemModel[] {
  return lessons.map((lesson) => {
    const status = STATUS_PRESENTATION[lesson.status];
    return {
      id: lesson.id,
      courseName: lesson.courseName,
      className: lesson.className,
      campusName: lesson.campusName,
      dateLabel: formatDate(lesson.startsAt),
      timeLabel: formatTimeRange(lesson.startsAt, lesson.endsAt),
      studentCountLabel: `${Math.max(0, Math.trunc(lesson.studentCount))} 名学员`,
      statusLabel: status.label,
      statusTone: status.tone,
      actionDisabled: status.actionDisabled,
    };
  });
}

export function mergeTeacherScheduleItems(
  current: readonly TeacherScheduleItemModel[],
  incoming: readonly TeacherScheduleItemModel[],
  page: number,
): TeacherScheduleItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function resolveTeacherScheduleNavigation(
  lessonId: string,
  actionDisabled: boolean,
): { kind: 'navigate'; url: string } | { kind: 'disabled' } {
  return actionDisabled
    ? { kind: 'disabled' }
    : {
        kind: 'navigate',
        url: `/pages/teacher/lesson/index?id=${encodeURIComponent(lessonId)}`,
      };
}
