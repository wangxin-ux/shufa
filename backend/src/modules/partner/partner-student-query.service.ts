import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { lessonBalanceSelect } from '../lesson-ledger/lesson-balance';
import type {
  PartnerSearchQueryDto,
  PartnerStudentQueryDto,
} from './dto/partner-query.dto';
import { readPartnerEnrollmentSummary } from './partner-enrollment-summary';

export const partnerCompletedAttendanceWhere = (
  campusId: string,
): Prisma.AttendanceRecordWhereInput => ({
  campusId,
  includedInFinalRoster: true,
  student: { campusId },
  lessonSession: {
    campusId,
    status: 'COMPLETED',
    teachingRecord: { is: { campusId, status: 'COMPLETED' } },
  },
});

export function partnerStudentSelect(campusId: string, now: Date) {
  return {
    id: true,
    displayName: true,
    birthDate: true,
    classMemberships: {
      where: {
        campusId,
        leftAt: null,
        classGroup: { campusId, status: 'ACTIVE' as const },
      },
      orderBy: [
        { classGroup: { name: 'asc' as const } },
        { id: 'asc' as const },
      ],
      select: { classGroup: { select: { name: true } } },
    },
    coursePackages: {
      where: {
        campusId,
        isActive: true,
        validFrom: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      select: lessonBalanceSelect,
    },
  } satisfies Prisma.StudentSelect;
}

@Injectable()
export class PartnerStudentQueryService {
  constructor(private readonly prisma: PrismaService) {}

  list(campusId: string, query: PartnerStudentQueryDto, now = new Date()) {
    const balance =
      query.balanceBand === 'ZERO'
        ? Prisma.sql`available = 0`
        : query.balanceBand === 'LTE_FIVE'
          ? Prisma.sql`available <= 500`
          : query.balanceBand === 'GT_FIVE'
            ? Prisma.sql`available > 500`
            : null;
    return this.query(
      campusId,
      query,
      now,
      balance,
      false,
      false,
      query.subjectId,
    ).then(({ students, total }) => ({ students, total }));
  }

  warnings(
    campusId: string,
    threshold: number,
    query: PartnerSearchQueryDto,
    now = new Date(),
  ) {
    return this.query(
      campusId,
      query,
      now,
      Prisma.sql`available <= ${threshold}`,
      true,
    ).then(({ students, total }) => ({ students, total }));
  }

  highlight(campusId: string, threshold: number, now = new Date()) {
    return this.query(
      campusId,
      { page: 1, pageSize: 1 },
      now,
      Prisma.sql`available <= ${threshold}`,
      true,
      true,
    );
  }

  private query(
    campusId: string,
    query: PartnerSearchQueryDto,
    now: Date,
    balance: Prisma.Sql | null,
    warnings: boolean,
    includeHighlight = false,
    subjectId?: string,
  ) {
    const keyword = query.query?.trim() ?? '';
    const validPackage = Prisma.sql`
      sp."studentId" = s.id AND sp."campusId" = ${campusId}::uuid
      AND sp."isActive" = TRUE AND sp."validFrom" <= ${now}
      AND (sp."expiresAt" IS NULL OR sp."expiresAt" >= ${now})
    `;
    // Subject chooses students; their balances still include every valid subject.
    const subject = !subjectId
      ? Prisma.empty
      : subjectId === 'UNCLASSIFIED'
        ? Prisma.sql`AND (
          EXISTS (SELECT 1 FROM "CoursePackage" sp
            WHERE ${validPackage} AND sp."subjectId" IS NULL)
          OR NOT EXISTS (SELECT 1 FROM "CoursePackage" sp WHERE ${validPackage})
        )`
        : Prisma.sql`AND EXISTS (SELECT 1 FROM "CoursePackage" sp
          WHERE ${validPackage} AND sp."subjectId" = ${subjectId}::uuid)`;
    const order = warnings
      ? Prisma.sql`available ASC, "displayName" ASC, id ASC`
      : Prisma.sql`"displayName" ASC, id ASC`;
    const source =
      balance === null
        ? Prisma.sql`SELECT * FROM candidates`
        : Prisma.sql`
      SELECT * FROM (
        SELECT s.id, s."displayName",
          COALESCE(SUM(p."mainBalanceUnits"::bigint + p."giftBalanceUnits"
            - p."mainReservedUnits" - p."giftReservedUnits"), 0) AS available
        FROM candidates s
        LEFT JOIN "CoursePackage" p ON p."studentId" = s.id
          AND p."campusId" = ${campusId}::uuid AND p."isActive" = TRUE
          AND p."validFrom" <= ${now}
          AND (p."expiresAt" IS NULL OR p."expiresAt" >= ${now})
        GROUP BY s.id, s."displayName"
      ) balances WHERE ${balance}
    `;
    return this.prisma.$transaction(
      async (tx) => {
        // Count and page share the same filtered relation, including empty/out-of-range pages.
        const rows = await tx.$queryRaw<
          Array<{ id: string | null; total: number }>
        >(Prisma.sql`
        WITH candidates AS (
          SELECT s.id, s."displayName"
          FROM "Student" s
          WHERE s."campusId" = ${campusId}::uuid AND s."isActive" = TRUE
            AND strpos(lower(s."displayName"), lower(${keyword})) > 0
            ${subject}
        ), filtered AS (
          ${source}
        ), paged AS (
          SELECT id, row_number() OVER (ORDER BY ${order}) AS ordinal
          FROM filtered ORDER BY ${order}
          LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
        )
        SELECT paged.id, counts.total
        FROM (SELECT COUNT(*)::int AS total FROM filtered) counts
        LEFT JOIN paged ON TRUE ORDER BY paged.ordinal
      `);
        const ids = rows.flatMap((row) => (row.id === null ? [] : [row.id]));
        const students =
          ids.length === 0
            ? []
            : await tx.student.findMany({
                where: { campusId, isActive: true, id: { in: ids } },
                select: partnerStudentSelect(campusId, now),
              });
        const byId = new Map(students.map((student) => [student.id, student]));
        const highlightId =
          includeHighlight && byId.has(ids[0]) ? ids[0] : undefined;
        const memberships = highlightId
          ? await tx.classMember.findMany({
              where: {
                campusId,
                studentId: highlightId,
                leftAt: null,
                classGroup: {
                  campusId,
                  status: 'ACTIVE',
                  teacher: { campusId },
                },
              },
              orderBy: [{ classGroup: { name: 'asc' } }, { id: 'asc' }],
              select: {
                classGroup: {
                  select: {
                    id: true,
                    name: true,
                    courseName: true,
                    teacher: {
                      select: { user: { select: { displayName: true } } },
                    },
                  },
                },
              },
            })
          : [];
        const attendanceGroups = highlightId
          ? await tx.attendanceRecord.groupBy({
              by: ['status'],
              where: {
                ...partnerCompletedAttendanceWhere(campusId),
                studentId: highlightId,
              },
              _count: { _all: true },
            })
          : [];
        const enrollmentSummary = highlightId
          ? await readPartnerEnrollmentSummary(tx, campusId, highlightId)
          : null;
        return {
          students: ids.map((id) => byId.get(id)!),
          total: rows[0]?.total ?? 0,
          classes: memberships.map(({ classGroup }) => ({
            id: classGroup.id,
            className: classGroup.name,
            courseName: classGroup.courseName,
            teacherName: classGroup.teacher.user.displayName,
          })),
          attendanceGroups,
          enrollmentSummary,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
