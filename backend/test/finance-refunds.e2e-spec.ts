import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import type {
  AuthenticatedUser,
  RoleCode,
} from '../src/common/auth/authenticated-user';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { FinanceRefundService } from '../src/modules/finance/finance-refund.service';
import { ParentPortalService } from '../src/modules/parent-portal/parent-portal.service';
import { PartnerReadService } from '../src/modules/partner/partner-read.service';
import { CampusManagerSettingsService } from '../src/modules/campus-manager/campus-manager-settings.service';
import { CampusManagerStudentService } from '../src/modules/campus-manager/campus-manager-student.service';
import { ManagementWorkspaceService } from '../src/modules/management/management-workspace.service';
import request from 'supertest';
import type { Server } from 'node:http';
import { AuthService } from '../src/modules/auth/auth.service';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { LessonLedgerService } from '../src/modules/lesson-ledger/lesson-ledger.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Refund integration tests require a local *_test database');
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
type MutationResult = { id: string; status: string; version: number };
const result = (value: unknown) => value as MutationResult;
const requestBody = {
  mainUnits: 200,
  giftUnits: 100,
  amountFen: 20000,
  reason: '本地部分退费测试',
};
const image = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const file = {
  originalname: 'proof.png',
  mimetype: 'image/png',
  size: image.length,
  buffer: image,
};

