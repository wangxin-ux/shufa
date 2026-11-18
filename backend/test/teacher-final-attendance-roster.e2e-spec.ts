import {
  AttendanceService,
  type CompleteLessonResult,
} from '../src/modules/attendance/attendance.service';
import type { LockedLessonSession } from '../src/modules/attendance/lesson-mutation.helper';
import { EarningRecordingService } from '../src/modules/earning/earning-recording.service';
import { FeedbackService } from '../src/modules/feedback/feedback.service';
import { PartnerEarningRecordingService } from '../src/modules/partner-earning/partner-earning-recording.service';
import { ParentGrowthService } from '../src/modules/parent-portal/parent-growth.service';
import { ParentPortalService } from '../src/modules/parent-portal/parent-portal.service';
import { OperatorStudentArchiveService } from '../src/modules/operator/operator-student-archive.service';
import { PartnerStudentGrowthService } from '../src/modules/partner/partner-student-growth.service';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import {
  AttendanceDraftDto,
  CompleteLessonDto,
} from '../src/modules/attendance/dto/attendance.dto';

const scope = {
  userId: '10000000-0000-4000-8000-000000000001',
  campusId: '20000000-0000-4000-8000-000000000001',
  teacherProfileId: '30000000-0000-4000-8000-000000000001',
};
const lessonId = '40000000-0000-4000-8000-000000000001';
const a = '50000000-0000-4000-8000-000000000001';
const b = '50000000-0000-4000-8000-000000000002';
type Status = 'PRESENT' | 'LEAVE' | 'ABSENT';
interface Row {
  campusId: string;
  lessonSessionId: string;
  studentId: string;
  status: Status;
  recordedAt: Date;
  includedInFinalRoster: boolean;
}
interface Where {
  campusId?: string;
  lessonSessionId?: string;
  studentId?: string | { notIn: string[] };
  includedInFinalRoster?: boolean;
  status?: Status;
}
function matches(row: Row, where: Where) {
  return (
    (where.campusId === undefined || row.campusId === where.campusId) &&
    (where.lessonSessionId === undefined ||
      row.lessonSessionId === where.lessonSessionId) &&
    (where.includedInFinalRoster === undefined ||
      row.includedInFinalRoster === where.includedInFinalRoster) &&
    (where.status === undefined || row.status === where.status) &&
    (where.studentId === undefined ||
      (typeof where.studentId === 'string'
        ? row.studentId === where.studentId
        : !where.studentId.notIn.includes(row.studentId)))
  );
}
function harness(priced = true) {
  const state = {
    members: [a, b],
    temporaryMembers: [] as string[],
    rows: [] as Row[],
    lesson: {
      id: lessonId,
      campusId: scope.campusId,
      teacherId: scope.teacherProfileId,
      classGroupId: '60000000-0000-4000-8000-000000000001',
      startsAt: new Date('2026-10-30T01:00:00Z'),
      endsAt: new Date('2026-10-30T02:00:00Z'),
      status: 'SCHEDULED',
      kind: 'REGULAR',
      lessonUnits: 100,
      version: 1,
      completedAt: null,
    } as LockedLessonSession,
    teaching: null as {
      id: string;
      status: string;
      attendeeCount: number;
    } | null,
    ledger: [] as Array<{
      id: string;
      campusId: string;
      studentId: string;
      coursePackageId: string;
      lessonSessionId: string;
      entryType: string;
      bucket: 'MAIN' | 'GIFT';
      deltaUnits: number;
    }>,
    packages: [a, b].map((studentId) => ({
      id: studentId,
      mainBalanceUnits: 1000,
      giftBalanceUnits: 0,
      version: 1,
    })),
  };
  const nextStage = jest.fn(() => {
    throw new Error('Feedback admission accepted');
  });
  const teacherBasis = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn((_args: unknown) => {
      void _args;
      return Promise.resolve({ id: 'teacher-basis' });
    }),
  };
  const partnerBasis = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn((_args: unknown) => {
      void _args;
      return Promise.resolve({ id: 'partner-basis' });
    }),
  };
  const tx = {
    lessonTemporaryMember: { findMany: jest.fn(() => Promise.resolve(
      state.temporaryMembers.map(studentId => ({ studentId, student: { displayName: studentId } })),
    )) },
    $queryRaw: jest.fn((parts: TemplateStringsArray, id: string) =>
      Promise.resolve(
        parts.join('').includes('FROM "CoursePackage"')
          ? state.packages.filter((row) => row.id === id)
          : [{ ...state.lesson }],
      ),
    ),
    classMember: {
      findMany: jest.fn(() =>
        Promise.resolve(
          state.members.map((studentId) => ({
            studentId,
            student: { displayName: studentId },
          })),
        ),
      ),
    },
    attendanceRecord: {
      upsert: jest.fn(
        (args: {
          create: Omit<Row, 'includedInFinalRoster'> & {
            includedInFinalRoster?: boolean;
          };
          update: Partial<Row>;
        }) => {
          const existing = state.rows.find(
            (row) => row.studentId === args.create.studentId,
          );
          if (existing) Object.assign(existing, args.update);
          else state.rows.push({ includedInFinalRoster: true, ...args.create });
          return Promise.resolve({});
        },
      ),
      updateMany: jest.fn((args: { where: Where; data: Partial<Row> }) => {
        const rows = state.rows.filter((row) => matches(row, args.where));
        rows.forEach((row) => Object.assign(row, args.data));
        return Promise.resolve({ count: rows.length });
      }),
      findMany: jest.fn((args: { where: Where }) =>
        Promise.resolve(
          state.rows
            .filter((row) => matches(row, args.where))
            .map((row) => ({ ...row })),
        ),
      ),
      findFirst: jest.fn((args: { where: Where }) =>
        Promise.resolve(
          state.rows.find((row) => matches(row, args.where)) ?? null,
        ),
      ),
    },
    lessonSession: {
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({
          ...state.lesson,
          campus: { name: 'Synthetic campus' },
          classGroup: {
            name: 'Synthetic class',
            courseName: 'Synthetic course',
          },
        }),
      ),
      updateMany: jest.fn(
        (args: {
          data: { status: LockedLessonSession['status']; completedAt?: Date };
        }) => {
          state.lesson.status = args.data.status;
          if (args.data.completedAt)
            state.lesson.completedAt = args.data.completedAt;
          state.lesson.version++;
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    teachingRecord: {
      create: jest.fn((args: { data: { attendeeCount: number } }) => {
        state.teaching = {
          id: 'teaching',
          status: 'COMPLETED',
          attendeeCount: args.data.attendeeCount,
        };
        return Promise.resolve({ id: 'teaching' });
      }),
      findUnique: jest.fn(() => Promise.resolve(state.teaching)),
      update: jest.fn(() => {
        if (state.teaching) state.teaching.status = 'REVERSED';
        return Promise.resolve({});
      }),
    },
    coursePackage: {
      updateMany: jest.fn(
        (args: {
          where: { id: string };
          data: { mainBalanceUnits: number };
        }) => {
          const pack = state.packages.find((row) => row.id === args.where.id)!;
          pack.mainBalanceUnits = args.data.mainBalanceUnits;
          pack.version++;
          return Promise.resolve({ count: 1 });
        },
      ),
    },
    lessonLedgerEntry: {
      findMany: jest.fn(() =>
        Promise.resolve(
          state.ledger.filter((row) => row.entryType === 'CONSUME'),
        ),
      ),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((args: { data: (typeof state.ledger)[number] }) => {
        state.ledger.push(args.data);
        return Promise.resolve({});
      }),
    },
    teacherEarningBasis: teacherBasis,
    partnerEarningBasis: partnerBasis,
    teacherEarningEntry: {
      create: jest.fn((_args: unknown) => {
        void _args;
        return Promise.resolve({});
      }),
    },
    partnerEarningEntry: {
      create: jest.fn((_args: unknown) => {
        void _args;
        return Promise.resolve({});
      }),
    },
    studentFeedback: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: nextStage,
    },
    parentLessonReview: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: nextStage,
    },
    student: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (value: typeof tx) => Promise<unknown>) => {
        const before = structuredClone(state);
        try {
          return await callback(tx);
        } catch (error) {
          Object.assign(state, before);
          throw error;
        }
      },
    ),
  };
  const idempotency = {
    claim: jest.fn().mockResolvedValue({ replayed: false }),
    complete: jest.fn().mockResolvedValue(undefined),
  };
  const ledger = {
    consumeStudentLessonUnits: jest.fn(
      (_client: unknown, input: { studentId: string }) => {
        state.packages.find(
          (row) => row.id === input.studentId,
        )!.mainBalanceUnits -= 100;
        state.ledger.push({
          id: `consume-${input.studentId}`,
          campusId: scope.campusId,
          studentId: input.studentId,
          coursePackageId: input.studentId,
          lessonSessionId: lessonId,
          entryType: 'CONSUME',
          bucket: 'MAIN',
          deltaUnits: -100,
        });
        return Promise.resolve({
          studentId: input.studentId,
          mainUnits: 100,
          giftUnits: 0,
        });
      },
    ),
  };
  const teacherRule = {
    findEffectiveRule: jest.fn().mockResolvedValue(
      priced
        ? {
            id: 'teacher-rule',
            version: 1,
            basisType: 'PER_PRESENT_ATTENDEE',
            unitAmountFen: 80,
            eligibleLessonKinds: ['REGULAR'],
            countedAttendanceStatuses: ['PRESENT', 'LEAVE', 'ABSENT'],
            settlementDelayDays: 0,
          }
        : null,
    ),
  };
  const partnerRule = {
    findEffectiveRule: jest.fn().mockResolvedValue(
      priced
        ? {
            id: 'partner-rule',
            version: 1,
            unitPriceFen: 100,
            shareBasisPoints: 5000,
            eligibleLessonKinds: ['REGULAR'],
            countedAttendanceStatuses: ['PRESENT', 'LEAVE', 'ABSENT'],
            settlementDelayDays: 0,
          }
        : null,
    ),
  };
  const teacher = new EarningRecordingService(
    teacherRule as unknown as ConstructorParameters<
      typeof EarningRecordingService
    >[0],
  );
  const partner = new PartnerEarningRecordingService(
    partnerRule as unknown as ConstructorParameters<
      typeof PartnerEarningRecordingService
    >[0],
  );
  const media = { store: nextStage, toFeedbackImageView: jest.fn() };
  const service = new AttendanceService(
    prisma as unknown as ConstructorParameters<typeof AttendanceService>[0],
    idempotency as unknown as ConstructorParameters<
      typeof AttendanceService
    >[1],
    ledger as unknown as ConstructorParameters<typeof AttendanceService>[2],
    teacher,
    partner,
    media as unknown as ConstructorParameters<typeof AttendanceService>[5],
  );
  const feedback = new FeedbackService(
    prisma as unknown as ConstructorParameters<typeof FeedbackService>[0],
    idempotency as unknown as ConstructorParameters<typeof FeedbackService>[1],
    media as unknown as ConstructorParameters<typeof FeedbackService>[2],
  );
  const parent = new ParentGrowthService(
    prisma as unknown as ConstructorParameters<typeof ParentGrowthService>[0],
    {} as ConstructorParameters<typeof ParentGrowthService>[1],
    media as unknown as ConstructorParameters<typeof ParentGrowthService>[2],
    idempotency as unknown as ConstructorParameters<
      typeof ParentGrowthService
    >[3],
  );
  return {
    state,
    tx,
    service,
    feedback,
    parent,
    idempotency,
    ledger,
    teacher,
    partner,
    nextStage,
  };
}
type Host = ReturnType<typeof harness>;
const dto = (
  attendance: Array<{ studentId: string; status: Status }>,
  lessonVersion = 1,
) => ({ lessonVersion, attendance });
async function saveThenRemove(host: Host, status: Status = 'PRESENT') {
  await host.service.saveAttendance(
    scope,
    lessonId,
    dto([
      { studentId: a, status: 'PRESENT' },
      { studentId: b, status },
    ]),
    'save',
  );
  host.state.members = [a];
}

