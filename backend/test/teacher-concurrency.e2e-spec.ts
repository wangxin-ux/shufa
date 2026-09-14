import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { seedTeacherCore } from '../prisma/seed';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { StaffBindTokenService } from '../src/modules/auth/staff-bind-token.service';

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
  eastTeacherUser: '20000000-0000-4000-8000-000000000001',
  eastStudentA: '40000000-0000-4000-8000-000000000001',
  eastStudentB: '40000000-0000-4000-8000-000000000002',
  eastScheduled: '70000000-0000-4000-8000-000000000002',
  eastPackageA: '80000000-0000-4000-8000-000000000001',
  eastPackageB: '80000000-0000-4000-8000-000000000002',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface CompletionResult {
  lessonSessionId: string;
  lessonVersion: number;
  status: 'COMPLETED';
  teachingRecordId: string;
  consumed: Array<{
    studentId: string;
    mainUnits: number;
    giftUnits: number;
  }>;
}

const bothPresent = [
  { studentId: ids.eastStudentA, status: 'PRESENT' },
  { studentId: ids.eastStudentB, status: 'PRESENT' },
] as const;

describe('teacher completion concurrency and transaction rollback', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let accessToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await resetTargetLesson(prisma);
    await prisma.authIdentity.deleteMany({
      where: { userId: ids.eastTeacherUser },
    });
    await prisma.staffBindToken.deleteMany({
      where: { userId: ids.eastTeacherUser },
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

    await app.get(StaffBindTokenService).issue({
      userId: ids.eastTeacherUser,
      rawToken: 'teacher-concurrency-bind-token-01',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await request(httpServer)
      .post('/auth/staff/bind')
      .set('Idempotency-Key', 'bind-teacher-concurrency-01')
      .send({
        code: 'mock-teacher-concurrency-code',
        bindToken: 'teacher-concurrency-bind-token-01',
      })
      .expect(200);
    accessToken = (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  });

  beforeEach(async () => {
    await resetTargetLesson(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await resetTargetLesson(prisma);
      await prisma.authIdentity.deleteMany({
        where: { userId: ids.eastTeacherUser },
      });
      await prisma.staffBindToken.deleteMany({
        where: { userId: ids.eastTeacherUser },
      });
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  const complete = (idempotencyKey: string) =>
    request(httpServer)
      .post(`/teachers/me/lesson-sessions/${ids.eastScheduled}/complete`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ lessonVersion: 1, attendance: bothPresent });

  it('returns one committed result for two concurrent requests with the same key', async () => {
    const responses = await Promise.all([
      complete('concurrent-same-key-0001'),
      complete('concurrent-same-key-0001'),
    ]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const results = responses.map(
      (response) => (response.body as Envelope<CompletionResult>).data,
    );
    expect(results[1]).toEqual(results[0]);
    await expect(
      prisma.lessonLedgerEntry.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.teachingRecord.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.teacherEarningEntry.count({
        where: { earningBasis: { lessonSessionId: ids.eastScheduled } },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.partnerEarningBasis.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
  });

  it('allows only one concurrent completion with different keys and one version', async () => {
    const responses = await Promise.all([
      complete('concurrent-key-a-000001'),
      complete('concurrent-key-b-000001'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const conflict = responses.find(({ status }) => status === 409);
    expect(conflict?.body as unknown).toEqual(
      expect.objectContaining({ code: 'LESSON_ALREADY_COMPLETED' }) as unknown,
    );
    await expect(
      prisma.lessonLedgerEntry.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.teachingRecord.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.teacherEarningBasis.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.partnerEarningBasis.count({
        where: { lessonSessionId: ids.eastScheduled },
      }),
    ).resolves.toBe(1);
  });

  it('rolls back the first student ledger write when the second student fails', async () => {
    await prisma.coursePackage.update({
      where: { id: ids.eastPackageB },
      data: {
        mainBalanceUnits: 0,
        giftBalanceUnits: 0,
        version: { increment: 1 },
      },
    });

    await complete('rollback-after-ledger-0001')
      .expect(409)
      .expect(({ body }) => {
        expect(body as unknown).toEqual(
          expect.objectContaining({
            code: 'INSUFFICIENT_LESSON_BALANCE',
          }) as unknown,
        );
      });

    const [
      lesson,
      packageA,
      attendance,
      ledger,
      teaching,
      earningBasis,
      partnerEarningBasis,
      idempotency,
    ] = await Promise.all([
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
      prisma.idempotencyRecord.count({
        where: { route: { contains: ids.eastScheduled } },
      }),
    ]);
    expect(lesson).toMatchObject({ status: 'SCHEDULED', version: 1 });
    expect(packageA).toMatchObject({
      mainBalanceUnits: 900,
      giftBalanceUnits: 200,
      version: 1,
    });
    expect({
      attendance,
      ledger,
      teaching,
      earningBasis,
      partnerEarningBasis,
      idempotency,
    }).toEqual({
      attendance: 0,
      ledger: 0,
      teaching: 0,
      earningBasis: 0,
      partnerEarningBasis: 0,
      idempotency: 0,
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
    where: {
      earningBasis: { lessonSessionId: ids.eastScheduled },
    },
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
