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
  teacherProfile: '30000000-0000-4000-8000-000000000001',
  policy: 'f1000000-0000-4000-8000-000000000001',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

describe('teacher withdrawal concurrency', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let accessToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await reset(prisma);

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
    const login = await request(httpServer)
      .post('/auth/login')
      .send({ code: 'mock-demo-east-teacher' })
      .expect(200);
    accessToken = (login.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  });

  beforeEach(async () => reset(prisma));

  afterAll(async () => {
    if (prisma) {
      await reset(prisma);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  it('commits exactly one request when concurrent totals exceed availability', async () => {
    const create = (key: string) =>
      request(httpServer)
        .post('/teachers/me/withdrawals')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Idempotency-Key', key)
        .send({ amountFen: 10000 });

    const responses = await Promise.all([
      create('withdrawal-concurrent-a-01'),
      create('withdrawal-concurrent-b-01'),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      responses.find(({ status }) => status === 409)?.body as unknown,
    ).toEqual(
      expect.objectContaining({
        code: 'WITHDRAWAL_BALANCE_INSUFFICIENT',
      }) as unknown,
    );

    await expect(
      prisma.withdrawal.count({
        where: { teacherProfileId: ids.teacherProfile },
      }),
    ).resolves.toBe(1);
    const allocations = await prisma.withdrawalAllocation.aggregate({
      where: { withdrawal: { teacherProfileId: ids.teacherProfile } },
      _sum: { amountFen: true },
    });
    expect(allocations._sum.amountFen).toBe(10000);
  });
});

async function reset(prisma: PrismaClient): Promise<void> {
  await prisma.idempotencyRecord.deleteMany({
    where: { route: { startsWith: '/teachers/me/withdrawals' } },
  });
  await prisma.auditLog.deleteMany({
    where: { resourceType: 'Withdrawal' },
  });
  await prisma.withdrawalAllocation.deleteMany({});
  await prisma.withdrawal.deleteMany({});
  await seedTeacherCore(prisma);
  await prisma.teacherWithdrawalPolicy.update({
    where: { id: ids.policy },
    data: { dailyRequestLimit: 2 },
  });
}
