import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { RoleCode, StoredFilePurpose } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Finance report tests require a local *_test database');
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
  TZ: 'Asia/Shanghai',
});

type Fixture = {
  campusId: string;
  studentId: string;
  packageId: string;
  lessonId: string;
  teacherUserId: string;
  teacherId: string;
};
type ConsumptionEnvelope = {
  data: {
    items: Array<{
      entryType: string;
      bucket: string;
      units: number;
      amountFen: number | null;
      packageName: string;
      amountStatus: string;
      campusId: string;
    }>;
    summary: {
      mainUnits: number;
      giftUnits: number;
      knownAmountFen: number;
      pendingCheckCount: number;
    };
  };
};
type RefundEnvelope = {
  data: {
    total: number;
    summary: { actualRefundFen: number; mainUnits: number; giftUnits: number };
    items: Array<{
      campusId: string;
      amountFen: number;
      mainUnits: number;
      giftUnits: number;
    }>;
  };
};

describe('headquarters finance lesson-consumption and paid-refund reports', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let finance: string;
  let financeUserId: string;
  let campusA: Fixture;
  let campusB: Fixture;
  let historical: Fixture;
  const users: string[] = [];
  const runId = randomUUID();

  async function actor(roleCode: RoleCode, campusId: string | null = null) {
    const user = await prisma.user.create({
      data: {
        displayName: `财务报表-${roleCode}-${runId}`,
        roles: { create: { roleCode, campusId } },
      },
    });
    users.push(user.id);
    return {
      id: user.id,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  }

  async function storedFile(
    createdByUserId: string,
    purpose: StoredFilePurpose,
  ) {
    return prisma.storedFile.create({
      data: {
        purpose,
        storageKey: `finance-reports/${randomUUID()}.png`,
        originalName: '本地测试.png',
        mimeType: 'image/png',
        sizeBytes: 12,
        sha256: 'a'.repeat(64),
        createdByUserId,
      },
    });
  }

  async function baseFixture(
    label: string,
    withIssuance = true,
  ): Promise<Fixture> {
    const campus = await prisma.campus.create({
      data: { code: randomUUID(), name: `${label}-${runId}` },
    });
    const teacher = await actor('TEACHER', campus.id);
    const profile = await prisma.teacherProfile.create({
      data: {
        userId: teacher.id,
        campusId: campus.id,
        employeeCode: randomUUID(),
      },
    });
    const student = await prisma.student.create({
      data: {
        campusId: campus.id,
        displayName: `${label}学员`,
        homeAddress: '不应返回的地址',
      },
    });
    const group = await prisma.classGroup.create({
      data: {
        campusId: campus.id,
        teacherId: profile.id,
        name: `${label}班-${runId}`,
        courseName: `${label}课程`,
      },
    });
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId: campus.id,
        classGroupId: group.id,
        teacherId: profile.id,
        startsAt: new Date('2026-09-08T10:00:00+08:00'),
        endsAt: new Date('2026-09-08T11:00:00+08:00'),
        status: 'COMPLETED',
        completedAt: new Date('2026-09-08T10:55:00+08:00'),
      },
    });
    const coursePackage = await prisma.coursePackage.create({
      data: {
        campusId: campus.id,
        studentId: student.id,
        name: `${label}课包`,
        mainBalanceUnits: 10000,
        giftBalanceUnits: 10000,
        paidAmountFen: withIssuance ? 10000 : 0,
      },
    });
    if (withIssuance) {
      const proof = await storedFile(financeUserId, 'FINANCE_RECEIPT_PROOF');
      const receipt = await prisma.financeReceipt.create({
        data: {
          campusId: campus.id,
          studentId: student.id,
          amountFen: 10000,
          receivedOn: new Date('2026-09-01T00:00:00Z'),
          channel: 'CASH',
          proofFileId: proof.id,
          createdByUserId: financeUserId,
        },
      });
      await prisma.financePackageIssuance.create({
        data: {
          receiptId: receipt.id,
          coursePackageId: coursePackage.id,
          originalAmountFen: 10000,
          initialMainUnits: 300,
          initialGiftUnits: 100,
          name: coursePackage.name,
          validFrom: new Date('2026-09-01T00:00:00+08:00'),
          issuedByUserId: financeUserId,
        },
      });
    }
    return {
      campusId: campus.id,
      studentId: student.id,
      packageId: coursePackage.id,
      lessonId: lesson.id,
      teacherUserId: teacher.id,
      teacherId: profile.id,
    };
  }

  async function ledger(
    fixture: Fixture,
    input: {
      type: 'CONSUME' | 'REVERSAL' | 'REFUND' | 'ADJUSTMENT';
      bucket?: 'MAIN' | 'GIFT';
      units: number;
      createdAt: string;
      reversalOfId?: string;
      lessonId?: string | null;
      financeRefundId?: string;
    },
  ) {
    return prisma.lessonLedgerEntry.create({
      data: {
        campusId: fixture.campusId,
        studentId: fixture.studentId,
        coursePackageId: fixture.packageId,
        lessonSessionId:
          input.lessonId === undefined ? fixture.lessonId : input.lessonId,
        entryType: input.type,
        bucket: input.bucket ?? 'MAIN',
        deltaUnits: input.units,
        balanceBeforeUnits: 10000,
        balanceAfterUnits: 10000 + input.units,
        idempotencyKey: randomUUID(),
        reversalOfId: input.reversalOfId,
        financeRefundId: input.financeRefundId,
        actorUserId: fixture.teacherUserId,
        createdAt: new Date(input.createdAt),
      },
    });
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
    const financeActor = await actor('FINANCE');
    finance = financeActor.token;
    financeUserId = financeActor.id;
    campusA = await baseFixture('课耗甲校区');
    campusB = await baseFixture('课耗乙校区');

    const previousLesson = await prisma.lessonSession.create({
      data: {
        campusId: campusA.campusId,
        classGroupId: (
          await prisma.lessonSession.findUniqueOrThrow({
            where: { id: campusA.lessonId },
          })
        ).classGroupId,
        teacherId: campusA.teacherId,
        startsAt: new Date('2026-09-07T10:00:00+08:00'),
        endsAt: new Date('2026-09-07T11:00:00+08:00'),
        status: 'COMPLETED',
        completedAt: new Date('2026-09-07T10:55:00+08:00'),
      },
    });
    const first = await ledger(campusA, {
      type: 'CONSUME',
      units: -100,
      createdAt: '2026-09-07T11:00:00+08:00',
      lessonId: previousLesson.id,
    });
    await ledger(campusA, {
      type: 'CONSUME',
      units: -100,
      createdAt: '2026-09-08T11:00:00+08:00',
    });
    await ledger(campusA, {
      type: 'REVERSAL',
      units: 100,
      createdAt: '2026-09-08T11:01:00+08:00',
      reversalOfId: first.id,
    });
    await ledger(campusA, {
      type: 'CONSUME',
      units: -100,
      createdAt: '2026-09-08T11:02:00+08:00',
    });
    await ledger(campusA, {
      type: 'CONSUME',
      bucket: 'GIFT',
      units: -100,
      createdAt: '2026-09-08T11:03:00+08:00',
    });
    await ledger(campusA, {
      type: 'ADJUSTMENT',
      units: -20,
      createdAt: '2026-09-08T11:05:00+08:00',
    });
    await ledger(campusB, {
      type: 'CONSUME',
      units: -100,
      createdAt: '2026-09-08T11:00:00+08:00',
    });
    historical = await baseFixture('历史无快照', false);
    await ledger(historical, {
      type: 'CONSUME',
      units: -50,
      createdAt: '2026-09-08T12:00:00+08:00',
    });

    const paidProof = await storedFile(financeUserId, 'FINANCE_REFUND_PROOF');
    const issuance = await prisma.financePackageIssuance.findUniqueOrThrow({
      where: { coursePackageId: campusA.packageId },
    });
    const paid = await prisma.financeRefundRequest.create({
      data: {
        issuanceId: issuance.id,
        mainUnits: 100,
        giftUnits: 20,
        referenceAmountFen: 3333,
        amountFen: 3200,
        reason: '报表测试实退',
        status: 'PAID',
        requestedByUserId: financeUserId,
      },
    });
    await prisma.financeRefundPayment.create({
      data: {
        refundId: paid.id,
        amountFen: 3200,
        paidAt: new Date('2026-09-08T23:59:59+08:00'),
        proofFileId: paidProof.id,
        externalReference: `敏感流水-${randomUUID()}`,
        recordedByUserId: financeUserId,
      },
    });
    await ledger(campusA, {
      type: 'REFUND',
      units: -20,
      createdAt: '2026-09-08T23:59:59+08:00',
      lessonId: null,
      financeRefundId: paid.id,
    });
    const payingProof = await storedFile(financeUserId, 'FINANCE_REFUND_PROOF');
    const paying = await prisma.financeRefundRequest.create({
      data: {
        issuanceId: issuance.id,
        mainUnits: 1,
        giftUnits: 0,
        referenceAmountFen: 1,
        amountFen: 1,
        reason: '非已付',
        status: 'PAYING',
        requestedByUserId: financeUserId,
      },
    });
    await prisma.financeRefundPayment.create({
      data: {
        refundId: paying.id,
        amountFen: 1,
        paidAt: new Date('2026-09-08T12:00:00+08:00'),
        proofFileId: payingProof.id,
        externalReference: randomUUID(),
        recordedByUserId: financeUserId,
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (prisma && users.length)
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
    await app?.close();
  });

  it('filters by Shanghai completion date and campus while preserving signed allocation facts', async () => {
    const response = await request(server)
      .get('/finance/reports/lesson-consumption')
      .auth(finance, { type: 'bearer' })
      .query({
        campusId: campusA.campusId,
        from: '2026-09-08',
        to: '2026-09-08',
        pageSize: 50,
      })
      .expect(200);
    const body = response.body as unknown as ConsumptionEnvelope;
    expect(body.data.summary).toEqual({
      mainUnits: 100,
      giftUnits: 100,
      knownAmountFen: 3334,
      pendingCheckCount: 0,
    });
    expect(
      body.data.items.map((item) => [
        item.entryType,
        item.bucket,
        item.units,
        item.amountFen,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['CONSUME', 'MAIN', 100, 3334],
        ['REVERSAL', 'MAIN', -100, -3333],
        ['CONSUME', 'MAIN', 100, 3333],
        ['CONSUME', 'GIFT', 100, 0],
      ]),
    );
    expect(JSON.stringify(response.body)).not.toMatch(
      /地址|电话|proof|storageKey|REFUND|ADJUSTMENT/,
    );
  });

  it('marks historical packages without issuance pending and keeps campus filtering independent', async () => {
    const response = await request(server)
      .get('/finance/reports/lesson-consumption')
      .auth(finance, { type: 'bearer' })
      .query({
        campusId: historical.campusId,
        from: '2026-09-08',
        to: '2026-09-08',
      })
      .expect(200);
    const body = response.body as unknown as ConsumptionEnvelope;
    expect(body.data.items).toEqual([
      expect.objectContaining({
        packageName: '历史无快照课包',
        amountFen: null,
        amountStatus: 'PENDING_CHECK',
      }),
    ]);
    expect(body.data.summary.pendingCheckCount).toBe(1);
    const otherCampus = await request(server)
      .get('/finance/reports/lesson-consumption')
      .auth(finance, { type: 'bearer' })
      .query({
        campusId: campusB.campusId,
        from: '2026-09-08',
        to: '2026-09-08',
      })
      .expect(200);
    const otherBody = otherCampus.body as unknown as ConsumptionEnvelope;
    expect(otherBody.data.items).toEqual([
      expect.objectContaining({
        campusId: campusB.campusId,
        amountStatus: 'KNOWN',
      }),
    ]);
  });

  it('reports only PAID refund facts by paidAt without payment secrets', async () => {
    const response = await request(server)
      .get('/finance/reports/refunds')
      .auth(finance, { type: 'bearer' })
      .query({
        campusId: campusA.campusId,
        from: '2026-09-08',
        to: '2026-09-08',
      })
      .expect(200);
    const body = response.body as unknown as RefundEnvelope;
    expect(body.data).toMatchObject({
      total: 1,
      summary: { actualRefundFen: 3200, mainUnits: 100, giftUnits: 20 },
      items: [
        expect.objectContaining({
          campusId: campusA.campusId,
          amountFen: 3200,
          mainUnits: 100,
          giftUnits: 20,
        }),
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /externalReference|proof|recordedBy|reason|phone|account|敏感流水/,
    );
  });

  it('exports the same filtered rows, audits with headquarters scope, and allows unknown campuses', async () => {
    const exported = await request(server)
      .get('/finance/reports/lesson-consumption/export')
      .auth(finance, { type: 'bearer' })
      .query({
        campusId: campusA.campusId,
        from: '2026-09-08',
        to: '2026-09-08',
      })
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
        res.on('error', callback);
      })
      .expect(200);
    const workbook = new Workbook();
    await workbook.xlsx.load(exported.body as Buffer);
    expect(workbook.getWorksheet('课耗明细')?.rowCount).toBe(5);
    expect(
      JSON.stringify(workbook.getWorksheet('课耗明细')?.getRow(1).values),
    ).not.toMatch(/电话|凭证|账户/);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'FINANCE_REPORT_EXPORT',
          campusId: null,
          details: { path: ['campusId'], equals: campusA.campusId },
        },
      }),
    ).toBe(1);

    const unknown = randomUUID();
    await request(server)
      .get('/finance/reports/refunds/export')
      .auth(finance, { type: 'bearer' })
      .query({ campusId: unknown })
      .expect(200);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'FINANCE_REPORT_EXPORT',
          campusId: null,
          details: { path: ['campusId'], equals: unknown },
        },
      }),
    ).toBe(1);
  });

  it('rejects list queries and exports over 5000 rows before materialization', async () => {
    const large = await baseFixture('导出上限', false);
    await prisma.lessonLedgerEntry.createMany({
      data: Array.from({ length: 5001 }, (_, index) => ({
        campusId: large.campusId,
        studentId: large.studentId,
        coursePackageId: large.packageId,
        lessonSessionId: large.lessonId,
        entryType: 'CONSUME' as const,
        bucket: 'MAIN' as const,
        deltaUnits: -1,
        balanceBeforeUnits: 10000 - index,
        balanceAfterUnits: 9999 - index,
        idempotencyKey: randomUUID(),
        actorUserId: large.teacherUserId,
        createdAt: new Date(
          `2026-09-08T${String(12 + Math.floor(index / 1000)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00+08:00`,
        ),
      })),
    });
    await request(server)
      .get('/finance/reports/lesson-consumption')
      .auth(finance, { type: 'bearer' })
      .query({ campusId: large.campusId })
      .expect(400);
    await request(server)
      .get('/finance/reports/lesson-consumption/export')
      .auth(finance, { type: 'bearer' })
      .query({ campusId: large.campusId })
      .expect(400);
  }, 30_000);

  it('rejects non-finance, mixed-role and campus-bound finance identities', async () => {
    for (const role of ['HR', 'SUPER_ADMIN', 'CAMPUS_MANAGER'] as const) {
      const current = await actor(
        role,
        role === 'CAMPUS_MANAGER' ? campusA.campusId : null,
      );
      await request(server)
        .get('/finance/reports/refunds')
        .auth(current.token, { type: 'bearer' })
        .expect(403);
    }
    const scoped = await actor('FINANCE', campusA.campusId);
    await request(server)
      .get('/finance/reports/lesson-consumption')
      .auth(scoped.token, { type: 'bearer' })
      .expect(403);
    const mixed = await actor('FINANCE');
    await prisma.userRole.create({
      data: { userId: mixed.id, roleCode: 'HR', campusId: null },
    });
    await request(server)
      .get('/finance/reports/refunds')
      .auth(mixed.token, { type: 'bearer' })
      .expect(403);
  });

  it('validates real calendar dates and range order', async () => {
    await request(server)
      .get('/finance/reports/refunds')
      .auth(finance, { type: 'bearer' })
      .query({ from: '2026-09-09', to: '2026-09-08' })
      .expect(400);
    await request(server)
      .get('/finance/reports/refunds')
      .auth(finance, { type: 'bearer' })
      .query({ from: '2026-02-30' })
      .expect(400);
  });
});
