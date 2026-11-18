import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import type { TeacherLessonDetail } from '../../frontend/types/teacher';

const dependencies = createRequire(
  createRequire(
    createRequire(__filename).resolve('@nestjs/cli/package.json'),
  ).resolve('@angular-devkit/core'),
);
interface Validate {
  (value: unknown): boolean;
  errors: unknown;
}
const { default: Ajv } = dependencies('ajv/dist/2020') as {
  default: new (options: object) => {
    addSchema(schema: unknown, id: string): void;
    getSchema(ref: string): Validate | undefined;
  };
};
const validator = new Ajv({ strict: false, allErrors: true });
(dependencies('ajv-formats') as (value: typeof validator) => void)(validator);
const contractId = 'https://education.invalid/contracts/openapi.yaml';
validator.addSchema(
  load(
    readFileSync(resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8'),
  ),
  contractId,
);
const check = (schema: string, value: unknown) => {
  const validate = validator.getSchema(
    `${contractId}#/components/schemas/${schema}`,
  );
  if (!validate) throw new Error(`Missing schema ${schema}`);
  return { valid: validate(value), errors: validate.errors };
};
const summary = (status = 'SCHEDULED') => ({
  id: '8bb66d61-7133-4d80-9ee4-9e4516f71763',
  version: 1,
  className: 'Synthetic class',
  courseName: 'Synthetic course',
  campusName: 'Synthetic campus',
  startsAt: '2026-10-30T01:00:00.000Z',
  endsAt: '2026-10-30T02:00:00.000Z',
  lessonUnits: 150,
  status,
  studentCount: 0,
});
const detail = (status = 'SCHEDULED') => ({
  ...summary(status),
  attendancePolicy: {
    PRESENT: { consumesLessonUnits: true },
    LEAVE: { consumesLessonUnits: false },
    ABSENT: { consumesLessonUnits: false },
  },
  students: [],
  canComplete: status === 'SCHEDULED',
  canReverse: false,
});
const studentId = '84a14af9-6a48-4190-9551-7391ad19bf4f';
const scores = {
  classroomPerformance: 0,
  workCompletion: 7,
  communication: null,
  overall: 10,
};
const lessonStudent = () => ({
  id: studentId,
  displayName: 'Synthetic student',
  attendanceStatus: 'PRESENT',
  expectedConsumeUnits: 150,
  feedback: 'Synthetic feedback',
  feedbackImages: [],
  performanceRating: null,
  photo: null,
  parentReview: null,
  teacherRatings: scores,
  feedbackVersion: 2,
  feedbackAuthorName: 'Synthetic teacher',
  canEditFeedback: true,
});
const studentDetail = () => ({
  id: studentId,
  displayName: 'Synthetic student',
  classNames: ['Synthetic class'],
  nextLessonAt: null,
  latestFeedbackAt: '2026-10-28T01:00:00.000Z',
  classes: [],
  nextLesson: null,
  attendance: {
    presentCount: 1,
    leaveCount: 0,
    absentCount: 0,
    recordedCount: 1,
    attendanceRateBasisPoints: 10000,
  },
  recentAttendance: [],
  latestFeedback: null,
  archive: {
    age: null,
    photo: null,
    enrollment: {
      initialMainUnits: null,
      initialGiftUnits: null,
      receivedAmountFen: null,
      pendingIssuanceCount: 0,
    },
    balance: {
      mainAvailableUnits: 150,
      giftAvailableUnits: 0,
      availableTotalUnits: 150,
      thresholdUnits: 500,
      isWarning: true,
      asOf: '2026-10-28T01:00:00.000Z',
    },
  },
  feedbackHistory: {
    data: [
      {
        id: '3649ca54-744f-41b0-81b0-473277ea79f8',
        lessonSessionId: summary().id,
        className: 'Synthetic class',
        courseName: 'Synthetic course',
        startsAt: '2026-10-27T01:00:00.000Z',
        updatedAt: '2026-10-28T01:00:00.000Z',
        lessonStatus: 'REVERSED',
        content: 'Retained synthetic feedback',
        performanceRating: null,
        images: [],
        teacherRatings: scores,
        feedbackVersion: 2,
        feedbackAuthorName: 'Synthetic teacher',
      },
    ],
    meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
  },
});

describe('closed teacher lesson detail response contract', () => {
  it.each(['SCHEDULED', 'CANCELLED'])(
    'accepts the current %s summary and expanded detail',
    (status) => {
      expect(check('TeacherLessonSessionSummary', summary(status))).toEqual({
        valid: true,
        errors: null,
      });
      expect(check('TeacherLessonSessionDetail', detail(status))).toEqual({
        valid: true,
        errors: null,
      });
    },
  );
  it.each(['teacherId', 'campusId', 'classGroupId', 'kind'])(
    'continues rejecting undeclared %s in the summary and detail',
    (field) => {
      expect(
        check('TeacherLessonSessionSummary', {
          ...summary(),
          [field]: 'private',
        }).valid,
      ).toBe(false);
      expect(
        check('TeacherLessonSessionDetail', {
          ...detail(),
          [field]: 'private',
        }).valid,
      ).toBe(false);
    },
  );
  it('requires detail fields and preserves the PRESENT consumption rule', () => {
    expect(check('TeacherLessonSessionDetail', summary()).valid).toBe(false);
    const value = detail();
    expect(
      check('TeacherLessonSessionDetail', {
        ...value,
        attendancePolicy: {
          ...value.attendancePolicy,
          PRESENT: { consumesLessonUnits: false },
        },
      }).valid,
    ).toBe(false);
  });
  it('accepts a completed lesson with independently rated students', () => {
    expect(
      check('TeacherLessonSessionDetail', {
        ...detail('COMPLETED'),
        students: [lessonStudent()],
      }),
    ).toEqual({ valid: true, errors: null });
  });
  it.each([
    'teacherRatings',
    'feedbackVersion',
    'feedbackAuthorName',
    'canEditFeedback',
  ])('requires the lesson student %s field', (field) => {
    const value: Record<string, unknown> = lessonStudent();
    delete value[field];
    expect(check('TeacherLessonStudent', value).valid).toBe(false);
  });
  it.each([-1, 0.5, 11, '7'])(
    'rejects invalid independent score %s',
    (score) => {
      expect(
        check('TeacherLessonStudent', {
          ...lessonStudent(),
          teacherRatings: { ...scores, communication: score },
        }).valid,
      ).toBe(false);
    },
  );
});

describe('closed teacher student archive response contract', () => {
  it('accepts summary and detail fields together, including reversed own history', () => {
    expect(check('TeacherStudentDetail', studentDetail())).toEqual({
      valid: true,
      errors: null,
    });
  });
  it.each(['archive', 'feedbackHistory'])('requires %s', (field) => {
    const value: Record<string, unknown> = studentDetail();
    delete value[field];
    expect(check('TeacherStudentDetail', value).valid).toBe(false);
  });
  it.each(['phone', 'birthday', 'parentUserId', 'campusId'])(
    'rejects undeclared private %s at both detail and archive levels',
    (field) => {
      const value = studentDetail();
      expect(
        check('TeacherStudentDetail', { ...value, [field]: 'private' }).valid,
      ).toBe(false);
      expect(
        check('TeacherStudentDetail', {
          ...value,
          archive: { ...value.archive, [field]: 'private' },
        }).valid,
      ).toBe(false);
    },
  );
  it('rejects invented history states and legacy zero scores', () => {
    const value = studentDetail();
    for (const invalid of [
      { lessonStatus: 'SCHEDULED' },
      { performanceRating: 0 },
      { feedbackVersion: 0 },
      { teacherRatings: { ...scores, overall: 3.5 } },
    ]) {
      expect(
        check('TeacherStudentDetail', {
          ...value,
          feedbackHistory: {
            ...value.feedbackHistory,
            data: [{ ...value.feedbackHistory.data[0], ...invalid }],
          },
        }).valid,
      ).toBe(false);
    }
  });
});

describe('actual attendance save response against the lesson detail contract', () => {
  const scope = {
    userId: '3f2586aa-447c-4699-887c-752f66b8ef9e',
    campusId: 'fb4b0078-fdf0-4745-a24a-73920a46d6de',
    teacherProfileId: '77c501c2-dde2-480c-b4c0-031b176b96e5',
  };
  const ownFeedback = () => ({
    studentId,
    teacherId: scope.teacherProfileId,
    content: 'Retained own feedback',
    performanceRating: null,
    teacherRatings: scores,
    version: 4,
    teacher: { user: { displayName: 'Synthetic author' } },
    images: [],
  });
  function setup(
    status: 'SCHEDULED' | 'IN_PROGRESS' = 'SCHEDULED',
    feedback: Array<ReturnType<typeof ownFeedback>> = [],
  ) {
    const lesson = {
      ...summary(status),
      campusId: scope.campusId,
      teacherId: scope.teacherProfileId,
      classGroupId: 'a9d39ed1-00c0-4146-a014-e08db1184118',
      startsAt: new Date(summary().startsAt),
      endsAt: new Date(summary().endsAt),
      completedAt: null,
      kind: 'REGULAR',
    };
    let cached: unknown;
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([lesson]),
      lessonTemporaryMember: { findMany: jest.fn().mockResolvedValue([]) },
      classMember: {
        findMany: jest.fn().mockResolvedValue([
          { studentId, student: { displayName: 'Synthetic student' } },
        ]),
      },
      attendanceRecord: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ studentId, status: 'PRESENT' }]),
      },
      lessonSession: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          status,
          completedAt: null,
          campus: { name: 'Synthetic campus' },
          classGroup: { name: 'Synthetic class', courseName: 'Synthetic course' },
        }),
      },
      studentFeedback: {
        findMany: jest.fn((input: {
          where: { teacherId: string };
          select: Record<string, unknown>;
        }) => Promise.resolve(feedback
          .filter(row => row.teacherId === input.where.teacherId)
          .map(row => Object.fromEntries(Object.keys(input.select).map(key => [
            key, row[key as keyof typeof row],
          ]))))),
      },
      parentLessonReview: { findMany: jest.fn().mockResolvedValue([]) },
      student: { findMany: jest.fn().mockResolvedValue([{ id: studentId, profilePhotoFile: null }]) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const idempotency = {
      claim: jest.fn(() => Promise.resolve(cached === undefined
        ? { replayed: false } : { replayed: true, responseBody: cached })),
      complete: jest.fn((_transaction: unknown, input: { responseBody: unknown }) => {
        cached = structuredClone(input.responseBody);
        return Promise.resolve();
      }),
    };
    type Dependencies = ConstructorParameters<typeof AttendanceService>;
    const service = new AttendanceService(
      { $transaction: (callback: (client: typeof transaction) => Promise<unknown>) =>
        callback(transaction) } as unknown as Dependencies[0],
      idempotency as unknown as Dependencies[1],
      {} as Dependencies[2],
      {} as Dependencies[3],
      {} as Dependencies[4],
      {} as Dependencies[5],
    );
    const save = async () => (await service.saveAttendance(scope, lesson.id, {
      lessonVersion: lesson.version,
      attendance: [{ studentId, status: 'PRESENT' }],
    }, 'synthetic-attendance-response')) as unknown as TeacherLessonDetail;
    return { save, transaction, idempotency };
  }

  it.each(['SCHEDULED', 'IN_PROGRESS'] as const)(
    'returns a contract-complete %s save with explicit absent-feedback metadata',
    async status => {
      const { save } = setup(status);
      const saved = await save();
      expect(check('TeacherLessonSessionDetail', saved)).toEqual({ valid: true, errors: null });
      expect(saved.students[0]).toMatchObject({
        attendanceStatus: 'PRESENT', teacherRatings: null, feedbackVersion: 0,
        feedbackAuthorName: null, canEditFeedback: false,
      });
    },
  );
  it('retains independent zero scores and the original author/version without granting edit access', async () => {
    const { save, transaction } = setup('SCHEDULED', [ownFeedback()]);
    const saved = await save();
    expect(check('TeacherLessonSessionDetail', saved)).toEqual({ valid: true, errors: null });
    expect(saved.students[0]).toMatchObject({
      teacherRatings: scores, feedbackVersion: 4, feedbackAuthorName: 'Synthetic author',
      canEditFeedback: false,
    });
    expect(transaction.studentFeedback.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teacherId: scope.teacherProfileId }) as unknown,
      select: expect.objectContaining({
        teacherRatings: true, version: true,
        teacher: { select: { user: { select: { displayName: true } } } },
      }) as unknown,
    }));
  });
  it('does not disclose another teacher feedback or grant write permission from its presence', async () => {
    const { save } = setup('SCHEDULED', [{
      ...ownFeedback(), teacherId: '14731b3d-8414-414b-b752-09df33b29d63',
    }]);
    const saved = await save();
    expect(check('TeacherLessonSessionDetail', saved)).toEqual({ valid: true, errors: null });
    expect(saved.students[0]).toMatchObject({
      feedback: null, teacherRatings: null, feedbackVersion: 0,
      feedbackAuthorName: null, canEditFeedback: false,
    });
  });
  it('returns the same complete receipt on replay without another attendance or audit write', async () => {
    const { save, transaction, idempotency } = setup('IN_PROGRESS', [ownFeedback()]);
    const saved = await save();
    expect(check('TeacherLessonSessionDetail', saved)).toEqual({ valid: true, errors: null });
    expect(await save()).toEqual(saved);
    expect(transaction.attendanceRecord.upsert).toHaveBeenCalledTimes(1);
    expect(transaction.auditLog.create).toHaveBeenCalledTimes(1);
    expect(idempotency.complete).toHaveBeenCalledTimes(1);
  });
});
