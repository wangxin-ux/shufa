import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type {
  AuthenticatedUser,
  RoleCode,
} from '../src/common/auth/authenticated-user';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AttendanceService } from '../src/modules/attendance/attendance.service';
import { FinanceCorrectionService } from '../src/modules/finance/finance-correction.service';
import { FinanceRefundService } from '../src/modules/finance/finance-refund.service';
import { FinanceReportService } from '../src/modules/finance/finance-report.service';
import { FinanceService } from '../src/modules/finance/finance.service';
import { LessonLedgerService } from '../src/modules/lesson-ledger/lesson-ledger.service';
import { ManagementWorkspaceService } from '../src/modules/management/management-workspace.service';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Finance correction tests require a local *_test database');
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

type CorrectionResult = {
  id: string;
  type: 'VOID' | 'REPLACE';
  status: string;
  version: number;
  correctionEffectFen: number;
};
type Fixture = {
  receiptId: string;
  issuanceId: string;
  packageId: string;
  studentId: string;
  studentName: string;
  receiptBefore: unknown;
  issuanceBefore: unknown;
  grantsBefore: unknown;
};
type Replacement = {
  campusId: string;
  studentId: string;
  amountFen: number;
  receivedOn: string;
  channel: string;
  proofFileId: string;
  note: string;
  package: {
    name: string;
    mainUnits: number;
    giftUnits: number;
    validFrom: string;
    expiresAt: string | null;
  };
};
type CorrectionRow = {
  id: string;
  originalIssuanceId: string;
  originalAmountFen: number;
  sourcePackageVersion: number;
  replacementReceiptId: string | null;
  requestedByUserId: string;
  reviewedByUserId: string | null;
  appliedByUserId: string | null;
  status: string;
};
type CorrectionLedgerRow = {
  id: string;
  bucket: string;
  deltaUnits: number;
  reversalOfId: string;
  financeCorrectionId: string;
};

const result = (value: unknown) => value as CorrectionResult;
const image = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const file = {
  originalname: 'correction-proof.png',
  mimetype: 'image/png',
  size: image.length,
  buffer: image,
};

