import { PartnerDashboard } from '../types/partner';

export type PartnerHomeActionKey =
  | 'warnings'
  | 'attendance'
  | 'teachers'
  | 'students'
  | 'profile'
  | 'more';

export type PartnerHomeActionResult =
  | { kind: 'navigate'; url: string }
  | { kind: 'unavailable'; message: string };

export interface PartnerHomeStatModel {
  key: 'students' | 'consumed' | 'attendance';
  label: string;
  value: string;
  unit: '人' | '节' | '%';
  compact: boolean;
}

export interface PartnerHomePageModel {
  partnerName: string;
  campusName: string;
  highlightValue: string;
  highlightUnit: '节';
  highlightStudent: string;
  highlightClass: string;
  highlightSummary: string;
  stats: PartnerHomeStatModel[];
}

export const PARTNER_HOME_ACTIONS = [
  {
    key: 'warnings' as const,
    label: '课时预警',
    icon: '/pages/partner/assets/icon-warnings.png',
  },
  {
    key: 'attendance' as const,
    label: '出勤统计',
    icon: '/pages/partner/assets/icon-attendance.png',
  },
  {
    key: 'teachers' as const,
    label: '教师信息',
    icon: '/pages/partner/assets/icon-teachers.png',
  },
  {
    key: 'students' as const,
    label: '学员档案',
    icon: '/pages/partner/assets/icon-students.png',
  },
];

function formatLessonUnits(units: number): string {
  const value = Math.max(0, Math.trunc(units)) / 100;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '');
}

function count(value: number): { value: string; compact: boolean } {
  const normalized = Math.max(0, Math.trunc(value));
  return { value: String(normalized), compact: normalized >= 100 };
}

function percentage(basisPoints: number | null): string {
  if (basisPoints === null) return '--';
  const value = Math.max(0, Math.trunc(basisPoints)) / 100;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '');
}

export function buildPartnerHomePageModel(
  dashboard: PartnerDashboard,
): PartnerHomePageModel {
  const students = count(dashboard.activeStudentCount);
  const consumed = formatLessonUnits(dashboard.monthConsumedUnits);
  const highlight = dashboard.highlight;
  const highlightValue = highlight
    ? formatLessonUnits(highlight.availableTotalUnits ?? highlight.totalBalanceUnits)
    : '0';

  return {
    partnerName: dashboard.partner.displayName,
    campusName: dashboard.campus.name,
    highlightValue,
    highlightUnit: '节',
    highlightStudent: highlight?.studentName ?? '暂无课时预警',
    highlightClass:
      highlight && highlight.classNames.length > 0
        ? highlight.classNames.join('、')
        : dashboard.campus.name,
    highlightSummary: highlight
      ? `低课时 · 当前 ${highlightValue} 节`
      : '当前校区暂无低课时学员',
    stats: [
      {
        key: 'students',
        label: '在读学员',
        ...students,
        unit: '人',
      },
      {
        key: 'consumed',
        label: '本月课耗',
        value: consumed,
        unit: '节',
        compact: consumed.length >= 4,
      },
      {
        key: 'attendance',
        label: '出勤率',
        value: percentage(dashboard.attendanceRateBasisPoints),
        unit: '%',
        compact: false,
      },
    ],
  };
}

const ROUTES: Partial<Record<PartnerHomeActionKey, string>> = {
  warnings: '/pages/partner/warnings/index',
  attendance: '/pages/partner/attendance/index',
  teachers: '/pages/partner/teachers/index',
  students: '/pages/partner/students/index',
  profile: '/pages/partner/profile/index',
  more: '/pages/partner/group-campaigns/index',
};

export function resolvePartnerHomeAction(
  key: string,
): PartnerHomeActionResult {
  const url = ROUTES[key as PartnerHomeActionKey];
  return url
    ? { kind: 'navigate', url }
    : { kind: 'unavailable', message: '入口暂不可用' };
}
