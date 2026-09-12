import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';

jest.setTimeout(30_000);

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

const TEST_ENV = {
  NODE_ENV: 'test',
  PORT: '3001',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
  TZ: 'Asia/Shanghai',
};

const ids = {
  eastCampus: '10000000-0000-4000-8000-000000000001',
  eastTeacher: '30000000-0000-4000-8000-000000000001',
  eastClass: '50000000-0000-4000-8000-000000000001',
  eastWorkshop: '50000000-0000-4000-8000-000000000002',
  westClass: '50000000-0000-4000-8000-000000000003',
  eastCompleted: '70000000-0000-4000-8000-000000000001',
  westScheduled: '70000000-0000-4000-8000-000000000004',
  listFixture: '71000000-0000-4000-8000-000000000001',
} as const;

const TEST_RANGE_START = new Date('2040-01-01T00:00:00.000Z');
const TEST_RANGE_END = new Date('2041-01-01T00:00:00.000Z');
const CREATE_ROUTE = '/campus-managers/me/lesson-sessions';

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface AuthSession {
  accessToken: string;
}

interface LessonView {
  id: string;
  campusId: string;
  classGroupId: string;
  className: string;
  courseName: string;
  teacherId: string;
  teacherName: string;
  startsAt: string;
  endsAt: string;
  kind: 'REGULAR' | 'MAKEUP' | 'TRIAL';
  lessonUnits: number;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'REVERSED' | 'CANCELLED';
  version: number;
}

interface LessonInput {
  classGroupId: string;
  startsAt: string;
  endsAt: string;
  kind: 'REGULAR' | 'MAKEUP' | 'TRIAL';
}

