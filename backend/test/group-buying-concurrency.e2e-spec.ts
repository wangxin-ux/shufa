import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
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
const campusId = '10000000-0000-4000-8000-000000000001';
const leaderStudentId = '40000000-0000-4000-8000-000000000001';

describe('group buying concurrency', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let leaderToken: string;
  const fixtures: ParentFixture[] = [];

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await resetGroupBusiness(prisma);
    await seedTeacherCore(prisma);
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    leaderToken = await login(server, 'mock-demo-east-parent');
  });

  afterAll(async () => {
    await resetGroupBusiness(prisma);
    await removeFixtures(prisma, fixtures);
    await app?.close();
    await prisma?.$disconnect();
  });

  it('allows one final-slot winner and applies concurrent duplicate payment once', async () => {
    for (const label of ['甲', '乙', '丙']) {
      fixtures.push(await createParentFixture(prisma, label));
    }
    const tokens = await Promise.all(
      fixtures.map(({ loginCode }) => login(server, loginCode)),
    );
    const campaign = await prisma.groupCampaign.findUniqueOrThrow({
      where: { code: 'GROUP-1990-DEMO' },
    });
    const leader = await post(
      server,
      leaderToken,
      '/parents/me/group-teams',
      'group-concurrency-create',
      { campaignId: campaign.id, studentId: leaderStudentId },
    );
    expect(leader.status).toBe(200);
    const teamId = leader.body.data.team.id as string;
    const memberId = leader.body.data.order.memberId as string;
    const outTradeNo = leader.body.data.prepay.outTradeNo as string;

    const reserved = await post(
      server,
      tokens[0],
      `/parents/me/group-teams/${teamId}/members`,
      'group-concurrency-reserve-two',
      { studentId: fixtures[0].studentId },
    );
    expect(reserved.status).toBe(200);

    const contenders = await Promise.all([
      post(
        server,
        tokens[1],
        `/parents/me/group-teams/${teamId}/members`,
        'group-concurrency-contender-b',
        { studentId: fixtures[1].studentId },
      ),
      post(
        server,
        tokens[2],
        `/parents/me/group-teams/${teamId}/members`,
        'group-concurrency-contender-c',
        { studentId: fixtures[2].studentId },
      ),
    ]);
    expect(contenders.map(({ status }) => status).sort()).toEqual([200, 409]);
    expect(
      await prisma.groupMember.count({ where: { teamId } }),
    ).toBe(3);

    const confirmations = await Promise.all([
      post(
        server,
        leaderToken,
        `/parents/me/group-members/${memberId}/mock-payment-confirmation`,
        'group-concurrency-confirm-a',
        { outTradeNo },
      ),
      post(
        server,
        leaderToken,
        `/parents/me/group-members/${memberId}/mock-payment-confirmation`,
        'group-concurrency-confirm-b',
        { outTradeNo },
      ),
    ]);
    expect(confirmations.map(({ status }) => status)).toEqual([200, 200]);
    expect(
      await prisma.paymentTransaction.count({ where: { outTradeNo } }),
    ).toBe(1);
    expect(
      await prisma.groupTeam.findUniqueOrThrow({ where: { id: teamId } }),
    ).toMatchObject({ paidMemberCount: 1, status: 'OPEN' });
  });
});

interface ParentFixture {
  userId: string;
  studentId: string;
  loginCode: string;
}

async function post(
  server: Server,
  token: string,
  path: string,
  idempotencyKey: string,
  body: object,
) {
  return request(server)
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server).post('/auth/login').send({ code });
  return response.body.data.accessToken as string;
}

async function createParentFixture(
  prisma: PrismaClient,
  label: string,
): Promise<ParentFixture> {
  const userId = randomUUID();
  const studentId = randomUUID();
  const loginCode = `mock-group-concurrency-${randomUUID()}`;
  await prisma.user.create({
    data: {
      id: userId,
      displayName: `并发家长${label}`,
      authIdentities: { create: { provider: 'MOCK', subject: loginCode } },
      roles: { create: { roleCode: 'PARENT', campusId } },
    },
  });
  await prisma.student.create({
    data: { id: studentId, campusId, displayName: `并发学员${label}` },
  });
  await prisma.parentStudentBinding.create({
    data: { parentUserId: userId, studentId, campusId, isPrimary: true },
  });
  return { userId, studentId, loginCode };
}

async function resetGroupBusiness(prisma: PrismaClient): Promise<void> {
  const orders = await prisma.enrollmentOrder.findMany({
    where: { orderNo: { startsWith: 'GROUP-' } },
    select: { id: true },
  });
  const orderIds = orders.map(({ id }) => id);
  if (orderIds.length > 0) {
    await prisma.lessonLedgerEntry.deleteMany({
      where: { coursePackage: { sourceOrderId: { in: orderIds } } },
    });
    await prisma.coursePackage.deleteMany({
      where: { sourceOrderId: { in: orderIds } },
    });
  }
  await prisma.paymentTransaction.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.groupTeam.deleteMany();
  if (orderIds.length > 0) {
    await prisma.enrollmentOrder.deleteMany({ where: { id: { in: orderIds } } });
  }
  await prisma.idempotencyRecord.deleteMany({
    where: { route: { startsWith: '/parents/me/group-' } },
  });
}

async function removeFixtures(
  prisma: PrismaClient,
  fixtures: ParentFixture[],
): Promise<void> {
  const userIds = fixtures.map(({ userId }) => userId);
  const studentIds = fixtures.map(({ studentId }) => studentId);
  if (userIds.length === 0) return;
  await prisma.parentStudentBinding.deleteMany({
    where: { parentUserId: { in: userIds } },
  });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
