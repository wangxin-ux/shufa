import { AttendanceService } from '../src/modules/attendance/attendance.service';
import {
  loadActiveRoster,
  validateAttendanceSnapshot,
  type LockedLessonSession,
} from '../src/modules/attendance/lesson-mutation.helper';
import { FeedbackService } from '../src/modules/feedback/feedback.service';

const scope = {
  userId: '10000000-0000-4000-8000-000000000001',
  campusId: '20000000-0000-4000-8000-000000000001',
  teacherProfileId: '30000000-0000-4000-8000-000000000001',
};
const anotherCampus = '20000000-0000-4000-8000-000000000002';
const studentId = '50000000-0000-4000-8000-000000000001';
const lesson: LockedLessonSession = {
  id: '40000000-0000-4000-8000-000000000001',
  campusId: scope.campusId,
  teacherId: scope.teacherProfileId,
  classGroupId: '60000000-0000-4000-8000-000000000001',
  startsAt: new Date('2026-10-30T01:00:00.000Z'),
  endsAt: new Date('2026-10-30T02:00:00.000Z'),
  status: 'SCHEDULED',
  kind: 'REGULAR',
  lessonUnits: 100,
  version: 1,
  completedAt: null,
};
function member() {
  return {
    campusId: scope.campusId,
    classGroupId: lesson.classGroupId,
    studentId,
    leftAt: null as Date | null,
    student: {
      campusId: scope.campusId,
      isActive: true,
      displayName: 'Synthetic student',
    },
  };
}
type Member = ReturnType<typeof member>;
interface RosterQuery {
  where: {
    campusId: string;
    classGroupId: string;
    leftAt: null;
    student: { campusId?: string; isActive: boolean };
  };
  select: unknown;
  take?: number;
}
function harness(rows = [member()], status = lesson.status) {
  const nextStage = jest.fn(() => {
    throw new Error('The member guard allowed the next stage');
  });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ ...lesson, status }]),
    lessonTemporaryMember: { findMany: jest.fn().mockResolvedValue([]) },
    classMember: {
      findMany: jest.fn((args: RosterQuery) =>
        Promise.resolve(
          rows
            .filter(
              (row) =>
                row.campusId === args.where.campusId &&
                row.classGroupId === args.where.classGroupId &&
                row.leftAt === args.where.leftAt &&
                row.student.isActive === args.where.student.isActive &&
                (args.where.student.campusId === undefined ||
                  row.student.campusId === args.where.student.campusId),
            )
            .map((row) => ({
              studentId: row.studentId,
              student: { displayName: row.student.displayName },
            })),
        ),
      ),
    },
    attendanceRecord: { upsert: nextStage },
    studentFeedback: { findUnique: nextStage },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const idempotency = {
    claim: jest.fn().mockResolvedValue({ replayed: false }),
    complete: jest.fn(),
  };
  const ledger = { consumeStudentLessonUnits: jest.fn() };
  const earning = { recordCompletedLesson: jest.fn() };
  const partnerEarning = { recordCompletedLesson: jest.fn() };
  const media = { store: nextStage };
  const attendance = new AttendanceService(
    prisma as unknown as ConstructorParameters<typeof AttendanceService>[0],
    idempotency as unknown as ConstructorParameters<
      typeof AttendanceService
    >[1],
    ledger as unknown as ConstructorParameters<typeof AttendanceService>[2],
    earning as unknown as ConstructorParameters<typeof AttendanceService>[3],
    partnerEarning as unknown as ConstructorParameters<
      typeof AttendanceService
    >[4],
    media as unknown as ConstructorParameters<typeof AttendanceService>[5],
  );
  const feedback = new FeedbackService(
    prisma as unknown as ConstructorParameters<typeof FeedbackService>[0],
    idempotency as unknown as ConstructorParameters<typeof FeedbackService>[1],
    media as unknown as ConstructorParameters<typeof FeedbackService>[2],
  );
  return {
    tx,
    attendance,
    feedback,
    idempotency,
    ledger,
    earning,
    partnerEarning,
    nextStage,
  };
}
function transaction(host: ReturnType<typeof harness>) {
  return host.tx as unknown as Parameters<typeof loadActiveRoster>[0];
}

