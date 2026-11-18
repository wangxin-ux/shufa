import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Prisma } from '@prisma/client';
import { load } from 'js-yaml';
import { TeacherReadService } from '../src/modules/scheduling/teacher-read.service';

const scope = {
  userId: '10000000-0000-4000-8000-000000000001',
  campusId: '20000000-0000-4000-8000-000000000001',
  teacherProfileId: '30000000-0000-4000-8000-000000000001',
};
const lessonId = '40000000-0000-4000-8000-000000000001';
const studentIds = [
  '50000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  '50000000-0000-4000-8000-000000000003',
];
type Status = 'PRESENT' | 'LEAVE' | 'ABSENT';
interface PhotoFile {
  id: string;
  mimeType: string;
  sizeBytes: number;
}
const balance = (
  mainBalanceUnits = 600,
  giftBalanceUnits = 0,
  mainReservedUnits = 0,
  giftReservedUnits = 0,
) => ({
  mainBalanceUnits,
  giftBalanceUnits,
  mainReservedUnits,
  giftReservedUnits,
});
const student = (id: string, coursePackages = [balance()]) => ({
  id,
  displayName: `Synthetic ${id.slice(-1)}`,
  profilePhotoFile: null as PhotoFile | null,
  coursePackages,
});
function lesson(status = 'SCHEDULED') {
  const students = [
    student(studentIds[0], [balance(900, 100, 200, 0)]),
    student(studentIds[1], [balance(900, 100, 400, 100)]),
    student(studentIds[2], []),
  ];
  return {
    id: lessonId,
    version: 3,
    startsAt: new Date('2026-10-30T01:00:00.000Z'),
    endsAt: new Date('2026-10-30T02:00:00.000Z'),
    completedAt: null,
    lessonUnits: 100,
    status,
    campus: { name: 'Synthetic campus', lessonWarningThresholdUnits: 500 },
    classGroup: {
      name: 'Synthetic class',
      courseName: 'Synthetic course',
      _count: { members: 1 },
      members: [{ student: students[0] }],
    },
    attendanceRecords: students.map((item, index) => ({
      studentId: item.id,
      student: item,
      status: (['PRESENT', 'LEAVE', 'ABSENT'] as Status[])[index],
      includedInFinalRoster: true,
    })),
    parentLeaveRequests: [
      { studentId: students[0].id, temporaryMemberId: null as string | null },
      { studentId: students[2].id, temporaryMemberId: null as string | null },
    ],
    temporaryMembers: [] as Array<{ id: string; student: ReturnType<typeof student> }>,
    feedback: [],
    parentLessonReviews: [],
  };
}
type Row = ReturnType<typeof lesson>;
describe('temporary lesson visibility stays separate from personal photo permission', () => {
  it('returns a final temporary member with feedback permission but no profile photo', async () => {
    const row = lesson('COMPLETED');
    const item = row.attendanceRecords[1].student;
    item.profilePhotoFile = { id: 'synthetic-photo', mimeType: 'image/png', sizeBytes: 10 };
    row.temporaryMembers = [{ id: 'episode-active', student: item }];
    const host = harness([row]);
    const result = await host.service.getLessonSession(scope, lessonId);
    expect(result.students.find(student => student.id === item.id)).toMatchObject({
      id: item.id, canEditFeedback: true, photo: null,
    });
    expect(host.media.toStudentPhotoView).not.toHaveBeenCalled();
  });
  it('does not prefill an old temporary approval after a new episode is joined', async () => {
    const row = lesson();
    const item = row.attendanceRecords[1].student;
    row.attendanceRecords = [];
    row.temporaryMembers = [{ id: 'new-episode', student: item }];
    row.parentLeaveRequests = [{ studentId: item.id, temporaryMemberId: 'old-episode' }];
    const host = harness([row]);
    const result = await host.service.getLessonSession(scope, lessonId);
    expect(result.students.find(student => student.id === item.id)?.attendanceStatus).toBeNull();
    expect(result.rosterSummary?.leaveCount).toBe(0);
  });
});

