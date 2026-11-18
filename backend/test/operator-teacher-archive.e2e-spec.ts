// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- The captured Page needs WeChat ambient types in the backend test project.
/// <reference path="../../frontend/node_modules/miniprogram-api-typings/index.d.ts" />
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { load } from 'js-yaml';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import type {
  AuthenticatedUser,
  RoleCode,
} from '../src/common/auth/authenticated-user';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { OperatorTeacherArchiveService } from '../src/modules/operator/operator-teacher-archive.service';
import { assertCampusArchiveTestTarget } from './support/campus-archive-test-database';
import type { OperatorHttpRequestOptions } from '../../frontend/pages/operator/runtime/data/api-operator-data-source';
import { capture } from '../../frontend/tests/operator-page-host';

assertCampusArchiveTestTarget(process.env);
jest.setTimeout(60_000);

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
const contractBase = 'https://education.invalid/contracts/';
for (const filename of [
  'openapi.yaml',
  'operator-teacher-archive.openapi.yaml',
]) {
  validator.addSchema(
    load(readFileSync(resolve(__dirname, '../../contracts', filename), 'utf8')),
    `${contractBase}${filename}`,
  );
}
const validateResponse = (body: unknown, schema: string) => {
  const validate = validator.getSchema(
    `${contractBase}operator-teacher-archive.openapi.yaml#/schemas/${schema}`,
  );
  if (!validate) throw new Error(`Missing response schema: ${schema}`);
  expect({ valid: validate(body), errors: validate.errors }).toEqual({
    valid: true,
    errors: null,
  });
};

interface Performance {
  teacherId: string;
  periodMonth: string;
  timezone: string;
  asOf: string;
  scheduledLessonCount: number;
  completedLessonCount: number;
  completionRateBasisPoints: number | null;
  evaluation: {
    canEdit: boolean;
    version: number;
    teachingRating: number;
    overallRating: number;
    authorName: string;
    guidance: string;
  } | null;
}
interface Teacher {
  id: string;
  displayName: string;
  classes: { id: string; className: string }[];
}
interface Revision {
  version: number;
  periodMonth: string;
  authorName: string;
}
interface Envelope<T> {
  data: T;
  meta: { total: number; totalPages: number };
}
interface ArchivePage {
  data: {
    viewState: string;
    items: { id: string }[];
    page: number;
    expandedId: string;
    month: string;
    performance: {
      scheduledLabel: string;
      completedLabel: string;
      completionLabel: string;
      evaluation: { ratings: { valueLabel: string }[] };
    } | null;
    historyItems: { version: number }[];
    historyPage: number;
    historyHasMore: boolean;
  };
  teacherRecords: unknown[];
  historyRecords: unknown[];
  listRequest?: Promise<void>;
  performanceRequest?: Promise<void>;
  historyRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onLoadMore(): void;
  onHistoryMore(): void;
  onRetry(): void;
  onPullDownRefresh(): void;
  onTeacherToggle(event: { currentTarget: { dataset: { id: string } } }): void;
  onMonthChange(event: { detail: { value: string } }): void;
}
const payload = <T>(response: { body: unknown }) =>
  response.body as Envelope<T>;