describe('teacher current roster campus scope (offline actual methods)', () => {
  it('requires current student campus as well as the membership campus', async () => {
    const row = member();
    row.student.campusId = anotherCampus;
    const host = harness([row]);
    expect(await loadActiveRoster(transaction(host), lesson)).toEqual([]);
  });
  it('requests the same scoped current members without a nested page limit', async () => {
    const host = harness();
    await loadActiveRoster(transaction(host), lesson);
    expect(host.tx.classMember.findMany).toHaveBeenCalledWith({
      where: {
        campusId: scope.campusId,
        classGroupId: lesson.classGroupId,
        leftAt: null,
        student: { campusId: scope.campusId, isActive: true },
      },
      orderBy: [{ student: { displayName: 'asc' } }, { studentId: 'asc' }],
      select: { studentId: true, student: { select: { displayName: true } } },
    });
  });
  it('keeps a valid current member and the exact attendance snapshot requirement', async () => {
    const host = harness();
    const roster = await loadActiveRoster(transaction(host), lesson);
    expect(roster).toEqual([{ studentId, displayName: 'Synthetic student' }]);
    expect(
      validateAttendanceSnapshot(roster, [{ studentId, status: 'PRESENT' }]),
    ).toEqual(new Map([[studentId, 'PRESENT']]));
    expect(() => validateAttendanceSnapshot(roster, [])).toThrow(
      'Attendance must include every active class member exactly once',
    );
  });
  it.each([
    [
      'inactive student',
      (row: Member) => {
        row.student.isActive = false;
      },
    ],
    [
      'left member',
      (row: Member) => {
        row.leftAt = new Date();
      },
    ],
    [
      'other membership campus',
      (row: Member) => {
        row.campusId = anotherCampus;
      },
    ],
    [
      'other class',
      (row: Member) => {
        row.classGroupId = studentId;
      },
    ],
  ] as const)('continues rejecting %s', async (_name, change) => {
    void _name;
    const row = member();
    change(row);
    const host = harness([row]);
    expect(await loadActiveRoster(transaction(host), lesson)).toEqual([]);
  });
  it.each(['save', 'complete', 'feedback', 'upload'] as const)(
    'rejects migrated students before side effects in public %s',
    async (operation) => {
      const row = member();
      row.student.campusId = anotherCampus;
      const host = harness(
        [row],
        operation === 'feedback' || operation === 'upload'
          ? 'COMPLETED'
          : 'SCHEDULED',
      );
      const dto = {
        lessonVersion: 1,
        attendance: [{ studentId, status: 'PRESENT' as const }],
      };
      const result =
        operation === 'save'
          ? host.attendance.saveAttendance(
              scope,
              lesson.id,
              dto,
              'synthetic-key',
            )
          : operation === 'complete'
            ? host.attendance.completeLesson(
                scope,
                lesson.id,
                dto,
                'synthetic-key',
              )
            : operation === 'feedback'
              ? host.feedback.upsert(
                  scope,
                  lesson.id,
                  studentId,
                  { content: 'Synthetic feedback', imageFileIds: [] },
                  'synthetic-key',
                )
              : host.feedback.uploadImage(
                  scope,
                  {
                    userId: scope.userId,
                    roles: [{ code: 'TEACHER', campusId: scope.campusId }],
                  },
                  lesson.id,
                  studentId,
                  undefined,
                );
      await expect(result).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN',
      });
      expect(host.nextStage).not.toHaveBeenCalled();
      expect(host.ledger.consumeStudentLessonUnits).not.toHaveBeenCalled();
      expect(host.earning.recordCompletedLesson).not.toHaveBeenCalled();
      expect(host.partnerEarning.recordCompletedLesson).not.toHaveBeenCalled();
      expect(host.idempotency.complete).not.toHaveBeenCalled();
      expect(host.tx.$queryRaw).toHaveBeenCalledTimes(4);
    },
  );
});
