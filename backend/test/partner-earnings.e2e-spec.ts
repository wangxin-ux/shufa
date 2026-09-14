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
  throw new Error('Partner earning tests must use education_app_test');
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
  eastStudentA: '40000000-0000-4000-8000-000000000001',
  eastStudentB: '40000000-0000-4000-8000-000000000002',
  eastScheduled: '70000000-0000-4000-8000-000000000002',
  eastWorkshop: '70000000-0000-4000-8000-000000000003',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

jest.setTimeout(30_000);

describe('partner earning rules and ledger', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let superAdminToken: string;
  let partnerToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);

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

    superAdminToken = await login(httpServer, 'mock-demo-super-admin');
    partnerToken = await login(httpServer, 'mock-demo-east-partner');
    teacherToken = await login(httpServer, 'mock-demo-east-teacher');
  });

  beforeEach(async () => {
    await seedTeacherCore(prisma);
    await prisma.idempotencyRecord.deleteMany({
      where: {
        route: { startsWith: '/management/partner-' },
      },
    });
    await prisma.partnerEarningEntry.deleteMany({});
    await prisma.partnerEarningBasis.deleteMany({});
    await prisma.partnerEarningRule.deleteMany({});
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.partnerEarningEntry.deleteMany({});
      await prisma.partnerEarningBasis.deleteMany({});
      await prisma.partnerEarningRule.deleteMany({});
      await seedTeacherCore(prisma);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  const post = (path: string, token = superAdminToken) =>
    request(httpServer).post(path).set('Authorization', `Bearer ${token}`);

  const activateDefaultRule = async () => {
    const created = await post('/management/partner-earning-rules')
      .set('Idempotency-Key', 'partner-default-rule-create')
      .send(ruleBody(1000, 4000))
      .expect(200);
    const rule = (
      created.body as Envelope<{ id: string; version: number }>
    ).data;
    await post(`/management/partner-earning-rules/${rule.id}/activate`)
      .set('Idempotency-Key', 'partner-default-rule-activate')
      .send({ expectedVersion: rule.version })
      .expect(200);
    return rule;
  };

  const completeScheduledLesson = async (key: string) => {
    const completed = await request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', key)
      .send({
        lessonVersion: 1,
        attendance: [
          { studentId: ids.eastStudentA, status: 'PRESENT' },
          { studentId: ids.eastStudentB, status: 'PRESENT' },
        ],
      })
      .expect(200);
    return (completed.body as Envelope<{ teachingRecordId: string }>).data;
  };

  it('creates versioned campus rules idempotently and retires the previous active rule', async () => {
    const firstBody = ruleBody(1000, 4000);
    const first = await post('/management/partner-earning-rules')
      .set('Idempotency-Key', 'partner-rule-create-v1')
      .send(firstBody)
      .expect(200);
    const firstRule = (
      first.body as Envelope<{ id: string; version: number; status: string }>
    ).data;
    expect(firstRule).toMatchObject({ version: 1, status: 'DRAFT' });

    const replay = await post('/management/partner-earning-rules')
      .set('Idempotency-Key', 'partner-rule-create-v1')
      .send(firstBody)
      .expect(200);
    expect((replay.body as Envelope<unknown>).data).toEqual(
      (first.body as Envelope<unknown>).data,
    );

    await post(
      `/management/partner-earning-rules/${firstRule.id}/activate`,
    )
      .set('Idempotency-Key', 'partner-rule-activate-v1')
      .send({ expectedVersion: 1 })
      .expect(200);

    const second = await post('/management/partner-earning-rules')
      .set('Idempotency-Key', 'partner-rule-create-v2')
      .send(ruleBody(1200, 4500))
      .expect(200);
    const secondRule = (
      second.body as Envelope<{ id: string; version: number; status: string }>
    ).data;
    expect(secondRule).toMatchObject({ version: 2, status: 'DRAFT' });

    await post(
      `/management/partner-earning-rules/${secondRule.id}/activate`,
    )
      .set('Idempotency-Key', 'partner-rule-activate-v2')
      .send({ expectedVersion: 2 })
      .expect(200);

    await expect(
      prisma.partnerEarningRule.findMany({
        where: { campusId: ids.eastCampus },
        orderBy: { version: 'asc' },
        select: { version: true, status: true, effectiveTo: true },
      }),
    ).resolves.toEqual([
      { version: 1, status: 'RETIRED', effectiveTo: expect.any(Date) },
      { version: 2, status: 'ACTIVE', effectiveTo: null },
    ]);
  });

  it('rejects invalid ratios and denies management to campus-scoped roles', async () => {
    await post('/management/partner-earning-rules', partnerToken)
      .set('Idempotency-Key', 'partner-rule-forbidden-01')
      .send(ruleBody(1000, 4000))
      .expect(403);
    await post('/management/partner-earning-rules', teacherToken)
      .set('Idempotency-Key', 'partner-rule-forbidden-02')
      .send(ruleBody(1000, 4000))
      .expect(403);
    await post('/management/partner-earning-rules')
      .set('Idempotency-Key', 'partner-rule-invalid-ratio')
      .send(ruleBody(1000, 10001))
      .expect(400);
  });

  it('records the rule snapshot on completion and adds one negative entry on reversal', async () => {
    const createdRule = await post('/management/partner-earning-rules')
      .set('Idempotency-Key', 'partner-recording-rule-create')
      .send(ruleBody(1000, 4000))
      .expect(200);
    const activeRule = (
      createdRule.body as Envelope<{ id: string; version: number }>
    ).data;
    await post(`/management/partner-earning-rules/${activeRule.id}/activate`)
      .set('Idempotency-Key', 'partner-recording-rule-activate')
      .send({ expectedVersion: activeRule.version })
      .expect(200);
    const attendance = [
      { studentId: ids.eastStudentA, status: 'PRESENT' },
      { studentId: ids.eastStudentB, status: 'PRESENT' },
    ];
    const completed = await request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', 'partner-earning-complete-01')
      .send({ lessonVersion: 1, attendance })
      .expect(200);
    const teachingRecordId = (
      completed.body as Envelope<{ teachingRecordId: string }>
    ).data.teachingRecordId;

    const basis = await prisma.partnerEarningBasis.findUnique({
      where: { teachingRecordId },
      include: { entries: true },
    });
    expect(basis).toMatchObject({
      status: 'PRICED',
      selectedRuleId: activeRule.id,
      actualAttendeeCount: 2,
      countedAttendeeCount: 2,
      entries: [
        expect.objectContaining({
          entryType: 'ACCRUAL',
          amountFen: 800,
          status: 'PENDING_REVIEW',
          ruleSnapshot: expect.objectContaining({
            unitPriceFen: 1000,
            shareBasisPoints: 4000,
            countedAttendeeCount: 2,
            perAttendeeAmountFen: 400,
            amountFen: 800,
          }) as unknown,
        }),
      ],
    });

    await request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/reverse`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', 'partner-earning-reverse-01')
      .send({ lessonVersion: 2, reason: '点名修正' })
      .expect(200);

    const reversed = await prisma.partnerEarningBasis.findUniqueOrThrow({
      where: { teachingRecordId },
      include: { entries: { orderBy: { createdAt: 'asc' } } },
    });
    expect(reversed.status).toBe('REVERSED');
    expect(reversed.entries).toHaveLength(2);
    expect(reversed.entries[0]).toMatchObject({
      entryType: 'ACCRUAL',
      amountFen: 800,
      status: 'REVERSED',
    });
    expect(reversed.entries[1]).toMatchObject({
      entryType: 'REVERSAL',
      amountFen: -800,
      status: 'REVERSED',
      reversalOfId: reversed.entries[0].id,
    });
  });

  it('records an unpriced basis without inventing money when no rule is active', async () => {
    const completed = await request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastWorkshop}/complete`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', 'partner-earning-unpriced-01')
      .send({
        lessonVersion: 1,
        attendance: [{ studentId: ids.eastStudentA, status: 'PRESENT' }],
      })
      .expect(200);
    const teachingRecordId = (
      completed.body as Envelope<{ teachingRecordId: string }>
    ).data.teachingRecordId;

    await expect(
      prisma.partnerEarningBasis.findUnique({
        where: { teachingRecordId },
        select: { status: true, selectedRuleId: true, entries: true },
      }),
    ).resolves.toEqual({
      status: 'UNPRICED',
      selectedRuleId: null,
      entries: [],
    });
  });

  it('lets the scoped partner read pending totals and lets only super admin approve once', async () => {
    const activeRule = await activateDefaultRule();
    const completed = await completeScheduledLesson(
      'partner-query-complete-01',
    );
    const entry = await prisma.partnerEarningEntry.findFirstOrThrow({
      where: { earningBasis: { teachingRecordId: completed.teachingRecordId } },
    });

    await request(httpServer)
      .get('/partners/me/earning-rule')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body as unknown).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              id: activeRule.id,
              unitPriceFen: 1000,
              shareBasisPoints: 4000,
            }) as unknown,
          }) as unknown,
        );
      });
    await request(httpServer)
      .get('/partners/me/earnings/summary')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body as unknown).toEqual(
          expect.objectContaining({
            data: {
              estimatedTotalFen: 800,
              pendingReviewFen: 800,
              availableFen: 0,
              reversedNetFen: 0,
              currency: 'CNY',
            },
          }) as unknown,
        );
      });
    await request(httpServer)
      .get('/partners/me/earnings?page=1&pageSize=10')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body as unknown).toEqual(
          expect.objectContaining({
            data: [
              expect.objectContaining({
                id: entry.id,
                amountFen: 800,
                countedAttendeeCount: 2,
                perAttendeeAmountFen: 400,
              }),
            ],
            meta: expect.objectContaining({ total: 1 }) as unknown,
          }) as unknown,
        );
      });

    const approved = await post(
      `/management/partner-earnings/${entry.id}/approve`,
    )
      .set('Idempotency-Key', 'partner-entry-approve-01')
      .send({ expectedVersion: 1 })
      .expect(200);
    expect((approved.body as Envelope<{ status: string; version: number }>).data)
      .toMatchObject({ status: 'AVAILABLE', version: 2 });

    const replay = await post(
      `/management/partner-earnings/${entry.id}/approve`,
    )
      .set('Idempotency-Key', 'partner-entry-approve-01')
      .send({ expectedVersion: 1 })
      .expect(200);
    expect((replay.body as Envelope<unknown>).data).toEqual(
      (approved.body as Envelope<unknown>).data,
    );
    await post(`/management/partner-earnings/${entry.id}/approve`)
      .set('Idempotency-Key', 'partner-entry-approve-again')
      .send({ expectedVersion: 2 })
      .expect(409);

    await request(httpServer)
      .get('/partners/me/earnings/summary')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          pendingReviewFen: 0,
          availableFen: 800,
        });
      });

    await request(httpServer)
      .get('/partners/me/earnings')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
    await request(httpServer)
      .get('/management/partner-earnings')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(403);
  });

  it('filters partner earning totals and entries by campus-timezone period', async () => {
    await activateDefaultRule();
    const completed = await completeScheduledLesson(
      'partner-period-complete-01',
    );
    const basis = await prisma.partnerEarningBasis.findUniqueOrThrow({
      where: { teachingRecordId: completed.teachingRecordId },
      include: { entries: true },
    });
    await prisma.partnerEarningBasis.update({
      where: { id: basis.id },
      data: { completedAt: new Date('2026-09-01T08:00:00.000Z') },
    });

    await request(httpServer)
      .get(
        '/partners/me/earnings/summary?period=DAY&anchorDate=2026-09-01',
      )
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual({
          estimatedTotalFen: 800,
          pendingReviewFen: 800,
          availableFen: 0,
          reversedNetFen: 0,
          currency: 'CNY',
        });
      });
    await request(httpServer)
      .get(
        '/partners/me/earnings?page=1&pageSize=10&period=DAY&anchorDate=2026-09-01',
      )
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([
          expect.objectContaining({
            amountFen: 800,
          }),
        ]);
        expect(body.meta).toEqual(
          expect.objectContaining({ total: 1 }) as unknown,
        );
      });

    await request(httpServer)
      .get(
        '/partners/me/earnings/summary?period=DAY&anchorDate=2026-09-02',
      )
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.estimatedTotalFen).toBe(0);
      });
    await request(httpServer)
      .get(
        '/partners/me/earnings?page=1&pageSize=10&period=DAY&anchorDate=2026-09-02',
      )
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toEqual([]);
        expect(body.meta.total).toBe(0);
      });
  });

  it('rejects an invalid partner earning period', async () => {
    await request(httpServer)
      .get('/partners/me/earnings?period=YEAR')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(400);
  });

  it('requires a reason when super admin rejects a pending partner earning', async () => {
    await activateDefaultRule();
    const completed = await completeScheduledLesson(
      'partner-reject-complete-01',
    );
    const entry = await prisma.partnerEarningEntry.findFirstOrThrow({
      where: { earningBasis: { teachingRecordId: completed.teachingRecordId } },
    });

    await post(`/management/partner-earnings/${entry.id}/reject`)
      .set('Idempotency-Key', 'partner-entry-reject-empty')
      .send({ expectedVersion: 1, reason: '' })
      .expect(400);
    await post(`/management/partner-earnings/${entry.id}/reject`)
      .set('Idempotency-Key', 'partner-entry-reject-01')
      .send({ expectedVersion: 1, reason: '课次记录需复核' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.data).toMatchObject({
          status: 'REJECTED',
          reviewReason: '课次记录需复核',
          version: 2,
        });
      });
  });
});

function ruleBody(unitPriceFen: number, shareBasisPoints: number) {
  return {
    campusId: ids.eastCampus,
    unitPriceFen,
    shareBasisPoints,
    eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
    countedAttendanceStatuses: ['PRESENT'],
    settlementDelayDays: 0,
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
  };
}

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ code })
    .expect(200);
  return (response.body as Envelope<{ accessToken: string }>).data.accessToken;
}
