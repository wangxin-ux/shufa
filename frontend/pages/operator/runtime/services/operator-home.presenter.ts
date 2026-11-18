import { OperatorDashboard } from '../types/operator';

export type OperatorHomeActionKey =
  | 'schedule'
  | 'approvals'
  | 'warnings'
  | 'student-create'
  | 'students'
  | 'teacher-archives'
  | 'rankings'
  | 'lesson-account'
  | 'settings'
  | 'profile'
  | 'more';

export type OperatorHomeActionResult =
  | { kind: 'navigate'; url: string }
  | { kind: 'unavailable'; message: string };

export interface OperatorHomeStatModel {
  key: 'students' | 'lessons' | 'pending';
  label: string;
  value: string;
  unit: '人' | '节' | '件';
  compact: boolean;
}

export interface OperatorHomePageModel {
  managerName: string;
  campusName: string;
  pendingCount: string;
  pendingUnit: '请假';
  latestLabel: string;
  latestStatus: string;
  latestLeaveId: string | null;
  stats: OperatorHomeStatModel[];
}

export const OPERATOR_HOME_ACTIONS = [
  {
    key: 'schedule' as const,
    label: '排课管理',
    icon: '/pages/operator/assets/icon-schedule.png',
  },
  {
    key: 'approvals' as const,
    label: '请假审批',
    icon: '/pages/operator/assets/icon-approvals.png',
  },
  {
    key: 'warnings' as const,
    label: '预警名单',
    icon: '/pages/operator/assets/icon-warnings.png',
  },
  {
    key: 'student-create' as const,
    label: '新增学员',
    icon: '/pages/operator/assets/icon-student-create.png',
  },
];

function count(value: number): { value: string; compact: boolean } {
  const normalized = Math.max(0, Math.trunc(value));
  return { value: String(normalized), compact: normalized >= 100 };
}

export function buildOperatorHomePageModel(
  dashboard: OperatorDashboard,
): OperatorHomePageModel {
  const students = count(dashboard.activeStudentCount);
  const lessons = count(dashboard.todayLessonCount);
  const pending = count(dashboard.pendingLeaveCount);
  return {
    managerName: dashboard.manager.displayName,
    campusName: dashboard.campus.name,
    pendingCount: pending.value,
    pendingUnit: '请假',
    latestLabel: dashboard.latestPendingLeave
      ? `最近审批 ${dashboard.latestPendingLeave.studentName}请假申请`
      : '最近暂无待审批请假',
    latestStatus: dashboard.latestPendingLeave
      ? '待审批请假'
      : '审批事项已处理',
    latestLeaveId: dashboard.latestPendingLeave?.id ?? null,
    stats: [
      {
        key: 'students',
        label: '在读学员',
        ...students,
        unit: '人',
      },
      {
        key: 'lessons',
        label: '今日课程',
        ...lessons,
        unit: '节',
      },
      {
        key: 'pending',
        label: '待处理事项',
        ...pending,
        unit: '件',
      },
    ],
  };
}

const ROUTES: Partial<Record<OperatorHomeActionKey, string>> = {
  schedule: '/pages/operator/schedule/index',
  approvals: '/pages/operator/leave-requests/index',
  warnings: '/pages/operator/warnings/index',
  'student-create': '/pages/operator/students/index?quick=1',
  students: '/pages/operator/students/index',
  'teacher-archives': '/pages/operator/teacher-archives/index',
  rankings: '/pages/operator/rankings/index',
  'lesson-account': '/pages/operator/lesson-account/index',
  settings: '/pages/operator/campus-settings/index',
  profile: '/pages/operator/profile/index',
  more: '/pages/operator/profile/index',
};

export function resolveOperatorHomeAction(
  key: string,
): OperatorHomeActionResult {
  const url = ROUTES[key as OperatorHomeActionKey];
  return url
    ? { kind: 'navigate', url }
    : { kind: 'unavailable', message: '入口暂不可用' };
}
