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

const ids = {
  eastStudent: '40000000-0000-4000-8000-000000000001',
  westStudent: '40000000-0000-4000-8000-000000000003',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

describe('parent group buying', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let parentToken: string;
  let teacherToken: string;

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
    parentToken = await login(server, 'mock-demo-east-parent');
    teacherToken = await login(server, 'mock-demo-east-teacher');
  });

  beforeEach(async () => {
    await resetGroupBusiness(prisma);
    await seedTeacherCore(prisma);
  });

  afterAll(async () => {
    await resetGroupBusiness(prisma);
    await app?.close();
    await prisma?.$disconnect();
  });

  const parentGet = (path: string) =>
    request(server)
      .get(path)
      .set('Authorization', `Bearer ${parentToken}`);
  const parentPost = (path: string, idempotencyKey: string) =>
    request(server)
      .post(path)
      .set('Authorization', `Bearer ${parentToken}`)
      .set('Idempotency-Key', idempotencyKey);

  it('lists only the parent campus campaigns and rejects other roles', async () => {
    const response = await parentGet(
      `/parents/me/group-campaigns?page=1&pageSize=20&studentId=${ids.eastStudent}`,
    ).expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            code: 'GROUP-1990-DEMO',
            priceFen: 1990,
            boundStudents: [
              expect.objectContaining({ id: ids.eastStudent, name: '陈晨' }),
            ],
            customerService: expect.objectContaining({
              name: '启明课程顾问',
              phone: '0731-88886666',
            }),
          }),
        ]),
        meta: expect.objectContaining({ page: 1, pageSize: 20, total: 1 }),
      }),
    );

    await request(server)
      .get('/parents/me/group-campaigns')
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(403);
  });

  it('opens a team, confirms one mock payment idempotently, and lists only its own order', async () => {
    const campaign = await prisma.groupCampaign.findUniqueOrThrow({
      where: { code: 'GROUP-1990-DEMO' },
    });

    await parentPost('/parents/me/group-teams', 'group-cross-campus-1')
      .send({ campaignId: campaign.id, studentId: ids.westStudent })
      .expect(403);

    const createResponse = await parentPost(
      '/parents/me/group-teams',
      'group-create-parent-1',
    )
      .send({ campaignId: campaign.id, studentId: ids.eastStudent })
      .expect(200);
    const created = (
      createResponse.body as Envelope<{
        team: { id: string; paidMemberCount: number; remainingSlots: number };
        order: {
          id: string;
          memberId: string;
          memberStatus: string;
          orderStatus: string;
        };
        prepay: { mode: string; outTradeNo: string };
      }>
    ).data;
    expect(created).toMatchObject({
      team: { paidMemberCount: 0, remainingSlots: 2 },
      order: {
        memberStatus: 'PENDING_PAYMENT',
        orderStatus: 'AWAITING_PAYMENT',
      },
      prepay: { mode: 'MOCK' },
    });

    const replay = await parentPost(
      '/parents/me/group-teams',
      'group-create-parent-1',
    )
      .send({ campaignId: campaign.id, studentId: ids.eastStudent })
      .expect(200);
    expect(replay.body.data).toMatchObject({
      team: { id: created.team.id },
      order: { id: created.order.id, memberId: created.order.memberId },
      prepay: { outTradeNo: created.prepay.outTradeNo },
    });

    const confirmation = await parentPost(
      `/parents/me/group-members/${created.order.memberId}/mock-payment-confirmation`,
      'group-confirm-parent-1',
    )
      .send({ outTradeNo: created.prepay.outTradeNo })
      .expect(200);
    expect(confirmation.body.data).toMatchObject({
      id: created.order.id,
      memberStatus: 'PAID',
      orderStatus: 'PAID',
      teamStatus: 'OPEN',
      paidMemberCount: 1,
    });

    await parentPost(
      `/parents/me/group-members/${created.order.memberId}/mock-payment-confirmation`,
      'group-confirm-parent-1',
    )
      .send({ outTradeNo: created.prepay.outTradeNo })
      .expect(200);

    expect(
      await prisma.paymentTransaction.count({
        where: { outTradeNo: created.prepay.outTradeNo },
      }),
    ).toBe(1);
    expect(
      await prisma.coursePackage.count({
        where: { sourceOrderId: created.order.id },
      }),
    ).toBe(0);

    const orders = await parentGet('/parents/me/group-orders').expect(200);
    expect(orders.body.data).toEqual([
      expect.objectContaining({
        id: created.order.id,
        studentId: ids.eastStudent,
        memberStatus: 'PAID',
      }),
    ]);
  });

  it('settles the three-person tier once and grants every paid member five lessons', async () => {
    const campaign = await prisma.groupCampaign.findUniqueOrThrow({
      where: { code: 'GROUP-1990-DEMO' },
    });
    const extraParents = await Promise.all([
      createParentFixture(prisma, '拼团家长乙', '拼团学员乙'),
      createParentFixture(prisma, '拼团家长丙', '拼团学员丙'),
    ]);

    try {
      const extraTokens = await Promise.all(
        extraParents.map(({ loginCode }) => login(server, loginCode)),
      );
      const leader = await parentPost(
        '/parents/me/group-teams',
        'group-tier3-leader-create',
      )
        .send({ campaignId: campaign.id, studentId: ids.eastStudent })
        .expect(200);
      const leaderData = leader.body.data as {
        team: { id: string };
        order: { memberId: string };
        prepay: { outTradeNo: string };
      };
      await parentPost(
        `/parents/me/group-members/${leaderData.order.memberId}/mock-payment-confirmation`,
        'group-tier3-leader-pay',
      )
        .send({ outTradeNo: leaderData.prepay.outTradeNo })
        .expect(200);

      const joined: Array<{
        token: string;
        memberId: string;
        outTradeNo: string;
      }> = [];
      for (const [index, fixture] of extraParents.entries()) {
        const response = await request(server)
          .post(
            `/parents/me/group-teams/${leaderData.team.id}/members`,
          )
          .set('Authorization', `Bearer ${extraTokens[index]}`)
          .set('Idempotency-Key', `group-tier3-join-${index + 2}`)
          .send({ studentId: fixture.studentId })
          .expect(200);
        joined.push({
          token: extraTokens[index],
          memberId: response.body.data.order.memberId as string,
          outTradeNo: response.body.data.prepay.outTradeNo as string,
        });
      }

      await request(server)
        .post(
          `/parents/me/group-members/${joined[0].memberId}/mock-payment-confirmation`,
        )
        .set('Authorization', `Bearer ${joined[0].token}`)
        .set('Idempotency-Key', 'group-tier3-member2-pay')
        .send({ outTradeNo: joined[0].outTradeNo })
        .expect(200);
      const finalPayment = await request(server)
        .post(
          `/parents/me/group-members/${joined[1].memberId}/mock-payment-confirmation`,
        )
        .set('Authorization', `Bearer ${joined[1].token}`)
        .set('Idempotency-Key', 'group-tier3-member3-pay')
        .send({ outTradeNo: joined[1].outTradeNo })
        .expect(200);
      expect(finalPayment.body.data).toMatchObject({
        memberStatus: 'SETTLED',
        orderStatus: 'EFFECTIVE',
        teamStatus: 'SETTLED',
        paidMemberCount: 3,
        grantedMainUnits: 100,
        grantedGiftUnits: 400,
      });

      await request(server)
        .post(
          `/parents/me/group-members/${joined[1].memberId}/mock-payment-confirmation`,
        )
        .set('Authorization', `Bearer ${joined[1].token}`)
        .set('Idempotency-Key', 'group-tier3-member3-pay-retry')
        .send({ outTradeNo: joined[1].outTradeNo })
        .expect(200);

      const team = await prisma.groupTeam.findUniqueOrThrow({
        where: { id: leaderData.team.id },
        include: {
          members: {
            include: {
              enrollmentOrder: { include: { coursePackage: true } },
            },
          },
        },
      });
      expect(team).toMatchObject({
        status: 'SETTLED',
        paidMemberCount: 3,
        finalTier: 3,
      });
      expect(team.members).toHaveLength(3);
      expect(
        team.members.every(
          (member) =>
            member.status === 'SETTLED' &&
            member.grantedMainUnits === 100 &&
            member.grantedGiftUnits === 400 &&
            member.enrollmentOrder.status === 'EFFECTIVE' &&
            member.enrollmentOrder.coursePackage?.mainBalanceUnits === 100 &&
            member.enrollmentOrder.coursePackage?.giftBalanceUnits === 400,
        ),
      ).toBe(true);
      const orderIds = team.members.map(({ enrollmentOrderId }) =>
        enrollmentOrderId,
      );
      expect(
        await prisma.coursePackage.count({
          where: { sourceOrderId: { in: orderIds } },
        }),
      ).toBe(3);
      expect(
        await prisma.lessonLedgerEntry.count({
          where: { coursePackage: { sourceOrderId: { in: orderIds } } },
        }),
      ).toBe(6);
    } finally {
      await resetGroupBusiness(prisma);
      await removeParentFixtures(prisma, extraParents);
    }
  });

  it('accepts a verified payment notification once without a bearer token', async () => {
    const campaign = await prisma.groupCampaign.findUniqueOrThrow({
      where: { code: 'GROUP-1990-DEMO' },
    });
    const created = await parentPost(
      '/parents/me/group-teams',
      'group-notification-create',
    )
      .send({ campaignId: campaign.id, studentId: ids.eastStudent })
      .expect(200);
    const memberId = created.body.data.order.memberId as string;
    const outTradeNo = created.body.data.prepay.outTradeNo as string;
    const payload = {
      outTradeNo,
      providerTradeNo: 'MOCK-NOTIFY-0001',
      amountFen: 1990,
      status: 'SUCCEEDED',
    };

    await request(server)
      .post('/payments/wechat/notifications')
      .send(payload)
      .expect(200);
    await request(server)
      .post('/payments/wechat/notifications')
      .send(payload)
      .expect(200);

    expect(
      await prisma.groupMember.findUniqueOrThrow({ where: { id: memberId } }),
    ).toMatchObject({ status: 'PAID', version: 2 });
    expect(
      await prisma.paymentTransaction.count({ where: { outTradeNo } }),
    ).toBe(1);
  });

  it('keeps a failed payment transaction and creates a new prepay transaction on retry', async () => {
    const campaign = await prisma.groupCampaign.findUniqueOrThrow({
      where: { code: 'GROUP-1990-DEMO' },
    });
    const created = await parentPost(
      '/parents/me/group-teams',
      'group-failed-payment-create',
    )
      .send({ campaignId: campaign.id, studentId: ids.eastStudent })
      .expect(200);
    const memberId = created.body.data.order.memberId as string;
    const originalTradeNo = created.body.data.prepay.outTradeNo as string;

    await request(server)
      .post('/payments/wechat/notifications')
      .send({
        outTradeNo: originalTradeNo,
        providerTradeNo: 'MOCK-FAILED-0001',
        amountFen: 1990,
        status: 'FAILED',
      })
      .expect(200);

    const retried = await parentPost(
      `/parents/me/group-members/${memberId}/prepay`,
      'group-failed-payment-retry',
    )
      .send({ expectedVersion: 1 })
      .expect(200);

    expect(retried.body.data.outTradeNo).not.toBe(originalTradeNo);
    expect(
      await prisma.paymentTransaction.findMany({
        where: { groupMemberId: memberId, type: 'PAYMENT' },
        orderBy: { createdAt: 'asc' },
        select: { status: true, outTradeNo: true },
      }),
    ).toEqual([
      { status: 'FAILED', outTradeNo: originalTradeNo },
      { status: 'PENDING', outTradeNo: retried.body.data.outTradeNo },
    ]);
  });
});

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server).post('/auth/login').send({ code });
  return (response.body as Envelope<{ accessToken: string }>).data.accessToken;
}

