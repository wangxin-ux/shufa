import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { RoleCode } from '@prisma/client';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { prepareFinanceUiFixture } from '../prisma/finance-ui-fixture';
import { Workbook } from 'exceljs';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Finance tests require a local *_test database');
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

describe('finance receipt to existing parent balance', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let auth: AuthService;
  let campusId: string;
  let studentId: string;
  let finance: string;
  const users: string[] = [];
  const runId = randomUUID();
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');

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
    auth = app.get(AuthService);
    campusId = (
      await prisma.campus.create({
        data: { code: `FIN-${runId}`, name: '财务闭环测试校区' },
      })
    ).id;
    studentId = (
      await prisma.student.create({
        data: { campusId, displayName: `收款测试-${runId}` },
      })
    ).id;
    finance = await actor('FINANCE');
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

  async function actor(roleCode: RoleCode, scope: string | null = null) {
    const user = await prisma.user.create({
      data: {
        displayName: `财务测试-${roleCode}`,
        roles: { create: { roleCode, campusId: scope } },
      },
    });
    users.push(user.id);
    return (await auth.issueSessionForUser(user.id)).accessToken;
  }

  it('prepares an isolated UI fixture idempotently without resetting balances', async () => {
    const code = `FIN-UI-${runId}`;
    const first = await prepareFinanceUiFixture(prisma, code);
    users.push(first.parentUserId);
    expect(await prepareFinanceUiFixture(prisma, code)).toEqual(first);
    expect(
      await prisma.student.count({ where: { campusId: first.campusId } }),
    ).toBe(1);
    expect(
      await prisma.coursePackage.count({
        where: { studentId: first.studentId },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          resourceId: first.studentId,
          action: 'LOCAL_FINANCE_UI_FIXTURE_CREATE',
        },
      }),
    ).toBe(1);
  });

  async function proof(token = finance) {
    const result = await request(server)
      .post('/finance/receipt-proofs')
      .auth(token, { type: 'bearer' })
      .attach('file', png, {
        filename: 'receipt.png',
        contentType: 'image/png',
      })
      .expect(201);
    return result.body.data.id as string;
  }

  it('exports the filtered receipt overview and audits access without exposing proof data', async () => {
    const exportCampus = await prisma.campus.create({
      data: { code: `FIN-EXPORT-${runId}`, name: '收款导出测试校区' },
    });
    const exportStudent = await prisma.student.create({
      data: {
        campusId: exportCampus.id,
        displayName: `导出学员-${runId}`,
      },
    });
    await receipt(12345, {
      campusId: exportCampus.id,
      studentId: exportStudent.id,
    });
    const filters = {
      campusId: exportCampus.id,
      query: '导出学员',
      from: '2026-09-01',
      to: '2026-09-01',
      status: 'UNLINKED',
    };
    const overview = await request(server)
      .get('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .query({ ...filters, pageSize: 50 })
      .expect(200);
    const exported = await request(server)
      .get('/finance/receipts/export')
      .auth(finance, { type: 'bearer' })
      .query(filters)
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
    const data = overview.body as {
      data: { total: number; summary: { amountFen: number } };
    };
    const sheet = workbook.getWorksheet('收款明细')!;
    expect(sheet.rowCount).toBe(data.data.total + 1);
    expect(sheet.getRow(2).values).toContain(123.45);
    expect(JSON.stringify(sheet.getRow(1).values)).not.toMatch(
      /手机号|凭证|账户/,
    );
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'FINANCE_RECEIPT_EXPORT',
          campusId: null,
          details: { path: ['campusId'], equals: exportCampus.id },
        },
      }),
    ).toBe(1);
    const hr = await actor('HR');
    await request(server)
      .get('/finance/receipts/export')
      .auth(hr, { type: 'bearer' })
      .expect(403);
  });

  it('exports an empty workbook for an unknown campus filter without breaking audit persistence', async () => {
    const unknownCampusId = randomUUID();
    const exported = await request(server)
      .get('/finance/receipts/export')
      .auth(finance, { type: 'bearer' })
      .query({ campusId: unknownCampusId })
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
    expect(workbook.getWorksheet('收款明细')?.rowCount).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'FINANCE_RECEIPT_EXPORT',
          campusId: null,
          details: { path: ['campusId'], equals: unknownCampusId },
        },
      }),
    ).toBe(1);
  });

  async function receipt(
    amountFen = 120000,
    overrides: Partial<{
      campusId: string;
      studentId: string;
      receivedOn: string;
    }> = {},
  ) {
    const body = {
      campusId: overrides.campusId ?? campusId,
      studentId: overrides.studentId ?? studentId,
      amountFen,
      receivedOn: overrides.receivedOn ?? '2026-09-01',
      channel: 'WECHAT',
      proofFileId: await proof(),
      note: '隔离测试',
    };
    const key = randomUUID();
    const result = await request(server)
      .post('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(body)
      .expect(201);
    return { id: result.body.data.id as string, body, key };
  }

  const issuance = {
    name: '购买12节赠3节',
    mainUnits: 1200,
    giftUnits: 300,
    validFrom: '2026-09-01T00:00:00+08:00',
    expiresAt: null,
  };

  it('records actual receipt date, replays once and exposes only minimal student data', async () => {
    const created = await receipt();
    const replay = await request(server)
      .post('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', created.key)
      .send(created.body)
      .expect(201);
    expect(replay.body.data.id).toBe(created.id);
    const listed = await request(server)
      .get('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .query({ campusId, from: '2026-09-01', to: '2026-09-01' })
      .expect(200);
    expect(
      listed.body.data.items.some(
        (item: { id: string }) => item.id === created.id,
      ),
    ).toBe(true);
    expect(listed.body.data.summary.amountFen).toBe(120000);
    expect(JSON.stringify(listed.body)).not.toMatch(
      /homeAddress|parentPhone|storageKey/,
    );
    expect(
      await prisma.auditLog.count({
        where: { resourceId: created.id, action: 'FINANCE_RECEIPT_CREATE' },
      }),
    ).toBe(1);
    await request(server)
      .patch(`/finance/receipts/${created.id}`)
      .auth(finance, { type: 'bearer' })
      .send({ amountFen: 1 })
      .expect(404);
  });

  it('grants main and gift ledger once and parent sees the existing balance', async () => {
    const created = await receipt();
    const key = randomUUID();
    const result = await request(server)
      .post(`/finance/receipts/${created.id}/issue-package`)
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(issuance)
      .expect(201);
    const packageId = result.body.data.coursePackageId as string;
    expect(result.body.data).toMatchObject({
      originalAmountFen: 120000,
      initialMainUnits: 1200,
      initialGiftUnits: 300,
      unitPriceFen: 10000,
    });
    const replay = await request(server)
      .post(`/finance/receipts/${created.id}/issue-package`)
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(issuance)
      .expect(201);
    expect(replay.body.data.coursePackageId).toBe(packageId);
    await request(server)
      .post(`/finance/receipts/${created.id}/issue-package`)
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(issuance)
      .expect(409);
    expect(
      await prisma.lessonLedgerEntry.findMany({
        where: { coursePackageId: packageId },
        orderBy: { bucket: 'asc' },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryType: 'GRANT',
          bucket: 'MAIN',
          deltaUnits: 1200,
          balanceBeforeUnits: 0,
        }),
        expect.objectContaining({
          entryType: 'GRANT',
          bucket: 'GIFT',
          deltaUnits: 300,
          balanceBeforeUnits: 0,
        }),
      ]),
    );
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: packageId },
      }),
    ).toBe(2);
    const parent = await actor('PARENT', campusId);
    await prisma.parentStudentBinding.create({
      data: {
        parentUserId: users[users.length - 1],
        studentId,
        campusId,
        isPrimary: true,
      },
    });
    const hours = await request(server)
      .get('/parents/me/hours')
      .auth(parent, { type: 'bearer' })
      .query({ studentId })
      .expect(200);
    expect(hours.body.data).toMatchObject({
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      remainingTotalUnits: 1500,
    });
    expect(
      await prisma.coursePackage.findUnique({ where: { id: packageId } }),
    ).toMatchObject({
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      paidAmountFen: 120000,
    });
    expect(
      await prisma.auditLog.count({
        where: { resourceId: created.id, action: 'FINANCE_PACKAGE_ISSUE' },
      }),
    ).toBe(1);
  });

  it('serializes concurrent different-key issuance and preserves exact original ratio without gifts', async () => {
    const created = await receipt(10000);
    const results = await Promise.all(
      [randomUUID(), randomUUID()].map((key) =>
        request(server)
          .post(`/finance/receipts/${created.id}/issue-package`)
          .auth(finance, { type: 'bearer' })
          .set('Idempotency-Key', key)
          .send({ ...issuance, mainUnits: 300, giftUnits: 0 }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    const granted = results.find((result) => result.status === 201)!.body.data;
    expect(granted).toMatchObject({
      originalAmountFen: 10000,
      initialMainUnits: 300,
      initialGiftUnits: 0,
      unitPriceFen: 3333,
    });
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: granted.coursePackageId },
      }),
    ).toBe(1);
  });

  it('rejects foreign/reused proof, invalid signature, and mismatched student campus', async () => {
    await request(server)
      .post('/finance/receipt-proofs')
      .auth(finance, { type: 'bearer' })
      .attach('file', Buffer.from('not png'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    const otherProof = await proof(await actor('FINANCE'));
    const body = {
      campusId,
      studentId,
      amountFen: 10000,
      receivedOn: '2026-09-01',
      channel: 'CASH',
      proofFileId: otherProof,
    };
    await request(server)
      .post('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(400);
    const created = await receipt();
    await request(server)
      .post('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(created.body)
      .expect(409);
    await request(server)
      .post('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, campusId: randomUUID(), proofFileId: await proof() })
      .expect(400);
    await request(server)
      .get(`/finance/receipts/${created.id}/proof`)
      .auth(finance, { type: 'bearer' })
      .expect('Content-Type', /image\/png/)
      .expect(200);
  });

  it.each([
    'HR',
    'SUPER_ADMIN',
    'CAMPUS_MANAGER',
    'PARTNER',
    'TEACHER',
    'PARENT',
    'OPERATOR',
  ] as const)('denies %s all finance endpoints', async (role) => {
    const token = await actor(
      role,
      ['CAMPUS_MANAGER', 'PARTNER', 'TEACHER', 'OPERATOR'].includes(role)
        ? campusId
        : null,
    );
    for (const path of [
      '/finance/receipts',
      '/finance/students',
      '/finance/campuses',
      `/finance/receipts/${randomUUID()}/proof`,
    ]) {
      await request(server)
        .get(path)
        .auth(token, { type: 'bearer' })
        .expect(403);
    }
    await request(server)
      .post('/finance/receipts')
      .auth(token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
  });

  it('rejects invalid date/units and leaves no package on failed issuance', async () => {
    const created = await receipt();
    for (const input of [
      { ...issuance, mainUnits: 0 },
      { ...issuance, mainUnits: 0.5 },
      { ...issuance, giftUnits: -1 },
      { ...issuance, expiresAt: '2026-08-01T00:00:00+08:00' },
    ]) {
      await request(server)
        .post(`/finance/receipts/${created.id}/issue-package`)
        .auth(finance, { type: 'bearer' })
        .set('Idempotency-Key', randomUUID())
        .send(input)
        .expect(400);
    }
    const detail = await request(server)
      .get(`/finance/receipts/${created.id}`)
      .auth(finance, { type: 'bearer' })
      .expect(200);
    expect(detail.body.data.issuance).toBeNull();
    await request(server)
      .post('/finance/receipts')
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ ...created.body, receivedOn: '2026-02-30' })
      .expect(400);
  });

  it('rolls back receipt, package, ledger, audit and claim when the final transaction write fails', async () => {
    const idempotency = app.get(IdempotencyService);
    const created = await receipt();
    const key = randomUUID();
    const beforePackages = await prisma.coursePackage.count({
      where: { studentId },
    });
    const beforeLedger = await prisma.lessonLedgerEntry.count({
      where: { studentId },
    });
    const failure = jest
      .spyOn(idempotency, 'complete')
      .mockRejectedValueOnce(new Error('Injected final write failure'));
    try {
      await request(server)
        .post(`/finance/receipts/${created.id}/issue-package`)
        .auth(finance, { type: 'bearer' })
        .set('Idempotency-Key', key)
        .send(issuance)
        .expect(500);
    } finally {
      failure.mockRestore();
    }
    expect(await prisma.coursePackage.count({ where: { studentId } })).toBe(
      beforePackages,
    );
    expect(await prisma.lessonLedgerEntry.count({ where: { studentId } })).toBe(
      beforeLedger,
    );
    expect(
      await prisma.financePackageIssuance.count({
        where: { receiptId: created.id },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { resourceId: created.id, action: 'FINANCE_PACKAGE_ISSUE' },
      }),
    ).toBe(0);
    expect(await prisma.idempotencyRecord.count({ where: { key } })).toBe(0);
    await request(server)
      .post(`/finance/receipts/${created.id}/issue-package`)
      .auth(finance, { type: 'bearer' })
      .set('Idempotency-Key', key)
      .send(issuance)
      .expect(201);
    const proofFileId = await proof();
    const receiptFailure = jest
      .spyOn(idempotency, 'complete')
      .mockRejectedValueOnce(new Error('Injected receipt write failure'));
    const receiptKey = randomUUID();
    try {
      await request(server)
        .post('/finance/receipts')
        .auth(finance, { type: 'bearer' })
        .set('Idempotency-Key', receiptKey)
        .send({ ...created.body, proofFileId })
        .expect(500);
    } finally {
      receiptFailure.mockRestore();
    }
    expect(await prisma.financeReceipt.count({ where: { proofFileId } })).toBe(
      0,
    );
    expect(
      await prisma.idempotencyRecord.count({ where: { key: receiptKey } }),
    ).toBe(0);
    expect(await prisma.storedFile.count({ where: { id: proofFileId } })).toBe(
      1,
    );
  });

  it('rejects mixed roles and campus-bound FINANCE even when finance permissions are present', async () => {
    const scoped = await actor('FINANCE', campusId);
    await request(server)
      .get('/finance/receipts')
      .auth(scoped, { type: 'bearer' })
      .expect(403);
    const mixed = await actor('FINANCE');
    await prisma.userRole.create({
      data: { userId: users[users.length - 1], roleCode: 'HR', campusId: null },
    });
    await request(server)
      .get('/finance/receipts')
      .auth(mixed, { type: 'bearer' })
      .expect(403);
  });
});
