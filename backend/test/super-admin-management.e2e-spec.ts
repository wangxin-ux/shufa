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

interface Envelope<T> {
  data: T;
  requestId: string;
}

interface PageEnvelope<T> extends Envelope<T[]> {
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

interface AdjustmentView {
  coursePackageId: string;
  bucket: 'MAIN' | 'GIFT';
  deltaUnits: number;
  balanceBeforeUnits: number;
  balanceAfterUnits: number;
}

interface PackageValidityView {
  id: string;
  validFrom: string;
  expiresAt: string | null;
  version: number;
}

describe('super admin management workspace', () => {
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
    server = app.getHttpServer() as Server;
    superToken = await login(server, 'mock-demo-super-admin');
    managerToken = await login(server, 'mock-demo-east-campus-manager');
  });

  beforeEach(async () => {
    await seedTeacherCore(prisma);
    await prisma.idempotencyRecord.deleteMany({
      where: {
        OR: [
          { route: '/management/lesson-ledger/adjustments' },
          { route: { startsWith: '/management/course-packages/' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  const get = (path: string, token = superToken) =>
    request(server).get(path).set('Authorization', `Bearer ${token}`);

  it('lists all campuses with pagination and hides them from campus managers', async () => {
    const response = await get(
      '/management/campuses?page=1&pageSize=20',
    ).expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String) as unknown,
            name: expect.any(String) as unknown,
            activeStudentCount: expect.any(Number) as unknown,
            warningStudentCount: expect.any(Number) as unknown,
          }),
        ]) as unknown,
        meta: expect.objectContaining({ page: 1, pageSize: 20 }) as unknown,
      }),
    );
    await get('/management/campuses', managerToken).expect(403);
  });