describe('campus manager scheduling', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let managerToken: string;
  let parentToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await cleanupTestData();
    await prisma.lessonSession.create({
      data: {
        id: ids.listFixture,
        campusId: ids.eastCampus,
        classGroupId: ids.eastClass,
        teacherId: ids.eastTeacher,
        startsAt: new Date('2040-01-05T06:00:00.000Z'),
        endsAt: new Date('2040-01-05T07:30:00.000Z'),
        kind: 'MAKEUP',
        lessonUnits: 100,
        status: 'SCHEDULED',
        version: 1,
      },
    });

    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    httpServer = app.getHttpServer() as Server;
    managerToken = await login('mock-demo-east-campus-manager');
    parentToken = await login('mock-demo-east-parent');
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.classGroup.updateMany({
        where: { id: ids.eastWorkshop },
        data: { status: 'ACTIVE' },
      });
      await cleanupTestData();
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  async function cleanupTestData() {
    const lessons = await prisma.lessonSession.findMany({
      where: {
        campusId: ids.eastCampus,
        startsAt: { gte: TEST_RANGE_START, lt: TEST_RANGE_END },
      },
      select: { id: true },
    });
    const lessonIds = lessons.map(({ id }) => id);
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { startsWith: 'CAMPUS_SCHEDULE_' } },
          ...(lessonIds.length > 0 ? [{ resourceId: { in: lessonIds } }] : []),
        ],
      },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: {
        route: { startsWith: '/campus-managers/me/lesson-sessions' },
        key: { startsWith: 'cm-schedule-' },
      },
    });
    if (lessonIds.length > 0) {
      await prisma.lessonSession.deleteMany({
        where: { id: { in: lessonIds } },
      });
    }
  }

  async function login(code: string): Promise<string> {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ code })
      .expect(200);
    return (response.body as Envelope<AuthSession>).data.accessToken;
  }

  const getAs = (path: string, token = managerToken) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);

  const createAs = (body: LessonInput, key: string, token = managerToken) =>
    request(httpServer)
      .post(CREATE_ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  const updateAs = (
    lessonSessionId: string,
    body: Omit<LessonInput, 'classGroupId'> & { version: number },
    key: string,
    token = managerToken,
  ) =>
    request(httpServer)
      .patch(`${CREATE_ROUTE}/${lessonSessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(body);

  const cancelAs = (
    lessonSessionId: string,
    version: number,
    key: string,
    token = managerToken,
  ) =>
    request(httpServer)
      .post(`${CREATE_ROUTE}/${lessonSessionId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ version });

  const lessonInput = (
    suffix: number,
    overrides: Partial<LessonInput> = {},
  ): LessonInput => ({
    classGroupId: ids.eastClass,
    startsAt: `2040-02-${String(suffix).padStart(2, '0')}T06:00:00.000Z`,
    endsAt: `2040-02-${String(suffix).padStart(2, '0')}T07:30:00.000Z`,
    kind: 'REGULAR',
    ...overrides,
  });

  it('lists only the current campus with paging, range, and status filters', async () => {
    const response = await getAs(
      `${CREATE_ROUTE}?page=1&pageSize=1&from=2040-01-05T00:00:00.000Z&to=2040-01-06T00:00:00.000Z&status=SCHEDULED`,
    ).expect(200);

    expect(response.body).toEqual({
      data: [
        expect.objectContaining({
          id: ids.listFixture,
          campusId: ids.eastCampus,
          classGroupId: ids.eastClass,
          className: '创意基础A班',
          courseName: '创意基础',
          teacherId: ids.eastTeacher,
          teacherName: '林老师',
          startsAt: '2040-01-05T06:00:00.000Z',
          endsAt: '2040-01-05T07:30:00.000Z',
          kind: 'MAKEUP',
          lessonUnits: 100,
          status: 'SCHEDULED',
          version: 1,
        }),
      ],
      meta: { page: 1, pageSize: 1, total: 1, totalPages: 1 },
      requestId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toContain(ids.westScheduled);

    const empty = await getAs(
      `${CREATE_ROUTE}?from=2040-01-05T00:00:00.000Z&to=2040-01-06T00:00:00.000Z&status=COMPLETED`,
    ).expect(200);
    const emptyPage = empty.body as {
      data: LessonView[];
      meta: { total: number };
    };
    expect(emptyPage.data).toEqual([]);
    expect(emptyPage.meta.total).toBe(0);
  });

  it('creates one future session and derives teacher and units from the active class', async () => {
    const response = await createAs(
      lessonInput(1, { kind: 'TRIAL' }),
      'cm-schedule-create-001',
    ).expect(200);
    const lesson = (response.body as Envelope<LessonView>).data;

    expect(lesson).toMatchObject({
      id: expect.any(String) as unknown,
      campusId: ids.eastCampus,
      classGroupId: ids.eastClass,
      className: '创意基础A班',
      courseName: '创意基础',
      teacherId: ids.eastTeacher,
      teacherName: '林老师',
      kind: 'TRIAL',
      lessonUnits: 100,
      status: 'SCHEDULED',
      version: 1,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'CAMPUS_SCHEDULE_CREATE',
          resourceId: lesson.id,
          campusId: ids.eastCampus,
        },
      }),
    ).toBe(1);
  });

  it('rejects past or reversed time ranges without creating a session', async () => {
    const before = await prisma.lessonSession.count();
    await createAs(
      {
        classGroupId: ids.eastClass,
        startsAt: new Date(Date.now() - 7_200_000).toISOString(),
        endsAt: new Date(Date.now() - 3_600_000).toISOString(),
        kind: 'REGULAR',
      },
      'cm-schedule-past-001',
    ).expect(400);
    await createAs(
      lessonInput(2, {
        startsAt: '2040-02-02T08:00:00.000Z',
        endsAt: '2040-02-02T07:00:00.000Z',
      }),
      'cm-schedule-range-001',
    ).expect(400);
    expect(await prisma.lessonSession.count()).toBe(before);
  });

  it('rejects foreign or archived classes and rolls back the idempotency claim', async () => {
    await createAs(
      lessonInput(3, { classGroupId: ids.westClass }),
      'cm-schedule-scope-001',
    ).expect(404);
    await createAs(lessonInput(3), 'cm-schedule-scope-001').expect(200);

    await prisma.classGroup.update({
      where: { id: ids.eastWorkshop },
      data: { status: 'ARCHIVED' },
    });
    try {
      await createAs(
        lessonInput(4, { classGroupId: ids.eastWorkshop }),
        'cm-schedule-archived-001',
      ).expect(404);
    } finally {
      await prisma.classGroup.update({
        where: { id: ids.eastWorkshop },
        data: { status: 'ACTIVE' },
      });
    }
    expect(
      await prisma.lessonSession.count({
        where: {
          classGroupId: ids.eastWorkshop,
          startsAt: new Date('2040-02-04T06:00:00.000Z'),
        },
      }),
    ).toBe(0);
  });

  it('replays the same create once and rejects one key with another payload', async () => {
    const input = lessonInput(5);
    const first = await createAs(input, 'cm-schedule-idempotent-001').expect(
      200,
    );
    const replay = await createAs(input, 'cm-schedule-idempotent-001').expect(
      200,
    );
    const firstLesson = (first.body as Envelope<LessonView>).data;
    const replayedLesson = (replay.body as Envelope<LessonView>).data;

    expect(replayedLesson.id).toBe(firstLesson.id);
    expect(
      await prisma.lessonSession.count({
        where: { startsAt: new Date(input.startsAt), campusId: ids.eastCampus },
      }),
    ).toBe(1);
    await createAs(
      { ...input, kind: 'MAKEUP' },
      'cm-schedule-idempotent-001',
    ).expect(409);
  });

  it('updates and cancels only scheduled sessions with version checks and audit', async () => {
    const created = await createAs(
      lessonInput(6),
      'cm-schedule-lifecycle-create-001',
    ).expect(200);
    const createdLesson = (created.body as Envelope<LessonView>).data;
    const updateBody = {
      version: 1,
      startsAt: '2040-02-06T08:00:00.000Z',
      endsAt: '2040-02-06T09:00:00.000Z',
      kind: 'MAKEUP' as const,
    };
    const updated = await updateAs(
      createdLesson.id,
      updateBody,
      'cm-schedule-lifecycle-update-001',
    ).expect(200);
    const updateReplay = await updateAs(
      createdLesson.id,
      updateBody,
      'cm-schedule-lifecycle-update-001',
    ).expect(200);
    const updatedLesson = (updated.body as Envelope<LessonView>).data;
    expect((updateReplay.body as Envelope<LessonView>).data).toEqual(
      updatedLesson,
    );
    expect(updatedLesson).toMatchObject({
      id: createdLesson.id,
      classGroupId: ids.eastClass,
      teacherId: ids.eastTeacher,
      lessonUnits: 100,
      startsAt: updateBody.startsAt,
      endsAt: updateBody.endsAt,
      kind: 'MAKEUP',
      status: 'SCHEDULED',
      version: 2,
    });
    await updateAs(
      createdLesson.id,
      updateBody,
      'cm-schedule-lifecycle-update-replay-001',
    ).expect(409);

    const cancelled = await cancelAs(
      createdLesson.id,
      2,
      'cm-schedule-lifecycle-cancel-001',
    ).expect(200);
    const cancelReplay = await cancelAs(
      createdLesson.id,
      2,
      'cm-schedule-lifecycle-cancel-001',
    ).expect(200);
    expect((cancelled.body as Envelope<LessonView>).data).toMatchObject({
      id: createdLesson.id,
      status: 'CANCELLED',
      version: 3,
    });
    expect((cancelReplay.body as Envelope<LessonView>).data).toEqual(
      (cancelled.body as Envelope<LessonView>).data,
    );
    await updateAs(
      createdLesson.id,
      { ...updateBody, version: 3 },
      'cm-schedule-terminal-update-001',
    ).expect(409);
    await cancelAs(
      createdLesson.id,
      3,
      'cm-schedule-terminal-cancel-001',
    ).expect(409);
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: createdLesson.id,
          action: { in: ['CAMPUS_SCHEDULE_UPDATE', 'CAMPUS_SCHEDULE_CANCEL'] },
        },
      }),
    ).toBe(2);
  });

  it('allows only one concurrent update for the same version', async () => {
    const created = await createAs(
      lessonInput(7),
      'cm-schedule-concurrent-create-001',
    ).expect(200);
    const lesson = (created.body as Envelope<LessonView>).data;
    const responses = await Promise.all([
      updateAs(
        lesson.id,
        {
          version: 1,
          startsAt: '2040-02-07T08:00:00.000Z',
          endsAt: '2040-02-07T09:00:00.000Z',
          kind: 'REGULAR',
        },
        'cm-schedule-concurrent-update-001',
      ),
      updateAs(
        lesson.id,
        {
          version: 1,
          startsAt: '2040-02-07T09:00:00.000Z',
          endsAt: '2040-02-07T10:00:00.000Z',
          kind: 'TRIAL',
        },
        'cm-schedule-concurrent-update-002',
      ),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const stored = await prisma.lessonSession.findUniqueOrThrow({
      where: { id: lesson.id },
    });
    expect(stored.version).toBe(2);
  });

  it('hides foreign sessions and rejects terminal seed sessions', async () => {
    await updateAs(
      ids.westScheduled,
      {
        version: 1,
        startsAt: '2040-03-01T06:00:00.000Z',
        endsAt: '2040-03-01T07:00:00.000Z',
        kind: 'REGULAR',
      },
      'cm-schedule-foreign-update-001',
    ).expect(404);
    await cancelAs(
      ids.westScheduled,
      1,
      'cm-schedule-foreign-cancel-001',
    ).expect(404);
    await cancelAs(
      ids.eastCompleted,
      2,
      'cm-schedule-completed-cancel-001',
    ).expect(409);
  });

  it('rejects non-manager reads and writes', async () => {
    await getAs(CREATE_ROUTE, parentToken).expect(403);
    await createAs(
      lessonInput(8),
      'cm-schedule-forbidden-create-001',
      parentToken,
    ).expect(403);
  });
});