describe('finance receipt correction review and application', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let receipts: FinanceService;
  let corrections: FinanceCorrectionService;
  let refundService: FinanceRefundService;
  let reports: FinanceReportService;
  let ledger: LessonLedgerService;
  let attendance: AttendanceService;
  let management: ManagementWorkspaceService;
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
    await app.init();
    prisma = app.get(PrismaService);
    receipts = app.get(FinanceService);
    corrections = app.get(FinanceCorrectionService);
    refundService = app.get(FinanceRefundService);
    reports = app.get(FinanceReportService);
    ledger = app.get(LessonLedgerService);
    attendance = app.get(AttendanceService);
    management = app.get(ManagementWorkspaceService);
    campusId = (
      await prisma.campus.create({
        data: {
          code: `FC-${randomUUID()}`,
          name: '财务纠错隔离测试校区',
        },
      })
    ).id;
    finance = await actor('FINANCE');
    admin = await actor('SUPER_ADMIN');
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

  async function actor(
    roleCode: RoleCode,
    scope: string | null = null,
  ): Promise<AuthenticatedUser> {
    const user = await prisma.user.create({
      data: {
        displayName: `纠错测试-${roleCode}`,
        roles: { create: { roleCode, campusId: scope } },
      },
    });
    users.push(user.id);
    return { userId: user.id, roles: [{ code: roleCode, campusId: scope }] };
  }

  async function fixture(
    amountFen = 120000,
    mainUnits = 1200,
    giftUnits = 300,
  ): Promise<Fixture> {
    const student = await prisma.student.create({
      data: {
        campusId,
        displayName: `纠错测试学员-${randomUUID()}`,
      },
    });
    const proof = await receipts.uploadProof(finance, file);
    const receipt = result(
      await receipts.create(
        finance,
        {
          campusId,
          studentId: student.id,
          amountFen,
          receivedOn: '2026-09-01',
          channel: 'CASH',
          proofFileId: proof.id,
          note: '原始收款必须保留',
        },
        randomUUID(),
      ),
    );
    await receipts.issue(
      finance,
      receipt.id,
      {
        name: '原始课包',
        mainUnits,
        giftUnits,
        validFrom: '2026-09-01T00:00:00+08:00',
        expiresAt: null,
      },
      randomUUID(),
    );
    const issuance = await prisma.financePackageIssuance.findUniqueOrThrow({
      where: { receiptId: receipt.id },
    });
    return {
      receiptId: receipt.id,
      issuanceId: issuance.id,
      packageId: issuance.coursePackageId,
      studentId: student.id,
      studentName: student.displayName,
      receiptBefore: await prisma.financeReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
      }),
      issuanceBefore: issuance,
      grantsBefore: await prisma.lessonLedgerEntry.findMany({
        where: {
          coursePackageId: issuance.coursePackageId,
          entryType: 'GRANT',
        },
        orderBy: { bucket: 'asc' },
      }),
    };
  }

  async function replacement(
    f: Fixture,
    amountFen = 100000,
    proofOwner = finance,
  ): Promise<Replacement> {
    const proof = await receipts.uploadProof(proofOwner, file);
    return {
      campusId,
      studentId: f.studentId,
      amountFen,
      receivedOn: '2026-09-02',
      channel: 'BANK',
      proofFileId: proof.id,
      note: '替代记录，不是第二笔实际收款',
      package: {
        name: '替代课包',
        mainUnits: 1000,
        giftUnits: 100,
        validFrom: '2026-09-02T00:00:00+08:00',
        expiresAt: '2027-09-02T00:00:00+08:00',
      },
    };
  }

  const submit = async (
    f: Fixture,
    input:
      | { type: 'VOID'; reason: string }
      | { type: 'REPLACE'; reason: string; replacement: Replacement },
    key = randomUUID(),
  ) => result(await corrections.submit(finance, f.receiptId, input, key));

  const move = async (
    who: AuthenticatedUser,
    current: CorrectionResult,
    action: 'APPROVE' | 'REJECT' | 'WITHDRAW' | 'APPLY',
    key = randomUUID(),
  ) =>
    result(
      await corrections.act(
        who,
        current.id,
        {
          action,
          expectedVersion: current.version,
          reason: `本地纠错测试-${action}`,
        },
        key,
      ),
    );

  async function correctionRow(id: string) {
    const rows = await prisma.$queryRaw<CorrectionRow[]>`
      SELECT "id", "originalIssuanceId", "originalAmountFen",
             "sourcePackageVersion", "replacementReceiptId",
             "requestedByUserId", "reviewedByUserId", "appliedByUserId",
             "status"::text AS "status"
      FROM "FinanceReceiptCorrection"
      WHERE "id" = ${id}::uuid
    `;
    return rows[0];
  }

  async function correctionLedger(id: string) {
    return prisma.$queryRaw<CorrectionLedgerRow[]>`
      SELECT "id", "bucket"::text AS "bucket", "deltaUnits",
             "reversalOfId", "financeCorrectionId"
      FROM "LessonLedgerEntry"
      WHERE "financeCorrectionId" = ${id}::uuid
      ORDER BY CASE "bucket" WHEN 'MAIN' THEN 0 ELSE 1 END
    `;
  }

  async function approve(current: CorrectionResult) {
    return move(admin, current, 'APPROVE');
  }

  async function teachingFixture() {
    const teacher = await actor('TEACHER', campusId);
    const profile = await prisma.teacherProfile.create({
      data: {
        userId: teacher.userId,
        campusId,
        employeeCode: `FC-${randomUUID()}`,
      },
    });
    const group = await prisma.classGroup.create({
      data: {
        campusId,
        teacherId: profile.id,
        name: `纠错竞争班-${randomUUID()}`,
        courseName: '纠错测试课程',
      },
    });
    const now = new Date();
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId,
        teacherId: profile.id,
        classGroupId: group.id,
        startsAt: now,
        endsAt: new Date(now.getTime() + 60 * 60 * 1000),
      },
    });
    return {
      lesson,
      now,
      scope: {
        userId: teacher.userId,
        teacherProfileId: profile.id,
        campusId,
      },
    };
  }

  async function consume(f: Fixture, units = 100) {
    const teaching = await teachingFixture();
    await prisma.$transaction((tx) =>
      ledger.consumeStudentLessonUnits(tx, {
        scope: teaching.scope,
        studentId: f.studentId,
        lessonSessionId: teaching.lesson.id,
        requestedUnits: units,
        idempotencyKey: randomUUID(),
        occurredAt: teaching.now,
        reason: '纠错门禁消费',
      }),
    );
    return teaching;
  }

  it('applies VOID only after approval and preserves immutable source facts', async () => {
    const f = await fixture();
    const key = randomUUID();
    const submitted = await submit(
      f,
      { type: 'VOID', reason: '整笔收款录入错误' },
      key,
    );
    expect(
      await submit(f, { type: 'VOID', reason: '整笔收款录入错误' }, key),
    ).toEqual(submitted);
    expect(submitted).toMatchObject({
      type: 'VOID',
      status: 'SUBMITTED',
      version: 1,
      correctionEffectFen: -120000,
    });
    expect(await correctionRow(submitted.id)).toMatchObject({
      originalIssuanceId: f.issuanceId,
      originalAmountFen: 120000,
      sourcePackageVersion: 1,
      requestedByUserId: finance.userId,
      status: 'SUBMITTED',
    });
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      isActive: true,
      version: 1,
    });
    expect(await correctionLedger(submitted.id)).toHaveLength(0);

    const applied = await move(finance, await approve(submitted), 'APPLY');
    expect(applied).toMatchObject({
      status: 'APPLIED',
      version: 3,
      correctionEffectFen: -120000,
    });
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({
      mainBalanceUnits: 0,
      giftBalanceUnits: 0,
      paidAmountFen: 120000,
      isActive: false,
      version: 2,
    });
    const grants = f.grantsBefore as Array<{
      id: string;
      bucket: string;
      deltaUnits: number;
    }>;
    const reversalRows = await correctionLedger(submitted.id);
    expect(
      reversalRows.map(
        ({ bucket, deltaUnits, reversalOfId, financeCorrectionId }) => ({
          bucket,
          deltaUnits,
          reversalOfId,
          financeCorrectionId,
        }),
      ),
    ).toEqual(
      grants.map((grant) => ({
        bucket: grant.bucket,
        deltaUnits: -grant.deltaUnits,
        reversalOfId: grant.id,
        financeCorrectionId: submitted.id,
      })),
    );
    expect(
      await prisma.financeReceipt.findUniqueOrThrow({
        where: { id: f.receiptId },
      }),
    ).toEqual(f.receiptBefore);
    expect(
      await prisma.financePackageIssuance.findUniqueOrThrow({
        where: { id: f.issuanceId },
      }),
    ).toEqual(f.issuanceBefore);
    expect(
      await prisma.lessonLedgerEntry.findMany({
        where: { coursePackageId: f.packageId, entryType: 'GRANT' },
        orderBy: { bucket: 'asc' },
      }),
    ).toEqual(f.grantsBefore);
    const events = await prisma.$queryRaw<Array<{ action: string }>>`
      SELECT "action" FROM "FinanceReceiptCorrectionEvent"
      WHERE "correctionId" = ${submitted.id}::uuid
      ORDER BY "version" ASC
    `;
    expect(events.map(({ action }) => action)).toEqual([
      'SUBMIT',
      'APPROVE',
      'APPLY',
    ]);
    await expect(
      management.adjustLessonLedger(
        admin,
        {
          coursePackageId: f.packageId,
          bucket: 'MAIN',
          deltaUnits: 100,
          reason: '纠错后不得调整原课包',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      management.updateCoursePackageValidity(
        admin,
        f.packageId,
        {
          expectedVersion: 2,
          validFrom: '2026-09-01T00:00:00+08:00',
          expiresAt: '2027-09-01T00:00:00+08:00',
          reason: '纠错后不得修改原课包有效期',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('applies REPLACE as linked replacement facts without double-counting receipts', async () => {
    const f = await fixture();
    const proposal = await replacement(f);
    const submitted = await submit(f, {
      type: 'REPLACE',
      reason: '金额及课包录入错误',
      replacement: proposal,
    });
    expect(submitted.correctionEffectFen).toBe(-20000);
    const applied = await move(finance, await approve(submitted), 'APPLY');
    const correction = await correctionRow(applied.id);
    expect(correction).toMatchObject({
      status: 'APPLIED',
      originalIssuanceId: f.issuanceId,
      originalAmountFen: 120000,
      reviewedByUserId: admin.userId,
      appliedByUserId: finance.userId,
    });
    expect(correction.replacementReceiptId).not.toBeNull();
    const replacementReceipt = await prisma.financeReceipt.findUniqueOrThrow({
      where: { id: correction.replacementReceiptId! },
      include: { issuance: { include: { coursePackage: true } } },
    });
    expect(replacementReceipt).toMatchObject({
      campusId,
      studentId: f.studentId,
      amountFen: 100000,
      channel: 'BANK',
      proofFileId: proposal.proofFileId,
      issuance: {
        originalAmountFen: 100000,
        initialMainUnits: 1000,
        initialGiftUnits: 100,
        name: '替代课包',
        coursePackage: {
          mainBalanceUnits: 1000,
          giftBalanceUnits: 100,
          paidAmountFen: 100000,
          isActive: true,
        },
      },
    });
    const replacementGrants = await prisma.lessonLedgerEntry.findMany({
      where: {
        coursePackageId: replacementReceipt.issuance!.coursePackageId,
        entryType: 'GRANT',
      },
      orderBy: { bucket: 'asc' },
    });
    expect(
      replacementGrants.map(({ bucket, deltaUnits }) => ({
        bucket,
        deltaUnits,
      })),
    ).toEqual([
      { bucket: 'MAIN', deltaUnits: 1000 },
      { bucket: 'GIFT', deltaUnits: 100 },
    ]);
    await expect(
      corrections.submit(
        finance,
        replacementReceipt.id,
        { type: 'VOID', reason: '替代记录不得再次发起纠错' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(
      await prisma.financeReceipt.findUniqueOrThrow({
        where: { id: f.receiptId },
      }),
    ).toEqual(f.receiptBefore);
    expect(
      await prisma.financePackageIssuance.findUniqueOrThrow({
        where: { id: f.issuanceId },
      }),
    ).toEqual(f.issuanceBefore);
    const overview = await receipts.list(finance, {
      campusId,
      query: f.studentName,
      page: 1,
      pageSize: 50,
    });
    expect(overview.summary).toMatchObject({
      amountFen: 120000,
      correctionEffectFen: -20000,
      netAmountFen: 100000,
    });
  });

  it('rejects consumed, reversed, refunded, adjusted or version-changed packages', async () => {
    const consumed = await fixture();
    await consume(consumed);
    await expect(
      submit(consumed, { type: 'VOID', reason: '已有消费不能整体撤销' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const reversed = await fixture();
    const teaching = await consume(reversed);
    await prisma.lessonSession.update({
      where: { id: teaching.lesson.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    await prisma.teachingRecord.create({
      data: {
        campusId,
        lessonSessionId: teaching.lesson.id,
        teacherId: teaching.scope.teacherProfileId,
        attendeeCount: 1,
        lessonUnits: 100,
        recordedByUserId: teaching.scope.userId,
        completedAt: new Date(),
      },
    });
    await attendance.reverseLesson(
      teaching.scope,
      teaching.lesson.id,
      {
        lessonVersion: teaching.lesson.version,
        reason: '消费后撤销仍保留历史',
      },
      randomUUID(),
    );
    await expect(
      submit(reversed, { type: 'VOID', reason: '已有反向历史不能整体撤销' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const refunded = await fixture();
    await refundService.submit(
      finance,
      refunded.receiptId,
      {
        mainUnits: 100,
        giftUnits: 0,
        amountFen: 10000,
        reason: '存在退费申请',
      },
      randomUUID(),
    );
    await expect(
      submit(refunded, { type: 'VOID', reason: '存在退费不能纠错' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const adjusted = await fixture();
    await management.adjustLessonLedger(
      admin,
      {
        coursePackageId: adjusted.packageId,
        bucket: 'MAIN',
        deltaUnits: 100,
        reason: '纠错前发生管理调整',
      },
      randomUUID(),
    );
    await expect(
      submit(adjusted, { type: 'VOID', reason: '存在调整不能纠错' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const changed = await fixture();
    const approved = await approve(
      await submit(changed, { type: 'VOID', reason: '等待执行期间变更' }),
    );
    await management.updateCoursePackageValidity(
      admin,
      changed.packageId,
      {
        expectedVersion: 1,
        validFrom: '2026-09-01T00:00:00+08:00',
        expiresAt: '2027-09-01T00:00:00+08:00',
        reason: '审批后有效期发生变化',
      },
      randomUUID(),
    );
    await expect(move(finance, approved, 'APPLY')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await correctionLedger(approved.id)).toHaveLength(0);
  });

  it('enforces headquarters single-role duties, self-review and version checks', async () => {
    const f = await fixture();
    await expect(
      corrections.submit(
        admin,
        f.receiptId,
        { type: 'VOID', reason: '总端不得代提交' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      corrections.submit(
        await actor('HR'),
        f.receiptId,
        { type: 'VOID', reason: '人力不得提交' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      corrections.submit(
        await actor('FINANCE', campusId),
        f.receiptId,
        { type: 'VOID', reason: '财务必须是总部角色' },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const submitted = await submit(f, {
      type: 'VOID',
      reason: '权限状态机测试',
    });
    await expect(move(finance, submitted, 'APPROVE')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      move(
        {
          userId: finance.userId,
          roles: [{ code: 'SUPER_ADMIN', campusId: null }],
        },
        submitted,
        'APPROVE',
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      corrections.act(
        admin,
        submitted.id,
        {
          action: 'APPROVE',
          expectedVersion: 99,
          reason: '旧版本审批',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const approved = await approve(submitted);
    await expect(move(admin, approved, 'APPLY')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const withdrawnFixture = await fixture();
    const withdrawn = await move(
      finance,
      await submit(withdrawnFixture, {
        type: 'VOID',
        reason: '主动撤回测试',
      }),
      'WITHDRAW',
    );
    expect(withdrawn.status).toBe('WITHDRAWN');
    const rejectedFixture = await fixture();
    const rejected = await move(
      admin,
      await submit(rejectedFixture, {
        type: 'VOID',
        reason: '驳回测试',
      }),
      'REJECT',
    );
    expect(rejected.status).toBe('REJECTED');
  });

  it('serializes duplicate application and races against consume or refund submission', async () => {
    const duplicate = await fixture();
    const approved = await approve(
      await submit(duplicate, { type: 'VOID', reason: '并发应用测试' }),
    );
    const applications = await Promise.allSettled([
      move(finance, approved, 'APPLY'),
      move(finance, approved, 'APPLY'),
    ]);
    expect(
      applications.filter((entry) => entry.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await correctionLedger(approved.id)).toHaveLength(2);

    const consuming = await fixture(120000, 1200, 0);
    const consumingCorrection = await approve(
      await submit(consuming, { type: 'VOID', reason: '与扣课竞争' }),
    );
    const teaching = await teachingFixture();
    const consumeResult = () =>
      prisma.$transaction((tx) =>
        ledger.consumeStudentLessonUnits(tx, {
          scope: teaching.scope,
          studentId: consuming.studentId,
          lessonSessionId: teaching.lesson.id,
          requestedUnits: 100,
          idempotencyKey: randomUUID(),
          occurredAt: teaching.now,
          reason: '纠错并发扣课',
        }),
      );
    const consumeRace = await Promise.allSettled([
      move(finance, consumingCorrection, 'APPLY'),
      consumeResult(),
    ]);
    expect(
      consumeRace.filter((entry) => entry.status === 'fulfilled'),
    ).toHaveLength(1);

    const refunding = await fixture();
    const refundingCorrection = await approve(
      await submit(refunding, { type: 'VOID', reason: '与退费竞争' }),
    );
    const refundRace = await Promise.allSettled([
      move(finance, refundingCorrection, 'APPLY'),
      refundService.submit(
        finance,
        refunding.receiptId,
        {
          mainUnits: 100,
          giftUnits: 0,
          amountFen: 10000,
          reason: '纠错并发退费',
        },
        randomUUID(),
      ),
    ]);
    expect(
      refundRace.filter((entry) => entry.status === 'fulfilled'),
    ).toHaveLength(1);
  });

  it('requires an unused requester-owned replacement proof', async () => {
    const foreign = await fixture();
    const otherFinance = await actor('FINANCE');
    await expect(
      submit(foreign, {
        type: 'REPLACE',
        reason: '不得使用他人凭证',
        replacement: await replacement(foreign, 100000, otherFinance),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const occupied = await fixture();
    const proposal = await replacement(occupied);
    const submitted = await submit(occupied, {
      type: 'REPLACE',
      reason: '凭证由纠错申请占用',
      replacement: proposal,
    });
    const anotherStudent = await prisma.student.create({
      data: {
        campusId,
        displayName: `凭证复用测试-${randomUUID()}`,
      },
    });
    await expect(
      receipts.create(
        finance,
        {
          campusId,
          studentId: anotherStudent.id,
          amountFen: 100000,
          receivedOn: '2026-09-02',
          channel: 'BANK',
          proofFileId: proposal.proofFileId,
          note: '不得复用纠错凭证',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await move(finance, submitted, 'WITHDRAW');
    await expect(
      receipts.create(
        finance,
        {
          campusId,
          studentId: anotherStudent.id,
          amountFen: 100000,
          receivedOn: '2026-09-02',
          channel: 'BANK',
          proofFileId: proposal.proofFileId,
          note: '历史凭证仍不得复用',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rolls back the whole apply transaction and keeps reports separated', async () => {
    const f = await fixture();
    const approved = await approve(
      await submit(f, { type: 'VOID', reason: '事务回滚与报表隔离' }),
    );
    const idempotency = app.get(IdempotencyService);
    const applyKey = randomUUID();
    const fail = jest
      .spyOn(idempotency, 'complete')
      .mockRejectedValueOnce(new Error('Injected correction final write'));
    try {
      await expect(move(finance, approved, 'APPLY', applyKey)).rejects.toThrow(
        'Injected correction final write',
      );
    } finally {
      fail.mockRestore();
    }
    expect(await correctionRow(approved.id)).toMatchObject({
      status: 'APPROVED',
      replacementReceiptId: null,
      appliedByUserId: null,
    });
    expect(await correctionLedger(approved.id)).toHaveLength(0);
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: f.packageId },
      }),
    ).toMatchObject({
      mainBalanceUnits: 1200,
      giftBalanceUnits: 300,
      isActive: true,
      version: 1,
    });
    expect(
      await prisma.idempotencyRecord.count({ where: { key: applyKey } }),
    ).toBe(0);

    await move(finance, approved, 'APPLY', applyKey);
    const receiptOverview = await receipts.list(finance, {
      campusId,
      page: 1,
      pageSize: 50,
    });
    const summary =
      receiptOverview.summary as typeof receiptOverview.summary & {
        correctionEffectFen: number;
        netAmountFen: number;
      };
    expect(Number.isSafeInteger(summary.correctionEffectFen)).toBe(true);
    expect(Number.isSafeInteger(summary.netAmountFen)).toBe(true);
    const reportQuery = {
      campusId,
      from: '2026-09-01',
      to: '2026-09-01',
      page: 1,
      pageSize: 20,
    };
    expect((await reports.lessonConsumption(finance, reportQuery)).total).toBe(
      0,
    );
    expect((await reports.refunds(finance, reportQuery)).total).toBe(0);
  });
});