describe('finance refund transactions and authorized HTTP routes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let receipts: FinanceService;
  let refunds: FinanceRefundService;
  let finance: AuthenticatedUser;
  let admin: AuthenticatedUser;
  let campusId: string;
  const users: string[] = [];

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
    prisma = app.get(PrismaService);
    receipts = app.get(FinanceService);
    refunds = app.get(FinanceRefundService);
    campusId = (
      await prisma.campus.create({
        data: { code: `RF-${randomUUID()}`, name: '退费隔离测试校区' },
      })
    ).id;
    finance = await actor('FINANCE');
    admin = await actor('SUPER_ADMIN');
  }, 60000);

  afterAll(async () => {
    if (prisma && users.length)
      await prisma.user.updateMany({
        where: { id: { in: users } },
        data: { status: 'DISABLED' },
      });
    await app?.close();
  });

  async function actor(code: RoleCode): Promise<AuthenticatedUser> {
    const scope = [
      'PARENT',
      'PARTNER',
      'CAMPUS_MANAGER',
      'TEACHER',
      'OPERATOR',
    ].includes(code)
      ? campusId
      : null;
    const user = await prisma.user.create({
      data: {
        displayName: `退费测试${code}`,
        roles: { create: { roleCode: code, campusId: scope } },
      },
    });
    users.push(user.id);
    return { userId: user.id, roles: [{ code, campusId: scope }] };
  }
  async function fixture(
    amountFen = 120000,
    mainUnits = 1200,
    giftUnits = 300,
  ) {
    const student = await prisma.student.create({
      data: { campusId, displayName: '退费测试学员' },
    });
    const proof = await receipts.uploadProof(finance, file);
    const receipt = result(
      await receipts.create(
        finance,
        {
          campusId,
          studentId: student.id,
          amountFen,
          receivedOn: '2026-09-07',
          channel: 'CASH',
          proofFileId: proof.id,
          note: '本地测试',
        },
        randomUUID(),
      ),
    );
    await receipts.issue(
      finance,
      receipt.id,
      {
        name: '退费测试课包',
        mainUnits,
        giftUnits,
        validFrom: '2026-09-01T00:00:00Z',
        expiresAt: null,
      },
      randomUUID(),
    );
    const issuance = await prisma.financePackageIssuance.findUniqueOrThrow({
      where: { receiptId: receipt.id },
    });
    return {
      receiptId: receipt.id,
      packageId: issuance.coursePackageId,
      studentId: student.id,
    };
  }
  const submit = async (
    receiptId: string,
    body = requestBody,
    key = randomUUID(),
  ) => result(await refunds.submit(finance, receiptId, body, key));
  const move = async (
    who: AuthenticatedUser,
    current: MutationResult,
    action: string,
  ) =>
    result(
      await refunds.act(
        who,
        current.id,
        { action, expectedVersion: current.version, reason: '测试状态操作' },
        randomUUID(),
      ),
    );
  const balance = (id: string) =>
    prisma.coursePackage.findUniqueOrThrow({ where: { id } });

  async function teachingFixture() {
    const teacher = await actor('TEACHER');
    const profile = await prisma.teacherProfile.create({
      data: {
        userId: teacher.userId,
        campusId,
        employeeCode: `RF-${randomUUID()}`,
      },
    });
    const group = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: profile.id,
        name: `退费竞争测试班-${randomUUID()}`,
        courseName: '验收课程',
      },
    });
    const now = new Date();
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId,
        teacherId: profile.id,
        classGroupId: group.id,
        startsAt: now,
        endsAt: new Date(now.getTime() + 3600000),
      },
    });
    const scope = {
      userId: teacher.userId,
      teacherProfileId: profile.id,
      campusId,
    };
    return { lesson, scope, now };
  }

  it('reserves but does not deduct gross, create cash payment or lesson refund entries at submission', async () => {
    const f = await fixture();
    const key = randomUUID();
    const submitted = await submit(f.receiptId, requestBody, key);
    expect(await submit(f.receiptId, requestBody, key)).toEqual(submitted);
    expect(submitted).toMatchObject({ status: 'SUBMITTED', version: 1 });
    expect(await balance(f.packageId)).toMatchObject({
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      mainReservedUnits: 200,
      giftReservedUnits: 100,
    });
    expect(
      await prisma.financeRefundPayment.count({
        where: { refundId: submitted.id },
      }),
    ).toBe(0);
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: f.packageId, entryType: 'REFUND' },
      }),
    ).toBe(0);
    expect(
      await prisma.financeRefundEvent.count({
        where: { refundId: submitted.id },
      }),
    ).toBe(1);
  });

  it('shows the parent gross, reserved and available balances independently throughout refund', async () => {
    const f = await fixture();
    const parent = await actor('PARENT');
    await prisma.parentStudentBinding.create({
      data: {
        parentUserId: parent.userId,
        studentId: f.studentId,
        campusId,
        isPrimary: true,
      },
    });
    const scope = { userId: parent.userId, campusId };
    const portal = app.get(ParentPortalService);
    const submitted = await submit(f.receiptId);
    expect(await portal.getHours(scope)).toMatchObject({
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      mainReservedUnits: 200,
      giftReservedUnits: 100,
      mainAvailableUnits: 1000,
      giftAvailableUnits: 200,
      remainingTotalUnits: 1500,
      availableTotalUnits: 1200,
      reservedTotalUnits: 300,
    });
    expect(await portal.getHome(scope)).toMatchObject({ remainingUnits: 1200 });
    await move(finance, submitted, 'WITHDRAW');
    expect(await portal.getHours(scope)).toMatchObject({
      availableTotalUnits: 1500,
      reservedTotalUnits: 0,
    });
  });

  it('uses available units for partner and manager warnings and preserves gross detail', async () => {
    const f = await fixture();
    await prisma.campus.update({
      where: { id: campusId },
      data: { lessonWarningThresholdUnits: 1250 },
    });
    await submit(f.receiptId);
    const partner = await actor('PARTNER');
    const manager = await actor('CAMPUS_MANAGER');
    const partnerService = app.get(PartnerReadService);
    expect(await partnerService.getStudent(partner, f.studentId)).toMatchObject(
      {
        totalBalanceUnits: 1500,
        availableTotalUnits: 1200,
        reservedTotalUnits: 300,
      },
    );
    expect(
      await app.get(CampusManagerStudentService).detail(manager, f.studentId),
    ).toMatchObject({
      totalBalanceUnits: 1500,
      availableTotalUnits: 1200,
      reservedTotalUnits: 300,
    });
    const warnings = await app
      .get(CampusManagerSettingsService)
      .listWarnings(manager, { page: 1, pageSize: 100 });
    expect(warnings.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: f.studentId,
          totalBalanceUnits: 1500,
          availableTotalUnits: 1200,
        }),
      ]),
    );
    const management = await app
      .get(ManagementWorkspaceService)
      .getStudent(f.studentId);
    expect(management).toMatchObject({
      lowBalance: true,
      totalBalanceUnits: 1500,
      availableTotalUnits: 1200,
    });
  });

  it.each(['WITHDRAW', 'REJECT'] as const)(
    'releases reservation on %s while retaining history',
    async (action) => {
      const f = await fixture();
      const submitted = await submit(f.receiptId);
      await move(action === 'REJECT' ? admin : finance, submitted, action);
      expect(await balance(f.packageId)).toMatchObject({
        mainBalanceUnits: 1200,
        giftBalanceUnits: 300,
        mainReservedUnits: 0,
        giftReservedUnits: 0,
      });
      expect(
        await prisma.financeRefundEvent.count({
          where: { refundId: submitted.id },
        }),
      ).toBe(2);
    },
  );

  it('requires separate review and records actual offline payment once with immutable refund ledger', async () => {
    const f = await fixture();
    const submitted = await submit(f.receiptId);
    await expect(move(finance, submitted, 'APPROVE')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      move({ ...admin, userId: finance.userId }, submitted, 'APPROVE'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const approved = await move(admin, submitted, 'APPROVE');
    await expect(move(finance, approved, 'WITHDRAW')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    const paying = await move(finance, approved, 'START_PAYMENT');
    const proof = await refunds.uploadProof(finance, file);
    const body = {
      action: 'RECORD_PAYMENT',
      expectedVersion: paying.version,
      reason: '已确认线下退费',
      payment: {
        amountFen: 20000,
        paidAt: new Date().toISOString(),
        proofFileId: proof.id,
        externalReference: `LOCAL-${randomUUID()}`,
      },
    };
    const key = randomUUID();
    const paid = result(await refunds.act(finance, paying.id, body, key));
    expect(paid.status).toBe('PAID');
    expect(await refunds.act(finance, paying.id, body, key)).toEqual(paid);
    await expect(
      refunds.act(finance, paying.id, body, randomUUID()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await balance(f.packageId)).toMatchObject({
      mainBalanceUnits: 1000,
      giftBalanceUnits: 200,
      mainReservedUnits: 0,
      giftReservedUnits: 0,
      paidAmountFen: 120000,
    });
    expect(
      await prisma.financeRefundPayment.count({ where: { refundId: paid.id } }),
    ).toBe(1);
    expect(
      await prisma.lessonLedgerEntry.findMany({
        where: { coursePackageId: f.packageId, entryType: 'REFUND' },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bucket: 'MAIN',
          deltaUnits: -200,
          balanceBeforeUnits: 1200,
          balanceAfterUnits: 1000,
        }),
        expect.objectContaining({
          bucket: 'GIFT',
          deltaUnits: -100,
          balanceBeforeUnits: 300,
          balanceAfterUnits: 200,
        }),
      ]),
    );
    expect((await refunds.readProof(admin, paid.id)).buffer).toEqual(image);
    expect(
      await prisma.financeReceipt.findUniqueOrThrow({
        where: { id: f.receiptId },
      }),
    ).toMatchObject({ amountFen: 120000 });
  });

  it('holds reservations during unknown payment outcome and requires admin confirmation of approved cancellation', async () => {
    const f = await fixture();
    let current = await move(admin, await submit(f.receiptId), 'APPROVE');
    current = await move(finance, current, 'REQUEST_CANCELLATION');
    await expect(
      move(finance, current, 'CONFIRM_CANCELLATION'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    current = await move(admin, current, 'DENY_CANCELLATION');
    current = await move(finance, current, 'START_PAYMENT');
    current = await move(finance, current, 'MARK_UNCERTAIN');
    await expect(
      move(admin, current, 'CONFIRM_CANCELLATION'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await balance(f.packageId)).toMatchObject({
      mainReservedUnits: 200,
      giftReservedUnits: 100,
      mainBalanceUnits: 1200,
    });
    const second = await fixture();
    let cancel = await move(admin, await submit(second.receiptId), 'APPROVE');
    cancel = await move(finance, cancel, 'REQUEST_CANCELLATION');
    await move(admin, cancel, 'CONFIRM_CANCELLATION');
    expect(await balance(second.packageId)).toMatchObject({
      mainReservedUnits: 0,
      giftReservedUnits: 0,
    });
  });

  it('serializes concurrent requests against receipt money and package quantities', async () => {
    const f = await fixture(10000, 300, 100);
    const body = {
      ...requestBody,
      mainUnits: 100,
      giftUnits: 0,
      amountFen: 6000,
    };
    const results = await Promise.allSettled([
      submit(f.receiptId, body),
      submit(f.receiptId, body),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(f.packageId)).toMatchObject({
      mainReservedUnits: 100,
      mainBalanceUnits: 300,
    });
    const quantity = await fixture();
    const competing = {
      ...requestBody,
      mainUnits: 700,
      giftUnits: 0,
      amountFen: 100,
    };
    const unitResults = await Promise.allSettled([
      submit(quantity.receiptId, competing),
      submit(quantity.receiptId, competing),
    ]);
    expect(unitResults.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('serializes actual consumption against refund reservations and preserves reservations on teaching reversal', async () => {
    const f = await fixture(120000, 1200, 0);
    const teaching = await teachingFixture();
    const consume = (units: number) =>
      prisma.$transaction((tx) =>
        app.get(LessonLedgerService).consumeStudentLessonUnits(tx, {
          scope: teaching.scope,
          studentId: f.studentId,
          lessonSessionId: teaching.lesson.id,
          requestedUnits: units,
          idempotencyKey: randomUUID(),
          occurredAt: teaching.now,
          reason: '退费竞争扣课',
        }),
      );
    const competing = await Promise.allSettled([
      submit(f.receiptId, {
        ...requestBody,
        mainUnits: 1000,
        giftUnits: 0,
        amountFen: 100000,
      }),
      consume(1000),
    ]);
    expect(
      competing.filter((entry) => entry.status === 'fulfilled'),
    ).toHaveLength(1);
    const before = await balance(f.packageId);
    expect(before.mainBalanceUnits - before.mainReservedUnits).toBe(200);
    if (competing[0].status === 'fulfilled')
      await move(finance, competing[0].value, 'WITHDRAW');
    const reversalFixture = await fixture(120000, 1200, 0);
    const reversalTeaching = await teachingFixture();
    await prisma.$transaction((tx) =>
      app.get(LessonLedgerService).consumeStudentLessonUnits(tx, {
        scope: reversalTeaching.scope,
        studentId: reversalFixture.studentId,
        lessonSessionId: reversalTeaching.lesson.id,
        requestedUnits: 1000,
        idempotencyKey: randomUUID(),
        occurredAt: reversalTeaching.now,
        reason: '退费预留前扣课',
      }),
    );
    await prisma.lessonSession.update({
      where: { id: reversalTeaching.lesson.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await prisma.teachingRecord.create({
      data: {
        campusId,
        lessonSessionId: reversalTeaching.lesson.id,
        teacherId: reversalTeaching.scope.teacherProfileId,
        attendeeCount: 1,
        lessonUnits: 1000,
        recordedByUserId: reversalTeaching.scope.userId,
        completedAt: new Date(),
      },
    });
    await submit(reversalFixture.receiptId, {
      ...requestBody,
      mainUnits: 100,
      giftUnits: 0,
      amountFen: 10000,
    });
    await app.get(AttendanceService).reverseLesson(
      reversalTeaching.scope,
      reversalTeaching.lesson.id,
      {
        lessonVersion: reversalTeaching.lesson.version,
        reason: '本地撤销测试',
      },
      randomUUID(),
    );
    expect(await balance(reversalFixture.packageId)).toMatchObject({
      mainBalanceUnits: 1200,
      mainReservedUnits: 100,
    });
  });

  it('caps subsequent requests by paid money even when gross lessons remain', async () => {
    const f = await fixture(10000, 300, 0);
    let current = await submit(f.receiptId, {
      ...requestBody,
      mainUnits: 100,
      giftUnits: 0,
      amountFen: 8000,
    });
    current = await move(admin, current, 'APPROVE');
    current = await move(finance, current, 'START_PAYMENT');
    const proof = await refunds.uploadProof(finance, file);
    await refunds.act(
      finance,
      current.id,
      {
        action: 'RECORD_PAYMENT',
        expectedVersion: current.version,
        reason: '本地测试退款',
        payment: {
          amountFen: 8000,
          paidAt: new Date().toISOString(),
          proofFileId: proof.id,
          externalReference: `LOCAL-${randomUUID()}`,
        },
      },
      randomUUID(),
    );
    expect(
      await refunds.quote(finance, f.receiptId, {
        mainUnits: 100,
        giftUnits: 0,
      }),
    ).toMatchObject({
      referenceAmountFen: 3333,
      suggestedAmountFen: 2000,
      maxAmountFen: 2000,
    });
    await expect(
      submit(f.receiptId, {
        ...requestBody,
        mainUnits: 100,
        giftUnits: 0,
        amountFen: 2001,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await balance(f.packageId)).toMatchObject({
      mainBalanceUnits: 200,
      mainReservedUnits: 0,
    });
  });

  it('rolls back submit and completed payment if idempotency final write fails', async () => {
    const f = await fixture();
    const idempotency = app.get(IdempotencyService);
    const key = randomUUID();
    let fail = jest
      .spyOn(idempotency, 'complete')
      .mockRejectedValueOnce(new Error('Injected final write'));
    try {
      await expect(submit(f.receiptId, requestBody, key)).rejects.toThrow(
        'Injected final write',
      );
    } finally {
      fail.mockRestore();
    }
    expect(await balance(f.packageId)).toMatchObject({
      mainReservedUnits: 0,
      giftReservedUnits: 0,
    });
    expect(
      await prisma.financeRefundRequest.count({
        where: { issuance: { receiptId: f.receiptId } },
      }),
    ).toBe(0);
    const submitted = await submit(f.receiptId, requestBody, key);
    const paying = await move(
      finance,
      await move(admin, submitted, 'APPROVE'),
      'START_PAYMENT',
    );
    const proof = await refunds.uploadProof(finance, file);
    const payment = {
      action: 'RECORD_PAYMENT',
      expectedVersion: paying.version,
      reason: '付款登记',
      payment: {
        amountFen: 20000,
        paidAt: new Date().toISOString(),
        proofFileId: proof.id,
        externalReference: `LOCAL-${randomUUID()}`,
      },
    };
    const paymentKey = randomUUID();
    fail = jest
      .spyOn(idempotency, 'complete')
      .mockRejectedValueOnce(new Error('Injected payment final write'));
    try {
      await expect(
        refunds.act(finance, paying.id, payment, paymentKey),
      ).rejects.toThrow('Injected payment final write');
    } finally {
      fail.mockRestore();
    }
    expect(await balance(f.packageId)).toMatchObject({
      mainBalanceUnits: 1200,
      mainReservedUnits: 200,
    });
    expect(
      await prisma.financeRefundPayment.count({
        where: { refundId: paying.id },
      }),
    ).toBe(0);
    expect(
      await prisma.lessonLedgerEntry.count({
        where: { coursePackageId: f.packageId, entryType: 'REFUND' },
      }),
    ).toBe(0);
    expect(
      await prisma.financeRefundEvent.count({ where: { refundId: paying.id } }),
    ).toBe(3);
    expect(
      await prisma.idempotencyRecord.count({ where: { key: paymentKey } }),
    ).toBe(0);
    expect(
      result(await refunds.act(finance, paying.id, payment, paymentKey)).status,
    ).toBe('PAID');
  });

  it('rejects unrelated roles, wrong proof owner, amount mismatch and future payment date', async () => {
    const f = await fixture();
    await expect(
      refunds.submit(await actor('HR'), f.receiptId, requestBody, randomUUID()),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const submitted = await submit(f.receiptId);
    const paying = await move(
      finance,
      await move(admin, submitted, 'APPROVE'),
      'START_PAYMENT',
    );
    const foreign = await refunds.uploadProof(await actor('FINANCE'), file);
    const proof = await refunds.uploadProof(finance, file);
    const payment = {
      amountFen: 20000,
      paidAt: new Date().toISOString(),
      proofFileId: proof.id,
      externalReference: `LOCAL-${randomUUID()}`,
    };
    for (const bad of [
      { ...payment, amountFen: 19999 },
      { ...payment, proofFileId: foreign.id },
      { ...payment, paidAt: new Date(Date.now() + 86400000).toISOString() },
    ]) {
      await expect(
        refunds.act(
          finance,
          paying.id,
          {
            action: 'RECORD_PAYMENT',
            expectedVersion: paying.version,
            reason: '校验',
            payment: bad,
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(await balance(f.packageId)).toMatchObject({
      mainBalanceUnits: 1200,
      mainReservedUnits: 200,
    });
  });

  it('enforces separate HTTP submit/review/payment permissions and validates incoming requests', async () => {
    const f = await fixture();
    const server = app.getHttpServer() as Server;
    const token = async (who: AuthenticatedUser) =>
      (await app.get(AuthService).issueSessionForUser(who.userId)).accessToken;
    const fin = await token(finance);
    const total = await token(admin);
    const hr = await token(await actor('HR'));
    const quote = await request(server)
      .get(`/finance/receipts/${f.receiptId}/refund-quote`)
      .auth(fin, { type: 'bearer' })
      .query({ mainUnits: 200, giftUnits: 100 })
      .expect(200);
    expect((quote.body as { data: unknown }).data).toMatchObject({
      referenceAmountFen: 20000,
      suggestedAmountFen: 20000,
      maxAmountFen: 120000,
    });
    await request(server)
      .get('/finance/refunds')
      .auth(hr, { type: 'bearer' })
      .expect(403);
    await request(server)
      .get('/management/finance-refunds')
      .auth(fin, { type: 'bearer' })
      .expect(403);
    await request(server)
      .post(`/finance/receipts/${f.receiptId}/refunds`)
      .auth(total, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(requestBody)
      .expect(403);
    await request(server)
      .post(`/finance/receipts/${f.receiptId}/refunds`)
      .auth(fin, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ ...requestBody, mainUnits: -1 })
      .expect(400);
    const created = await request(server)
      .post(`/finance/receipts/${f.receiptId}/refunds`)
      .auth(fin, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send(requestBody)
      .expect(201);
    const current = (created.body as { data: MutationResult }).data;
    await request(server)
      .post(`/finance/refunds/${current.id}/actions`)
      .auth(fin, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'APPROVE', expectedVersion: 1, reason: '越权审核' })
      .expect(403);
    const approved = await request(server)
      .post(`/management/finance-refunds/${current.id}/actions`)
      .auth(total, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'APPROVE', expectedVersion: 1, reason: '审核通过' })
      .expect(200);
    expect((approved.body as { data: MutationResult }).data.status).toBe(
      'APPROVED',
    );
    await request(server)
      .post(`/finance/refunds/${current.id}/payment-actions`)
      .auth(total, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ action: 'START_PAYMENT', expectedVersion: 2, reason: '越权办理' })
      .expect(403);
    await request(server)
      .get('/finance/refunds')
      .auth(fin, { type: 'bearer' })
      .query({ receiptId: f.receiptId })
      .expect(200);
  });
});