async function resetGroupBusiness(prisma: PrismaClient): Promise<void> {
  const groupOrders = await prisma.enrollmentOrder.findMany({
    where: { orderNo: { startsWith: 'GROUP-' } },
    select: { id: true },
  });
  const orderIds = groupOrders.map(({ id }) => id);

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

interface ParentFixture {
  userId: string;
  studentId: string;
  loginCode: string;
}

async function createParentFixture(
  prisma: PrismaClient,
  parentName: string,
  studentName: string,
): Promise<ParentFixture> {
  const userId = randomUUID();
  const studentId = randomUUID();
  const loginCode = `mock-group-${randomUUID()}`;
  const campusId = '10000000-0000-4000-8000-000000000001';
  await prisma.user.create({
    data: {
      id: userId,
      displayName: parentName,
      authIdentities: {
        create: { provider: 'MOCK', subject: loginCode },
      },
      roles: {
        create: { roleCode: 'PARENT', campusId },
      },
    },
  });
  await prisma.student.create({
    data: { id: studentId, campusId, displayName: studentName },
  });
  await prisma.parentStudentBinding.create({
    data: { campusId, parentUserId: userId, studentId, isPrimary: true },
  });
  return { userId, studentId, loginCode };
}

async function removeParentFixtures(
  prisma: PrismaClient,
  fixtures: ParentFixture[],
): Promise<void> {
  const userIds = fixtures.map(({ userId }) => userId);
  const studentIds = fixtures.map(({ studentId }) => studentId);
  await prisma.parentStudentBinding.deleteMany({
    where: { parentUserId: { in: userIds } },
  });
  await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.authIdentity.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
