import { PartnerProfile } from '../types/partner';
import { formatPartnerLessonUnits } from '../utils/partner-format';

export type PartnerProfileActionKey =
  | 'students'
  | 'operations'
  | 'warnings'
  | 'attendance'
  | 'teachers'
  | 'earnings'
  | 'lesson-account'
  | 'group-campaigns'
  | 'application';

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
  { key: 'lesson-account', label: '课时流水' },
  { key: 'group-campaigns', label: '活动中心' },
  { key: 'application', label: '入驻申请' },
];

const ROUTES: Record<PartnerProfileActionKey, string> = {
  students: '/pages/partner/students/index',
  operations: '/pages/partner/operations/index',
  warnings: '/pages/partner/warnings/index',
  attendance: '/pages/partner/attendance/index',
  teachers: '/pages/partner/teachers/index',
  earnings: '/pages/partner/earnings/index',
  'lesson-account': '/pages/partner/lesson-account/index',
  'group-campaigns': '/pages/partner/group-campaigns/index',
  application: '/pages/partner/application/index',
};

export const PARTNER_PROFILE_PRIMARY_ACTIONS = [
  'students', 'lesson-account', 'teachers', 'group-campaigns',
].map((key) => PARTNER_PROFILE_ACTIONS.find((action) => action.key === key)!);

export const PARTNER_PROFILE_SECONDARY_ACTIONS = [
  'operations', 'earnings', 'warnings', 'attendance',
].map((key) => PARTNER_PROFILE_ACTIONS.find((action) => action.key === key)!);

export function buildPartnerProfilePageModel(profile: PartnerProfile) {
  const nameLength = Math.max(1, Array.from(profile.campus.name).length);
  const campusNameCompact = nameLength > 5;
  const nameWidthRpx = campusNameCompact ? 210 : 560;
  const campusNameFontSizeRpx = campusNameCompact
    ? Math.min(38, Math.max(28, Math.floor(420 / nameLength)))
    : 54;
  const campusNameHeightRpx = Math.min(
    128,
    Math.ceil(nameLength * campusNameFontSizeRpx / nameWidthRpx) * campusNameFontSizeRpx * 1.18,
  );
  return {
    displayName: profile.displayName,
    identityLabel: '合作方' as const,
    campusName: profile.campus.name,
    campusNameCompact,
    campusNameFontSizeRpx,
    campusNameHeightRpx,
    activeStudentCountLabel: `${profile.activeStudentCount}人`,
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
