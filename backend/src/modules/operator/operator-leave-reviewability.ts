import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';

type LeaveReadClient = Pick<Prisma.TransactionClient, '$queryRaw'>;

const leaveRelations = Prisma.sql`
  FROM "ParentLeaveRequest" r
  JOIN "Student" s ON s."id" = r."studentId"
  JOIN "LessonSession" l ON l."id" = r."lessonSessionId"
`;

// Match the command's current relationship check. An old temporary episode
// cannot be revived by another episode or by subsequently joining the class.
function reviewableWhere(campusId: string) {
  return Prisma.sql`
    r."campusId" = ${campusId}::uuid AND r."status" = 'PENDING'
    AND s."campusId" = ${campusId}::uuid AND s."isActive" = true
    AND l."campusId" = ${campusId}::uuid
    AND (
      (r."temporaryMemberId" IS NULL AND EXISTS (
        SELECT 1 FROM "ClassMember" cm
        WHERE cm."classGroupId" = l."classGroupId"
          AND cm."studentId" = r."studentId"
          AND cm."campusId" = ${campusId}::uuid AND cm."leftAt" IS NULL
      ))
      OR
      (r."temporaryMemberId" IS NOT NULL AND EXISTS (
        SELECT 1 FROM "LessonTemporaryMember" tm
        WHERE tm."id" = r."temporaryMemberId"
          AND tm."lessonSessionId" = r."lessonSessionId"
          AND tm."studentId" = r."studentId"
          AND tm."campusId" = ${campusId}::uuid AND tm."removedAt" IS NULL
      ))
    )
  `;
}

export async function readReviewableLeaveIds(
  client: LeaveReadClient,
  campusId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT r."id" ${leaveRelations}
    WHERE ${reviewableWhere(campusId)} AND r."id" IN (${Prisma.join(ids)})
  `);
  return new Set(rows.map(row => row.id));
}

export async function readReviewableLeaveSummary(
  client: LeaveReadClient,
  campusId: string,
) {
  const rows = await client.$queryRaw<Array<{
    id: string; studentName: string; courseName: string; startsAt: Date; total: bigint;
  }>>(Prisma.sql`
    SELECT r."id", s."displayName" AS "studentName",
      cg."courseName", l."startsAt", COUNT(*) OVER () AS "total"
    ${leaveRelations}
    JOIN "ClassGroup" cg ON cg."id" = l."classGroupId"
    WHERE ${reviewableWhere(campusId)}
    ORDER BY r."createdAt" DESC, r."id" DESC LIMIT 1
  `);
  const latest = rows[0];
  const pendingLeaveCount = latest ? Number(latest.total) : 0;
  if (!Number.isSafeInteger(pendingLeaveCount) || pendingLeaveCount < 0) {
    throw new DomainError(ErrorCode.INTERNAL_SERVER_ERROR, 'The pending leave count is invalid', 500);
  }
  return {
    pendingLeaveCount,
    latestPendingLeave: latest ? {
      id: latest.id,
      studentName: latest.studentName,
      courseName: latest.courseName,
      startsAt: latest.startsAt.toISOString(),
    } : null,
  };
}