describe('operator teacher archives on dedicated real HTTP/PostgreSQL', () => {
  const execution = process.env.OPERATOR_TEACHER_TEST_EXECUTION ?? randomUUID();
  const prefix = `ot-${execution.slice(0, 8)}`;
  const users: string[] = [];
  const campuses: string[] = [];
  const teachers: string[] = [];
  const teacherDetailLessons: { id: string; status: string }[] = [];
  const credentials: { userId: string; token: string }[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let operatorId: string;
  let token: string;
  let otherToken: string;
  let parentToken: string;
  let teacherToken: string;
  let mixedToken: string;
  let totalToken: string;
  let partnerId: string;
  let otherTeacher: string;
  let inactiveTeacher: string;
  let classId: string;
  let actorRoleId: string;
  let beforeReads: string;
  const base = '/operators/me/teacher-archives';
  const get = (path = base, bearer = token) =>
    request(server).get(path).auth(bearer, { type: 'bearer' });
  const performance = (id = teachers[0], bearer = token, month = '2026-09') =>
    get(`${base}/${id}/performance`, bearer).query({ month });

  async function account(
    kind: string,
    roles: { roleCode: RoleCode; campusId: string | null }[],
    issue = true,
  ) {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { displayName: `${prefix}-${kind}`, roles: { create: roles } },
        include: { roles: true },
      });
      await tx.auditLog.create({
        data: {
          campusId: roles[0]?.campusId,
          actorUserId: created.id,
          action: 'OPERATOR_TEACHER_ARCHIVE_FIXTURE_ACCOUNT',
          resourceType: 'User',
          resourceId: created.id,
          outcome: 'SUCCESS',
          details: { execution, syntheticOnly: true },
        },
      });
      return created;
    });
    users.push(row.id);
    if (!issue) return { userId: row.id, token: '', roles: row.roles };
    const issued = await app.get(AuthService).issueSessionForUser(row.id);
    credentials.push({ userId: row.id, token: issued.accessToken });
    return { userId: row.id, token: issued.accessToken, roles: row.roles };
  }

  async function domainSnapshot() {
    const value = {
      teachers: await prisma.teacherProfile.findMany({
        where: { campusId: { in: campuses } },
        orderBy: { id: 'asc' },
      }),
      lessons: await prisma.lessonSession.findMany({
        where: { campusId: { in: campuses } },
        orderBy: { id: 'asc' },
      }),
      teaching: await prisma.teachingRecord.findMany({
        where: { campusId: { in: campuses } },
        orderBy: { id: 'asc' },
      }),
      evaluations: await prisma.partnerTeacherEvaluation.findMany({
        where: { campusId: { in: campuses } },
        orderBy: { id: 'asc' },
      }),
      revisions: await prisma.partnerTeacherEvaluationRevision.findMany({
        where: { evaluation: { campusId: { in: campuses } } },
        orderBy: { id: 'asc' },
      }),
      ledger: await prisma.lessonLedgerEntry.findMany({
        where: { campusId: { in: campuses } },
        orderBy: { id: 'asc' },
      }),
      earnings: await prisma.teacherEarningEntry.findMany({
        where: { campusId: { in: campuses } },
        orderBy: { id: 'asc' },
      }),
      audit: await prisma.auditLog.findMany({
        where: { campusId: { in: campuses } },
        orderBy: { id: 'asc' },
      }),
    };
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  beforeAll(async () => {
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    for (const suffix of ['a', 'b']) {
      const campus = await prisma.campus.create({
        data: {
          code: `${prefix}-${suffix}`,
          name: `${prefix}-${suffix}`,
          timezone: 'Asia/Shanghai',
        },
      });
      campuses.push(campus.id);
    }
    const operator = await account('operator', [
      { roleCode: 'OPERATOR', campusId: campuses[0] },
    ]);
    operatorId = operator.userId;
    actorRoleId = operator.roles[0].id;
    token = operator.token;
    otherToken = (
      await account('other-operator', [
        { roleCode: 'OPERATOR', campusId: campuses[1] },
      ])
    ).token;
    parentToken = (
      await account('parent', [{ roleCode: 'PARENT', campusId: campuses[0] }])
    ).token;
    mixedToken = (
      await account('mixed', [
        { roleCode: 'OPERATOR', campusId: campuses[0] },
        { roleCode: 'TEACHER', campusId: campuses[0] },
      ])
    ).token;
    totalToken = (
      await account('total', [{ roleCode: 'OPERATOR', campusId: null }])
    ).token;
    partnerId = (
      await account(
        'partner-author',
        [{ roleCode: 'PARTNER', campusId: campuses[0] }],
        false,
      )
    ).userId;
    for (let index = 0; index < 23; index++) {
      const campusId = campuses[index === 21 ? 1 : 0];
      const teacher = await account(
        `teacher-${index}`,
        [{ roleCode: 'TEACHER', campusId }],
        index === 0,
      );
      await prisma.user.update({
        where: { id: teacher.userId },
        data: { displayName: `${prefix}-同名教师` },
      });
      const profile = await prisma.teacherProfile.create({
        data: {
          campusId,
          userId: teacher.userId,
          employeeCode: `${prefix}-${index}`,
          specialties: ['合成绘画'],
          isActive: index !== 22,
        },
      });
      if (index < 21) teachers.push(profile.id);
      else if (index === 21) otherTeacher = profile.id;
      else inactiveTeacher = profile.id;
      if (index === 0) teacherToken = teacher.token;
    }
    const group = await prisma.classGroup.create({
      data: {
        campusId: campuses[0],
        teacherId: teachers[0],
        name: `${prefix}-本校区班`,
        courseName: '合成课程',
      },
    });
    classId = group.id;
    const inconsistentGroup = await prisma.classGroup.create({
      data: {
        campusId: campuses[1],
        teacherId: teachers[0],
        name: `${prefix}-错校区班`,
        courseName: '不可披露的关联',
      },
    });
    for (const spec of [
      {
        at: '2026-08-31T15:59:59.999Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      {
        at: '2026-08-31T16:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      {
        at: '2026-09-30T15:59:59.999Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      {
        at: '2026-09-30T16:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
      },
      { at: '2026-09-10T02:00:00.000Z', status: 'SCHEDULED' },
      { at: '2026-09-11T02:00:00.000Z', status: 'IN_PROGRESS' },
      { at: '2026-09-12T02:00:00.000Z', status: 'CANCELLED' },
      {
        at: '2026-09-13T02:00:00.000Z',
        status: 'REVERSED',
        record: 'REVERSED',
      },
      { at: '2026-09-14T02:00:00.000Z', status: 'COMPLETED' },
      {
        at: '2026-09-15T02:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
        wrongTeacher: true,
      },
      {
        at: '2026-09-16T02:00:00.000Z',
        status: 'COMPLETED',
        record: 'COMPLETED',
        wrongCampus: true,
      },
      { at: '2026-09-17T02:00:00.000Z', status: 'SCHEDULED', wrongClass: true },
      { at: '2099-09-10T02:00:00.000Z', status: 'SCHEDULED' },
    ]) {
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId: campuses[0],
          teacherId: teachers[0],
          classGroupId: 'wrongClass' in spec ? inconsistentGroup.id : classId,
          startsAt: new Date(spec.at),
          endsAt: new Date(new Date(spec.at).getTime() + 3600_000),
          status: spec.status as 'SCHEDULED',
          completedAt: ['COMPLETED', 'REVERSED'].includes(spec.status)
            ? new Date('2026-10-02T02:00:00Z')
            : null,
          ...(spec.status === 'REVERSED'
            ? {
                reversedAt: new Date('2026-10-03T02:00:00Z'),
                reversalReason: 'Synthetic reversal',
              }
            : {}),
        },
      });
      if (
        ['SCHEDULED', 'CANCELLED'].includes(spec.status) &&
        !teacherDetailLessons.some(({ status }) => status === spec.status)
      ) {
        teacherDetailLessons.push({ id: lesson.id, status: spec.status });
      }
      if (spec.record) {
        await prisma.teachingRecord.create({
          data: {
            campusId: campuses['wrongCampus' in spec ? 1 : 0],
            teacherId: teachers['wrongTeacher' in spec ? 1 : 0],
            lessonSessionId: lesson.id,
            status: spec.record as 'COMPLETED',
            attendeeCount: 0,
            lessonUnits: 100,
            recordedByUserId: users[6],
            completedAt: new Date('2026-10-02T02:00:00Z'),
            ...(spec.record === 'REVERSED'
              ? {
                  reversedAt: new Date('2026-10-03T02:00:00Z'),
                  reversalReason: 'Synthetic reversal',
                }
              : {}),
          },
        });
      }
    }
    const values = {
      teachingRating: 1,
      communicationRating: 7,
      attendanceRating: 10,
      overallRating: 4,
      guidance: '合'.repeat(1000),
      authorName: '合成原作者',
    };
    const evaluation = await prisma.partnerTeacherEvaluation.create({
      data: {
        ...values,
        teacherId: teachers[0],
        campusId: campuses[0],
        periodMonth: '2026-09',
        version: 21,
        authorUserId: partnerId,
      },
    });
    for (let version = 1; version <= 21; version++) {
      await prisma.partnerTeacherEvaluationRevision.create({
        data: { ...values, evaluationId: evaluation.id, version },
      });
    }
    beforeReads = await domainSnapshot();
    console.log(
      `MANIFEST ${JSON.stringify({ execution, prefix, campuses, users, teachers, otherTeacher, inactiveTeacher, issuedCredentialCount: credentials.length, domainBefore: beforeReads })}`,
    );
  });

  afterAll(async () => {
    if (!prisma) {
      if (app) await app.close();
      return;
    }
    const closeout: Record<string, unknown> = {
      execution,
      prefix,
      users,
      retained: true,
    };
    try {
      jest.restoreAllMocks();
      const actorRole = actorRoleId
        ? await prisma.userRole.findUnique({ where: { id: actorRoleId } })
        : null;
      if (actorRole && actorRole.campusId !== campuses[0]) {
        await prisma.userRole.update({
          where: { id: actorRoleId },
          data: { campusId: campuses[0] },
        });
      }
      const owned = await prisma.user.count({
        where: { id: { in: users }, displayName: { startsWith: `${prefix}-` } },
      });
      if (owned !== users.length)
        throw new Error('Fixture account ownership mismatch');
      const domainAfter = await domainSnapshot();
      closeout.domainBefore = beforeReads;
      closeout.domainAfter = domainAfter;
      closeout.readsPreservedFacts = domainAfter === beforeReads;
      const disabled = await prisma.user.updateMany({
        where: { id: { in: users }, displayName: { startsWith: `${prefix}-` } },
        data: { status: 'DISABLED' },
      });
      closeout.disabledAccountCount = disabled.count;
      const statuses: number[] = [];
      for (const credential of credentials)
        statuses.push((await get(base, credential.token)).status);
      closeout.oldCredentialStatuses = statuses;
      if (beforeReads) expect(domainAfter).toBe(beforeReads);
      expect(disabled.count).toBe(users.length);
      expect(statuses).toEqual(credentials.map(() => 401));
    } finally {
      if (process.env.OPERATOR_TEACHER_TEST_EVIDENCE) {
        writeFileSync(
          resolve(
            process.env.OPERATOR_TEACHER_TEST_EVIDENCE,
            `${execution}-closeout.json`,
          ),
          JSON.stringify(closeout, null, 2),
          { flag: 'wx' },
        );
      }
      console.log(`CLOSEOUT ${JSON.stringify(closeout)}`);
      await app.close();
    }
  });

  it('paginates 21 same-name active teachers without crossing campus or disclosing staff data', async () => {
    const first = await get()
      .query({ query: `${prefix}-同名`, pageSize: 20 })
      .expect(200);
    const second = await get()
      .query({ query: `${prefix}-同名`, page: 2, pageSize: 20 })
      .expect(200);
    validateResponse(first.body, 'ListEnvelope');
    validateResponse(second.body, 'ListEnvelope');
    const all = [
      ...payload<Teacher[]>(first).data,
      ...payload<Teacher[]>(second).data,
    ];
    expect(payload<Teacher[]>(first).meta).toMatchObject({
      total: 21,
      totalPages: 2,
    });
    expect(new Set(all.map(({ id }) => id))).toEqual(new Set(teachers));
    expect(all.find(({ id }) => id === teachers[0])?.classes).toEqual([
      { id: classId, className: `${prefix}-本校区班`, courseName: '合成课程' },
    ]);
    expect(
      payload<Teacher[]>(await get().query({ page: 3 }).expect(200)).data,
    ).toEqual([]);
  });

  it('uses campus month boundaries and matching completed facts, excluding cancellations and cross-campus class associations', async () => {
    const response = await performance().expect(200);
    validateResponse(response.body, 'PerformanceEnvelope');
    expect(payload<Performance>(response).data).toMatchObject({
      teacherId: teachers[0],
      periodMonth: '2026-09',
      timezone: 'Asia/Shanghai',
      scheduledLessonCount: 8,
      completedLessonCount: 2,
      completionRateBasisPoints: 2500,
    });
  });

  it('validates current scheduled and cancelled teacher HTTP details against the closed main schema', async () => {
    const validate = validator.getSchema(
      `${contractBase}openapi.yaml#/components/schemas/TeacherLessonSessionDetail`,
    );
    if (!validate) throw new Error('Teacher detail schema missing');
    expect(teacherDetailLessons).toHaveLength(2);
    for (const lesson of teacherDetailLessons) {
      const response = await get(
        `/teachers/me/lesson-sessions/${lesson.id}`,
        teacherToken,
      ).expect(200);
      const actual = payload<{ status: string }>(response).data;
      expect(actual.status).toBe(lesson.status);
      expect({
        valid: validate(actual),
        errors: validate.errors,
      }).toEqual({ valid: true, errors: null });
    }
  });

  it('keeps independent half-stars, author, month and immutable versions read-only', async () => {
    const response = await performance().expect(200);
    const evaluation = payload<Performance>(response).data.evaluation;
    expect(evaluation).toMatchObject({
      teachingRating: 1,
      communicationRating: 7,
      attendanceRating: 10,
      overallRating: 4,
      version: 21,
      authorName: '合成原作者',
      canEdit: false,
    });
    expect(evaluation?.guidance).toHaveLength(1000);
    const first = await get(`${base}/${teachers[0]}/evaluation-history`)
      .query({ month: '2026-09' })
      .expect(200);
    const second = await get(`${base}/${teachers[0]}/evaluation-history`)
      .query({ month: '2026-09', page: 2 })
      .expect(200);
    validateResponse(first.body, 'HistoryEnvelope');
    validateResponse(second.body, 'HistoryEnvelope');
    expect(payload<Revision[]>(first).meta).toMatchObject({
      total: 21,
      totalPages: 2,
    });
    expect(
      [
        ...payload<Revision[]>(first).data,
        ...payload<Revision[]>(second).data,
      ].map(({ version }) => version),
    ).toEqual(Array.from({ length: 21 }, (_, index) => 21 - index));
    expect(payload<Revision[]>(second).data[0]).toMatchObject({
      periodMonth: '2026-09',
      authorName: '合成原作者',
    });
  });

  it('returns explicit no-plan/no-evaluation states and excludes future lessons', async () => {
    const empty = await performance(teachers[20]).expect(200);
    validateResponse(empty.body, 'PerformanceEnvelope');
    expect(payload<Performance>(empty).data).toMatchObject({
      scheduledLessonCount: 0,
      completedLessonCount: 0,
      completionRateBasisPoints: null,
      evaluation: null,
    });
    const future = await performance(teachers[0], token, '2099-09').expect(200);
    expect(payload<Performance>(future).data.scheduledLessonCount).toBe(0);
    const history = await get(`${base}/${teachers[20]}/evaluation-history`)
      .query({ month: '2026-09' })
      .expect(200);
    validateResponse(history.body, 'HistoryEnvelope');
    expect(payload<Revision[]>(history).data).toEqual([]);
  });

  it('defaults to the current campus month and respects the as-of cutoff', async () => {
    const response = await get(`${base}/${teachers[0]}/performance`).expect(
      200,
    );
    const actual = payload<Performance>(response).data;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(new Date(actual.asOf));
    expect(actual.periodMonth).toBe(
      `${parts.find(({ type }) => type === 'year')?.value}-${parts.find(({ type }) => type === 'month')?.value}`,
    );
    const actor: AuthenticatedUser = {
      userId: operatorId,
      roles: [{ code: 'OPERATOR', campusId: campuses[0] }],
    };
    const partial = await app
      .get(OperatorTeacherArchiveService)
      .performance(
        actor,
        teachers[0],
        { month: '2026-09' },
        new Date('2026-09-15T12:00:00Z'),
      );
    expect(partial).toMatchObject({
      scheduledLessonCount: 6,
      completedLessonCount: 1,
      completionRateBasisPoints: 1667,
    });
  });

  it('rejects other campuses, inactive profiles, other roles, mixed roles and the unscoped total account', async () => {
    for (const id of [otherTeacher, inactiveTeacher, randomUUID()])
      await performance(id).expect(404);
    await performance(teachers[0], otherToken).expect(404);
    for (const bearer of [parentToken, teacherToken, mixedToken, totalToken]) {
      await get(base, bearer).expect(403);
      await performance(teachers[0], bearer).expect(403);
      await get(`${base}/${teachers[0]}/evaluation-history`, bearer).expect(
        403,
      );
    }
    await request(server).get(base).expect(401);
  });

  it('rejects malformed inputs, undeclared disclosure and evaluation write routes', async () => {
    for (const query of [
      { month: '2026-13' },
      { month: '0000-01' },
      { month: '2026-9' },
      { campusId: campuses[1] },
    ]) {
      await get(`${base}/${teachers[0]}/performance`).query(query).expect(400);
    }
    await get(`${base}/not-a-uuid/performance`).expect(400);
    for (const query of [
      { page: 0 },
      { pageSize: 101 },
      { query: 'a'.repeat(101) },
    ])
      await get().query(query).expect(400);
    for (const method of ['post', 'put', 'patch'] as const) {
      await request(server)
        [method](`${base}/${teachers[0]}/evaluation`)
        .auth(token, { type: 'bearer' })
        .send({ overallRating: 10 })
        .expect(404);
    }
    await request(server)
      .put(`/partners/me/teachers/${teachers[0]}/evaluation`)
      .auth(token, { type: 'bearer' })
      .send({})
      .expect(403);
  });

  it('rechecks actor scope in a fresh transaction before returning a captured snapshot', async () => {
    const service = app.get(OperatorTeacherArchiveService);
    const transaction = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, '$transaction');
    spy.mockImplementationOnce(async (input, options) => {
      const result = await transaction(input, options);
      await prisma.userRole.update({
        where: { id: actorRoleId },
        data: { campusId: campuses[1] },
      });
      return result;
    });
    try {
      await performance().expect(403);
    } finally {
      spy.mockRestore();
      await prisma.userRole.update({
        where: { id: actorRoleId },
        data: { campusId: campuses[0] },
      });
    }
    expect(service).toBeDefined();
  });

  it('immediately rejects a disabled actor and keeps read-only domain facts unchanged', async () => {
    await prisma.user.update({
      where: { id: operatorId },
      data: { status: 'DISABLED' },
    });
    try {
      await get().expect(401);
    } finally {
      await prisma.user.update({
        where: { id: operatorId },
        data: { status: 'ACTIVE' },
      });
    }
    expect(await domainSnapshot()).toBe(beforeReads);
  });

  it.each(['list', 'performance', 'history'])(
    'rejects %s if a returned teacher is disabled after the read snapshot',
    async (kind) => {
      const teacher = await prisma.teacherProfile.findUniqueOrThrow({
        where: { id: teachers[0] },
      });
      const transaction = prisma.$transaction.bind(prisma);
      const spy = jest.spyOn(prisma, '$transaction');
      spy.mockImplementationOnce(async (input, options) => {
        const result = await transaction(input, options);
        await prisma.teacherProfile.update({
          where: { id: teachers[0] },
          data: { isActive: false },
        });
        return result;
      });
      try {
        if (kind === 'list') await get().query({ pageSize: 100 }).expect(404);
        else if (kind === 'performance') await performance().expect(404);
        else
          await get(`${base}/${teachers[0]}/evaluation-history`)
            .query({ month: '2026-09' })
            .expect(404);
      } finally {
        spy.mockRestore();
        await prisma.teacherProfile.update({
          where: { id: teacher.id },
          data: { isActive: teacher.isActive, updatedAt: teacher.updatedAt },
        });
      }
    },
  );

  it('serializes teacher status changes in User-before-profile order without deadlock', async () => {
    const teacher = await prisma.teacherProfile.findUniqueOrThrow({
      where: { id: teachers[0] },
    });
    let markUserLocked!: () => void;
    let releaseWriter!: () => void;
    const userLocked = new Promise<void>((resolve) => {
      markUserLocked = resolve;
    });
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writing = prisma
      .$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${teacher.userId}::uuid FOR UPDATE`;
          markUserLocked();
          await writerGate;
          await tx.teacherProfile.update({
            where: { id: teacher.id },
            data: { isActive: false },
          });
        },
        { timeout: 15000 },
      )
      .then(
        () => null,
        (error: unknown) => {
          markUserLocked();
          return error;
        },
      );
    await userLocked;
    const reading = performance().then((response) => response.status);
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [state] = await prisma.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid()
            AND wait_event_type = 'Lock' AND query LIKE '%FROM "User"%'`;
        if (Number(state.count) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(blocked).toBe(true);
      releaseWriter();
      expect(await writing).toBeNull();
      expect(await reading).toBe(404);
    } finally {
      releaseWriter();
      await Promise.allSettled([writing, reading]);
      await prisma.teacherProfile.update({
        where: { id: teacher.id },
        data: { isActive: teacher.isActive, updatedAt: teacher.updatedAt },
      });
    }
  });

  it('drives the integrated operator Page through real identity, pagination, month, revisions and revocation', async () => {
    const env = capture(['teacher-archives']);
    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Dedicated HTTP address unavailable');
      }
      const origin = `http://127.0.0.1:${address.port}`;
      const pending = new Set<Promise<void>>();
      const calls: { path: string; query: string; status: number }[] = [];
      env.change({ apiBaseUrl: origin, accessToken: token });
      env.platform.request.mockImplementation(
        (options: OperatorHttpRequestOptions) => {
          const target = new URL(options.url);
          if (
            target.origin !== origin ||
            options.method !== 'GET' ||
            (target.pathname !== '/me' &&
              !/^\/operators\/me\/teacher-archives(?:\/[0-9a-f-]{36}\/(?:performance|evaluation-history))?$/.test(
                target.pathname,
              ))
          ) {
            throw new Error('Page request outside dedicated read-only routes');
          }
          const task = fetch(target, {
            method: options.method,
            headers: options.header,
            signal: AbortSignal.timeout(5000),
          })
            .then(async (response) => {
              const data: unknown = await response.json();
              calls.push({
                path: target.pathname,
                query: target.search,
                status: response.status,
              });
              options.success({ statusCode: response.status, data });
            })
            .catch(() => options.fail(new Error('Dedicated HTTP read failed')))
            .finally(() => pending.delete(task));
          pending.add(task);
        },
      );
      const page = env.instantiate() as ArchivePage;
      const settle = async () => {
        for (let attempt = 0; attempt < 30; attempt++) {
          await Promise.all([
            page.listRequest,
            page.performanceRequest,
            page.historyRequest,
            ...pending,
          ]);
          await new Promise<void>((resolve) => setImmediate(resolve));
          if (
            !pending.size &&
            !page.listRequest &&
            !page.performanceRequest &&
            !page.historyRequest
          )
            return;
        }
        throw new Error('Page reads did not drain');
      };
      const teacher = await prisma.teacherProfile.findUniqueOrThrow({
        where: { id: teachers[0] },
      });
      try {
        page.onLoad();
        page.onShow();
        await settle();
        expect(page.data).toMatchObject({ viewState: 'ready', page: 1 });
        expect(page.data.items).toHaveLength(20);
        page.onLoadMore();
        await settle();
        expect(new Set(page.data.items.map(({ id }) => id))).toEqual(
          new Set(teachers),
        );
        page.onTeacherToggle({
          currentTarget: { dataset: { id: teachers[0] } },
        });
        await settle();
        expect(page.data.month).toMatch(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
        page.onMonthChange({ detail: { value: '2026-09' } });
        await settle();
        expect(page.data.performance).toMatchObject({
          scheduledLabel: '8',
          completedLabel: '2',
          completionLabel: '25%',
        });
        expect(
          page.data.performance?.evaluation.ratings.map(
            ({ valueLabel }) => valueLabel,
          ),
        ).toEqual(['0.5星', '3.5星', '5星', '2星']);
        expect(page.data.historyItems).toHaveLength(20);
        page.onHistoryMore();
        await settle();
        expect(page.data.historyItems.map(({ version }) => version)).toEqual(
          Array.from({ length: 21 }, (_, index) => 21 - index),
        );
        const transaction = prisma.$transaction.bind(prisma);
        const spy = jest.spyOn(prisma, '$transaction');
        spy.mockImplementationOnce(async (input, options) => {
          const result = await transaction(input, options);
          await prisma.teacherProfile.update({
            where: { id: teachers[0] },
            data: { isActive: false },
          });
          return result;
        });
        try {
          page.onPullDownRefresh();
          await settle();
        } finally {
          spy.mockRestore();
        }
        expect(calls.filter(({ path }) => path === base).at(-1)?.status).toBe(
          404,
        );
        expect(page.data.items).toEqual([]);
        expect(page.data.performance).toBeNull();
        expect(page.data.historyItems).toEqual([]);
        expect(page.teacherRecords).toEqual([]);
        expect(page.historyRecords).toEqual([]);
        await prisma.teacherProfile.update({
          where: { id: teacher.id },
          data: { isActive: teacher.isActive, updatedAt: teacher.updatedAt },
        });
        page.onPullDownRefresh();
        await settle();
        expect(page.data.items).toHaveLength(20);
        page.onTeacherToggle({
          currentTarget: { dataset: { id: teachers[0] } },
        });
        await settle();
        page.onMonthChange({ detail: { value: '2026-09' } });
        await settle();
        expect(page.data.performance).not.toBeNull();
        expect(page.data.historyItems).toHaveLength(20);
        expect(page.teacherRecords).toHaveLength(20);
        expect(page.historyRecords).toHaveLength(20);
        await prisma.user.update({
          where: { id: operatorId },
          data: { status: 'DISABLED' },
        });
        page.onPullDownRefresh();
        await settle();
        expect(page.data).toMatchObject({
          viewState: 'forbidden',
          items: [],
          performance: null,
          historyItems: [],
        });
        expect(page.teacherRecords).toEqual([]);
        expect(page.historyRecords).toEqual([]);
        expect(calls.filter(({ path }) => path === '/me').at(-1)?.status).toBe(
          401,
        );
        expect(await domainSnapshot()).toBe(beforeReads);
        console.log(`HTTP_PAGE ${JSON.stringify({ execution, calls })}`);
      } finally {
        jest.restoreAllMocks();
        await Promise.allSettled([...pending]);
        await prisma.teacherProfile.update({
          where: { id: teacher.id },
          data: { isActive: teacher.isActive, updatedAt: teacher.updatedAt },
        });
        await prisma.user.update({
          where: { id: operatorId },
          data: { status: 'ACTIVE' },
        });
      }
    } finally {
      env.close();
    }
  });
});
