import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

if (!new URL(TEST_DATABASE_URL).pathname.includes('education_app_test')) {
  throw new Error('Teacher earning tests must use education_app_test');
}

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
  eastTeacherUser: '20000000-0000-4000-8000-000000000001',
  campusManagerUser: '20000000-0000-4000-8000-000000000005',
  campusManagerIdentity: '21000000-0000-4000-8000-000000000005',
  campusManagerRole: 'd0000000-0000-4000-8000-000000000005',
  eastTeacher: '30000000-0000-4000-8000-000000000001',
  seedRule: 'f0000000-0000-4000-8000-000000000001',
  seedCurrentRule: 'f0000000-0000-4000-8000-000000000002',
  seedEntry: 'f3000000-0000-4000-8000-000000000001',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

describe('teacher earnings and management review', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let teacherToken: string;
  let superAdminToken: string;
  let campusManagerToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await seedCampusManager(prisma);

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

    teacherToken = await login(httpServer, 'mock-demo-east-teacher');
    superAdminToken = await login(httpServer, 'mock-demo-super-admin');
    campusManagerToken = await login(httpServer, 'mock-demo-campus-manager');
  });

  beforeEach(async () => {
    await prisma.idempotencyRecord.deleteMany({
      where: { route: { startsWith: '/management/' } },
    });
    await prisma.teacherEarningRule.deleteMany({
      where: { id: { not: ids.seedRule } },
    });
    await seedTeacherCore(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.idempotencyRecord.deleteMany({
        where: { actorUserId: ids.campusManagerUser },
      });
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  const get = (path: string, token = teacherToken) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token = superAdminToken) =>
    request(httpServer).post(path).set('Authorization', `Bearer ${token}`);

  it('seeds one active attendee rule, one policy, and one historical available earning repeatably', async () => {
    await seedTeacherCore(prisma);
    await seedTeacherCore(prisma);

    await expect(
      prisma.teacherEarningRule.findMany({
        where: {
          campusId: ids.eastCampus,
          teacherProfileId: null,
          status: 'ACTIVE',
        },
        select: { basisType: true, unitAmountFen: true, status: true },
      }),
    ).resolves.toEqual([
      {
        basisType: 'PER_PRESENT_ATTENDEE',
        unitAmountFen: 300,
        status: 'ACTIVE',
      },
    ]);
    await expect(
      prisma.teacherWithdrawalPolicy.findMany({
        where: { status: 'ACTIVE' },
        select: {
          minimumAmountFen: true,
          dailyRequestLimit: true,
          status: true,
        },
      }),
    ).resolves.toEqual([
      {
        minimumAmountFen: 10000,
        dailyRequestLimit: 1,
        status: 'ACTIVE',
      },
    ]);
    await expect(
      prisma.teacherEarningEntry.findMany({
        where: {
          teacherProfileId: ids.eastTeacher,
          status: 'AVAILABLE',
        },
        select: { amountFen: true, status: true },
      }),
    ).resolves.toEqual([{ amountFen: 10000, status: 'AVAILABLE' }]);
  });

  it('returns backend-calculated totals, current rule, and only own entries', async () => {
    await prisma.teacherEarningEntry.update({
      where: { id: ids.seedEntry },
      data: { createdAt: new Date() },
    });

    const summary = await get('/teachers/me/earnings/summary').expect(200);
    expect(summary.body).toEqual(
      expect.objectContaining({
        data: {
          todayEstimatedFen: 10000,
          weekEstimatedFen: 10000,
          monthEstimatedFen: 10000,
          estimatedTotalFen: 10000,
          pendingReviewFen: 0,
          availableFen: 10000,
          withdrawingFen: 0,
          currency: 'CNY',
        },
      }) as unknown,
    );

    await get('/teachers/me/earning-rule')
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              id: ids.seedCurrentRule,
              unitAmountFen: 300,
              basisType: 'PER_PRESENT_ATTENDEE',
            }) as unknown,
          }) as unknown,
        );
      });

    const entries = await get(
      '/teachers/me/earnings?page=1&pageSize=10',
    ).expect(200);
    expect(entries.body as unknown).toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: ids.seedEntry,
            teacherId: ids.eastTeacher,
            amountFen: 10000,
            status: 'AVAILABLE',
          }),
        ],
        meta: expect.objectContaining({ total: 1 }) as unknown,
      }) as unknown,
    );
  });

  it('denies management APIs to teachers and campus managers', async () => {
    await get('/management/earning-rules', teacherToken).expect(403);
    await get('/management/earning-rules', campusManagerToken).expect(403);
  });

  it('activates a teacher override without changing historical snapshots', async () => {
    const snapshotBefore = await prisma.teacherEarningEntry.findUniqueOrThrow({
      where: { id: ids.seedEntry },
      select: { ruleSnapshot: true },
    });
    const requestBody = {
      campusId: ids.eastCampus,
      teacherId: ids.eastTeacher,
      basisType: 'PER_COMPLETED_SESSION',
      unitAmountFen: 12000,
      eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
      countedAttendanceStatuses: ['PRESENT'],
      settlementDelayDays: 0,
      effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    };
    const created = await post('/management/earning-rules')
      .set('Idempotency-Key', 'create-teacher-rule-0001')
      .send(requestBody)
      .expect(200);
    const createdRule = (
      created.body as Envelope<{ id: string; status: string; version: number }>
    ).data;
    expect(createdRule).toMatchObject({ status: 'DRAFT', version: 1 });

    const replay = await post('/management/earning-rules')
      .set('Idempotency-Key', 'create-teacher-rule-0001')
      .send(requestBody)
      .expect(200);
    expect((replay.body as Envelope<unknown>).data).toEqual(
      (created.body as Envelope<unknown>).data,
    );

    await post(`/management/earning-rules/${createdRule.id}/activate`)
      .set('Idempotency-Key', 'activate-teacher-rule-01')
      .send({ expectedVersion: 1 })
      .expect(200);

    await get('/teachers/me/earning-rule')
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              id: createdRule.id,
              teacherId: ids.eastTeacher,
              unitAmountFen: 12000,
              status: 'ACTIVE',
            }) as unknown,
          }) as unknown,
        );
      });
    await expect(
      prisma.teacherEarningEntry.findUniqueOrThrow({
        where: { id: ids.seedEntry },
        select: { ruleSnapshot: true },
      }),
    ).resolves.toEqual(snapshotBefore);
  });

  it('rejects early review, then approves once and replays idempotently', async () => {
    await prisma.teacherEarningEntry.update({
      where: { id: ids.seedEntry },
      data: {
        status: 'PENDING_REVIEW',
        reviewableAt: new Date(Date.now() + 60_000),
        reviewedByUserId: null,
        reviewedAt: null,
        reviewReason: null,
        version: 1,
      },
    });

    await post(`/management/teacher-earnings/${ids.seedEntry}/approve`)
      .set('Idempotency-Key', 'approve-earning-too-early')
      .send({ expectedVersion: 1 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            code: 'EARNING_NOT_REVIEWABLE',
          }) as unknown,
        );
      });

    await prisma.teacherEarningEntry.update({
      where: { id: ids.seedEntry },
      data: { reviewableAt: new Date(Date.now() - 60_000) },
    });
    const approved = await post(
      `/management/teacher-earnings/${ids.seedEntry}/approve`,
    )
      .set('Idempotency-Key', 'approve-earning-ready-01')
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(approved.body as unknown).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          id: ids.seedEntry,
          status: 'AVAILABLE',
          version: 2,
        }) as unknown,
      }) as unknown,
    );

    const replay = await post(
      `/management/teacher-earnings/${ids.seedEntry}/approve`,
    )
      .set('Idempotency-Key', 'approve-earning-ready-01')
      .send({ expectedVersion: 1 })
      .expect(200);
    expect((replay.body as Envelope<unknown>).data).toEqual(
      (approved.body as Envelope<unknown>).data,
    );

    await post(`/management/teacher-earnings/${ids.seedEntry}/approve`)
      .set('Idempotency-Key', 'approve-earning-again-01')
      .send({ expectedVersion: 2 })
      .expect(409)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            code: 'EARNING_ALREADY_REVIEWED',
          }) as unknown,
        );
      });
  });
});

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ code })
    .expect(200);
  return (response.body as Envelope<{ accessToken: string }>).data.accessToken;
}

