export const ROLE_CODES = [
  'PARENT',
  'PARTNER',
  'TEACHER',
  'OPERATOR',
  'CAMPUS_MANAGER',
  'SUPER_ADMIN',
  'HR',
  'FINANCE',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface AuthenticatedUser {
  userId: string;
  roles: Array<{
    code: RoleCode;
    campusId: string | null;
  }>;
}
