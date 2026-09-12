import { PartnerProfile } from '../types/partner';
import { formatPartnerLessonUnits } from '../utils/partner-format';

export type PartnerProfileActionKey =
  | 'students'
  | 'operations'
  | 'warnings'
  | 'attendance'
  | 'teachers'
  | 'earnings'
  | 'group-campaigns';

export const PARTNER_PROFILE_ACTIONS: ReadonlyArray<{
  key: PartnerProfileActionKey;
  label: string;
}> = [
  { key: 'students', label: '学员档案' },
  { key: 'operations', label: '经营统计' },
  { key: 'warnings', label: '课时预警' },
  { key: 'attendance', label: '出勤统计' },
  { key: 'teachers', label: '教师信息' },
  { key: 'earnings', label: '合作收益' },
  { key: 'group-campaigns', label: '活动中心' },
];

const ROUTES: Record<PartnerProfileActionKey, string> = {
  students: '/pages/partner/students/index',
  operations: '/pages/partner/operations/index',
  warnings: '/pages/partner/warnings/index',
  attendance: '/pages/partner/attendance/index',
  teachers: '/pages/partner/teachers/index',
  earnings: '/pages/partner/earnings/index',
  'group-campaigns': '/pages/partner/group-campaigns/index',
};

export function buildPartnerProfilePageModel(profile: PartnerProfile) {
  return {
    displayName: profile.displayName,
    identityLabel: '合作方' as const,
    campusName: profile.campus.name,
    campusCodeLabel: `校区编号 ${profile.campus.code}`,
    contactPhoneLabel: profile.campus.contactPhone || '联系电话未填写',
    addressLabel: profile.campus.address || '校区地址未填写',
    warningThresholdLabel: `${formatPartnerLessonUnits(
      profile.campus.lessonWarningThresholdUnits,
    )} 节`,
  };
}

export function resolvePartnerProfileAction(
  key: PartnerProfileActionKey,
): { kind: 'navigate'; url: string } {
  return { kind: 'navigate', url: ROUTES[key] };
}
