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
  eastCampaign: 'a3000000-0000-4000-8000-000000000001',
  westCampus: '10000000-0000-4000-8000-000000000002',
  westTeacher: '20000000-0000-4000-8000-000000000002',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

describe('staff group campaign promotion reads', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaClient;
  let teacherToken: string;
  let partnerToken: string;
  let parentToken: string;
  let westTeacherToken: string;
  let westPartnerToken: string;
  const westPartnerUserId = randomUUID();
  const westTeacherIdentityId = randomUUID();
  const westPartnerIdentityId = randomUUID();

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await prisma.authIdentity.upsert({
      where: {
        userId_provider: { userId: ids.westTeacher, provider: 'MOCK' },
      },
      update: { subject: 'mock-promotion-west-teacher' },
      create: {
        id: westTeacherIdentityId,
        userId: ids.westTeacher,
        provider: 'MOCK',
        subject: 'mock-promotion-west-teacher',
      },
    });
    await prisma.user.create({
      data: {
        id: westPartnerUserId,
        displayName: '西校区合作方',
        authIdentities: {
          create: {
            id: westPartnerIdentityId,
            provider: 'MOCK',
            subject: 'mock-promotion-west-partner',
          },
        },
        roles: { create: { roleCode: 'PARTNER', campusId: ids.westCampus } },
      },
    });

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

    teacherToken = await login(server, 'mock-demo-east-teacher');
    partnerToken = await login(server, 'mock-demo-east-partner');
    parentToken = await login(server, 'mock-demo-east-parent');
    westTeacherToken = await login(server, 'mock-promotion-west-teacher');
    westPartnerToken = await login(server, 'mock-promotion-west-partner');
  });

  afterAll(async () => {
    await prisma?.authIdentity.deleteMany({
      where: {
        OR: [
          { id: westTeacherIdentityId },
          { id: westPartnerIdentityId },
        ],
      },
    });
    await prisma?.userRole.deleteMany({ where: { userId: westPartnerUserId } });
    await prisma?.user.deleteMany({ where: { id: westPartnerUserId } });
    await app?.close();
    await prisma?.$disconnect();
  });

  it.each([
    ['teacher', '/teachers/me/group-campaigns', () => teacherToken],
    ['partner', '/partners/me/group-campaigns', () => partnerToken],
  ])('returns a restricted campaign page to the east %s', async (_role, path, token) => {
    const response = await getAs(server, `${path}?page=1&pageSize=20`, token()).expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            id: ids.eastCampaign,
            code: 'GROUP-1990-DEMO',
            campusName: '启明东校区',
            title: '19.9 元创意美术拼团课',
            priceFen: 1990,
            posterImages: expect.any(Array),
          }),
        ],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      }),
    );
    expect(JSON.stringify(response.body)).not.toMatch(
      /boundStudents|joinableTeams|members|studentName|parentName|orderNo|payment|outTradeNo|version/,
    );
  });

  it.each([
    ['/teachers/me/group-campaigns', () => teacherToken],
    ['/partners/me/group-campaigns', () => partnerToken],
  ])('returns the restricted campaign detail from %s', async (path, token) => {
    const response = await getAs(server, `${path}/${ids.eastCampaign}`, token()).expect(200);
    const body = response.body as Envelope<Record<string, unknown>>;
    expect(body.data).toEqual(
      expect.objectContaining({
        id: ids.eastCampaign,
        customerService: {
          name: '启明课程顾问',
          phone: '0731-88886666',
          qrCodeUrl: null,
        },
      }),
    );
    expect(body.data).not.toHaveProperty('boundStudents');
    expect(body.data).not.toHaveProperty('joinableTeams');
  });

  it('hides campaigns that have not started or have already ended', async () => {
    const original = await prisma.groupCampaign.findUniqueOrThrow({
      where: { id: ids.eastCampaign },
      select: { startsAt: true, endsAt: true },
    });

    try {
      await prisma.groupCampaign.update({
        where: { id: ids.eastCampaign },
        data: {
          startsAt: new Date('2099-01-01T00:00:00.000Z'),
          endsAt: new Date('2099-01-02T00:00:00.000Z'),
        },
      });
      await getAs(server, '/teachers/me/group-campaigns', teacherToken)
        .expect(200)
        .expect(({ body }) => expect(body.data).toEqual([]));
      await getAs(
        server,
        `/teachers/me/group-campaigns/${ids.eastCampaign}`,
        teacherToken,
      ).expect(404);

      await prisma.groupCampaign.update({
        where: { id: ids.eastCampaign },
        data: {
          startsAt: new Date('2020-01-01T00:00:00.000Z'),
          endsAt: new Date('2020-01-02T00:00:00.000Z'),
        },
      });
      await getAs(server, '/partners/me/group-campaigns', partnerToken)
        .expect(200)
        .expect(({ body }) => expect(body.data).toEqual([]));
      await getAs(
        server,
        `/partners/me/group-campaigns/${ids.eastCampaign}`,
        partnerToken,
      ).expect(404);
    } finally {
      await prisma.groupCampaign.update({
        where: { id: ids.eastCampaign },
        data: original,
      });
    }
  });

  it('hides east campaign existence from west-campus staff', async () => {
    await getAs(
      server,
      `/teachers/me/group-campaigns/${ids.eastCampaign}`,
      westTeacherToken,
    ).expect(404);
    await getAs(
      server,
      `/partners/me/group-campaigns/${ids.eastCampaign}`,
      westPartnerToken,
    ).expect(404);
  });

  it('rejects cross-role access and invalid pagination', async () => {
    await getAs(server, '/teachers/me/group-campaigns', partnerToken).expect(403);
    await getAs(server, '/partners/me/group-campaigns', teacherToken).expect(403);
    await getAs(server, '/teachers/me/group-campaigns', parentToken).expect(403);
    await getAs(server, '/partners/me/group-campaigns?page=0', partnerToken).expect(400);
  });
});

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server).post('/auth/login').send({ code }).expect(200);
  return (response.body as Envelope<{ accessToken: string }>).data.accessToken;
}

function getAs(server: Server, path: string, token: string) {
  return request(server).get(path).set('Authorization', `Bearer ${token}`);
}
