import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PartnerEarningRecordingService } from '../src/modules/partner-earning/partner-earning-recording.service';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

if (!new URL(TEST_DATABASE_URL).pathname.includes('education_app_test')) {
  throw new Error('Partner earning concurrency tests must use education_app_test');
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
  eastPackageA: '80000000-0000-4000-8000-000000000001',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

jest.setTimeout(30_000);

describe('partner earning concurrency and transaction rollback', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let superAdminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await resetTargetLesson(prisma);

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
    teacherToken = await login(httpServer, 'mock-demo-east-teacher');
  });

  beforeEach(async () => {
    await resetTargetLesson(prisma);
    await prisma.idempotencyRecord.deleteMany({
      where: { route: { startsWith: '/management/partner-' } },
    });
    await prisma.partnerEarningEntry.deleteMany({});
    await prisma.partnerEarningBasis.deleteMany({});
    await prisma.partnerEarningRule.deleteMany({});
    await activateDefaultRule();
  });

  afterAll(async () => {
    if (prisma) {
      await resetTargetLesson(prisma);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  const complete = (idempotencyKey: string) =>
    request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({
        lessonVersion: 1,
        attendance: [
          { studentId: ids.eastStudentA, status: 'PRESENT' },
          { studentId: ids.eastStudentB, status: 'PRESENT' },
        ],
      });

  const reverse = (idempotencyKey: string) =>
    request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/reverse`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ lessonVersion: 2, reason: '并发撤销验证' });

  const activateDefaultRule = async () => {
    const created = await request(httpServer)
      .post('/management/partner-earning-rules')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Idempotency-Key', 'partner-concurrency-rule-create')
      .send({
        campusId: ids.eastCampus,
        unitPriceFen: 1000,
        shareBasisPoints: 4000,
        eligibleLessonKinds: ['REGULAR', 'MAKEUP'],
        countedAttendanceStatuses: ['PRESENT'],
        settlementDelayDays: 0,
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
      })
      .expect(200);
    const rule = (
      created.body as Envelope<{ id: string; version: number }>
    ).data;
    await request(httpServer)
      .post(`/management/partner-earning-rules/${rule.id}/activate`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Idempotency-Key', 'partner-concurrency-rule-activate')
      .send({ expectedVersion: rule.version })
      .expect(200);
  };

  it('records one partner accrual when completion requests race', async () => {
    const responses = await Promise.all([
      complete('partner-concurrent-complete-a'),
      complete('partner-concurrent-complete-b'),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    await expect(
      prisma.partnerEarningBasis.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.partnerEarningEntry.count({
        where: {
          earningBasis: { lessonSessionId: ids.eastScheduled },
          entryType: 'ACCRUAL',
        },
      }),
    ).resolves.toBe(1);
  });

  it('commits only one terminal decision when reviewers race', async () => {
    await complete('partner-review-race-complete').expect(200);
    const entry = await prisma.partnerEarningEntry.findFirstOrThrow({
      where: { earningBasis: { lessonSessionId: ids.eastScheduled } },
    });
    const approve = request(httpServer)
      .post(`/management/partner-earnings/${entry.id}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Idempotency-Key', 'partner-review-race-approve')
      .send({ expectedVersion: 1 });
    const reject = request(httpServer)
      .post(`/management/partner-earnings/${entry.id}/reject`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('Idempotency-Key', 'partner-review-race-reject')
      .send({ expectedVersion: 1, reason: '并发复核驳回' });

    const responses = await Promise.all([approve, reject]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const persisted = await prisma.partnerEarningEntry.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(['AVAILABLE', 'REJECTED']).toContain(persisted.status);
    await expect(
      prisma.auditLog.count({
        where: {
          resourceType: 'PartnerEarningEntry',
          resourceId: entry.id,
          action: { in: ['PARTNER_EARNING_APPROVE', 'PARTNER_EARNING_REJECT'] },
        },
      }),
    ).resolves.toBe(1);
  });

  it('adds one reversal when reversal requests race', async () => {
    await complete('partner-reverse-race-complete').expect(200);

    const responses = await Promise.all([
      reverse('partner-reverse-race-a'),
      reverse('partner-reverse-race-b'),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    await expect(
      prisma.partnerEarningEntry.count({
        where: {
          earningBasis: { lessonSessionId: ids.eastScheduled },
          entryType: 'REVERSAL',
        },
      }),
    ).resolves.toBe(1);
    const entries = await prisma.partnerEarningEntry.findMany({
      where: { earningBasis: { lessonSessionId: ids.eastScheduled } },
      orderBy: { amountFen: 'desc' },
      select: { amountFen: true, status: true },
    });
    expect(entries).toEqual([
      { amountFen: 800, status: 'REVERSED' },
      { amountFen: -800, status: 'REVERSED' },
    ]);
  });

  it('rolls back the complete lesson when partner recording fails', async () => {
    const recordingService = app.get(PartnerEarningRecordingService);
    const failure = jest
      .spyOn(recordingService, 'recordCompletedLesson')
      .mockRejectedValueOnce(new Error('forced partner earning failure'));

    await complete('partner-recording-rollback').expect(500);
    failure.mockRestore();

    const [lesson, coursePackage, attendance, ledger, teaching, teacher, partner] =
      await Promise.all([
        prisma.lessonSession.findUniqueOrThrow({
          where: { id: ids.eastScheduled },
        }),
        prisma.coursePackage.findUniqueOrThrow({
          where: { id: ids.eastPackageA },
        }),
        prisma.attendanceRecord.count({
          where: { lessonSessionId: ids.eastScheduled },
        }),
        prisma.lessonLedgerEntry.count({
          where: { lessonSessionId: ids.eastScheduled },
        }),
        prisma.teachingRecord.count({
          where: { lessonSessionId: ids.eastScheduled },
        }),
        prisma.teacherEarningBasis.count({
          where: { lessonSessionId: ids.eastScheduled },
        }),
        prisma.partnerEarningBasis.count({
          where: { lessonSessionId: ids.eastScheduled },
        }),
      ]);
    expect(lesson).toMatchObject({ status: 'SCHEDULED', version: 1 });
    expect(coursePackage).toMatchObject({
      mainBalanceUnits: 900,
      giftBalanceUnits: 200,
      version: 1,
    });
    expect({ attendance, ledger, teaching, teacher, partner }).toEqual({
      attendance: 0,
      ledger: 0,
      teaching: 0,
      teacher: 0,
      partner: 0,
    });
  });
});

async function resetTargetLesson(prisma: PrismaClient): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { resourceId: ids.eastScheduled },
  });
  await prisma.idempotencyRecord.deleteMany({
    where: { route: { contains: ids.eastScheduled } },
  });
  await prisma.studentFeedbackImage.deleteMany({
    where: { feedback: { lessonSessionId: ids.eastScheduled } },
  });
  await prisma.studentFeedback.deleteMany({
    where: { lessonSessionId: ids.eastScheduled },
  });
  await prisma.lessonLedgerEntry.deleteMany({
    where: {
      lessonSessionId: ids.eastScheduled,
      reversalOfId: { not: null },
    },
  });
  await prisma.lessonLedgerEntry.deleteMany({
    where: { lessonSessionId: ids.eastScheduled },
  });
  await prisma.teacherEarningEntry.deleteMany({
    where: { earningBasis: { lessonSessionId: ids.eastScheduled } },
  });
  await prisma.teacherEarningBasis.deleteMany({
    where: { lessonSessionId: ids.eastScheduled },
  });
  await prisma.partnerEarningEntry.deleteMany({
    where: { earningBasis: { lessonSessionId: ids.eastScheduled } },
  });
  await prisma.partnerEarningBasis.deleteMany({
    where: { lessonSessionId: ids.eastScheduled },
  });
  await prisma.teachingRecord.deleteMany({
    where: { lessonSessionId: ids.eastScheduled },
  });
  await prisma.attendanceRecord.deleteMany({
    where: { lessonSessionId: ids.eastScheduled },
  });
  await seedTeacherCore(prisma);
}

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ code })
    .expect(200);
  return (response.body as Envelope<{ accessToken: string }>).data.accessToken;
}
