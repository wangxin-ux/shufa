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
    subjectLabel: profile.subjectLabel,
    subjectLines: subjectLines.length ? subjectLines : ['暂未设置课程'],
    campusName: profile.campusName,
    studentCount: String(studentCount),
    studentCountCompact: studentCount >= 100,
  };
}

export function resolveTeacherProfileAction(
  key: TeacherProfileActionKey,
): { kind: 'navigate'; url: string } {
  return { kind: 'navigate', url: PROFILE_ROUTES[key] };
}
