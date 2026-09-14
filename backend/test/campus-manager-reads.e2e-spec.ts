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

const ids = {
  eastCampus: '10000000-0000-4000-8000-000000000001',
  managerUser: '20000000-0000-4000-8000-000000000005',
  noCampusUser: 'a1000000-0000-4000-8000-000000000001',
  noCampusRole: 'a1000000-0000-4000-8000-000000000002',
  noCampusIdentity: 'a1000000-0000-4000-8000-000000000003',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface AuthSession {
  accessToken: string;
}

describe('campus manager dashboard reads', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let managerToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await prisma.user.upsert({
      where: { id: ids.noCampusUser },
      update: { displayName: '无校区管理员', status: 'ACTIVE' },
      create: {
        id: ids.noCampusUser,
        displayName: '无校区管理员',
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.upsert({
      where: { id: ids.noCampusRole },
      update: {
        userId: ids.noCampusUser,
        roleCode: 'CAMPUS_MANAGER',
        campusId: null,
      },
      create: {
        id: ids.noCampusRole,
        userId: ids.noCampusUser,
        roleCode: 'CAMPUS_MANAGER',
        campusId: null,
      },
    });
    await prisma.authIdentity.upsert({
      where: {
        provider_subject: {
          provider: 'MOCK',
          subject: 'mock-demo-no-campus-manager',
        },
      },
      update: { userId: ids.noCampusUser },
      create: {
        id: ids.noCampusIdentity,
        userId: ids.noCampusUser,
        provider: 'MOCK',
        subject: 'mock-demo-no-campus-manager',
      },
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

    managerToken = await login('mock-demo-east-campus-manager');
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.authIdentity.deleteMany({
        where: { userId: ids.noCampusUser },
      });
      await prisma.userRole.deleteMany({ where: { userId: ids.noCampusUser } });
      await prisma.user.deleteMany({ where: { id: ids.noCampusUser } });
      await prisma.$disconnect();
    }
  });

  async function login(code: string): Promise<string> {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ code })
      .expect(200);
    return (response.body as Envelope<AuthSession>).data.accessToken;
  }

  const getAs = (path: string, token: string) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);

  it('returns only east-campus dashboard facts for the manager', async () => {
    const response = await getAs(
      '/campus-managers/me/dashboard',
      managerToken,
    ).expect(200);
    const body = response.body as Envelope<{
      manager: { displayName: string };
      campus: { id: string; name: string };
      activeStudentCount: number;
      todayLessonCount: number;
      pendingLeaveCount: number;
      latestPendingLeave: {
        id: string;
        studentName: string;
        courseName: string;
        startsAt: string;
      } | null;
      serverTime: string;
    }>;

    expect(body.data).toMatchObject({
      manager: { displayName: '周园长' },
      campus: { id: ids.eastCampus, name: '启明东校区' },
      activeStudentCount: 2,
      todayLessonCount: expect.any(Number) as unknown,
      pendingLeaveCount: 1,
      latestPendingLeave: {
        studentName: '陈晨',
        courseName: '创意基础',
        startsAt: '2026-08-30T06:00:00.000Z',
      },
      serverTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
    });
  });

  it('returns the manager profile without financial or sensitive fields', async () => {
    const response = await getAs(
      '/campus-managers/me/profile',
      managerToken,
    ).expect(200);

    expect(response.body).toEqual({
      data: {
        displayName: '周园长',
        roleCode: 'CAMPUS_MANAGER',
        campusId: ids.eastCampus,
        campusName: '启明东校区',
      },
      requestId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /withdrawal|earning|account|password/i,
    );
  });

  it.each(['mock-demo-east-parent', 'mock-demo-east-teacher'])(
    'rejects non-manager account %s',
    async (code) => {
      const token = await login(code);
      await getAs('/campus-managers/me/dashboard', token)
        .expect(403)
        .expect(({ body }) => {
          expect(body).toEqual(
            expect.objectContaining({ code: 'FORBIDDEN' }) as unknown,
          );
        });
    },
  );

  it('rejects a campus manager role without an assigned campus', async () => {
    const token = await login('mock-demo-no-campus-manager');
    await getAs('/campus-managers/me/dashboard', token)
      .expect(403)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'FORBIDDEN' }) as unknown,
        );
      });
  });
});
