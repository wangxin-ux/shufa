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
  eastStudentA: '40000000-0000-4000-8000-000000000001',
  westStudentA: '40000000-0000-4000-8000-000000000003',
  partnerUser: 'a2000000-0000-4000-8000-000000000001',
  partnerRole: 'a2000000-0000-4000-8000-000000000002',
  partnerIdentity: 'a2000000-0000-4000-8000-000000000003',
} as const;

interface Envelope<T> {
  data: T;
  requestId: string;
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
}

interface AuthSession {
  accessToken: string;
}

describe('partner campus-scoped reads', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaClient;
  let partnerToken: string;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await prisma.campus.update({
      where: { id: ids.eastCampus },
      data: { lessonWarningThresholdUnits: 800 },
    });
    await prisma.user.upsert({
      where: { id: ids.partnerUser },
      update: { displayName: '朱元璋', status: 'ACTIVE' },
      create: {
        id: ids.partnerUser,
        displayName: '朱元璋',
        status: 'ACTIVE',
      },
    });
    await prisma.userRole.upsert({
      where: { id: ids.partnerRole },
      update: {
        userId: ids.partnerUser,
        roleCode: 'PARTNER',
        campusId: ids.eastCampus,
      },
      create: {
        id: ids.partnerRole,
        userId: ids.partnerUser,
        roleCode: 'PARTNER',
        campusId: ids.eastCampus,
      },
    });
    await prisma.authIdentity.upsert({
      where: {
        provider_subject: {
          provider: 'MOCK',
          subject: 'mock-partner-read-test',
        },
      },
      update: { userId: ids.partnerUser },
      create: {
        id: ids.partnerIdentity,
        userId: ids.partnerUser,
        provider: 'MOCK',
        subject: 'mock-partner-read-test',
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
    partnerToken = await login('mock-partner-read-test');
  });

  afterAll(async () => {
    await app?.close();
    if (prisma) {
      await prisma.campus.update({
        where: { id: ids.eastCampus },
        data: { lessonWarningThresholdUnits: 500 },
      });
      await prisma.authIdentity.deleteMany({
        where: { userId: ids.partnerUser },
      });
      await prisma.userRole.deleteMany({ where: { userId: ids.partnerUser } });
      await prisma.user.deleteMany({ where: { id: ids.partnerUser } });
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

  const getAs = (path: string, token = partnerToken) =>
    request(httpServer).get(path).set('Authorization', `Bearer ${token}`);

  it('returns a real east-campus dashboard without financial fields', async () => {
    const response = await getAs('/partners/me/dashboard').expect(200);
    expect(response.body).toEqual({
      data: expect.objectContaining({
        partner: { displayName: '朱元璋' },
        campus: expect.objectContaining({
          id: ids.eastCampus,
          name: '启明东校区',
          lessonWarningThresholdUnits: 800,
        }) as unknown,
        activeStudentCount: 2,
        activeClassCount: 2,
        activeTeacherCount: 1,
        remainingMainUnits: 1600,
        remainingGiftUnits: 300,
        monthConsumedUnits: 0,
        attendanceRateBasisPoints: 10000,
        highlight: expect.objectContaining({
          studentName: '安然',
          totalBalanceUnits: 800,
        }) as unknown,
        serverTime: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) as unknown,
      }) as unknown,
      requestId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /earning|withdrawal|amountFen|paidAmountFen|分成|提现/i,
    );
  });

  it('returns a minimal partner profile with read-only campus contact data', async () => {
    const response = await getAs('/partners/me/profile').expect(200);
    expect(response.body).toEqual({
      data: {
        displayName: '朱元璋',
        roleCode: 'PARTNER',
        campus: expect.objectContaining({
          id: ids.eastCampus,
          name: '启明东校区',
          contactPhone: '0731-88886666',
        }) as unknown,
      },
      requestId: expect.any(String) as unknown,
    });
  });

  it('searches and paginates only east-campus students with server balances', async () => {
    const response = await getAs(
      '/partners/me/students?page=1&pageSize=1&query=%E9%99%88',
    ).expect(200);
    const body = response.body as Envelope<
      Array<{ displayName: string; totalBalanceUnits: number }>
    >;
    expect(body.data).toEqual([
      expect.objectContaining({
        displayName: '陈晨',
        mainBalanceUnits: 900,
        giftBalanceUnits: 200,
        totalBalanceUnits: 1100,
      }),
    ]);
    expect(body.meta).toEqual({
      page: 1,
      pageSize: 1,
      total: 1,
      totalPages: 1,
    });
    expect(JSON.stringify(body)).not.toMatch(/何嘉|罗一诺|启明西校区/);
  });

  it('returns a scoped student detail without phone or enrollment money', async () => {
    const response = await getAs(
      `/partners/me/students/${ids.eastStudentA}`,
    ).expect(200);
    expect(response.body).toEqual({
      data: expect.objectContaining({
        id: ids.eastStudentA,
        displayName: '陈晨',
        birthDate: '2017-03-14',
        mainBalanceUnits: 900,
        giftBalanceUnits: 200,
        totalBalanceUnits: 1100,
        classes: expect.arrayContaining([
          expect.objectContaining({
            className: '创意基础A班',
            courseName: '创意基础',
            teacherName: '林老师',
          }),
          expect.objectContaining({
            className: '创意工坊A班',
            courseName: '团体创意工坊',
            teacherName: '林老师',
          }),
        ]) as unknown,
        attendance: {
          presentCount: 1,
          absentCount: 0,
          leaveCount: 0,
          recordedCount: 1,
          attendanceRateBasisPoints: 10000,
        },
        recentAttendance: [
          expect.objectContaining({
            courseName: '创意基础',
            teacherName: '林老师',
            status: 'PRESENT',
          }),
        ],
        recentLessonLedger: [
          expect.objectContaining({
            packageName: '创意美术基础课包',
            entryType: 'CONSUME',
            deltaUnits: -100,
          }),
        ],
      }) as unknown,
      requestId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /phone|parent|paidAmount|priceFen|order|报名金额/i,
    );
  });

  it('hides a cross-campus student detail as not found', async () => {
    await getAs(`/partners/me/students/${ids.westStudentA}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }) as unknown,
        );
      });
  });

  it('returns campus-timezone day operating statistics and teacher teaching metrics', async () => {
    const response = await getAs(
      '/partners/me/operations-summary?period=DAY&anchorDate=2026-08-28',
    ).expect(200);
    expect(response.body).toEqual({
      data: {
        period: 'DAY',
        anchorDate: '2026-08-28',
        rangeStart: '2026-08-27T16:00:00.000Z',
        rangeEnd: '2026-08-28T16:00:00.000Z',
        consumedLessonUnits: 200,
        completedLessonCount: 1,
        presentCount: 2,
        absentCount: 0,
        leaveCount: 0,
        recordedCount: 2,
        attendanceRateBasisPoints: 10000,
        teacherMetrics: [
          expect.objectContaining({
            displayName: '林老师',
            completedLessonCount: 1,
            attendeeCount: 2,
          }),
        ],
      },
      requestId: expect.any(String) as unknown,
    });
  });

  it('rejects an invalid operating-statistics period', async () => {
    await getAs(
      '/partners/me/operations-summary?period=YEAR&anchorDate=2026-08-28',
    ).expect(400);
  });

  it('returns the threshold-qualified warning page', async () => {
    const response = await getAs(
      '/partners/me/warnings?page=1&pageSize=20',
    ).expect(200);
    expect(response.body).toEqual({
      data: [
        expect.objectContaining({
          studentName: '安然',
          totalBalanceUnits: 800,
          thresholdUnits: 800,
        }) as unknown,
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      requestId: expect.any(String) as unknown,
    });
  });

  it('returns attendance summary and paginated records', async () => {
    const response = await getAs(
      '/partners/me/attendance?page=1&pageSize=1',
    ).expect(200);
    expect(response.body).toEqual({
      data: expect.objectContaining({
        presentCount: 2,
        absentCount: 0,
        leaveCount: 0,
        recordedCount: 2,
        attendanceRateBasisPoints: 10000,
        items: [
          expect.objectContaining({
            courseName: '创意基础',
            teacherName: '林老师',
            status: 'PRESENT',
          }) as unknown,
        ],
        meta: { page: 1, pageSize: 1, total: 2, totalPages: 2 },
      }) as unknown,
      requestId: expect.any(String) as unknown,
    });
  });

  it('returns only active teachers in the partner campus', async () => {
    const response = await getAs(
      '/partners/me/teachers?page=1&pageSize=20',
    ).expect(200);
    expect(response.body).toEqual({
      data: [
        expect.objectContaining({
          displayName: '林老师',
          activeStudentCount: 2,
          monthCompletedLessonCount: 0,
        }) as unknown,
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      requestId: expect.any(String) as unknown,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /周老师|teacher-demo-west/,
    );
  });

  it('returns campus lesson balances and immutable ledger entries', async () => {
    const response = await getAs(
      '/partners/me/lesson-account?page=1&pageSize=100',
    ).expect(200);
    const body = response.body as Envelope<{
      mainBalanceUnits: number;
      giftBalanceUnits: number;
      totalBalanceUnits: number;
      items: Array<{
        studentName: string;
        entryType: string;
        bucket: string;
        deltaUnits: number;
      }>;
      meta: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
      };
    }>;
    expect(body.data).toEqual(
      expect.objectContaining({
        mainBalanceUnits: 1600,
        giftBalanceUnits: 300,
        totalBalanceUnits: 1900,
      }),
    );
    expect(body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentName: '陈晨',
          entryType: 'CONSUME',
          bucket: 'MAIN',
          deltaUnits: -100,
        }),
        expect.objectContaining({
          studentName: '安然',
          entryType: 'CONSUME',
          bucket: 'MAIN',
          deltaUnits: -100,
        }),
      ]),
    );
    expect(body.data.meta).toEqual(
      expect.objectContaining({ page: 1, pageSize: 100 }),
    );
    expect(JSON.stringify(response.body)).not.toMatch(/何嘉|罗一诺/);
  });

  it('rejects invalid pagination and non-partner roles', async () => {
    await getAs('/partners/me/students?page=0').expect(400);
    const parentToken = await login('mock-demo-east-parent');
    await getAs('/partners/me/dashboard', parentToken)
      .expect(403)
      .expect(({ body }) => {
        expect(body).toEqual(
          expect.objectContaining({ code: 'FORBIDDEN' }) as unknown,
        );
      });
  });
});