interface AttendanceFilter {
  includedInFinalRoster?: boolean;
  lessonSession?: { status: { notIn: string[] } };
  OR?: AttendanceFilter[];
}
function selectedRow(row: Row, args: unknown): Row {
  const filter = (
    args as { select: { attendanceRecords: { where: AttendanceFilter } } }
  ).select.attendanceRecords.where;
  const matches = (
    item: Row['attendanceRecords'][number],
    where: AttendanceFilter,
  ): boolean =>
    (where.includedInFinalRoster === undefined ||
      item.includedInFinalRoster === where.includedInFinalRoster) &&
    (!where.lessonSession ||
      !where.lessonSession.status.notIn.includes(row.status)) &&
    (!where.OR || where.OR.some((clause) => matches(item, clause)));
  return {
    ...row,
    attendanceRecords: row.attendanceRecords.filter((item) =>
      matches(item, filter),
    ),
  };
}
function harness(rows = [lesson()]) {
  const calls: Array<{ kind: string; args: unknown }> = [];
  const tx = {
    teacherProfile: {
      findFirst: jest.fn().mockResolvedValue({
        displayName: 'Synthetic teacher',
        subjectLabel: 'Synthetic subject',
        specialties: ['Synthetic subject'],
        campusName: 'Synthetic campus',
        timezone: 'Asia/Shanghai',
        user: { displayName: 'Synthetic teacher' },
        campus: { name: 'Synthetic campus', timezone: 'Asia/Shanghai' },
      }),
    },
    student: { count: jest.fn().mockResolvedValue(3) },
    lessonSession: {
      findMany: jest.fn((args: unknown) => {
        calls.push({ kind: 'list', args });
        return Promise.resolve(rows.map((row) => selectedRow(row, args)));
      }),
      findFirst: jest.fn((args: unknown) => {
        calls.push({ kind: 'detail-or-next', args });
        return Promise.resolve(rows[0] ? selectedRow(rows[0], args) : null);
      }),
      count: jest.fn().mockResolvedValue(rows.length),
    },
  };
  const transaction = jest.fn(
    async (
      callback: (value: typeof tx) => Promise<unknown>,
      _options?: { isolationLevel: string },
    ) => {
      void _options;
      return callback(tx);
    },
  );
  const prisma = { ...tx, $transaction: transaction };
  const authorization = {
    assertLessonSessionInScope: jest.fn().mockResolvedValue(undefined),
  };
  const media = {
    toStudentPhotoView: jest.fn((file: PhotoFile) => ({
      ...file,
      accessUrl: '/media/student-photos/synthetic-signed',
      accessUrlExpiresAt: '2026-10-30T02:00:00.000Z',
    })),
  };
  const service = new TeacherReadService(
    prisma as unknown as ConstructorParameters<typeof TeacherReadService>[0],
    authorization as unknown as ConstructorParameters<
      typeof TeacherReadService
    >[1],
    media as unknown as ConstructorParameters<typeof TeacherReadService>[2],
  );
  return { service, tx, transaction, calls, authorization, media };
}
interface Summary {
  studentCount: number;
  rosterSummary?: {
    expectedCount: number;
    leaveCount: number;
    warningCount: number;
    thresholdUnits: number;
    asOf: string;
    source: string;
  };
}
async function list(rows: Row[]) {
  const host = harness(rows);
  const response = await host.service.listLessonSessions(scope, {
    page: 1,
    pageSize: 1,
  });
  return { ...host, response, summaries: response.data as Summary[] };
}
interface Selection {
  campus: { select: { lessonWarningThresholdUnits: boolean } };
  classGroup: {
    select: {
      members: {
        where: unknown;
        take?: number;
        select: { student: { select: { coursePackages: { where: unknown } } } };
      };
    };
  };
  attendanceRecords: { where: unknown; take?: number };
  parentLeaveRequests: { where: unknown };
}

