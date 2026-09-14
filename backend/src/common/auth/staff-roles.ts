export const HEADQUARTERS_STAFF_ROLES = ['HR', 'FINANCE'] as const;
export const MANAGEABLE_STAFF_ROLES = [
  'TEACHER', 'CAMPUS_MANAGER', 'PARTNER', ...HEADQUARTERS_STAFF_ROLES,
] as const;
export const DIRECTLY_CREATABLE_STAFF_ROLES = [
  'CAMPUS_MANAGER', 'PARTNER', ...HEADQUARTERS_STAFF_ROLES,
] as const;

export function isHeadquartersStaffRole(role: string): boolean {
  return role === 'HR' || role === 'FINANCE';
}

export function hasValidStaffCampus(role: string, campusId: unknown): boolean {
  return isHeadquartersStaffRole(role)
    ? campusId === null
    : typeof campusId === 'string' && campusId.length > 0;
}
