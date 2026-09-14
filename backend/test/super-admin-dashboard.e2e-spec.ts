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

describe('super admin global dashboard', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;

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
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function token(code: string): Promise<string> {
    const response = await request(httpServer)
      .post('/auth/login')
      .send({ code })
      .expect(200);
    return (response.body as Envelope<{ accessToken: string }>).data
      .accessToken;
  }

  const getAs = (path: string, accessToken: string) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${accessToken}`);

  it('returns PostgreSQL global facts to the super administrator', async () => {
    const response = await getAs(
      '/management/dashboard?revenuePeriod=HISTORY',
      await token('mock-demo-super-admin'),
    ).expect(200);

    expect(response.body).toEqual({
      data: {
        administrator: { displayName: '系统管理员' },
        reportingTimeZone: 'Asia/Shanghai',
        campusCount: expect.any(Number) as unknown,
        activeStudentCount: expect.any(Number) as unknown,
        monthCompletedLessonCount: expect.any(Number) as unknown,
        warningStudentCount: expect.any(Number) as unknown,
        featuredCampus: expect.objectContaining({
          id: expect.any(String) as unknown,
          name: expect.any(String) as unknown,
          activeStudentCount: expect.any(Number) as unknown,
          monthCompletedLessonCount: expect.any(Number) as unknown,
          attendanceRatePercent: expect.any(Number) as unknown,
          warningStudentCount: expect.any(Number) as unknown,
        }) as unknown,
        revenue: {
          period: 'HISTORY',
          periodLabel: '历史',
          partnerCount: 1,
          countedAttendeeCount: 2,
          grossLessonRevenueFen: 2000,
          partnerEarningFen: 800,
          headquartersRetainedFen: 1200,
          currency: 'CNY',
          campuses: expect.arrayContaining([
            expect.objectContaining({
              campusName: '启明东校区',
              partnerCount: 1,
              countedAttendeeCount: 2,
              grossLessonRevenueFen: 2000,
              partnerEarningFen: 800,
              headquartersRetainedFen: 1200,
            }),
          ]) as unknown,
        },
        serverTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      },
      requestId: expect.any(String) as unknown,
    });
  });

  it('rejects unsupported revenue periods', async () => {
    await getAs(
      '/management/dashboard?revenuePeriod=YEAR',
      await token('mock-demo-super-admin'),
    ).expect(400);
  });

  it.each([
    'mock-demo-east-parent',
    'mock-demo-east-teacher',
    'mock-demo-east-campus-manager',
  ])('rejects non-super-admin account %s', async (code) => {
    await getAs('/management/dashboard', await token(code))
      .expect(403)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'FORBIDDEN' }) as unknown,
        );
      });
  });
});
