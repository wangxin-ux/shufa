import { TeacherProfile } from '../types/teacher';

export type TeacherProfileActionKey =
  | 'schedule'
  | 'students'
  | 'feedback'
  | 'ledger'
  | 'earnings'
  | 'group-campaigns';

export interface TeacherProfilePageModel {
  displayName: string;
  avatarInitial: string;
  subjectLabel: string;
  subjectLines: string[];
  campusName: string;
  studentCount: string;
  studentCountCompact: boolean;
}

export const TEACHER_PROFILE_ACTIONS: ReadonlyArray<{
  key: TeacherProfileActionKey;
  label: string;
}> = [
  { key: 'schedule', label: '我的课表' },
  { key: 'students', label: '我的学员' },
  { key: 'feedback', label: '课堂反馈' },
  { key: 'ledger', label: '扣课记录' },
  { key: 'earnings', label: '我的收益' },
  { key: 'group-campaigns', label: '活动中心' },
];

const PROFILE_ROUTES: Record<TeacherProfileActionKey, string> = {
  schedule: '/pages/teacher/schedule/index',
  students: '/pages/teacher/students/index',
  feedback: '/pages/teacher/feedback/index',
  ledger: '/pages/teacher/ledger/index',
  earnings: '/pages/teacher/earnings/index',
  'group-campaigns': '/pages/teacher/group-campaigns/index',
};

export const TEACHER_PRIMARY_PROFILE_ACTIONS: typeof TEACHER_PROFILE_ACTIONS = [
  { key: 'schedule', label: '我的课表' },
  { key: 'students', label: '我的学生' },
  { key: 'earnings', label: '课时账户' },
];
export const TEACHER_MORE_PROFILE_ACTIONS = TEACHER_PROFILE_ACTIONS.filter(
  action => !TEACHER_PRIMARY_PROFILE_ACTIONS.some(primary => primary.key === action.key),
);

export function buildTeacherProfilePageModel(
  profile: TeacherProfile,
): TeacherProfilePageModel {
  const studentCount = Math.max(
    0,
    Math.trunc(profile.responsibleStudentCount),
  );
  const subjectLines = profile.subjectLabel
    .split(/\s*(?:\/|、|，|,)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    displayName: profile.displayName,
    avatarInitial: teacherAvatarInitial(profile.displayName),
    subjectLabel: profile.subjectLabel,
    subjectLines: subjectLines.length ? subjectLines : ['暂未设置课程'],
    campusName: profile.campusName,
    studentCount: String(studentCount),
    studentCountCompact: studentCount >= 100,
  };
}

/**
 * 头像徽标文字：设计稿是插画头像，无该素材时用姓名首字顶位。
 * 只取第一个非空白字符，避免徽标里塞两个汉字把圆撑破。
 */
export function teacherAvatarInitial(displayName: string): string {
  const first = Array.from((displayName ?? '').trim())[0];
  return first ?? '师';
}

export function resolveTeacherProfileAction(
  key: TeacherProfileActionKey,
): { kind: 'navigate'; url: string } {
  return { kind: 'navigate', url: PROFILE_ROUTES[key] };
}
