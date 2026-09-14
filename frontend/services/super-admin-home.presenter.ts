import { SuperAdminDashboard } from '../types/super-admin';

export const SUPER_ADMIN_HOME_ACTIONS = [
  { key: 'campuses' as const, label: '校区管理', icon: '/pages/super-admin/assets/icon-campuses.png' },
  { key: 'accounts' as const, label: '账号管理', icon: '/pages/super-admin/assets/profile-mark-glyph.png' },
  { key: 'students' as const, label: '学员管理', icon: '/pages/super-admin/assets/icon-students.png' },
  { key: 'dashboard' as const, label: '全局看板', icon: '/pages/super-admin/assets/icon-dashboard.png' },
];

const ROUTES: Record<string, string> = {
  campuses: '/pages/super-admin/campuses/index',
  accounts: '/pages/super-admin/staff-accounts/index',
  students: '/pages/super-admin/students/index',
  brand: '/pages/super-admin/brand/index',
  dashboard: '/pages/super-admin/dashboard/index',
  groups: '/pages/super-admin/group-campaigns/index',
  more: '/pages/super-admin/group-campaigns/index',
  profile: '/pages/super-admin/profile/index',
};

export function resolveSuperAdminHomeAction(key: string) {
  const url = ROUTES[key];
  return url
    ? ({ kind: 'navigate', url } as const)
    : ({ kind: 'unavailable', message: '入口暂不可用' } as const);
}

const count = (value: number) => ({
  value: String(Math.max(0, Math.trunc(value))),
  compact: value >= 100,
});

export function buildSuperAdminHomePageModel(dashboard: SuperAdminDashboard) {
  const featured = dashboard.featuredCampus;
  return {
    administratorName: dashboard.administrator.displayName,
    campusCount: String(dashboard.campusCount),
    featuredCampusName: featured?.name ?? '暂无校区',
    featuredStudentCount: String(featured?.activeStudentCount ?? 0),
    featuredSummary: featured
      ? `本月授课${featured.monthCompletedLessonCount}节 出勤率${featured.attendanceRatePercent}% ${featured.warningStudentCount}人预警`
      : '暂无可展示的校区数据',
    stats: [
      { key: 'students' as const, label: '在读学员', unit: '人' as const, ...count(dashboard.activeStudentCount) },
      { key: 'lessons' as const, label: '本月授课', unit: '节' as const, ...count(dashboard.monthCompletedLessonCount) },
      { key: 'warnings' as const, label: '低课时', unit: '人' as const, ...count(dashboard.warningStudentCount) },
    ],
  };
}