describe('teacher lesson roster summary on actual read methods (offline)', () => {
  it.each(['COMPLETED', 'REVERSED'])(
    'uses all saved members for %s, not current class count',
    async (status) => {
      const { summaries } = await list([lesson(status)]);
      expect(summaries[0].studentCount).toBe(3);
      expect(summaries[0].rosterSummary).toMatchObject({
        expectedCount: 3,
        leaveCount: 1,
        warningCount: 2,
        thresholdUnits: 500,
        source: 'HISTORICAL_ATTENDANCE',
      });
    },
  );
  it.each(['SCHEDULED', 'IN_PROGRESS'])(
    'uses current members and saved attendance before approved leave for %s',
    async (status) => {
      const row = lesson(status);
      row.classGroup.members = row.attendanceRecords.map(({ student }) => ({
        student,
      }));
      row.attendanceRecords = row.attendanceRecords.slice(0, 2);
      const { summaries } = await list([row]);
      expect(summaries[0].studentCount).toBe(3);
      expect(summaries[0].rosterSummary).toMatchObject({
        expectedCount: 3,
        leaveCount: 2,
        warningCount: 2,
        source: 'CURRENT',
      });
    },
  );
  it('never fills an empty historical snapshot from current members or approved leave', async () => {
    const row = lesson('COMPLETED');
    row.attendanceRecords = [];
    const { summaries } = await list([row]);
    expect(summaries[0].studentCount).toBe(0);
    expect(summaries[0].rosterSummary).toMatchObject({
      expectedCount: 0,
      leaveCount: 0,
      warningCount: 0,
      source: 'HISTORICAL_ATTENDANCE',
    });
  });
  it('ignores removed draft students in an unfinished roster', async () => {
    const { summaries } = await list([lesson()]);
    expect(summaries[0].rosterSummary).toMatchObject({
      expectedCount: 1,
      leaveCount: 0,
      warningCount: 0,
    });
  });
  it('deduplicates identities without adding leave and warning counts to expected', async () => {
    const row = lesson();
    row.classGroup.members = [
      { student: row.attendanceRecords[1].student },
      { student: row.attendanceRecords[1].student },
    ];
    const { summaries } = await list([row]);
    expect(summaries[0].studentCount).toBe(1);
    expect(summaries[0].rosterSummary).toMatchObject({
      expectedCount: 1,
      leaveCount: 1,
      warningCount: 1,
    });
  });
  it('uses campus threshold, available gift/main balances and excludes both reservations', async () => {
    const row = lesson();
    row.campus.lessonWarningThresholdUnits = 800;
    const { summaries } = await list([row]);
    expect(summaries[0].rosterSummary).toMatchObject({
      expectedCount: 1,
      warningCount: 1,
      thresholdUnits: 800,
    });
  });
  it('compares very large package totals without rounding across the threshold', async () => {
    const row = lesson();
    row.classGroup.members[0].student.coursePackages = [
      balance(Number.MAX_SAFE_INTEGER),
      balance(Number.MAX_SAFE_INTEGER),
    ];
    const { summaries } = await list([row]);
    expect(summaries[0].rosterSummary?.warningCount).toBe(0);
  });
  it.each([
    balance(-1),
    balance(600, 0, 601),
    balance(0, 600, 0, 601),
    balance(1.5),
    balance(Number.MAX_SAFE_INTEGER + 1),
  ])(
    'rejects damaged package source rather than returning a reliable warning count (%j)',
    async (invalid) => {
      const row = lesson();
      row.classGroup.members[0].student.coursePackages = [invalid];
      await expect(list([row])).rejects.toMatchObject({ statusCode: 500 });
    },
  );
  it.each([-1, 1.5, Number.NaN])(
    'rejects invalid threshold %s',
    async (threshold) => {
      const row = lesson();
      row.campus.lessonWarningThresholdUnits = threshold;
      await expect(list([row])).rejects.toMatchObject({ statusCode: 500 });
    },
  );
  it('requests complete scoped roster and current effective packages with one calculation time', async () => {
    const { calls, summaries, transaction } = await list([lesson()]);
    const args = calls[0].args as {
      where: unknown;
      take: number;
      select: Selection;
    };
    expect(args.where).toEqual({
      campusId: scope.campusId,
      teacherId: scope.teacherProfileId,
    });
    expect(args.take).toBe(1);
    expect(args.select.classGroup.select.members.where).toEqual({
      campusId: scope.campusId,
      leftAt: null,
      student: { campusId: scope.campusId, isActive: true },
    });
    expect(args.select.classGroup.select.members.take).toBeUndefined();
    expect(args.select.attendanceRecords.where).toEqual({
      campusId: scope.campusId,
      OR: [
        { includedInFinalRoster: true },
        { lessonSession: { status: { notIn: ['COMPLETED', 'REVERSED'] } } },
      ],
    });
    expect(args.select.attendanceRecords.take).toBeUndefined();
    expect(args.select.parentLeaveRequests.where).toEqual({
      campusId: scope.campusId,
      status: 'APPROVED',
    });
    const at = new Date(summaries[0].rosterSummary!.asOf);
    expect(
      args.select.classGroup.select.members.select.student.select.coursePackages
        .where,
    ).toEqual({
      campusId: scope.campusId,
      isActive: true,
      validFrom: { lte: at },
      OR: [{ expiresAt: null }, { expiresAt: { gte: at } }],
    });
    expect(transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
  it('uses one timestamp for every summary in a page and keeps independent total', async () => {
    const { summaries, response } = await list([
      lesson(),
      { ...lesson('COMPLETED'), id: studentIds[0] },
    ]);
    expect(summaries[0].rosterSummary?.asOf).toBeDefined();
    expect(summaries[0].rosterSummary?.asOf).toBe(
      summaries[1].rosterSummary?.asOf,
    );
    expect(response.meta.total).toBe(2);
  });
  it('returns an empty page without fabricating summaries', async () => {
    const { response, transaction } = await list([]);
    expect(response).toEqual({
      data: [],
      meta: { page: 1, pageSize: 1, total: 0, totalPages: 0 },
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
  it('uses the same summary in dashboard next lesson and server time', async () => {
    const host = harness();
    const result = await host.service.getDashboard(scope);
    const next = result.nextLesson as Summary;
    expect(next.rosterSummary).toMatchObject({
      expectedCount: 1,
      source: 'CURRENT',
    });
    expect(next.rosterSummary?.asOf).toBe(result.serverTime);
    expect(host.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  });
  it.each(['COMPLETED', 'REVERSED'])(
    'keeps migrated/inactive saved members in %s detail without granting feedback edits',
    async (status) => {
      const row = lesson(status);
      const host = harness([row]);
      const result = await host.service.getLessonSession(scope, lessonId);
      const summary = result as Summary;
      expect(summary.rosterSummary).toMatchObject({
        expectedCount: 3,
        leaveCount: 1,
        warningCount: 2,
      });
      expect(result.students.map((item) => item.id)).toEqual(studentIds);
      expect(
        result.students
          .slice(1)
          .every((item) => item.canEditFeedback === false),
      ).toBe(true);
      const args = host.calls[0].args as { select: Selection };
      expect(args.select.attendanceRecords.where).toEqual({
        campusId: scope.campusId,
        OR: [
          { includedInFinalRoster: true },
          { lessonSession: { status: { notIn: ['COMPLETED', 'REVERSED'] } } },
        ],
      });
      expect(
        host.authorization.assertLessonSessionInScope,
      ).toHaveBeenCalledWith(scope, lessonId);
    },
  );
});

describe('teacher final roster selection through actual Prisma query predicates', () => {
  it.each(['COMPLETED', 'REVERSED'])(
    'excludes a retained draft in %s list and detail',
    async (status) => {
      const row = lesson(status);
      row.attendanceRecords[1].includedInFinalRoster = false;
      const { summaries } = await list([row]);
      expect(summaries[0].rosterSummary).toMatchObject({
        expectedCount: 2,
        leaveCount: 0,
      });
      const host = harness([row]);
      const detail = await host.service.getLessonSession(scope, lessonId);
      expect(detail.students.map((item) => item.id)).toEqual([
        studentIds[0],
        studentIds[2],
      ]);
      expect(row.attendanceRecords).toHaveLength(3);
    },
  );
  it.each(['SCHEDULED', 'IN_PROGRESS', 'CANCELLED'])(
    'keeps saved draft states for %s',
    async (status) => {
      const row = lesson(status);
      row.attendanceRecords[1].includedInFinalRoster = false;
      row.classGroup.members = [{ student: row.attendanceRecords[1].student }];
      const { summaries } = await list([row]);
      expect(summaries[0].rosterSummary).toMatchObject({
        expectedCount: 1,
        leaveCount: 1,
      });
      const host = harness([row]);
      const detail = await host.service.getLessonSession(scope, lessonId);
      expect(detail.students[0].attendanceStatus).toBe('LEAVE');
    },
  );
  it('keeps unfinished dashboard draft precedence over the approved leave source', async () => {
    const row = lesson();
    row.attendanceRecords[0].includedInFinalRoster = false;
    const host = harness([row]);
    const dashboard = await host.service.getDashboard(scope);
    expect(dashboard.nextLesson?.rosterSummary).toMatchObject({
      expectedCount: 1,
      leaveCount: 0,
    });
  });
});

describe('teacher roster review regressions', () => {
  const photo = {
    id: '60000000-0000-4000-8000-000000000001',
    mimeType: 'image/jpeg',
    sizeBytes: 100,
  };
  it.each(['COMPLETED', 'REVERSED'])(
    'keeps saved %s members without signing current photos outside active class scope',
    async (status) => {
      const row = lesson(status);
      row.attendanceRecords[1].student.profilePhotoFile = photo;
      const host = harness([row]);
      const result = await host.service.getLessonSession(scope, lessonId);
      expect(result.students.map((item) => item.id)).toEqual(studentIds);
      expect(result.students[1].photo).toBeNull();
      expect(host.media.toStudentPhotoView).not.toHaveBeenCalled();
    },
  );
  it('continues signing a current active member photo', async () => {
    const row = lesson('COMPLETED');
    row.classGroup.members[0].student.profilePhotoFile = photo;
    const host = harness([row]);
    const result = await host.service.getLessonSession(scope, lessonId);
    expect(result.students[0].photo?.id).toBe(photo.id);
    expect(host.media.toStudentPhotoView).toHaveBeenCalledWith(photo);
  });
  it('does not turn an approved request into attendance after cancellation', async () => {
    const row = lesson('CANCELLED');
    row.attendanceRecords = [];
    const host = harness([row]);
    const result = await host.service.getLessonSession(scope, lessonId);
    expect(result.rosterSummary?.leaveCount).toBe(0);
    expect(result.students[0].attendanceStatus).toBeNull();
  });
  it('retains explicitly saved leave on cancellation', async () => {
    const row = lesson('CANCELLED');
    row.attendanceRecords[0].status = 'LEAVE';
    const host = harness([row]);
    const result = await host.service.getLessonSession(scope, lessonId);
    expect(result.rosterSummary?.leaveCount).toBe(1);
    expect(result.students[0].attendanceStatus).toBe('LEAVE');
  });
});

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
    addSchema(value: unknown, id: string): void;
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
const check = (value: unknown) => {
  const validate = validator.getSchema(
    `${contractId}#/components/schemas/TeacherLessonSessionSummary`,
  )!;
  return validate(value);
};
const summaryBody = () => ({
  id: lessonId,
  version: 3,
  className: 'Synthetic class',
  courseName: 'Synthetic course',
  campusName: 'Synthetic campus',
  startsAt: '2026-10-30T01:00:00.000Z',
  endsAt: '2026-10-30T02:00:00.000Z',
  lessonUnits: 100,
  status: 'SCHEDULED',
  studentCount: 3,
  rosterSummary: {
    expectedCount: 3,
    leaveCount: 2,
    warningCount: 2,
    thresholdUnits: 500,
    asOf: '2026-10-29T01:00:00.000Z',
    source: 'CURRENT',
  },
});
describe('teacher roster summary closed contract', () => {
  it('accepts actual expanded read responses without exposing selected packages or identities', async () => {
    const host = harness([lesson('COMPLETED')]);
    const response = await host.service.listLessonSessions(scope, {
      page: 1,
      pageSize: 1,
    });
    expect(check(response.data[0])).toBe(true);
    const result = await host.service.getLessonSession(scope, lessonId);
    const validate = validator.getSchema(
      `${contractId}#/components/schemas/TeacherLessonSessionDetail`,
    )!;
    expect({ valid: validate(result), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
  });
  it('accepts additive counts and preserves the previous minimal response', () => {
    expect(check(summaryBody())).toBe(true);
    const previous: Omit<ReturnType<typeof summaryBody>, 'rosterSummary'> & {
      rosterSummary?: unknown;
    } = { ...summaryBody() };
    delete previous.rosterSummary;
    expect(check(previous)).toBe(true);
  });
  it.each(['expectedCount', 'leaveCount', 'warningCount', 'thresholdUnits'])(
    'rejects negative %s',
    (field) => {
      const body = summaryBody();
      Object.assign(body.rosterSummary, { [field]: -1 });
      expect(check(body)).toBe(false);
    },
  );
  it.each([
    { source: 'GUESSED' },
    { asOf: 'yesterday' },
    { studentIds },
    { amountFen: 100 },
    { teacherId: scope.teacherProfileId },
  ])('rejects invalid or private summary fields %j', (extra) => {
    const body = summaryBody();
    Object.assign(body.rosterSummary, extra);
    expect(check(body)).toBe(false);
  });
});
