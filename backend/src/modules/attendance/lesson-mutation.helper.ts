import type { Prisma } from '@prisma/client';
import type { TeacherScope } from '../../common/auth/teacher-scope.service';
import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { AttendanceItemDto, AttendanceStatus } from './dto/attendance.dto';

export interface LockedLessonSession {
  id: string;
  campusId: string;
  classGroupId: string;
  teacherId: string;
  startsAt: Date;
  endsAt: Date;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'REVERSED' | 'CANCELLED';
  kind: 'REGULAR' | 'MAKEUP' | 'TRIAL';
  lessonUnits: number;
  version: number;
  completedAt: Date | null;
}

export interface ActiveRosterMember {
  studentId: string;
  displayName: string;
}

export async function lockAssignedLesson(
  transaction: Prisma.TransactionClient,
  scope: TeacherScope,
  lessonSessionId: string,
): Promise<LockedLessonSession> {
  const lessons = await transaction.$queryRaw<LockedLessonSession[]>`
    SELECT
      "id",
      "campusId",
      "classGroupId",
      "teacherId",
      "startsAt",
      "endsAt",
      "status",
      "kind",
      "lessonUnits",
      "version",
      "completedAt"
    FROM "LessonSession"
    WHERE "id" = ${lessonSessionId}::uuid
    FOR UPDATE
  `;
  const lesson = lessons[0];
  if (!lesson) {
    throw new DomainError(
      ErrorCode.RESOURCE_NOT_FOUND,
      'Lesson session was not found',
      404,
    );
  }
  if (
    lesson.campusId !== scope.campusId ||
    lesson.teacherId !== scope.teacherProfileId
  ) {
    throw new DomainError(
      ErrorCode.LESSON_NOT_ASSIGNED,
      'The lesson session is outside the teacher scope',
      403,
    );
  }

  return lesson;
}

export async function loadActiveRoster(
  transaction: Prisma.TransactionClient,
  lesson: LockedLessonSession,
): Promise<ActiveRosterMember[]> {
  const members = await transaction.classMember.findMany({
    where: {
      campusId: lesson.campusId,
      classGroupId: lesson.classGroupId,
      leftAt: null,
      student: { isActive: true },
    },
    orderBy: [{ student: { displayName: 'asc' } }, { studentId: 'asc' }],
    select: {
      studentId: true,
      student: { select: { displayName: true } },
    },
  });

  return members.map(({ studentId, student }) => ({
    studentId,
    displayName: student.displayName,
  }));
}

export function assertLessonVersion(
  lesson: LockedLessonSession,
  requestedVersion: number,
): void {
  if (lesson.version !== requestedVersion) {
    throw new DomainError(
      ErrorCode.LESSON_VERSION_CONFLICT,
      'The lesson session version has changed',
      409,
      { currentVersion: lesson.version },
    );
  }
}

export function validateAttendanceSnapshot(
  roster: readonly ActiveRosterMember[],
  attendance: readonly AttendanceItemDto[],
): Map<string, AttendanceStatus> {
  const rosterIds = new Set(roster.map(({ studentId }) => studentId));
  const requestedIds = new Set(attendance.map(({ studentId }) => studentId));
  if (attendance.some(({ studentId }) => !rosterIds.has(studentId))) {
    throw new DomainError(
      ErrorCode.FORBIDDEN,
      'Attendance includes a student outside the assigned class',
      403,
    );
  }
  if (
    requestedIds.size !== attendance.length ||
    requestedIds.size !== rosterIds.size ||
    [...rosterIds].some((studentId) => !requestedIds.has(studentId))
  ) {
    throw new DomainError(
      ErrorCode.ATTENDANCE_INCOMPLETE,
      'Attendance must include every active class member exactly once',
      400,
    );
  }

  return new Map(
    attendance.map(({ studentId, status }) => [studentId, status]),
  );
}
