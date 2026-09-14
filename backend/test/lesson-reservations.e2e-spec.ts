import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import {
  InsufficientLessonBalanceError,
  LessonLedgerService,
} from '../src/modules/lesson-ledger/lesson-ledger.service';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Reservation tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: './storage/test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
});

describe('persisted lesson reservation write protection', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let ledger: LessonLedgerService;
  let campusId: string;
  let teacherId: string;
  let teacherUserId: string;
  let classGroupId: string;
  let admin: string;
  const users: string[] = [];
  const at = new Date('2026-09-07T00:00:00Z');

  beforeAll(async () => {
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
    prisma = app.get(PrismaService);
    ledger = app.get(LessonLedgerService);
    campusId = (
      await prisma.campus.create({
        data: { code: `RSV-${randomUUID()}`, name: '预留隔离测试校区' },
      })
    ).id;
    const administrator = await prisma.user.create({
      data: {
        displayName: '预留测试总端',
        roles: { create: { roleCode: 'SUPER_ADMIN', campusId: null } },
      },
    });
    users.push(administrator.id);
    admin = (await app.get(AuthService).issueSessionForUser(administrator.id))
      .accessToken;
    const teacher = await prisma.teacherProfile.create({
      data: {
        campus: { connect: { id: campusId } },
        employeeCode: `RSV-${randomUUID()}`,
        user: {
          create: {
            displayName: '预留测试教师',
            roles: { create: { roleCode: 'TEACHER', campusId } },
          },
        },
      },
    });
    teacherId = teacher.id;
    teacherUserId = teacher.userId;
    users.push(teacher.userId);
    classGroupId = (
      await prisma.classGroup.create({
        data: {
          campusId,
          teacherId,
          name: '预留测试班',
          courseName: '测试课程',
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    if (prisma && users.length) {
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
    }
    await app?.close();
  });

  async function fixture(mainReserved = 1100, giftReserved = 100) {
    const student = await prisma.student.create({
      data: { campusId, displayName: '预留测试学员' },
    });
    const coursePackage = await prisma.coursePackage.create({
      data: {
        campusId,
        studentId: student.id,
        name: '预留测试课包',
        mainBalanceUnits: 1200,
        giftBalanceUnits: 300,
        validFrom: new Date('2026-09-01T00:00:00Z'),
      },
    });
    await prisma.$executeRaw`
      UPDATE "CoursePackage"
      SET "mainReservedUnits" = ${mainReserved}, "giftReservedUnits" = ${giftReserved}
      WHERE "id" = ${coursePackage.id}::uuid
    `;
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId,
        teacherId,
        classGroupId,
        startsAt: at,
        endsAt: new Date(at.getTime() + 3600000),
      },
    });
    return {
      packageId: coursePackage.id,
      studentId: student.id,
      lessonId: lesson.id,
    };
  }

  function consume(
    f: Awaited<ReturnType<typeof fixture>>,
    units: number,
    key = randomUUID(),
  ) {
    return prisma.$transaction((tx) =>
      ledger.consumeStudentLessonUnits(tx, {
        scope: { campusId, teacherProfileId: teacherId, userId: teacherUserId },
        studentId: f.studentId,
        lessonSessionId: f.lessonId,
        requestedUnits: units,
        idempotencyKey: key,
        occurredAt: at,
        reason: '预留测试扣课',
      }),
    );
  }

  const adjust = (
    packageId: string,
    bucket: 'MAIN' | 'GIFT',
    deltaUnits: number,
    key = randomUUID(),
  ) =>
    request(server)
      .post('/management/lesson-ledger/adjustments')
      .auth(admin, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send({
        coursePackageId: packageId,
        bucket,
        deltaUnits,
        reason: '预留测试调整',
      });

  it('consumes available main then gift while ledger balances remain gross', async () => {
    const f = await fixture();
    expect(await consume(f, 250)).toMatchObject({
      mainUnits: 100,
      giftUnits: 150,
    });
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({
      mainBalanceUnits: 1100,
      giftBalanceUnits: 150,
      mainReservedUnits: 1100,
      giftReservedUnits: 100,
    });
    expect(
      await prisma.lessonLedgerEntry.findMany({
        where: { coursePackageId: f.packageId },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucket: 'MAIN',
          balanceBeforeUnits: 1200,
          balanceAfterUnits: 1100,
        }),
        expect.objectContaining({
          bucket: 'GIFT',
          balanceBeforeUnits: 300,
          balanceAfterUnits: 150,
        }),
      ]),
    );
  });

  it('rejects consumption beyond available units without a partial ledger', async () => {
    const f = await fixture();
    await expect(consume(f, 301)).rejects.toBeInstanceOf(
      InsufficientLessonBalanceError,
    );
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: f.packageId },
      }),
    ).toBe(0);
  });

  it.each(['MAIN', 'GIFT'] as const)(
    'rejects %s adjustments that cross reservations',
    async (bucket) => {
      const f = await fixture();
      const response = await adjust(
        f.packageId,
        bucket,
        bucket === 'MAIN' ? -101 : -201,
      ).expect(409);
      expect((response.body as { code: string }).code).toBe(
        'INSUFFICIENT_LESSON_BALANCE',
      );
      expect(
        await prisma.lessonLedgerEntry.count({
          where: { coursePackageId: f.packageId },
        }),
      ).toBe(0);
    },
  );

  it('allows an exact available adjustment, replays once and preserves reserved units', async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await adjust(f.packageId, 'MAIN', -100, key).expect(200);
    const replay = await adjust(f.packageId, 'MAIN', -100, key).expect(200);
    expect((replay.body as { data: { id: string } }).data.id).toBe(
      (first.body as { data: { id: string } }).data.id,
    );
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({ mainBalanceUnits: 1100, mainReservedUnits: 1100 });
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: f.packageId },
      }),
    ).toBe(1);
  });

  it('serializes competing consumption so only one can spend the available balance', async () => {
    const f = await fixture(1100, 300);
    const results = await Promise.allSettled([
      consume(f, 100),
      consume(f, 100),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InsufficientLessonBalanceError);
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: f.packageId },
      }),
    ).toBe(1);
  });

  it('serializes consumption against a negative administrator adjustment', async () => {
    const f = await fixture(1100, 300);
    const [consumption, adjustment] = await Promise.all([
      consume(f, 100).then(
        () => true,
        (error: unknown) => {
          expect(error).toBeInstanceOf(InsufficientLessonBalanceError);
          return false;
        },
      ),
      adjust(f.packageId, 'MAIN', -100),
    ]);
    expect(adjustment.status).toBe(consumption ? 409 : 200);
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({
      mainBalanceUnits: 1100,
      mainReservedUnits: 1100,
      giftReservedUnits: 300,
    });
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: f.packageId },
      }),
    ).toBe(1);
  });

  it('rolls back balance, ledger, audit and idempotency after a final-write failure', async () => {
    const f = await fixture();
    const key = randomUUID();
    const failure = jest
      .spyOn(app.get(IdempotencyService), 'complete')
      .mockRejectedValueOnce(new Error('Injected final-write failure'));
    try {
      await adjust(f.packageId, 'MAIN', -100, key).expect(500);
    } finally {
      failure.mockRestore();
    }
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({
      mainBalanceUnits: 1200,
      mainReservedUnits: 1100,
      version: 1,
    });
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: f.packageId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { resourceId: f.packageId } }),
    ).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    await adjust(f.packageId, 'MAIN', -100, key).expect(200);
  });

  it('allows positive adjustments without releasing reserved units', async () => {
    const f = await fixture(1200, 300);
    await adjust(f.packageId, 'GIFT', 50).expect(200);
    expect(await consume(f, 50)).toMatchObject({ mainUnits: 0, giftUnits: 50 });
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      mainReservedUnits: 1200,
      giftReservedUnits: 300,
    });
  });

  it('database constraints reject reservations outside gross balances', async () => {
    const f = await fixture();
    for (const value of [-1, 1201]) {
      await expect(prisma.$executeRaw`
        UPDATE "CoursePackage" SET "mainReservedUnits" = ${value}
        WHERE "id" = ${f.packageId}::uuid
      `).rejects.toThrow();
    }
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({ mainReservedUnits: 1100, mainBalanceUnits: 1200 });
    for (const value of [-1, 301]) {
      await expect(prisma.$executeRaw`
        UPDATE "CoursePackage" SET "giftReservedUnits" = ${value}
        WHERE "id" = ${f.packageId}::uuid
      `).rejects.toThrow();
    }
    await expect(prisma.$executeRaw`
      UPDATE "CoursePackage" SET "giftBalanceUnits" = 99
      WHERE "id" = ${f.packageId}::uuid
    `).rejects.toThrow();
  });
});
