import {
  LessonSessionStatus,
  TeacherDashboard,
  TeacherIdentity,
} from '../types/teacher';
import { parseZonedDateTime } from '../utils/format';

export type TeacherHomeActionKey =
  | 'more'
  | 'schedule'
  | 'students'
  | 'records'
  | 'confirm'
  | 'profile';

export type TeacherHomeActionResult =
  | { kind: 'navigate'; url: string }
  | { kind: 'unavailable'; message: string };

export interface TeacherHomeStatModel {
  key: 'pending' | 'completed' | 'students';
  value: string;
  unit: '节' | '人';
  label: string;
  compact: boolean;
}

export interface TeacherHomePageModel {
  teacher: TeacherIdentity;
  nextLesson: {
    id: string;
    time: string;
    weekday: string;
    campusName: string;
    courseName: string;
    statusPrefix: string;
    statusLabel: string;
    statusTone: 'success' | 'warning' | 'muted' | 'danger';
  } | null;
  stats: TeacherHomeStatModel[];
  emptyMessage: string;
}

export const TEACHER_HOME_ACTIONS = [
  {
    key: 'records' as const,
    label: '学员记录',
    icon: '/pages/teacher/assets/icon-student-record.png',
  },
  {
    key: 'confirm' as const,
    label: '确认扣课',
    icon: '/pages/teacher/assets/icon-confirm.png',
  },
  {
    key: 'students' as const,
    label: '学员列表',
    icon: '/pages/teacher/assets/icon-students.png',
  },
  {
    key: 'schedule' as const,
    label: '今日课表',
    icon: '/pages/teacher/assets/icon-schedule.png',
  },
];

const WEEKDAYS = [
  '周日',
  '周一',
  '周二',
  '周三',
  '周四',
  '周五',
  '周六',
];

const STATUS_PRESENTATION: Record<
  LessonSessionStatus,
  { prefix: string; label: string; tone: TeacherHomePageModel['nextLesson'] extends infer T
      ? T extends { statusTone: infer U }
        ? U
        : never
      : never }
> = {
  SCHEDULED: { prefix: '课时预警/', label: '待上课', tone: 'success' },
  IN_PROGRESS: { prefix: '', label: '上课中', tone: 'warning' },
  COMPLETED: { prefix: '', label: '已完成', tone: 'muted' },
  REVERSED: { prefix: '', label: '已撤销', tone: 'danger' },
  CANCELLED: { prefix: '', label: '已取消', tone: 'muted' },
};

function formatLessonTime(value: string): string {
  return parseZonedDateTime(value)?.time ?? '--:--';
}

function formatWeekday(value: string): string {
  const weekday = parseZonedDateTime(value)?.weekday;
  return weekday === undefined ? '' : WEEKDAYS[weekday] ?? '';
}

function toCount(value: number): { value: string; compact: boolean } {
  const normalized = Math.max(0, Math.trunc(value));
  return { value: String(normalized), compact: normalized >= 100 };
}

export function buildTeacherHomePageModel(
  dashboard: TeacherDashboard,
): TeacherHomePageModel {
  const pending = toCount(dashboard.todayPendingCount);
  const completed = toCount(dashboard.todayCompletedCount);
  const students = toCount(dashboard.responsibleStudentCount);
  const nextLesson = dashboard.nextLesson;
  const status = nextLesson
    ? STATUS_PRESENTATION[nextLesson.status]
    : STATUS_PRESENTATION.SCHEDULED;

  return {
    teacher: dashboard.teacher,
    nextLesson: nextLesson
      ? {
          id: nextLesson.id,
          time: formatLessonTime(nextLesson.startsAt),
          weekday: formatWeekday(nextLesson.startsAt),
          campusName: nextLesson.campusName,
          courseName: nextLesson.courseName,
          statusPrefix: status.prefix,
          statusLabel: status.label,
          statusTone: status.tone,
        }
      : null,
    stats: [
      { key: 'pending', ...pending, unit: '节', label: '今日待上课' },
      { key: 'completed', ...completed, unit: '节', label: '已完成' },
      { key: 'students', ...students, unit: '人', label: '负责学生' },
    ],
    emptyMessage: '今日暂无待上课程',
  };
}

export function resolveTeacherHomeAction(
  key: string,
  nextLessonId: string | null | undefined = null,
): TeacherHomeActionResult {
  if (key === 'more') {
    return { kind: 'navigate', url: '/pages/teacher/group-campaigns/index' };
  }
  if (key === 'schedule') {
    return { kind: 'navigate', url: '/pages/teacher/schedule/index' };
  }
  if (key === 'students') {
    return { kind: 'navigate', url: '/pages/teacher/students/index' };
  }
  if (key === 'records') {
    return { kind: 'navigate', url: '/pages/teacher/records/index' };
  }
  if (key === 'profile') {
    return { kind: 'navigate', url: '/pages/teacher/profile/index' };
  }
  if (key === 'confirm') {
    return nextLessonId
      ? {
          kind: 'navigate',
          url: `/pages/teacher/lesson/index?id=${encodeURIComponent(nextLessonId)}`,
        }
      : { kind: 'unavailable', message: '今日暂无可确认课次' };
  }
  return { kind: 'unavailable', message: '入口暂不可用' };
}