async function seedCampusManager(prisma: PrismaClient): Promise<void> {
  await prisma.user.upsert({
    where: { id: ids.campusManagerUser },
    update: { displayName: '东校区管理员', status: 'ACTIVE' },
    create: {
      id: ids.campusManagerUser,
      displayName: '东校区管理员',
      status: 'ACTIVE',
    },
  });
  await prisma.authIdentity.upsert({
    where: {
      userId_provider: {
        userId: ids.campusManagerUser,
        provider: 'MOCK',
      },
    },
    update: {
      userId: ids.campusManagerUser,
      provider: 'MOCK',
      subject: 'mock-demo-campus-manager',
    },
    create: {
      id: ids.campusManagerIdentity,
      userId: ids.campusManagerUser,
      provider: 'MOCK',
      subject: 'mock-demo-campus-manager',
    },
  });
  await prisma.userRole.upsert({
    where: { id: ids.campusManagerRole },
    update: {
      userId: ids.campusManagerUser,
      roleCode: 'CAMPUS_MANAGER',
      campusId: ids.eastCampus,
    },
    create: {
      id: ids.campusManagerRole,
      userId: ids.campusManagerUser,
      roleCode: 'CAMPUS_MANAGER',
      campusId: ids.eastCampus,
    },
  });
}
