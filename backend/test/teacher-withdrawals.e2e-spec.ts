import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
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
  FILE_STORAGE_ROOT: path.join(
    os.tmpdir(),
    'education-mini-program-payout-proof-tests',
  ),
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
  teacherAdminRole: 'd0000000-0000-4000-8000-000000000007',
  eastTeacher: '30000000-0000-4000-8000-000000000001',
  seedPolicy: 'f1000000-0000-4000-8000-000000000001',
  seedEntry: 'f3000000-0000-4000-8000-000000000001',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface WithdrawalView {
  id: string;
  amountFen: number;
  status: string;
  version: number;
  payoutProofFileId: string | null;
}

describe('teacher withdrawals and manual payout', () => {
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
    await resetWithdrawals(prisma);
    await seedTeacherCore(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await resetWithdrawals(prisma);
    }
    await app?.close();
    await prisma?.$disconnect();
  });

  const teacherPost = (url: string) =>
    request(httpServer)
      .post(url)
      .set('Authorization', `Bearer ${teacherToken}`);
  const managementPost = (url: string, token = superAdminToken) =>
    request(httpServer).post(url).set('Authorization', `Bearer ${token}`);

  it('validates amount, freezes oldest available earnings, and cancels once', async () => {
    await teacherPost('/teachers/me/withdrawals')
      .set('Idempotency-Key', 'withdrawal-under-minimum-01')
      .send({ amountFen: 9900 })
      .expect(400)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            code: 'WITHDRAWAL_AMOUNT_INVALID',
          }) as unknown,
        );
      });
    await teacherPost('/teachers/me/withdrawals')
      .set('Idempotency-Key', 'withdrawal-over-balance-01')
      .send({ amountFen: 20000 })
      .expect(409)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            code: 'WITHDRAWAL_BALANCE_INSUFFICIENT',
          }) as unknown,
        );
      });

    const created = await teacherPost('/teachers/me/withdrawals')
      .set('Idempotency-Key', 'withdrawal-create-valid-01')
      .send({ amountFen: 10000 })
      .expect(200);
    const withdrawal = (created.body as Envelope<WithdrawalView>).data;
    expect(withdrawal).toMatchObject({
      amountFen: 10000,
      status: 'SUBMITTED',
      version: 1,
    });
    await expect(
      prisma.withdrawalAllocation.findMany({
        where: { withdrawalId: withdrawal.id },
        select: { earningEntryId: true, amountFen: true },
      }),
    ).resolves.toEqual([{ earningEntryId: ids.seedEntry, amountFen: 10000 }]);

    const replay = await teacherPost('/teachers/me/withdrawals')
      .set('Idempotency-Key', 'withdrawal-create-valid-01')
      .send({ amountFen: 10000 })
      .expect(200);
    expect((replay.body as Envelope<WithdrawalView>).data).toEqual(withdrawal);

    await request(httpServer)
      .get('/teachers/me/earnings/summary')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              availableFen: 0,
              withdrawingFen: 10000,
            }) as unknown,
          }) as unknown,
        );
      });

    await teacherPost(`/teachers/me/withdrawals/${withdrawal.id}/cancel`)
      .set('Idempotency-Key', 'withdrawal-cancel-valid-01')
      .send({ expectedVersion: 1 })
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'CANCELLED',
              version: 2,
            }) as unknown,
          }) as unknown,
        );
      });
    await request(httpServer)
      .get('/teachers/me/earnings/summary')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              availableFen: 10000,
              withdrawingFen: 0,
            }) as unknown,
          }) as unknown,
        );
      });
    await teacherPost('/teachers/me/withdrawals')
      .set('Idempotency-Key', 'withdrawal-second-today-01')
      .send({ amountFen: 10000 })
      .expect(409)
      .expect((response) => {
        expect(response.body as unknown).toEqual(
          expect.objectContaining({
            code: 'WITHDRAWAL_FREQUENCY_EXCEEDED',
          }) as unknown,
        );
      });
  });

  it('denies campus-manager review and forbids self-review', async () => {
    const withdrawal = await createWithdrawal();
    await request(httpServer)
      .get('/management/withdrawals')
      .set('Authorization', `Bearer ${campusManagerToken}`)
      .expect(403);
    await managementPost(
      `/management/withdrawals/${withdrawal.id}/approve`,
      campusManagerToken,
    )
      .set('Idempotency-Key', 'campus-manager-review-denied')
      .send({ expectedVersion: 1 })
      .expect(403);

    await prisma.userRole.create({
      data: {
        id: ids.teacherAdminRole,
        userId: ids.eastTeacherUser,
        roleCode: 'SUPER_ADMIN',
        campusId: null,
      },
    });
    try {
      await managementPost(
        `/management/withdrawals/${withdrawal.id}/approve`,
        teacherToken,
      )
        .set('Idempotency-Key', 'withdrawal-self-review-denied')
        .send({ expectedVersion: 1 })
        .expect(403)
        .expect(({ body }) => {
          expect(body).toEqual(
            expect.objectContaining({
              code: 'WITHDRAWAL_SELF_REVIEW_FORBIDDEN',
            }) as unknown,
          );
        });
    } finally {
      await prisma.userRole.delete({ where: { id: ids.teacherAdminRole } });
    }
  });

  it('supports reject and failed payout states while releasing availability', async () => {
    let withdrawal = await createWithdrawal();
    await managementPost(`/management/withdrawals/${withdrawal.id}/reject`)
      .set('Idempotency-Key', 'withdrawal-reject-valid-01')
      .send({ expectedVersion: 1, reason: '收款信息需更正' })
      .expect(200);
    await expect(
      prisma.withdrawal.findUniqueOrThrow({ where: { id: withdrawal.id } }),
    ).resolves.toMatchObject({ status: 'REJECTED' });
    await resetWithdrawals(prisma);
    await seedTeacherCore(prisma);

    withdrawal = await createWithdrawal();
    await managementPost(`/management/withdrawals/${withdrawal.id}/approve`)
      .set('Idempotency-Key', 'withdrawal-approve-for-fail')
      .send({ expectedVersion: 1 })
      .expect(200);
    await managementPost(`/management/withdrawals/${withdrawal.id}/mark-failed`)
      .set('Idempotency-Key', 'withdrawal-mark-failed-01')
      .send({ expectedVersion: 2, reason: '线下打款失败' })
      .expect(200);
    await request(httpServer)
      .get('/teachers/me/earnings/summary')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({ availableFen: 10000 }) as unknown,
          }) as unknown,
        );
      });
  });

  it('marks paid only after a valid locally stored payout proof', async () => {
    const withdrawal = await createWithdrawal();
    await managementPost(`/management/withdrawals/${withdrawal.id}/approve`)
      .set('Idempotency-Key', 'withdrawal-approve-paying-01')
      .send({ expectedVersion: 1 })
      .expect(200);
    await managementPost(`/management/withdrawals/${withdrawal.id}/mark-paying`)
      .set('Idempotency-Key', 'withdrawal-mark-paying-01')
      .send({ expectedVersion: 2 })
      .expect(200);
    await managementPost(`/management/withdrawals/${withdrawal.id}/mark-paid`)
      .set('Idempotency-Key', 'withdrawal-paid-no-proof-01')
      .send({
        expectedVersion: 3,
        payoutReference: 'OFFLINE-20260830-001',
        payoutProofFileId: 'f9000000-0000-4000-8000-000000000001',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'PAYOUT_PROOF_REQUIRED' }) as unknown,
        );
      });

    const proofResponse = await request(httpServer)
      .post('/management/payout-proofs')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .attach('file', Buffer.from('%PDF-1.4\n% manual payout proof\n'), {
        filename: '人工打款凭证.pdf',
        contentType: 'application/pdf',
      })
      .expect(200);
    const proof = (proofResponse.body as Envelope<{ id: string }>).data;

    await managementPost(`/management/withdrawals/${withdrawal.id}/mark-paid`)
      .set('Idempotency-Key', 'withdrawal-paid-with-proof')
      .send({
        expectedVersion: 3,
        payoutReference: 'OFFLINE-20260830-001',
        payoutProofFileId: proof.id,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'PAID',
              payoutProofFileId: proof.id,
              version: 4,
            }) as unknown,
          }) as unknown,
        );
      });
    await request(httpServer)
      .get('/teachers/me/earnings/summary')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              availableFen: 0,
              withdrawingFen: 0,
            }) as unknown,
          }) as unknown,
        );
      });
  });

  async function createWithdrawal(): Promise<WithdrawalView> {
    const response = await teacherPost('/teachers/me/withdrawals')
      .set('Idempotency-Key', `withdrawal-${Date.now()}-valid`)
      .send({ amountFen: 10000 })
      .expect(200);
    return (response.body as Envelope<WithdrawalView>).data;
  }
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

async function resetWithdrawals(prisma: PrismaClient): Promise<void> {
  await prisma.idempotencyRecord.deleteMany({
    where: {
      OR: [
        { route: { startsWith: '/teachers/me/withdrawals' } },
        { route: { startsWith: '/management/withdrawals' } },
        { route: { startsWith: '/management/teacher-withdrawal-policies' } },
      ],
    },
  });
  await prisma.auditLog.deleteMany({
    where: {
      resourceType: { in: ['Withdrawal', 'TeacherWithdrawalPolicy'] },
    },
  });
  await prisma.withdrawalAllocation.deleteMany({});
  await prisma.withdrawal.deleteMany({});
  await prisma.storedFile.deleteMany({ where: { purpose: 'PAYOUT_PROOF' } });
  await prisma.teacherWithdrawalPolicy.deleteMany({
    where: { id: { not: ids.seedPolicy } },
  });
  await prisma.userRole.deleteMany({ where: { id: ids.teacherAdminRole } });
}
