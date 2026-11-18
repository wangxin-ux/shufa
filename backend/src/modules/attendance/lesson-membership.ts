import type { Prisma } from '@prisma/client';

export interface LessonMembershipScope {
  id: string;
  campusId: string;
  classGroupId: string;
}

export function activeLessonMemberWhere(
  campusId: string,
  studentId: string,
): Prisma.LessonSessionWhereInput {
  return {
    OR: [
      { classGroup: { members: { some: {
        campusId, studentId, leftAt: null,
        student: { campusId, isActive: true },
      } } } },
      { temporaryMembers: { some: {
        campusId, studentId, removedAt: null,
        student: { campusId, isActive: true },
      } } },
    ],
  };
}

// Call only after the lesson lock. Include inactive rows so reactivation
// cannot change the roster between validation and the dependent write.
export async function lockRosterRelations(
  tx: Prisma.TransactionClient,
  lesson: LessonMembershipScope,
  lockStudents = true,
  additionalStudentId: string | null = null,
): Promise<void> {
  await tx.$queryRaw`
    SELECT "id" FROM "ClassGroup"
    WHERE "id" = ${lesson.classGroupId}::uuid AND "campusId" = ${lesson.campusId}::uuid
    FOR UPDATE
  `;
  await tx.$queryRaw`
    SELECT "id" FROM "ClassMember"
    WHERE "classGroupId" = ${lesson.classGroupId}::uuid
    ORDER BY "studentId", "id" FOR SHARE
  `;
  if (lockStudents) {
    await tx.$queryRaw`
      SELECT s."id" FROM "Student" s
      WHERE s."id" = ${additionalStudentId}::uuid OR s."id" IN (
        SELECT "studentId" FROM "ClassMember" WHERE "classGroupId" = ${lesson.classGroupId}::uuid
        UNION
        SELECT "studentId" FROM "LessonTemporaryMember" WHERE "lessonSessionId" = ${lesson.id}::uuid
      )
      ORDER BY s."id" FOR SHARE OF s
    `;
  }
}

export async function readActiveLessonMembers(
  tx: Prisma.TransactionClient,
  lesson: LessonMembershipScope,
) {
  const student = { campusId: lesson.campusId, isActive: true };
  const select = { studentId: true, student: { select: { displayName: true } } } as const;
  const [regular, temporary] = await Promise.all([
    tx.classMember.findMany({
      where: { campusId: lesson.campusId, classGroupId: lesson.classGroupId, leftAt: null, student },
      orderBy: [{ student: { displayName: 'asc' } }, { studentId: 'asc' }],
      select,
    }),
    tx.lessonTemporaryMember.findMany({
      where: { campusId: lesson.campusId, lessonSessionId: lesson.id, removedAt: null, student },
      orderBy: [{ student: { displayName: 'asc' } }, { studentId: 'asc' }],
      select,
    }),
  ]);
  const members = new Map<string, { studentId: string; displayName: string; source: 'CLASS' | 'TEMPORARY' }>();
  for (const [rows, source] of [[regular, 'CLASS'], [temporary, 'TEMPORARY']] as const)
    for (const row of rows)
      if (!members.has(row.studentId))
        members.set(row.studentId, { studentId: row.studentId, displayName: row.student.displayName, source });
  return [...members.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName) || a.studentId.localeCompare(b.studentId));
}
