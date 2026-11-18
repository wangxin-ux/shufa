export function calculateStudentAge(
  birthDate: Date | null,
  now = new Date(),
): number {
  if (!birthDate) return 0;
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const beforeBirthday =
    local.getUTCMonth() < birthDate.getUTCMonth() ||
    (local.getUTCMonth() === birthDate.getUTCMonth() &&
      local.getUTCDate() < birthDate.getUTCDate());
  return Math.max(
    0,
    local.getUTCFullYear() -
      birthDate.getUTCFullYear() -
      (beforeBirthday ? 1 : 0),
  );
}
