import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import type { RoleCode } from '../src/common/auth/authenticated-user';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { Workbook } from 'exceljs';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('HR tests require a local *_test database');
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
type Teacher = {
  id: string;
  name: string;
  campusId: string;
  active: boolean;
  activeClassCount: number;
  specialties: string[];
};
type TeacherPage = {
  data: { items: Teacher[]; total: number; page: number; pageSize: number };
};

describe('headquarters HR teacher directory HTTP', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let hr: string;
  let campusA: string;
  let campusB: string;
  let teacherA: string;
  let earningId: string;
  const users: string[] = [];
  const keyword = `人力验收-${randomUUID()}`;
  async function account(code: RoleCode, campusId: string | null = null) {
    const user = await prisma.user.create({
      data: {
        displayName: keyword,
        roles: { create: { roleCode: code, campusId } },
      },
    });
    users.push(user.id);
    return {
      id: user.id,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  }
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
    campusA = (
      await prisma.campus.create({
        data: { code: randomUUID(), name: `${keyword}甲校区` },
      })
    ).id;
    campusB = (
      await prisma.campus.create({
        data: { code: randomUUID(), name: `${keyword}乙校区` },
      })
    ).id;
    hr = (await account('HR')).token;
    const first = await account('TEACHER', campusA);
    const second = await account('TEACHER', campusB);
    teacherA = (
      await prisma.teacherProfile.create({
        data: {
          userId: first.id,
          campusId: campusA,
          employeeCode: randomUUID(),
          specialties: ['美术', '创意课程'],
        },
      })
    ).id;
    await prisma.teacherProfile.create({
      data: {
        userId: second.id,
        campusId: campusB,
        employeeCode: randomUUID(),
        isActive: false,
      },
    });
    const group = await prisma.classGroup.create({
      data: {
        campusId: campusA,
        teacherId: teacherA,
        name: '人力验收班',
        courseName: '美术',
      },
    });
    for (const status of ['COMPLETED', 'REVERSED'] as const) {
      const timestamps = {
        completedAt: new Date(),
        ...(status === 'REVERSED'
          ? { reversedAt: new Date(), reversalReason: '本地测试撤销' }
          : {}),
      };
      const lesson = await prisma.lessonSession.create({
        data: {
          campusId: campusA,
          teacherId: teacherA,
          classGroupId: group.id,
          startsAt: new Date(),
          endsAt: new Date(Date.now() + 3600000),
          status,
          ...timestamps,
        },
      });
      const teaching = await prisma.teachingRecord.create({
        data: {
          campusId: campusA,
          teacherId: teacherA,
          lessonSessionId: lesson.id,
          status,
          attendeeCount: 1,
          lessonUnits: 100,
          recordedByUserId: first.id,
          ...timestamps,
        },
      });
      if (status === 'COMPLETED') {
        const rule = await prisma.teacherEarningRule.create({
          data: {
            campusId: campusA,
            scopeKey: randomUUID(),
            basisType: 'PER_COMPLETED_SESSION',
            unitAmountFen: 12345,
            eligibleLessonKinds: ['REGULAR'],
            countedAttendanceStatuses: ['PRESENT'],
            version: 1,
            effectiveFrom: new Date('2020-01-01'),
            createdByUserId: first.id,
          },
        });
        const basis = await prisma.teacherEarningBasis.create({
          data: {
            campusId: campusA,
            teacherProfileId: teacherA,
            teachingRecordId: teaching.id,
            lessonSessionId: lesson.id,
            lessonKind: 'REGULAR',
            lessonUnits: 100,
            attendeeCount: 1,
            attendanceSnapshot: {},
            completedAt: teaching.completedAt,
            status: 'PRICED',
            selectedRuleId: rule.id,
          },
        });
        earningId = (
          await prisma.teacherEarningEntry.create({
            data: {
              campusId: campusA,
              teacherProfileId: teacherA,
              earningBasisId: basis.id,
              entryType: 'ACCRUAL',
              amountFen: 12345,
              status: 'PENDING_REVIEW',
              ruleSnapshot: { localTest: true },
              reviewableAt: teaching.completedAt,
            },
          })
        ).id;
      }
    }
  }, 60000);
  afterAll(async () => {
    if (prisma && users.length)
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
    await app?.close();
  });
  it('paginates across campuses without accepting a caller role override', async () => {
    const response = await request(server)
      .get('/hr/teachers')
      .auth(hr, { type: 'bearer' })
      .query({ query: keyword, page: 1, pageSize: 1 })
      .expect(200);
    expect((response.body as TeacherPage).data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
    });
    expect((response.body as TeacherPage).data.items).toHaveLength(1);
    await request(server)
      .get('/hr/teachers')
      .auth(hr, { type: 'bearer' })
      .query({ roleCode: 'SUPER_ADMIN' })
      .expect(400);
  });
  it('filters campus and effective teacher status', async () => {
    const active = await request(server)
      .get('/hr/teachers')
      .auth(hr, { type: 'bearer' })
      .query({ query: keyword, campusId: campusA, status: 'ACTIVE' })
      .expect(200);
    expect((active.body as TeacherPage).data.items).toEqual([
      expect.objectContaining({
        id: teacherA,
        campusId: campusA,
        active: true,
        activeClassCount: 1,
        specialties: ['美术', '创意课程'],
      }),
    ]);
    const inactive = await request(server)
      .get('/hr/teachers')
      .auth(hr, { type: 'bearer' })
      .query({ query: keyword, status: 'INACTIVE' })
      .expect(200);
    expect((inactive.body as TeacherPage).data.items).toEqual([
      expect.objectContaining({ campusId: campusB, active: false }),
    ]);
  });
  it('returns minimal teacher facts and excludes reversed teaching from the total', async () => {
    const response = await request(server)
      .get(`/hr/teachers/${teacherA}`)
      .auth(hr, { type: 'bearer' })
      .expect(200);
    const row = (response.body as { data: Record<string, unknown> }).data;
    expect(row).toMatchObject({
      id: teacherA,
      completedLessonCount: 1,
      activeClassCount: 1,
    });
    for (const field of [
      'staffPhone',
      'parentPhone',
      'user',
      'students',
      'earningEntries',
      'authIdentities',
    ]) {
      expect(row).not.toHaveProperty(field);
    }
    await request(server)
      .get(`/hr/teachers/${randomUUID()}`)
      .auth(hr, { type: 'bearer' })
      .expect(404);
  });
  it('paginates campus choices and rejects malformed filters', async () => {
    const response = await request(server)
      .get('/hr/campuses')
      .auth(hr, { type: 'bearer' })
      .query({ query: keyword, pageSize: 1 })
      .expect(200);
    expect(
      (response.body as { data: { total: number; items: unknown[] } }).data,
    ).toMatchObject({ total: 2 });
    expect(
      (response.body as { data: { items: unknown[] } }).data.items,
    ).toHaveLength(1);
    await request(server)
      .get('/hr/teachers')
      .auth(hr, { type: 'bearer' })
      .query({ pageSize: 1000 })
      .expect(400);
    await request(server)
      .get('/hr/teachers')
      .auth(hr, { type: 'bearer' })
      .query({ campusId: 'wrong' })
      .expect(400);
  });
  it('rejects unauthenticated, non-HR and campus-scoped HR identities', async () => {
    await request(server).get('/hr/teachers').expect(401);
    for (const role of [
      'FINANCE',
      'SUPER_ADMIN',
      'CAMPUS_MANAGER',
      'TEACHER',
      'PARENT',
      'PARTNER',
    ] as const) {
      const token = (
        await account(
          role,
          ['FINANCE', 'SUPER_ADMIN'].includes(role) ? null : campusA,
        )
      ).token;
      await request(server)
        .get('/hr/teachers')
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
    const malformed = (await account('HR', campusA)).token;
    await request(server)
      .get('/hr/teachers')
      .auth(malformed, { type: 'bearer' })
      .expect(403);
  });
  it('does not grant HR finance, account management or teaching write access', async () => {
    await request(server)
      .get('/finance/receipts')
      .auth(hr, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get('/management/finance-refunds')
      .auth(hr, { type: 'bearer' })
      .expect(403);
    await request(server)
      .post('/management/staff-accounts')
      .auth(hr, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
  });

  it('reports effective teaching totals with paginated reversed history', async () => {
    const response = await request(server)
      .get('/hr/reports/teaching')
      .auth(hr, { type: 'bearer' })
      .query({
        teacherId: teacherA,
        from: '2020-01-01',
        to: '2099-12-31',
        pageSize: 1,
      })
      .expect(200);
    const data = (response.body as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      total: 2,
      summary: {
        completedCount: 1,
        attendeeCount: 1,
        lessonUnits: 100,
        consumedUnits: 0,
      },
    });
    expect(data.items).toHaveLength(1);
    const empty = await request(server)
      .get('/hr/reports/teaching')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA, campusId: campusB })
      .expect(200);
    expect((empty.body as { data: { total: number } }).data.total).toBe(0);
  });

  it('reports stored earning amounts and current settlement without financial identity fields', async () => {
    const response = await request(server)
      .get('/hr/reports/earnings')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA })
      .expect(200);
    const data = (
      response.body as {
        data: { items: Record<string, unknown>[]; summary: unknown };
      }
    ).data;
    expect(data.summary).toMatchObject({
      netFen: 12345,
      pendingFen: 12345,
      paidFen: 0,
      processingFen: 0,
    });
    expect(data.items).toEqual([
      expect.objectContaining({
        id: earningId,
        amountFen: 12345,
        status: 'PENDING_REVIEW',
        paidFen: 0,
      }),
    ]);
    expect(data.items[0]).not.toHaveProperty('ruleSnapshot');
    expect(data.items[0]).not.toHaveProperty('payoutReference');
  });

  it('rejects invalid report dates and prevents other roles from reading reports', async () => {
    for (const endpoint of ['teaching', 'earnings']) {
      await request(server)
        .get(`/hr/reports/${endpoint}`)
        .auth(hr, { type: 'bearer' })
        .query({ from: '2026-02-30' })
        .expect(400);
      await request(server)
        .get(`/hr/reports/${endpoint}`)
        .auth(hr, { type: 'bearer' })
        .query({ from: '2026-09-02', to: '2026-09-01' })
        .expect(400);
      const finance = (await account('FINANCE')).token;
      await request(server)
        .get(`/hr/reports/${endpoint}`)
        .auth(finance, { type: 'bearer' })
        .expect(403);
    }
    const response = await request(server)
      .get('/hr/reports/teaching')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA, from: '2020-01-01', to: '2020-01-01' })
      .expect(200);
    expect((response.body as { data: { total: number } }).data.total).toBe(0);
  });
  it('exports filtered lesson fees as an audited workbook with no payment identity', async () => {
    const response = await request(server)
      .get('/hr/reports/earnings/export')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
        res.on('error', callback);
      })
      .expect(200);
    const workbook = new Workbook();
    await workbook.xlsx.load(response.body as Buffer);
    const sheet = workbook.getWorksheet('课时费明细')!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(2).values).toContain(123.45);
    expect(JSON.stringify(sheet.getRow(1).values)).not.toMatch(
      /手机号|账户|流水号/,
    );
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'HR_REPORT_EXPORT',
          details: { path: ['teacherId'], equals: teacherA },
        },
      }),
    ).toBe(1);
    const finance = (await account('FINANCE')).token;
    await request(server)
      .get('/hr/reports/earnings/export')
      .auth(finance, { type: 'bearer' })
      .expect(403);
  });
  it('uses actual ledger consumption and inclusive Shanghai day boundaries', async () => {
    const record = await prisma.teachingRecord.findFirstOrThrow({
      where: { teacherId: teacherA, status: 'COMPLETED' },
    });
    await prisma.teachingRecord.update({
      where: { id: record.id },
      data: { completedAt: new Date('2026-09-01T16:00:00Z') },
    });
    const student = await prisma.student.create({
      data: { campusId: campusA, displayName: '课耗验收学员' },
    });
    const pack = await prisma.coursePackage.create({
      data: {
        campusId: campusA,
        studentId: student.id,
        name: '本地验收课包',
        mainBalanceUnits: 850,
      },
    });
    await prisma.lessonLedgerEntry.create({
      data: {
        campusId: campusA,
        studentId: student.id,
        coursePackageId: pack.id,
        lessonSessionId: record.lessonSessionId,
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -150,
        balanceBeforeUnits: 1000,
        balanceAfterUnits: 850,
        idempotencyKey: randomUUID(),
        actorUserId: record.recordedByUserId,
      },
    });
    const response = await request(server)
      .get('/hr/reports/teaching')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA, from: '2026-09-02', to: '2026-09-02' })
      .expect(200);
    expect(
      (response.body as { data: { summary: unknown; items: unknown[] } }).data,
    ).toMatchObject({
      summary: { completedCount: 1, consumedUnits: 150, lessonUnits: 100 },
      items: [expect.objectContaining({ consumedUnits: 150 })],
    });
    const before = await request(server)
      .get('/hr/reports/teaching')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA, from: '2026-09-01', to: '2026-09-01' })
      .expect(200);
    expect((before.body as { data: { total: number } }).data.total).toBe(0);
  });

  it('keeps partial paid allocations distinct from processing and signed reversals', async () => {
    const entry = await prisma.teacherEarningEntry.findUniqueOrThrow({
      where: { id: earningId },
    });
    const teacher = await prisma.teacherProfile.findUniqueOrThrow({
      where: { id: teacherA },
    });
    const latest = await prisma.teacherWithdrawalPolicy.aggregate({
      _max: { version: true },
    });
    const policy = await prisma.teacherWithdrawalPolicy.create({
      data: {
        minimumAmountFen: 1,
        dailyRequestLimit: 10,
        version: (latest._max.version ?? 0) + 1,
        effectiveFrom: new Date('2020-01-01'),
        createdByUserId: teacher.userId,
      },
    });
    const proof = await prisma.storedFile.create({
      data: {
        purpose: 'PAYOUT_PROOF',
        storageKey: `test/hr/${randomUUID()}`,
        originalName: 'local-test.png',
        mimeType: 'image/png',
        sizeBytes: 1,
        sha256: '0'.repeat(64),
        createdByUserId: teacher.userId,
      },
    });
    await prisma.teacherEarningEntry.update({
      where: { id: earningId },
      data: {
        status: 'AVAILABLE',
        reviewedAt: new Date(),
        reviewedByUserId: teacher.userId,
      },
    });
    for (const [status, amount] of [
      ['PAID', 5000],
      ['PAYING', 2000],
      ['FAILED', 1000],
    ] as const) {
      await prisma.withdrawal.create({
        data: {
          requestNo: randomUUID(),
          campusId: campusA,
          teacherProfileId: teacherA,
          requestedByUserId: teacher.userId,
          policyId: policy.id,
          policySnapshot: {},
          amountFen: amount,
          status,
          ...(status === 'PAID'
            ? {
                paidAt: new Date(),
                paidByUserId: teacher.userId,
                payoutReference: 'LOCAL TEST ONLY',
                payoutProofFileId: proof.id,
              }
            : {}),
          allocations: {
            create: { earningEntryId: earningId, amountFen: amount },
          },
        },
      });
    }
    const response = await request(server)
      .get('/hr/reports/earnings')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA })
      .expect(200);
    expect(
      (response.body as { data: { summary: unknown } }).data.summary,
    ).toMatchObject({
      pendingFen: 0,
      approvedFen: 12345,
      paidFen: 5000,
      processingFen: 2000,
    });
    await prisma.teacherEarningEntry.update({
      where: { id: earningId },
      data: { status: 'REVERSED' },
    });
    await prisma.teacherEarningEntry.create({
      data: {
        campusId: campusA,
        teacherProfileId: teacherA,
        earningBasisId: entry.earningBasisId,
        entryType: 'REVERSAL',
        status: 'REVERSED',
        amountFen: -12345,
        reversalOfId: earningId,
        ruleSnapshot: {},
        reviewableAt: new Date(),
      },
    });
    const reversed = await request(server)
      .get('/hr/reports/earnings')
      .auth(hr, { type: 'bearer' })
      .query({ teacherId: teacherA, pageSize: 1 })
      .expect(200);
    expect(
      (reversed.body as { data: { total: number; summary: unknown } }).data,
    ).toMatchObject({
      total: 2,
      summary: {
        netFen: 0,
        approvedFen: 0,
        paidFen: 5000,
        processingFen: 2000,
      },
    });
  });
});