  it('loads a campus detail even when it is outside the first 100 campuses', async () => {
    const suffix = Date.now().toString().slice(-8);
    const campuses = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      code: `ZZ${suffix}${String(index).padStart(3, '0')}`,
      name: `详情分页校区${index + 1}`,
    }));
    await prisma.campus.createMany({ data: campuses });

    try {
      const target = campuses[campuses.length - 1];
      const response = await get(`/management/campuses/${target.id}`).expect(
        200,
      );
      expect(response.body).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            id: target.id,
            code: target.code,
            name: target.name,
          }) as unknown,
        }),
      );
    } finally {
      await prisma.campus.deleteMany({
        where: { id: { in: campuses.map(({ id }) => id) } },
      });
    }
  });

  it('lists active students across campuses with search, campus filtering, and current balances', async () => {
    const target = await prisma.student.findFirstOrThrow({
      where: { isActive: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, campusId: true, displayName: true },
    });
    const response = await get(
      `/management/students?page=1&pageSize=20&campusId=${target.campusId}&query=${encodeURIComponent(target.displayName)}`,
    ).expect(200);
    const body = response.body as PageEnvelope<{
      id: string;
      campusId: string;
      displayName: string;
      mainBalanceUnits: number;
      giftBalanceUnits: number;
      totalBalanceUnits: number;
      lowBalance: boolean;
    }>;
    expect(body.meta).toMatchObject({ page: 1, pageSize: 20 });
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: target.id,
          campusId: target.campusId,
          displayName: target.displayName,
          mainBalanceUnits: expect.any(Number) as unknown,
          giftBalanceUnits: expect.any(Number) as unknown,
          totalBalanceUnits: expect.any(Number) as unknown,
          lowBalance: expect.any(Boolean) as unknown,
        }),
      ]),
    );
    expect(
      body.data.every(({ campusId }) => campusId === target.campusId),
    ).toBe(true);
    await get('/management/students', managerToken).expect(403);
  });

  it('loads every package status for one student and returns 404 for a missing student', async () => {
    const target = await prisma.student.findFirstOrThrow({
      where: { isActive: true },
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      select: { id: true, campusId: true },
    });
    const now = new Date();
    const packageIds = Array.from({ length: 4 }, () => randomUUID());
    await prisma.coursePackage.createMany({
      data: [
        {
          id: packageIds[0],
          campusId: target.campusId,
          studentId: target.id,
          name: '状态验证生效课包',
          mainBalanceUnits: 300,
          giftBalanceUnits: 100,
          validFrom: new Date(now.getTime() - 86_400_000),
          expiresAt: new Date(now.getTime() + 86_400_000),
          isActive: true,
        },
        {
          id: packageIds[1],
          campusId: target.campusId,
          studentId: target.id,
          name: '状态验证未开始课包',
          validFrom: new Date(now.getTime() + 86_400_000),
          isActive: true,
        },
        {
          id: packageIds[2],
          campusId: target.campusId,
          studentId: target.id,
          name: '状态验证过期课包',
          validFrom: new Date(now.getTime() - 172_800_000),
          expiresAt: new Date(now.getTime() - 86_400_000),
          isActive: true,
        },
        {
          id: packageIds[3],
          campusId: target.campusId,
          studentId: target.id,
          name: '状态验证停用课包',
          validFrom: new Date(now.getTime() - 86_400_000),
          isActive: false,
        },
      ],
    });

    try {
      const response = await get(`/management/students/${target.id}`).expect(
        200,
      );
      const body = response.body as Envelope<{
        id: string;
        coursePackages: Array<{ id: string; status: string }>;
      }>;
      expect(body.data.id).toBe(target.id);
      expect(
        body.data.coursePackages
          .filter(({ id }) => packageIds.includes(id))
          .map(({ status }) => status)
          .sort(),
      ).toEqual(['ACTIVE', 'EXPIRED', 'INACTIVE', 'UPCOMING']);
      await get(`/management/students/${target.id}`, managerToken).expect(403);
      await get(`/management/students/${randomUUID()}`).expect(404);
    } finally {
      await prisma.coursePackage.deleteMany({
        where: { id: { in: packageIds } },
      });
    }
  });

  it('updates package validity idempotently without creating a lesson ledger entry', async () => {
    const coursePackage = await prisma.coursePackage.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        campusId: true,
        validFrom: true,
        expiresAt: true,
        version: true,
      },
    });
    const ledgerCountBefore = await prisma.lessonLedgerEntry.count({
      where: { coursePackageId: coursePackage.id },
    });
    const auditCountBefore = await prisma.auditLog.count({
      where: {
        action: 'COURSE_PACKAGE_VALIDITY_UPDATE',
        resourceId: coursePackage.id,
      },
    });
    const key = `validity-${Date.now()}`;
    const body = {
      validFrom: '2026-09-01T00:00:00+08:00',
      expiresAt: '2027-08-31T23:59:59.999+08:00',
      expectedVersion: coursePackage.version,
      reason: '按新签合同更新课包有效期',
    };
    const submit = (token = superToken) =>
      request(server)
        .patch(`/management/course-packages/${coursePackage.id}/validity`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send(body);

    try {
      const first = await submit().expect(200);
      const replay = await submit().expect(200);
      const firstBody = first.body as Envelope<PackageValidityView>;
      const replayBody = replay.body as Envelope<PackageValidityView>;
      expect(replayBody.data).toEqual(firstBody.data);
      expect(firstBody.data).toMatchObject({
        id: coursePackage.id,
        validFrom: '2026-08-31T16:00:00.000Z',
        expiresAt: '2027-08-31T15:59:59.999Z',
        version: coursePackage.version + 1,
      });
      await expect(
        prisma.lessonLedgerEntry.count({
          where: { coursePackageId: coursePackage.id },
        }),
      ).resolves.toBe(ledgerCountBefore);
      await expect(
        prisma.auditLog.count({
          where: {
            action: 'COURSE_PACKAGE_VALIDITY_UPDATE',
            resourceId: coursePackage.id,
          },
        }),
      ).resolves.toBe(auditCountBefore + 1);
      await submit(managerToken).expect(403);
    } finally {
      await prisma.coursePackage.update({
        where: { id: coursePackage.id },
        data: {
          validFrom: coursePackage.validFrom,
          expiresAt: coursePackage.expiresAt,
          version: coursePackage.version,
        },
      });
      await prisma.idempotencyRecord.deleteMany({ where: { key } });
    }
  });

  it('rejects invalid validity ranges and stale package versions', async () => {
    const coursePackage = await prisma.coursePackage.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true, validFrom: true, expiresAt: true, version: true },
    });
    const submit = (body: Record<string, unknown>, key: string) =>
      request(server)
        .patch(`/management/course-packages/${coursePackage.id}/validity`)
        .set('Authorization', `Bearer ${superToken}`)
        .set('Idempotency-Key', key)
        .send(body);

    await submit(
      {
        validFrom: '2027-09-01T00:00:00+08:00',
        expiresAt: '2027-08-31T23:59:59+08:00',
        expectedVersion: coursePackage.version,
        reason: '非法日期范围守卫',
      },
      `invalid-validity-${Date.now()}`,
    ).expect(400);
    await submit(
      {
        validFrom: '2026-09-01T00:00:00+08:00',
        expiresAt: null,
        expectedVersion: coursePackage.version + 1,
        reason: '过期版本守卫',
      },
      `stale-validity-${Date.now()}`,
    ).expect(409);
    await expect(
      prisma.coursePackage.findUniqueOrThrow({
        where: { id: coursePackage.id },
        select: { validFrom: true, expiresAt: true, version: true },
      }),
    ).resolves.toEqual({
      validFrom: coursePackage.validFrom,
      expiresAt: coursePackage.expiresAt,
      version: coursePackage.version,
    });
  });

  it('lists the immutable global lesson ledger and package balances', async () => {
    const response = await get(
      '/management/lesson-ledger?page=1&pageSize=20',
    ).expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        data: expect.any(Array) as unknown,
        meta: expect.objectContaining({ page: 1, pageSize: 20 }) as unknown,
      }),
    );
    await get('/management/lesson-ledger', managerToken).expect(403);
  });

  it('adjusts one bucket transactionally, replays the same key, and writes an audit log', async () => {
    const coursePackage = await prisma.coursePackage.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true, mainBalanceUnits: true },
    });
    const auditCountBefore = await prisma.auditLog.count({
      where: {
        action: 'LESSON_LEDGER_ADJUST',
        resourceId: coursePackage.id,
        outcome: 'SUCCESS',
      },
    });
    const key = `super-adjust-${Date.now()}`;
    const body = {
      coursePackageId: coursePackage.id,
      bucket: 'MAIN',
      deltaUnits: 100,
      reason: '夜间开发验收调整',
    };
    const submit = () =>
      request(server)
        .post('/management/lesson-ledger/adjustments')
        .set('Authorization', `Bearer ${superToken}`)
        .set('Idempotency-Key', key)
        .send(body);
    const first = await submit().expect(200);
    const replay = await submit().expect(200);
    const firstBody = first.body as Envelope<AdjustmentView>;
    const replayBody = replay.body as Envelope<AdjustmentView>;
    expect(replayBody.data).toEqual(firstBody.data);
    expect(firstBody.data).toMatchObject({
      coursePackageId: coursePackage.id,
      bucket: 'MAIN',
      deltaUnits: 100,
      balanceBeforeUnits: coursePackage.mainBalanceUnits,
      balanceAfterUnits: coursePackage.mainBalanceUnits + 100,
    });
    await expect(
      prisma.auditLog.count({
        where: {
          action: 'LESSON_LEDGER_ADJUST',
          resourceId: coursePackage.id,
          outcome: 'SUCCESS',
        },
      }),
    ).resolves.toBe(auditCountBefore + 1);
  });

  it('rejects an adjustment that would create a negative balance and rejects non-super admins', async () => {
    const coursePackage = await prisma.coursePackage.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true, mainBalanceUnits: true },
    });
    const body = {
      coursePackageId: coursePackage.id,
      bucket: 'MAIN',
      deltaUnits: -(coursePackage.mainBalanceUnits + 1),
      reason: '负余额守卫',
    };
    const submit = (token: string, key: string) =>
      request(server)
        .post('/management/lesson-ledger/adjustments')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send(body);
    const negativeKey = `negative-${Date.now()}`;
    await submit(superToken, negativeKey).expect(409);
    await expect(
      prisma.coursePackage.findUniqueOrThrow({
        where: { id: coursePackage.id },
        select: { mainBalanceUnits: true },
      }),
    ).resolves.toEqual({ mainBalanceUnits: coursePackage.mainBalanceUnits });
    await expect(
      prisma.lessonLedgerEntry.count({
        where: {
          coursePackageId: coursePackage.id,
          idempotencyKey: negativeKey,
        },
      }),
    ).resolves.toBe(0);
    await submit(managerToken, `manager-${Date.now()}`).expect(403);
  });

  it('serializes concurrent adjustments with different idempotency keys', async () => {
    const coursePackage = await prisma.coursePackage.findFirstOrThrow({
      where: { isActive: true },
      orderBy: { id: 'asc' },
      select: { id: true, mainBalanceUnits: true },
    });
    const submit = (key: string) =>
      request(server)
        .post('/management/lesson-ledger/adjustments')
        .set('Authorization', `Bearer ${superToken}`)
        .set('Idempotency-Key', key)
        .send({
          coursePackageId: coursePackage.id,
          bucket: 'MAIN',
          deltaUnits: 100,
          reason: '并发调整验收',
        });
    const prefix = `concurrent-${Date.now()}`;
    const responses = await Promise.all([
      submit(`${prefix}-a`),
      submit(`${prefix}-b`),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    await expect(
      prisma.coursePackage.findUniqueOrThrow({
        where: { id: coursePackage.id },
        select: { mainBalanceUnits: true },
      }),
    ).resolves.toEqual({
      mainBalanceUnits: coursePackage.mainBalanceUnits + 200,
    });
  });

  it('exposes read-only system boundaries, eight-role permissions, and paged audit logs', async () => {
    await get('/management/system-settings')
      .expect(200)
      .expect((response) => {
        const body = response.body as Envelope<{
          paymentMode: string;
          payoutMode: string;
          reportingTimeZone: string;
        }>;
        expect(body.data).toMatchObject({
          paymentMode: '模拟/人工',
          payoutMode: '线下人工打款',
          reportingTimeZone: 'Asia/Shanghai',
        });
      });
    await get('/management/role-permissions')
      .expect(200)
      .expect((response) => {
        const body = response.body as Envelope<Array<{ roleCode: string }>>;
        expect(body.data).toHaveLength(8);
        expect(body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ roleCode: 'SUPER_ADMIN' }),
          ]),
        );
      });
    await get('/management/audit-logs?page=1&pageSize=20')
      .expect(200)
      .expect((response) => {
        const body = response.body as PageEnvelope<unknown>;
        expect(body.meta).toMatchObject({ page: 1, pageSize: 20 });
      });
  });
});

async function login(server: Server, code: string): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ code })
    .expect(200);
  return (response.body as { data: { accessToken: string } }).data.accessToken;
}