describe('explicit final attendance on actual services (offline, no SQL)', () => {
  it('completes a temporary student through both actual earning recorders and restores original consumption on reverse', async () => {
    const host = harness();
    host.state.members = [a];
    host.state.temporaryMembers = [b];
    const result = await host.service.completeLesson(scope, lessonId, dto([
      { studentId: a, status: 'PRESENT' }, { studentId: b, status: 'PRESENT' },
    ]), 'temporary-complete') as CompleteLessonResult;
    expect(result.consumed.map(row => row.studentId)).toEqual([a, b]);
    expect(host.state.teaching?.attendeeCount).toBe(2);
    for (const basis of [host.tx.teacherEarningBasis, host.tx.partnerEarningBasis])
      expect(basis.create.mock.calls[0][0]).toMatchObject({
        data: { attendanceSnapshot: [
          { studentId: a, status: 'PRESENT' }, { studentId: b, status: 'PRESENT' },
        ] },
      });
    host.state.temporaryMembers = [];
    const reversed = await host.service.reverseLesson(scope, lessonId,
      { lessonVersion: 2, reason: 'Synthetic reversal' }, 'temporary-reverse') as CompleteLessonResult;
    expect(reversed.consumed.map(row => row.studentId)).toEqual([a, b]);
    expect(host.state.packages.every(row => row.mainBalanceUnits === 1000)).toBe(true);
  });
  it('marks new saved rows as drafts without losing their status', async () => {
    const host = harness();
    await saveThenRemove(host, 'LEAVE');
    expect(
      host.state.rows.map((row) => [
        row.studentId,
        row.status,
        row.includedInFinalRoster,
      ]),
    ).toEqual([
      [a, 'PRESENT', false],
      [b, 'LEAVE', false],
    ]);
  });
  it.each<Status>(['PRESENT', 'LEAVE', 'ABSENT'])(
    'retains removed %s draft but excludes it from both priced earning snapshots',
    async (status) => {
      const host = harness();
      await saveThenRemove(host, status);
      const oldDraft = { ...host.state.rows[1] };
      const result = (await host.service.completeLesson(
        scope,
        lessonId,
        dto([{ studentId: a, status: 'PRESENT' }]),
        'complete',
      )) as CompleteLessonResult;
      expect(result.consumed.map((row) => row.studentId)).toEqual([a]);
      expect(host.state.rows.find((row) => row.studentId === b)).toEqual({
        ...oldDraft,
        includedInFinalRoster: false,
      });
      expect(
        host.state.rows.find((row) => row.studentId === a)
          ?.includedInFinalRoster,
      ).toBe(true);
      expect(host.state.teaching?.attendeeCount).toBe(1);
      for (const basis of [
        host.tx.teacherEarningBasis,
        host.tx.partnerEarningBasis,
      ])
        expect(basis.create.mock.calls[0][0]).toMatchObject({
          data: {
            attendanceSnapshot: [{ studentId: a, status: 'PRESENT' }],
          },
        });
      expect(host.tx.teacherEarningEntry.create.mock.calls[0][0]).toMatchObject(
        { data: { amountFen: 80 } },
      );
      expect(host.tx.partnerEarningEntry.create.mock.calls[0][0]).toMatchObject(
        { data: { amountFen: 50 } },
      );
    },
  );
  it('filters legacy default-true drafts on first new completion as well', async () => {
    const host = harness();
    await saveThenRemove(host);
    host.state.rows.forEach((row) => {
      row.includedInFinalRoster = true;
    });
    await host.service.completeLesson(
      scope,
      lessonId,
      dto([{ studentId: a, status: 'PRESENT' }]),
      'complete',
    );
    expect(
      host.state.rows.find((row) => row.studentId === b)?.includedInFinalRoster,
    ).toBe(false);
  });
  it('uses only final rows in unpriced snapshots too', async () => {
    const host = harness(false);
    await saveThenRemove(host);
    await host.service.completeLesson(
      scope,
      lessonId,
      dto([{ studentId: a, status: 'PRESENT' }]),
      'complete',
    );
    for (const basis of [
      host.tx.teacherEarningBasis,
      host.tx.partnerEarningBasis,
    ])
      expect(basis.create.mock.calls[0][0]).toMatchObject({
        data: {
          status: 'UNPRICED',
          attendanceSnapshot: [{ studentId: a, status: 'PRESENT' }],
        },
      });
  });
  it('handles an empty roster inside the service without deleting drafts (public DTO rejects empty)', async () => {
    const host = harness();
    await saveThenRemove(host);
    host.state.rows.forEach((row) => {
      row.includedInFinalRoster = true;
    });
    host.state.members = [];
    await host.service.completeLesson(scope, lessonId, dto([]), 'empty');
    expect(host.state.rows).toHaveLength(2);
    expect(host.state.rows.every((row) => !row.includedInFinalRoster)).toBe(
      true,
    );
    expect(host.tx.teacherEarningEntry.create).not.toHaveBeenCalled();
    expect(host.tx.partnerEarningEntry.create).not.toHaveBeenCalled();
  });
  it('rolls back final membership, consumption and status when completion fails', async () => {
    const host = harness();
    await saveThenRemove(host);
    const before = structuredClone(host.state);
    host.tx.partnerEarningBasis.create.mockRejectedValueOnce(
      new Error('Synthetic earning failure'),
    );
    await expect(
      host.service.completeLesson(
        scope,
        lessonId,
        dto([{ studentId: a, status: 'PRESENT' }]),
        'failed',
      ),
    ).rejects.toThrow('Synthetic earning failure');
    expect(host.state).toEqual(before);
    expect(host.idempotency.complete).toHaveBeenCalledTimes(1);
  });
  it('does not change final membership or repeat earnings on idempotency replay', async () => {
    const host = harness();
    await saveThenRemove(host);
    const request = dto([{ studentId: a, status: 'PRESENT' }]);
    const first = await host.service.completeLesson(
      scope,
      lessonId,
      request,
      'complete',
    );
    const before = structuredClone(host.state);
    host.idempotency.claim.mockResolvedValueOnce({
      replayed: true,
      responseBody: first,
    });
    expect(
      await host.service.completeLesson(scope, lessonId, request, 'complete'),
    ).toEqual(first);
    expect(host.state).toEqual(before);
    expect(host.tx.teacherEarningBasis.create).toHaveBeenCalledTimes(1);
  });
  it('reverse response retains final membership even if the class changes again', async () => {
    const host = harness();
    await saveThenRemove(host);
    await host.service.completeLesson(
      scope,
      lessonId,
      dto([{ studentId: a, status: 'PRESENT' }]),
      'complete',
    );
    host.state.members = [b];
    const before = structuredClone(host.state.rows);
    const response = (await host.service.reverseLesson(
      scope,
      lessonId,
      { lessonVersion: 2, reason: 'Synthetic reversal' },
      'reverse',
    )) as CompleteLessonResult;
    expect(JSON.parse(JSON.stringify(response.consumed))).toEqual([
      { studentId: a, mainUnits: 100, giftUnits: 0 },
    ]);
    expect(host.state.rows).toEqual(before);
    expect(
      host.state.packages.find((row) => row.id === a)?.mainBalanceUnits,
    ).toBe(1000);
  });
  it.each(['feedback', 'upload'] as const)(
    'refuses %s for an excluded student even after they rejoin the current class',
    async (operation) => {
      const host = harness();
      await saveThenRemove(host);
      await host.service.completeLesson(
        scope,
        lessonId,
        dto([{ studentId: a, status: 'PRESENT' }]),
        'complete',
      );
      host.state.members = [a, b];
      const request =
        operation === 'feedback'
          ? host.feedback.upsert(
              scope,
              lessonId,
              b,
              { content: 'Synthetic', imageFileIds: [] },
              'feedback',
            )
          : host.feedback.uploadImage(
              scope,
              {
                userId: scope.userId,
                roles: [{ code: 'TEACHER', campusId: scope.campusId }],
              },
              lessonId,
              b,
              undefined,
            );
      await expect(request).rejects.toMatchObject({ statusCode: 403 });
      expect(host.nextStage).not.toHaveBeenCalled();
    },
  );
  it('allows final members to reach the existing feedback author guard', async () => {
    const host = harness();
    await saveThenRemove(host);
    await host.service.completeLesson(
      scope,
      lessonId,
      dto([{ studentId: a, status: 'PRESENT' }]),
      'complete',
    );
    await expect(
      host.feedback.upsert(
        scope,
        lessonId,
        a,
        { content: 'Synthetic', imageFileIds: [] },
        'feedback',
      ),
    ).rejects.toThrow('Feedback admission accepted');
    expect(host.nextStage).toHaveBeenCalledTimes(1);
  });
  it('refuses a new parent review for an excluded draft despite its old PRESENT status', async () => {
    const host = harness();
    await saveThenRemove(host);
    await host.service.completeLesson(
      scope,
      lessonId,
      dto([{ studentId: a, status: 'PRESENT' }]),
      'complete',
    );
    await expect(
      host.parent.submitReview(
        scope,
        lessonId,
        b,
        { teaching: 5, communication: 5, environment: 5, overall: 5 },
        'review',
      ),
    ).rejects.toMatchObject({
      code: 'PARENT_REVIEW_NOT_ALLOWED',
      statusCode: 409,
    });
    expect(host.nextStage).not.toHaveBeenCalled();
  });
  it('still admits a final PRESENT member to the existing parent review duplicate guard', async () => {
    const host = harness();
    await saveThenRemove(host);
    await host.service.completeLesson(
      scope,
      lessonId,
      dto([{ studentId: a, status: 'PRESENT' }]),
      'complete',
    );
    await expect(
      host.parent.submitReview(
        scope,
        lessonId,
        a,
        { teaching: 5, communication: 5, environment: 5, overall: 5 },
        'review',
      ),
    ).rejects.toThrow('Feedback admission accepted');
    expect(host.nextStage).toHaveBeenCalledTimes(1);
  });
});

