import { CampusManagerProfile } from "../types/campus-manager";

export type CampusManagerProfileActionKey =
  | "students"
  | "schedule"
  | "approvals"
  | "warnings"
  | "settings";

export const CAMPUS_MANAGER_PROFILE_ACTIONS: ReadonlyArray<{
  key: CampusManagerProfileActionKey;
  label: string;
}> = [
  { key: "students", label: "人员管理" },
  { key: "schedule", label: "排课管理" },
  { key: "approvals", label: "请假审批" },
  { key: "warnings", label: "预警名单" },
  { key: "settings", label: "校区设置" },
];

const PROFILE_ROUTES: Record<CampusManagerProfileActionKey, string> = {
  students: "/pages/campus-manager/students/index",
  schedule: "/pages/campus-manager/schedule/index",
  approvals: "/pages/campus-manager/leave-requests/index",
  warnings: "/pages/campus-manager/warnings/index",
  settings: "/pages/campus-manager/campus-settings/index",
};

export function buildCampusManagerProfilePageModel(
  profile: CampusManagerProfile,
) {
  return {
    displayName: profile.displayName,
    identityLabel: "分校区管理员" as const,
    campusName: profile.campusName,
  };
}

export function resolveCampusManagerProfileAction(
  key: CampusManagerProfileActionKey,
): { kind: "navigate"; url: string } {
  return { kind: "navigate", url: PROFILE_ROUTES[key] };
}
