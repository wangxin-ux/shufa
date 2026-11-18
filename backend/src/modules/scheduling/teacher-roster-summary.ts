import { Prisma } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { lessonBalanceSelect } from '../lesson-ledger/lesson-balance';
import type { TeacherLessonRosterSummaryView } from './teacher-read.models';
import { savedOrFinalAttendanceWhere } from '../attendance/final-attendance';

export function teacherRosterSummarySelect(campusId: string, at: Date) {
  const student = {
    select: {
      id: true,
      coursePackages: {
        where: {
          campusId,
          isActive: true,
          validFrom: { lte: at },
          OR: [{ expiresAt: null }, { expiresAt: { gte: at } }],
        },
        select: lessonBalanceSelect,
      },
    },
  } satisfies Prisma.StudentDefaultArgs;
  return {
    id: true,
    version: true,
    startsAt: true,
    endsAt: true,
    lessonUnits: true,
    status: true,
    campus: { select: { name: true, lessonWarningThresholdUnits: true } },
    classGroup: {
      select: {
        name: true,
        courseName: true,
        members: {
          where: {
            campusId,
            leftAt: null,
            student: { campusId, isActive: true },
          },
          select: { student },
        },
      },
    },
    temporaryMembers: {
      where: { campusId, removedAt: null, student: { campusId, isActive: true } },
      select: { id: true, student },
    },
    attendanceRecords: {
      where: { campusId, ...savedOrFinalAttendanceWhere },
      select: { studentId: true, status: true, student },
    },
    parentLeaveRequests: {
      where: { campusId, status: 'APPROVED' },
      select: { studentId: true, temporaryMemberId: true },
    },
  } satisfies Prisma.LessonSessionSelect;
}

export type TeacherRosterSummaryRow = Prisma.LessonSessionGetPayload<{
  select: ReturnType<typeof teacherRosterSummarySelect>;
}>;

export function activeApprovedLeaveStudentIds(row: TeacherRosterSummaryRow) {
  const regularIds = new Set(row.classGroup.members.map(({ student }) => student.id));
  const temporaryIds = new Set(row.temporaryMembers.map(({ id }) => id));
  return new Set(row.parentLeaveRequests.filter(request =>
    request.temporaryMemberId === null
      ? regularIds.has(request.studentId)
      : temporaryIds.has(request.temporaryMemberId),
  ).map(({ studentId }) => studentId));
}

function sourceError(): never {
  throw new DomainError(
    ErrorCode.INTERNAL_SERVER_ERROR,
    'The lesson roster balance source is invalid',
    500,
  );
}

export function summarizeTeacherLessonRoster(
  row: TeacherRosterSummaryRow,
  at: Date,
): TeacherLessonRosterSummaryView {
  const thresholdUnits = row.campus.lessonWarningThresholdUnits;
  if (!Number.isSafeInteger(thresholdUnits) || thresholdUnits < 0) {
    sourceError();
  }
  const historical = row.status === 'COMPLETED' || row.status === 'REVERSED';
  const acceptsLeave =
    row.status === 'SCHEDULED' || row.status === 'IN_PROGRESS';
  const members = new Map(
    (historical ? row.attendanceRecords : [...row.classGroup.members, ...row.temporaryMembers]).map(
      ({ student }) => [student.id, student],
    ),
  );
  const attendance = new Map(
    row.attendanceRecords.map(({ studentId, status }) => [studentId, status]),
  );
  const approvedLeave = activeApprovedLeaveStudentIds(row);
  let leaveCount = 0;
  let warningCount = 0;
  for (const student of members.values()) {
    const saved = attendance.get(student.id);
    if (
      saved === 'LEAVE' ||
      (acceptsLeave && !saved && approvedLeave.has(student.id))
    ) {
      leaveCount++;
    }
    let available = 0n;
    for (const item of student.coursePackages) {
      const {
        mainBalanceUnits,
        giftBalanceUnits,
        mainReservedUnits,
        giftReservedUnits,
      } = item;
      if (
        ![
          mainBalanceUnits,
          giftBalanceUnits,
          mainReservedUnits,
          giftReservedUnits,
        ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
        mainReservedUnits > mainBalanceUnits ||
        giftReservedUnits > giftBalanceUnits
      ) {
        sourceError();
      }
      available +=
        BigInt(mainBalanceUnits) +
        BigInt(giftBalanceUnits) -
        BigInt(mainReservedUnits) -
        BigInt(giftReservedUnits);
    }
    if (available <= BigInt(thresholdUnits)) warningCount++;
  }
  return {
    expectedCount: members.size,
    leaveCount,
    warningCount,
    thresholdUnits,
    asOf: at.toISOString(),
    source: historical ? 'HISTORICAL_ATTENDANCE' : 'CURRENT',
  };
}
