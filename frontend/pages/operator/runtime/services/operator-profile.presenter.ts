import { OperatorProfile } from "../types/operator";

export type OperatorProfileActionKey =
  | "students"
  | "teacher-archives"
  | "rankings"
  | "lesson-account"
  | "schedule"
  | "approvals"
  | "warnings"
  | "settings";

export const OPERATOR_PROFILE_ACTIONS: ReadonlyArray<{
  key: OperatorProfileActionKey;
  label: string;
}> = [
  { key: "students", label: "人员管理" },
  { key: "teacher-archives", label: "教师档案" },
  { key: "rankings", label: "校区月榜" },
  { key: "lesson-account", label: "课时账户" },
  { key: "schedule", label: "排课管理" },
  { key: "approvals", label: "请假审批" },
  { key: "warnings", label: "预警名单" },
  { key: "settings", label: "校区设置" },
];

const PROFILE_ROUTES: Record<OperatorProfileActionKey, string> = {
  students: "/pages/operator/students/index",
  "teacher-archives": "/pages/operator/teacher-archives/index",
  rankings: "/pages/operator/rankings/index",
  "lesson-account": "/pages/operator/lesson-account/index",
  schedule: "/pages/operator/schedule/index",
  approvals: "/pages/operator/leave-requests/index",
  warnings: "/pages/operator/warnings/index",
  settings: "/pages/operator/campus-settings/index",
};

export const OPERATOR_PRIMARY_PROFILE_ACTIONS: typeof OPERATOR_PROFILE_ACTIONS = [
  { key: 'lesson-account', label: '课时数据' },
  { key: 'schedule', label: '排课管理' },
  { key: 'approvals', label: '审批中心' },
  { key: 'students', label: '学员档案' },
  { key: 'teacher-archives', label: '教师档案' },
];
export const OPERATOR_MORE_PROFILE_ACTIONS = OPERATOR_PROFILE_ACTIONS.filter(
  action => !OPERATOR_PRIMARY_PROFILE_ACTIONS.some(primary => primary.key === action.key),
);

export function buildOperatorProfilePageModel(
  profile: OperatorProfile,
) {
  return {
    displayName: profile.displayName,
    identityLabel: "校区运营" as const,
    campusName: profile.campusName,
  };
}

export function resolveOperatorProfileAction(
  key: OperatorProfileActionKey,
): { kind: "navigate"; url: string } {
  return { kind: "navigate", url: PROFILE_ROUTES[key] };
}
