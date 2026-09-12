import { CampusManagerDashboard } from '../types/campus-manager';

export type CampusManagerHomeActionKey =
  | 'schedule'
  | 'approvals'
  | 'warnings'
  | 'student-create'
  | 'students'
  | 'settings'
  | 'profile'
  | 'more';

export type CampusManagerHomeActionResult =
  | { kind: 'navigate'; url: string }
  | { kind: 'unavailable'; message: string };

export interface CampusManagerHomeStatModel {
  key: 'students' | 'lessons' | 'pending';
  label: string;
  value: string;
  unit: '人' | '节' | '件';
  compact: boolean;
}

export interface CampusManagerHomePageModel {
  managerName: string;
  campusName: string;
  pendingCount: string;
  pendingUnit: '请假';
  latestLabel: string;
  latestStatus: string;
  latestLeaveId: string | null;
  stats: CampusManagerHomeStatModel[];
}

export const CAMPUS_MANAGER_HOME_ACTIONS = [
  {
    key: 'schedule' as const,
    label: '排课管理',
    icon: '/pages/campus-manager/assets/icon-schedule.png',
  },
  {
    key: 'approvals' as const,
    label: '请假审批',
    icon: '/pages/campus-manager/assets/icon-approvals.png',
  },
  {
    key: 'warnings' as const,
    label: '预警名单',
    icon: '/pages/campus-manager/assets/icon-warnings.png',
  },
  {
    key: 'students' as const,
    label: '人员管理',
    icon: '/pages/campus-manager/assets/icon-student-create.png',
  },
];

function count(value: number): { value: string; compact: boolean } {
  const normalized = Math.max(0, Math.trunc(value));
  return { value: String(normalized), compact: normalized >= 100 };
}

export function buildCampusManagerHomePageModel(
  dashboard: CampusManagerDashboard,
): CampusManagerHomePageModel {
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

const ROUTES: Partial<Record<CampusManagerHomeActionKey, string>> = {
  schedule: '/pages/campus-manager/schedule/index',
  approvals: '/pages/campus-manager/leave-requests/index',
  warnings: '/pages/campus-manager/warnings/index',
  'student-create': '/pages/campus-manager/students/index?quick=1',
  students: '/pages/campus-manager/students/index',
  settings: '/pages/campus-manager/campus-settings/index',
  profile: '/pages/campus-manager/profile/index',
  more: '/pages/campus-manager/profile/index',
};

export function resolveCampusManagerHomeAction(
  key: string,
): CampusManagerHomeActionResult {
  const url = ROUTES[key as CampusManagerHomeActionKey];
  return url
    ? { kind: 'navigate', url }
    : { kind: 'unavailable', message: '入口暂不可用' };
}