describe('unchanged public attendance input boundary', () => {
  it.each([AttendanceDraftDto, CompleteLessonDto])(
    'continues rejecting empty attendance through ValidationPipe for %p',
    async (metatype) => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      await expect(
        pipe.transform(
          { lessonVersion: 1, attendance: [] },
          { type: 'body', metatype },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
  it('still admits a valid complete request through the same validation pipe', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const request = dto([{ studentId: a, status: 'PRESENT' }]);
    await expect(
      pipe.transform(request, { type: 'body', metatype: CompleteLessonDto }),
    ).resolves.toMatchObject(request);
  });
});

interface HistoryWhere {
  status?: string | { in: string[] };
  attendanceRecords?: { some: Where };
  feedback?: { some: { studentId?: string } };
  AND?: HistoryWhere[];
  OR?: HistoryWhere[];
}
function historyLesson(
  id: string,
  includedInFinalRoster: boolean,
  withFeedback = false,
) {
  return {
    id,
    teacherId: scope.teacherProfileId,
    status: 'COMPLETED',
    startsAt: new Date('2026-10-28T01:00:00Z'),
    campus: { name: 'Synthetic campus' },
    classGroup: { courseName: 'Synthetic course' },
    teacher: { user: { displayName: 'Synthetic teacher' } },
    attendanceRecords: [
      {
        campusId: scope.campusId,
        lessonSessionId: id,
        studentId: b,
        status: 'PRESENT' as Status,
        recordedAt: new Date(),
        includedInFinalRoster,
      },
    ],
    parentLessonReviews: [],
    feedback: withFeedback
      ? [
          {
            studentId: b,
            teacherId: scope.teacherProfileId,
            content: 'Preserved legacy feedback',
            performanceRating: null,
            teacherRatings: null,
            version: 1,
            teacher: { user: { displayName: 'Synthetic teacher' } },
            images: [],
            updatedAt: new Date('2026-10-28T02:00:00Z'),
          },
        ]
      : [],
  };
}
type HistoryRow = ReturnType<typeof historyLesson>;
function historyMatches(row: HistoryRow, where: HistoryWhere): boolean {
  return (
    (!where.status ||
      (typeof where.status === 'string'
        ? row.status === where.status
        : where.status.in.includes(row.status))) &&
    (!where.attendanceRecords ||
      row.attendanceRecords.some((item) =>
        matches(item, where.attendanceRecords!.some),
      )) &&
    (!where.feedback ||
      row.feedback.some(
        (item) =>
          !where.feedback!.some.studentId ||
          item.studentId === where.feedback!.some.studentId,
      )) &&
    (!where.AND || where.AND.every((clause) => historyMatches(row, clause))) &&
    (!where.OR || where.OR.some((clause) => historyMatches(row, clause)))
  );
}
function growthHarness() {
  const rows = [
    historyLesson('final', true),
    historyLesson('draft', false),
    historyLesson('feedback', false, true),
  ];
  const student = {
    id: b,
    campusId: scope.campusId,
    displayName: 'Synthetic student',
    profilePhotoFile: null,
    birthDate: null,
    profileAge: null,
    homeAddress: null,
    profileVersion: 1,
  };
  const tx = {
    student: {
      findFirst: jest.fn().mockResolvedValue(student),
      findUniqueOrThrow: jest.fn().mockResolvedValue(student),
    },
    lessonSession: {
      count: jest.fn((args: { where: HistoryWhere }) =>
        Promise.resolve(
          rows.filter((row) => historyMatches(row, args.where)).length,
        ),
      ),
      findMany: jest.fn(
        (args: {
          where: HistoryWhere;
          select: { attendanceRecords: { where: Where } };
        }) =>
          Promise.resolve(
            rows
              .filter((row) => historyMatches(row, args.where))
              .map((row) => ({
                ...row,
                attendanceRecords: row.attendanceRecords.filter((item) =>
                  matches(item, args.select.attendanceRecords.where),
                ),
              })),
          ),
      ),
    },
  };
  const prisma = {
    ...tx,
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  };
  const authorization = {
    require: () => ({ campusId: scope.campusId }),
    resolveStudent: jest.fn().mockResolvedValue(student),
  };
  const operator = new OperatorStudentArchiveService(
    prisma as unknown as ConstructorParameters<
      typeof OperatorStudentArchiveService
    >[0],
    authorization as unknown as ConstructorParameters<
      typeof OperatorStudentArchiveService
    >[1],
    {} as ConstructorParameters<typeof OperatorStudentArchiveService>[2],
  );
  const partner = new PartnerStudentGrowthService(
    prisma as unknown as ConstructorParameters<
      typeof PartnerStudentGrowthService
    >[0],
    authorization as unknown as ConstructorParameters<
      typeof PartnerStudentGrowthService
    >[1],
    {} as ConstructorParameters<typeof PartnerStudentGrowthService>[2],
  );
  const parent = new ParentPortalService(
    prisma as unknown as ConstructorParameters<typeof ParentPortalService>[0],
    authorization as unknown as ConstructorParameters<
      typeof ParentPortalService
    >[1],
    {} as ConstructorParameters<typeof ParentPortalService>[2],
    {} as ConstructorParameters<typeof ParentPortalService>[3],
  );
  return { operator, partner, parent, rows };
}
describe('final attendance through actual cross-role history queries (offline)', () => {
  const user = {
    userId: scope.userId,
    roles: [{ code: 'OPERATOR' as const, campusId: scope.campusId }],
  };
  it('operator history excludes drafts but preserves legacy feedback-only history', async () => {
    const host = growthHarness();
    const result = await host.operator.getGrowth(user, b, {
      page: 1,
      pageSize: 20,
    });
    expect(result.meta.total).toBe(2);
    expect(
      result.data.items.map((row) => [
        row.lessonSessionId,
        row.attendanceStatus,
      ]),
    ).toEqual([
      ['final', 'PRESENT'],
      ['feedback', null],
    ]);
    expect(host.rows[1].attendanceRecords).toHaveLength(1);
  });
  it('partner history uses the same final membership without changing legacy feedback', async () => {
    const host = growthHarness();
    const result = await host.partner.getGrowth(
      { ...user, roles: [{ code: 'PARTNER', campusId: scope.campusId }] },
      b,
      { page: 1, pageSize: 20 },
    );
    expect(result.meta.total).toBe(2);
    expect(
      result.items.map((row) => [row.lessonSessionId, row.attendanceStatus]),
    ).toEqual([
      ['final', 'PRESENT'],
      ['feedback', null],
    ]);
  });
  it('parent growth does not offer a review for preserved feedback on an excluded row', async () => {
    const result = await growthHarness().parent.getUpdates(scope, b);
    expect(
      result.records.map((row) => [
        row.lessonSessionId,
        row.attendanceStatus,
        row.canReview,
      ]),
    ).toEqual([
      ['final', 'PRESENT', true],
      ['feedback', null, false],
    ]);
  });
});
