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

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface PageEnvelope<T> extends Envelope<T[]> {
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

describe('management group campaigns', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let superToken: string;
  let managerToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await cleanup(prisma);
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
    superToken = await login(server, 'mock-demo-super-admin');
    managerToken = await login(server, 'mock-demo-east-campus-manager');
  });

  beforeEach(async () => {
    await cleanup(prisma);
    await seedTeacherCore(prisma);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await app?.close();
    await prisma?.$disconnect();
  });

  const management = (
    method: 'get' | 'post' | 'patch',
    path: string,
    token = superToken,
    idempotencyKey?: string,
  ) => {
    const call = request(server)
      [method](path)
      .set('Authorization', `Bearer ${token}`);
    return idempotencyKey ? call.set('Idempotency-Key', idempotencyKey) : call;
  };

  it('lets only super admins create, edit, activate, and list campaigns', async () => {
    const campus = await prisma.campus.findUniqueOrThrow({
      where: { code: 'campus-demo-east' },
    });
    const product = await prisma.courseProduct.findFirstOrThrow({
      where: { campusId: campus.id, status: 'ACTIVE' },
    });
    const payload = {
      campusId: campus.id,
      courseProductId: product.id,
      title: '秋季创意拼团体验课',
      description: '三人拼团，线下到校上课。',
      priceFen: 1990,
      startsAt: '2026-09-05T00:00:00+08:00',
      endsAt: '2026-10-05T23:59:59+08:00',
    };

    await management(
      'post',
      '/management/group-campaigns',
      managerToken,
      'group-mgmt-manager-denied',
    )
      .send(payload)
      .expect(403);

    const createdResponse = await management(
      'post',
      '/management/group-campaigns',
      superToken,
      'group-mgmt-create-1',
    )
      .send(payload)
      .expect(200);
    const created = (
      createdResponse.body as Envelope<{
        id: string;
        code: string;
        title: string;
        status: string;
        version: number;
      }>
    ).data;
    expect(created).toMatchObject({
      title: payload.title,
      status: 'DRAFT',
      version: 1,
    });

    const replay = await management(
      'post',
      '/management/group-campaigns',
      superToken,
      'group-mgmt-create-1',
    )
      .send(payload)
      .expect(200);
    expect(replay.body.data.id).toBe(created.id);

    const updated = await management(
      'patch',
      `/management/group-campaigns/${created.id}`,
      superToken,
      'group-mgmt-update-1',
    )
      .send({
        ...payload,
        title: '秋季创意拼团体验营',
        expectedVersion: 1,
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      id: created.id,
      title: '秋季创意拼团体验营',
      status: 'DRAFT',
      version: 2,
    });

    const activated = await management(
      'post',
      `/management/group-campaigns/${created.id}/activate`,
      superToken,
      'group-mgmt-activate-1',
    )
      .send({ expectedVersion: 2 })
      .expect(200);
    expect(activated.body.data).toMatchObject({
      id: created.id,
      status: 'ACTIVE',
      version: 3,
    });

    const list = await management(
      'get',
      `/management/group-campaigns?page=1&pageSize=20&campusId=${campus.id}`,
    ).expect(200);
    expect(list.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: created.id, status: 'ACTIVE' }),
      ]),
    );
    expect(
      await prisma.auditLog.count({
        where: { resourceId: created.id, resourceType: 'GroupCampaign' },
      }),
    ).toBe(3);
  });

  it('lists active course products independently of campaign history', async () => {
    const campus = await prisma.campus.findUniqueOrThrow({
      where: { code: 'campus-demo-east' },
    });
    const product = await prisma.courseProduct.findFirstOrThrow({
      where: { campusId: campus.id, status: 'ACTIVE' },
    });
    await prisma.groupCampaign.deleteMany();

    const response = await management(
      'get',
      `/management/course-products?page=1&pageSize=20&campusId=${campus.id}&status=ACTIVE`,
    ).expect(200);

    const body = response.body as PageEnvelope<{
      id: string;
      campusId: string;
      campusName: string;
      name: string;
      status: string;
    }>;
    expect(body).toMatchObject({
      data: [
        expect.objectContaining({
          id: product.id,
          campusId: campus.id,
          campusName: campus.name,
          name: product.name,
          status: 'ACTIVE',
        }),
      ],
      meta: expect.objectContaining({ page: 1, pageSize: 20 }),
    });
    await management(
      'get',
      `/management/course-products?page=1&pageSize=20&campusId=${campus.id}`,
      managerToken,
    ).expect(403);
  });

  it('lets only super admins append, reorder, and detach campaign posters', async () => {
    const campaign = await prisma.groupCampaign.findUniqueOrThrow({
      where: { code: 'GROUP-1990-DEMO' },
    });
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('poster-image'),
    ]);

    await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters`,
      managerToken,
      'group-poster-manager-denied',
    )
      .field('expectedVersion', String(campaign.version))
      .attach('file', png, { filename: 'poster.png', contentType: 'image/png' })
      .expect(403);

    const invalid = await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters`,
      superToken,
      'group-poster-invalid',
    )
      .field('expectedVersion', String(campaign.version))
      .attach('file', Buffer.from('not-an-image'), {
        filename: 'poster.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(invalid.body.code).toBe('GROUP_CAMPAIGN_POSTER_INVALID');

    const first = await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters`,
      superToken,
      'group-poster-upload-first',
    )
      .field('expectedVersion', String(campaign.version))
      .attach('file', png, { filename: 'first.png', contentType: 'image/png' })
      .expect(200);
    expect(first.body.data).toMatchObject({
      id: campaign.id,
      version: campaign.version + 1,
      posterImages: [
        expect.objectContaining({ sortOrder: 0, mimeType: 'image/png' }),
      ],
    });

    const replay = await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters`,
      superToken,
      'group-poster-upload-first',
    )
      .field('expectedVersion', String(campaign.version))
      .attach('file', png, { filename: 'first.png', contentType: 'image/png' })
      .expect(200);
    expect(replay.body.data.posterImages).toHaveLength(1);

    const second = await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters`,
      superToken,
      'group-poster-upload-second',
    )
      .field('expectedVersion', String(campaign.version + 1))
      .attach('file', png, { filename: 'second.png', contentType: 'image/png' })
      .expect(200);
    const [firstPoster, secondPoster] = second.body.data.posterImages as Array<{
      id: string;
      storedFileId: string;
      accessUrl: string;
    }>;

    const stale = await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters/reorder`,
      superToken,
      'group-poster-reorder-stale',
    )
      .send({
        expectedVersion: campaign.version + 1,
        posterIds: [secondPoster.id, firstPoster.id],
      })
      .expect(409);
    expect(stale.body.code).toBe('CONFLICT');

    const reordered = await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters/reorder`,
      superToken,
      'group-poster-reorder',
    )
      .send({
        expectedVersion: campaign.version + 2,
        posterIds: [secondPoster.id, firstPoster.id],
      })
      .expect(200);
    expect(
      reordered.body.data.posterImages.map(({ id }: { id: string }) => id),
    ).toEqual([secondPoster.id, firstPoster.id]);

    const media = await request(server).get(firstPoster.accessUrl).expect(200);
    expect(media.headers['content-type']).toMatch(/^image\/png/);
    expect(Buffer.from(media.body as Buffer)).toEqual(png);

    const detached = await management(
      'post',
      `/management/group-campaigns/${campaign.id}/posters/${firstPoster.id}/detach`,
      superToken,
      'group-poster-detach',
    )
      .send({ expectedVersion: campaign.version + 3 })
      .expect(200);
    expect(detached.body.data.posterImages).toEqual([
      expect.objectContaining({ id: secondPoster.id, sortOrder: 0 }),
    ]);
    expect(
      await prisma.storedFile.findUnique({
        where: { id: firstPoster.storedFileId },
      }),
    ).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: campaign.id,
          action: {
            in: [
              'GROUP_CAMPAIGN_POSTER_UPLOADED',
              'GROUP_CAMPAIGN_POSTERS_REORDERED',
              'GROUP_CAMPAIGN_POSTER_DETACHED',
            ],
          },
        },
      }),
    ).toBe(4);
  });

  it('closes an active campaign and settles a one-person paid team', async () => {
    const fixture = await createPaidGroupMember(prisma, 'close-one');
    const response = await management(
      'post',
      `/management/group-campaigns/${fixture.campaignId}/close`,
      superToken,
      'group-mgmt-close-one',
    )
      .send({ expectedVersion: 1 })
      .expect(200);
    expect(response.body.data).toMatchObject({
      id: fixture.campaignId,
      status: 'CLOSED',
      version: 2,
    });

    const member = await prisma.groupMember.findUniqueOrThrow({
      where: { id: fixture.memberId },
      include: {
        team: true,
        enrollmentOrder: { include: { coursePackage: true } },
      },
    });
    expect(member).toMatchObject({
      status: 'SETTLED',
      grantedMainUnits: 100,
      grantedGiftUnits: 0,
      team: { status: 'SETTLED', paidMemberCount: 1, finalTier: 1 },
      enrollmentOrder: {
        status: 'EFFECTIVE',
        coursePackage: {
          mainBalanceUnits: 100,
          giftBalanceUnits: 0,
        },
      },
    });
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackage: { sourceOrderId: fixture.orderId } },
      }),
    ).toBe(1);
  });

  it('cancels an unsettled campaign, refunds paid members, and grants no package', async () => {
    const fixture = await createPaidGroupMember(prisma, 'cancel-one');
    const response = await management(
      'post',
      `/management/group-campaigns/${fixture.campaignId}/cancel`,
      superToken,
      'group-mgmt-cancel-one',
    )
      .send({ expectedVersion: 1, reason: '校区活动取消' })
      .expect(200);
    expect(response.body.data).toMatchObject({
      id: fixture.campaignId,
      status: 'CANCELLED',
      version: 2,
    });

    const member = await prisma.groupMember.findUniqueOrThrow({
      where: { id: fixture.memberId },
      include: { team: true, enrollmentOrder: true, transactions: true },
    });
    expect(member).toMatchObject({
      status: 'REFUNDED',
      team: { status: 'CANCELLED', paidMemberCount: 0 },
      enrollmentOrder: { status: 'REFUNDED' },
    });
    expect(member.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'REFUND',
          status: 'SUCCEEDED',
          amountFen: 1990,
        }),
      ]),
    );
    expect(
      await prisma.coursePackage.count({
        where: { sourceOrderId: fixture.orderId },
      }),
    ).toBe(0);
  });

  it('refunds an unused settled package with an adjustment and blocks a consumed package', async () => {
    const fixture = await createPaidGroupMember(prisma, 'refund-unused');
    await management(
      'post',
      `/management/group-campaigns/${fixture.campaignId}/close`,
      superToken,
      'group-mgmt-close-for-refund',
    )
      .send({ expectedVersion: 1 })
      .expect(200);

    const refunded = await management(
      'post',
      `/management/group-orders/${fixture.orderId}/refund`,
      superToken,
      'group-mgmt-refund-unused',
    )
      .send({ expectedVersion: 2, reason: '家长申请退款' })
      .expect(200);
    expect(refunded.body.data).toMatchObject({
      id: fixture.orderId,
      memberStatus: 'REFUNDED',
      orderStatus: 'REFUNDED',
      version: 3,
    });
    const refundedPackage = await prisma.coursePackage.findUniqueOrThrow({
      where: { sourceOrderId: fixture.orderId },
    });
    expect(refundedPackage).toMatchObject({
      mainBalanceUnits: 0,
      giftBalanceUnits: 0,
      isActive: false,
    });
    expect(
      await prisma.lessonLedgerEntry.findFirst({
        where: {
          coursePackageId: refundedPackage.id,
          entryType: 'ADJUSTMENT',
        },
      }),
    ).toMatchObject({
      bucket: 'MAIN',
      deltaUnits: -100,
      balanceBeforeUnits: 100,
      balanceAfterUnits: 0,
    });

    await cleanup(prisma);
    await seedTeacherCore(prisma);
    const consumedFixture = await createPaidGroupMember(
      prisma,
      'refund-consumed',
    );
    await management(
      'post',
      `/management/group-campaigns/${consumedFixture.campaignId}/close`,
      superToken,
      'group-mgmt-close-for-consumed',
    )
      .send({ expectedVersion: 1 })
      .expect(200);
    const consumedPackage = await prisma.coursePackage.findUniqueOrThrow({
      where: { sourceOrderId: consumedFixture.orderId },
    });
    await prisma.coursePackage.update({
      where: { id: consumedPackage.id },
      data: { mainBalanceUnits: 0 },
    });
    await prisma.lessonLedgerEntry.create({
      data: {
        campusId: consumedPackage.campusId,
        studentId: consumedPackage.studentId,
        coursePackageId: consumedPackage.id,
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        balanceBeforeUnits: 100,
        balanceAfterUnits: 0,
        idempotencyKey: 'group-test-consumed-refund',
        actorUserId: '20000000-0000-4000-8000-000000000001',
        reason: '模拟课包已使用',
      },
    });
    const blocked = await management(
      'post',
      `/management/group-orders/${consumedFixture.orderId}/refund`,
      superToken,
      'group-mgmt-refund-consumed',
    )
      .send({ expectedVersion: 2, reason: '尝试退款' })
      .expect(409);
    expect(blocked.body.code).toBe('REFUND_NOT_ALLOWED');
    expect(
      await prisma.paymentTransaction.count({
        where: {
          enrollmentOrderId: consumedFixture.orderId,
          type: 'REFUND',
        },
      }),
    ).toBe(0);
  });
});

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server).post('/auth/login').send({ code });
  return (response.body as Envelope<{ accessToken: string }>).data.accessToken;
}

async function cleanup(prisma: PrismaClient): Promise<void> {
  const groupOrders = await prisma.enrollmentOrder.findMany({
    where: { orderNo: { startsWith: 'GROUP-' } },
    select: { id: true },
  });
  const groupOrderIds = groupOrders.map(({ id }) => id);
  if (groupOrderIds.length > 0) {
    await prisma.lessonLedgerEntry.deleteMany({
      where: { coursePackage: { sourceOrderId: { in: groupOrderIds } } },
    });
    await prisma.coursePackage.deleteMany({
      where: { sourceOrderId: { in: groupOrderIds } },
    });
  }
  await prisma.paymentTransaction.deleteMany();
  await prisma.groupMember.deleteMany();
  await prisma.groupTeam.deleteMany();
  await prisma.groupCampaignPoster.deleteMany();
  await prisma.storedFile.deleteMany({
    where: { purpose: 'GROUP_CAMPAIGN_POSTER' },
  });
  if (groupOrderIds.length > 0) {
    await prisma.enrollmentOrder.deleteMany({
      where: { id: { in: groupOrderIds } },
    });
  }
  const campaigns = await prisma.groupCampaign.findMany({
    where: { code: { startsWith: 'GROUP-MGMT-' } },
    select: { id: true },
  });
  const campaignIds = campaigns.map(({ id }) => id);
  if (campaignIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { resourceType: 'GroupCampaign', resourceId: { in: campaignIds } },
    });
    await prisma.groupCampaign.deleteMany({
      where: { id: { in: campaignIds } },
    });
  }
  await prisma.idempotencyRecord.deleteMany({
    where: { route: { startsWith: '/management/group-' } },
  });
  await prisma.auditLog.deleteMany({
    where: { action: { startsWith: 'GROUP_' } },
  });
}

async function createPaidGroupMember(
  prisma: PrismaClient,
  suffix: string,
): Promise<{
  campaignId: string;
  teamId: string;
  memberId: string;
  orderId: string;
}> {
  const campaign = await prisma.groupCampaign.findUniqueOrThrow({
    where: { code: 'GROUP-1990-DEMO' },
  });
  const parentUserId = '20000000-0000-4000-8000-000000000003';
  const studentId = '40000000-0000-4000-8000-000000000001';
  const paidAt = new Date();
  const team = await prisma.groupTeam.create({
    data: {
      campaignId: campaign.id,
      leaderUserId: parentUserId,
      paidMemberCount: 1,
    },
  });
  const order = await prisma.enrollmentOrder.create({
    data: {
      orderNo: `GROUP-MGMT-${suffix}`,
      parentUserId,
      studentId,
      campusId: campaign.campusId,
      courseProductId: campaign.courseProductId,
      productNameSnapshot: campaign.title,
      priceFenSnapshot: 1990,
      mainUnitsSnapshot: 100,
      giftUnitsSnapshot: 0,
      validityDaysSnapshot: 365,
      status: 'PAID',
    },
  });
  const member = await prisma.groupMember.create({
    data: {
      campaignId: campaign.id,
      teamId: team.id,
      parentUserId,
      studentId,
      enrollmentOrderId: order.id,
      status: 'PAID',
      reservationExpiresAt: new Date(paidAt.getTime() + 30 * 60 * 1_000),
      paidAt,
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      groupMemberId: member.id,
      enrollmentOrderId: order.id,
      type: 'PAYMENT',
      provider: 'MOCK',
      outTradeNo: `GROUP-PAY-${suffix}`,
      providerTradeNo: `MOCK-PAY-${suffix}`,
      amountFen: 1990,
      status: 'SUCCEEDED',
      succeededAt: paidAt,
    },
  });
  return {
    campaignId: campaign.id,
    teamId: team.id,
    memberId: member.id,
    orderId: order.id,
  };
}
