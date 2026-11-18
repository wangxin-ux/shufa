import { ParentProfileView } from '../types/parent';

export type ParentProfileAction =
  | 'student'
  | 'messages'
  | 'hours'
  | 'groups'
  | 'campuses'
  | 'offers'
  | 'shop';

export const PARENT_PROFILE_ACTIONS: ReadonlyArray<{
  key: ParentProfileAction; label: string; commandLabel: string;
}> = [
  { key: 'student', label: '学员资料', commandLabel: '查看' },
  { key: 'campuses', label: '门店导航', commandLabel: '查看' },
  { key: 'hours', label: '课时记录', commandLabel: '查看' },
  { key: 'offers', label: '优惠活动', commandLabel: '查看' },
  { key: 'shop', label: '购物商城', commandLabel: '查看' },
];

export interface ParentProfilePageModel {
  isEmpty: boolean;
  studentName: string;
  studentAgeLabel: string;
  studentAgeInput: string;
  homeAddress: string;
  homeAddressLabel: string;
  profileVersion: number;
  unreadMessageCount: number;
  emptyMessage?: string;
}

export type ParentProfileActionResult =
  | { kind: 'navigate'; url: string }
  | { kind: 'toast'; title: string };

export function formatUnreadMessageBadge(count: number): string {
  if (count <= 0) {
    return '';
  }
  return count > 99 ? '99+' : String(count);
}

export function buildParentProfilePageModel(profile: ParentProfileView): ParentProfilePageModel {
  if (!profile.student) {
    return {
      isEmpty: true,
      studentName: '',
      studentAgeLabel: '',
      studentAgeInput: '',
      homeAddress: '',
      homeAddressLabel: '',
      profileVersion: 0,
      unreadMessageCount: profile.unreadMessageCount,
      emptyMessage: '暂未绑定学员',
    };
  }

  return {
    isEmpty: false,
    studentName: profile.student.name,
    studentAgeLabel: `${profile.student.age} 岁`,
    studentAgeInput: String(profile.student.age),
    homeAddress: profile.student.homeAddress ?? '',
    homeAddressLabel: profile.student.homeAddress ?? '暂未填写',
    profileVersion: profile.student.profileVersion,
    unreadMessageCount: profile.unreadMessageCount,
  };
}

export function normalizeParentProfileDraft(input: {
  ageInput: string;
  homeAddressInput: string;
}): { age: number; homeAddress: string } {
  const ageText = input.ageInput.trim();
  const age = Number(ageText);
  if (!/^\d{1,3}$/.test(ageText) || !Number.isInteger(age) || age < 0 || age > 120) {
    throw new Error('年龄需填写 0 至 120 的整数');
  }
  const homeAddress = input.homeAddressInput.trim();
  if (homeAddress.length > 300) {
    throw new Error('家庭住址不能超过 300 字');
  }
  return { age, homeAddress };
}

export function resolveParentProfileAction(
  action: ParentProfileAction,
): ParentProfileActionResult {
  if (action === 'student') {
    return { kind: 'navigate', url: '/pages/parent/updates/index' };
  }
  if (action === 'campuses') {
    return { kind: 'navigate', url: '/pages/parent/courses/index?section=map' };
  }
  if (action === 'offers') {
    return { kind: 'navigate', url: '/pages/parent/courses/index' };
  }
  if (action === 'shop') {
    return { kind: 'toast', title: '待上架' };
  }
  if (action === 'hours') {
    return { kind: 'navigate', url: '/pages/parent/hours/index' };
  }
  if (action === 'messages') {
    return { kind: 'navigate', url: '/pages/parent/updates/index' };
  }
  if (action === 'groups') {
    return { kind: 'navigate', url: '/pages/parent/group-orders/index' };
  }

  return { kind: 'toast', title: '本轮暂未开放' };
}
