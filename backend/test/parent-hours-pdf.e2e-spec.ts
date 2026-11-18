import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

const databaseUrl = process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test')) {
  throw new Error('Parent hours tests require a local *_test database');
}
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: databaseUrl, PORT: '3001', REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local', FILE_STORAGE_ROOT: './storage/test', AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock', PAYOUT_DRIVER: 'manual', MESSAGE_DRIVER: 'mock',
});

describe('parent PDF hours history', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let token: string;
  let teacherToken: string;
  let campusId: string;
  let studentId: string;
  let otherStudentId: string;
  let packageId: string;
  let actorId: string;
  const users: string[] = [];

  beforeAll(async () => {
    const { AppModule } = jest.requireActual<typeof import('../src/app.module')>('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    campusId = (await prisma.campus.create({ data: { code: `HOURS-${randomUUID()}`, name: '课时测试校区' } })).id;
    studentId = (await prisma.student.create({ data: { campusId, displayName: '课时学员' } })).id;
    otherStudentId = (await prisma.student.create({ data: { campusId, displayName: '其他学员' } })).id;
    const parent = await prisma.user.create({
      data: { displayName: '课时家长', roles: { create: { roleCode: 'PARENT', campusId } } },
    });
    actorId = parent.id;
    users.push(parent.id);
    await prisma.parentStudentBinding.create({ data: { campusId, parentUserId: parent.id, studentId, isPrimary: true } });
    token = (await app.get(AuthService).issueSessionForUser(parent.id)).accessToken;
    const teacher = await prisma.teacherProfile.create({
      data: {
        campus: { connect: { id: campusId } }, employeeCode: `HOURS-${randomUUID()}`,
        user: { create: { displayName: '课时教师', roles: { create: { roleCode: 'TEACHER', campusId } } } },
      },
    });
    users.push(teacher.userId);
    teacherToken = (await app.get(AuthService).issueSessionForUser(teacher.userId)).accessToken;
    const group = await prisma.classGroup.create({
      data: { campusId, teacherId: teacher.id, name: '历史班级', courseName: '历史书法' },
    });
    const lesson = await prisma.lessonSession.create({
      data: { campusId, teacherId: teacher.id, classGroupId: group.id,
        startsAt: new Date('2025-01-01T06:00:00Z'), endsAt: new Date('2025-01-01T07:00:00Z'),
        status: 'COMPLETED', completedAt: new Date('2025-01-01T07:00:00Z') },
    });
    packageId = (await prisma.coursePackage.create({ data: {
      campusId, studentId, name: '原始课包', paidAmountFen: 480001,
      mainBalanceUnits: 3700, giftBalanceUnits: 900, mainReservedUnits: 100, giftReservedUnits: 200,
    } })).id;
    await prisma.lessonLedgerEntry.createMany({ data: [
      { bucket: 'MAIN' as const, deltaUnits: 4800 },
      { bucket: 'GIFT' as const, deltaUnits: 1200 },
    ].map((entry) => ({
      ...entry, campusId, studentId, coursePackageId: packageId, entryType: 'GRANT' as const,
      balanceBeforeUnits: 0, balanceAfterUnits: entry.deltaUnits, idempotencyKey: randomUUID(),
      actorUserId: actorId, createdAt: new Date('2025-01-01T00:00:00Z'),
    })) });
    await prisma.lessonLedgerEntry.create({ data: {
      campusId, studentId, coursePackageId: packageId, lessonSessionId: lesson.id,
      entryType: 'CONSUME', bucket: 'MAIN', deltaUnits: -100, balanceBeforeUnits: 4800, balanceAfterUnits: 4700,
      actorUserId: actorId, idempotencyKey: randomUUID(), createdAt: new Date('2025-01-02T00:00:00Z'),
    } });
    await prisma.lessonLedgerEntry.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      campusId, studentId, coursePackageId: packageId, entryType: 'ADJUSTMENT' as const, bucket: 'MAIN' as const,
      deltaUnits: 1, balanceBeforeUnits: 0, balanceAfterUnits: 1,
      actorUserId: actorId, idempotencyKey: randomUUID(), createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    })) });
    await prisma.coursePackage.create({ data: {
      campusId, studentId, name: '过期课包', mainBalanceUnits: 9999, paidAmountFen: 999999,
      validFrom: new Date('2019-01-01T00:00:00Z'), expiresAt: new Date('2020-01-01T00:00:00Z'),
    } });
  }, 60000);
  afterAll(async () => {
    if (prisma && users.length) await prisma.user.updateMany({ where: { id: { in: users } }, data: { status: 'DISABLED' } });
    await app?.close();
  });

  const read = (query: Record<string, unknown> = {}) =>
    request(server).get('/parents/me/hours').auth(token, { type: 'bearer' }).query(query);

  it('returns immutable grants, exact paid fen and refund reservations separately', async () => {
    const response = await read().expect(200);
    expect(response.body.data).toMatchObject({
      grantedMainUnits: 4800, grantedGiftUnits: 1200, paidAmountFen: 480001,
      remainingTotalUnits: 4600, availableTotalUnits: 4300,
      mainReservedUnits: 100, giftReservedUnits: 200,
      meta: { page: 1, pageSize: 20, total: 108, totalPages: 6 },
    });
  });
  it('filters courses from the full scoped history, not the newest 100 entries', async () => {
    const response = await read({ courseName: '历史书法', direction: 'debit', pageSize: 1 }).expect(200);
    expect(response.body.data.courseNames).toEqual(['历史书法', '未分类']);
    expect(response.body.data.entries).toHaveLength(1);
    expect(response.body.data.entries[0]).toMatchObject({ courseName: '历史书法', deltaUnits: -100 });
    expect(response.body.data.meta.total).toBe(1);
    const unclassified = await read({ courseName: '未分类', page: 6, pageSize: 20 }).expect(200);
    expect(unclassified.body.data.meta.total).toBe(107);
    expect(unclassified.body.data.entries).toHaveLength(7);
  });
  it('paginates deterministically without changing facts or exposing other students', async () => {
    const first = await read({ page: 1, pageSize: 10 }).expect(200);
    const second = await read({ page: 2, pageSize: 10 }).expect(200);
    expect(second.body.data.entries).toHaveLength(10);
    expect(second.body.data.entries.some((entry: { id: string }) =>
      first.body.data.entries.some((other: { id: string }) => other.id === entry.id))).toBe(false);
    await read({ studentId: otherStudentId }).expect(403);
    await request(server).get('/parents/me/hours').auth(teacherToken, { type: 'bearer' }).expect(403);
    await read({ page: 0 }).expect(400);
    await read({ direction: 'invalid' }).expect(400);
    await read({ pageSize: 101 }).expect(400);
  });
  it('does not infer unknown historical grants from current balances', async () => {
    await prisma.coursePackage.create({ data: {
      campusId, studentId, name: '历史缺流水课包', mainBalanceUnits: 300, giftBalanceUnits: 100, paidAmountFen: 12345,
    } });
    const response = await read().expect(200);
    expect(response.body.data.grantedMainUnits).toBeNull();
    expect(response.body.data.grantedGiftUnits).toBeNull();
    expect(response.body.data.paidAmountFen).toBe(492346);
    expect(await prisma.lessonLedgerEntry.count({ where: { coursePackageId: packageId } })).toBe(108);
  });
});
