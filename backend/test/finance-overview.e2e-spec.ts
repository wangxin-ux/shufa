import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { RoleCode, StoredFilePurpose } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { Server } from 'node:http';
import request from 'supertest';
import { configureApplication } from '../src/common/bootstrap/configure-app';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

jest.setTimeout(60_000);

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';
const target = new URL(databaseUrl);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  !target.pathname.endsWith('_test')
) {
  throw new Error('Finance overview tests require a local *_test database');
}

const storageRoot = path.join(os.tmpdir(), 'education-finance-overview-tests');
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  PORT: '3001',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters',
  FILE_STORAGE_DRIVER: 'local',
  FILE_STORAGE_ROOT: storageRoot,
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  PAYOUT_DRIVER: 'manual',
  MESSAGE_DRIVER: 'mock',
  TZ: 'Asia/Shanghai',
});

type Actor = { id: string; token: string };
type CampusFixture = {
  campusId: string;
  studentId: string;
  teacherUserId: string;
  teacherId: string;
  lessonId: string;
  teachingRecordId: string;
};

type OverviewData = {
  items: Array<Record<string, unknown>>;
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
  summary: Record<string, unknown>;
  coverage: Record<string, unknown>;
  feeStatus: string;
};

function responseData<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

describe('headquarters finance oversight', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let finance: Actor;
  let hr: Actor;
  let superAdmin: Actor;
  let scopedFinance: Actor;
  let mixedFinance: Actor;
  let parent: Actor;
  let campusA: CampusFixture;
  let campusB: CampusFixture;
  let orderId: string;
  const runId = randomUUID();

  async function actor(
    roles: Array<{ code: RoleCode; campusId: string | null }>,
    displayName: string,
  ): Promise<Actor> {
    const user = await prisma.user.create({
      data: {
        displayName,
        roles: {
          create: roles.map((role) => ({
            roleCode: role.code,
            campusId: role.campusId,
          })),
        },
      },
    });
    return {
      id: user.id,
      token: (await app.get(AuthService).issueSessionForUser(user.id))
        .accessToken,
    };
  }

  async function storedFile(
    purpose: StoredFilePurpose,
    createdByUserId: string,
    physical = false,
  ) {
    const directory =
      purpose === 'PAYMENT_PROOF' ? 'payment-proofs' : 'finance-overview';
    const storageKey = `${directory}/${runId}/${randomUUID()}.png`;
    const bytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02,
    ]);
    if (physical) {
      const absolutePath = path.join(storageRoot, ...storageKey.split('/'));
      await mkdir(path.dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, bytes);
    }
    const file = await prisma.storedFile.create({
      data: {
        purpose,
        storageKey,
        originalName: '财务凭证.png',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        sha256: 'a'.repeat(64),
        createdByUserId,
      },
    });
    return { ...file, bytes };
  }

  async function campusFixture(label: string, address: string) {
    const campus = await prisma.campus.create({
      data: {
        code: `${label}-${runId}`,
        name: `${label}校区`,
        address,
      },
    });
    const teacher = await actor(
      [{ code: 'TEACHER', campusId: campus.id }],
      `${label}老师`,
    );
    const teacherProfile = await prisma.teacherProfile.create({
      data: {
        userId: teacher.id,
        campusId: campus.id,
        employeeCode: `${label}-${randomUUID()}`,
      },
    });
    const student = await prisma.student.create({
      data: { campusId: campus.id, displayName: `${label}同学` },
    });
    const classGroup = await prisma.classGroup.create({
      data: {
        campusId: campus.id,
        teacherId: teacherProfile.id,
        name: `${label}班-${runId}`,
        courseName: `${label}课程`,
      },
    });
    const completedAt = new Date('2026-09-08T10:55:00+08:00');
    const lesson = await prisma.lessonSession.create({
      data: {
        campusId: campus.id,
        classGroupId: classGroup.id,
        teacherId: teacherProfile.id,
        startsAt: new Date('2026-09-08T10:00:00+08:00'),
        endsAt: new Date('2026-09-08T11:00:00+08:00'),
        status: 'COMPLETED',
        completedAt,
      },
    });
    const teachingRecord = await prisma.teachingRecord.create({
      data: {
        campusId: campus.id,
        lessonSessionId: lesson.id,
        teacherId: teacherProfile.id,
        attendeeCount: 1,
        lessonUnits: 100,
        recordedByUserId: teacher.id,
        completedAt,
        createdAt: completedAt,
      },
    });
    return {
      campusId: campus.id,
      studentId: student.id,
      teacherUserId: teacher.id,
      teacherId: teacherProfile.id,
      lessonId: lesson.id,
      teachingRecordId: teachingRecord.id,
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

    finance = await actor(
      [{ code: 'FINANCE', campusId: null }],
      `总部财务-${runId}`,
    );
    parent = await actor([{ code: 'PARENT', campusId: null }], `家长-${runId}`);
    campusA = await campusFixture('长沙甲', '湖南省长沙市岳麓区测试路 1 号');
    campusB = await campusFixture('株洲乙', '湖南省株洲市天元区测试路 2 号');
    hr = await actor([{ code: 'HR', campusId: null }], `总部人力-${runId}`);
    superAdmin = await actor(
      [{ code: 'SUPER_ADMIN', campusId: null }],
      `总管理员-${runId}`,
    );
    scopedFinance = await actor(
      [{ code: 'FINANCE', campusId: campusA.campusId }],
      `校区财务-${runId}`,
    );
    mixedFinance = await actor(
      [
        { code: 'FINANCE', campusId: null },
        { code: 'HR', campusId: null },
      ],
      `混合财务-${runId}`,
    );

    const receiptProof = await storedFile('FINANCE_RECEIPT_PROOF', finance.id);
    const receipt = await prisma.financeReceipt.create({
      data: {
        campusId: campusA.campusId,
        studentId: campusA.studentId,
        amountFen: 90_000,
        receivedOn: new Date('2026-09-01T00:00:00+08:00'),
        channel: 'WECHAT',
        proofFileId: receiptProof.id,
        createdByUserId: finance.id,
        createdAt: new Date('2026-09-01T09:00:00+08:00'),
      },
    });
    const packageA = await prisma.coursePackage.create({
      data: {
        campusId: campusA.campusId,
        studentId: campusA.studentId,
        name: '甲课包',
        mainBalanceUnits: 600,
        giftBalanceUnits: 0,
        paidAmountFen: 90_000,
        validFrom: new Date('2026-09-01T00:00:00+08:00'),
        expiresAt: new Date('2027-08-31T23:59:59.999+08:00'),
        createdAt: new Date('2026-09-01T09:00:00+08:00'),
      },
    });
    const issuance = await prisma.financePackageIssuance.create({
      data: {
        receiptId: receipt.id,
        coursePackageId: packageA.id,
        originalAmountFen: 90_000,
        initialMainUnits: 900,
        initialGiftUnits: 0,
        name: packageA.name,
        validFrom: new Date('2026-09-01T00:00:00+08:00'),
        issuedByUserId: finance.id,
      },
    });
    const packageB = await prisma.coursePackage.create({
      data: {
        campusId: campusB.campusId,
        studentId: campusB.studentId,
        name: '乙历史课包',
        mainBalanceUnits: 500,
        giftBalanceUnits: 0,
        validFrom: new Date('2026-09-01T00:00:00+08:00'),
        expiresAt: null,
        createdAt: new Date('2026-09-01T09:00:00+08:00'),
      },
    });
    await prisma.lessonLedgerEntry.createMany({
      data: [
        {
          campusId: campusA.campusId,
          studentId: campusA.studentId,
          coursePackageId: packageA.id,
          lessonSessionId: campusA.lessonId,
          entryType: 'CONSUME',
          bucket: 'MAIN',
          deltaUnits: -100,
          balanceBeforeUnits: 900,
          balanceAfterUnits: 800,
          idempotencyKey: `hours-a-${runId}`,
          actorUserId: campusA.teacherUserId,
          createdAt: new Date('2026-09-08T11:00:00+08:00'),
        },
        {
          campusId: campusA.campusId,
          studentId: campusA.studentId,
          coursePackageId: packageA.id,
          entryType: 'ADJUSTMENT',
          bucket: 'MAIN',
          deltaUnits: -200,
          balanceBeforeUnits: 800,
          balanceAfterUnits: 600,
          idempotencyKey: `hours-a-later-${runId}`,
          actorUserId: finance.id,
          createdAt: new Date('2026-09-10T11:00:00+08:00'),
        },
        {
          campusId: campusB.campusId,
          studentId: campusB.studentId,
          coursePackageId: packageB.id,
          lessonSessionId: campusB.lessonId,
          entryType: 'CONSUME',
          bucket: 'MAIN',
          deltaUnits: -200,
          balanceBeforeUnits: 700,
          balanceAfterUnits: 500,
          idempotencyKey: `hours-b-${runId}`,
          actorUserId: campusB.teacherUserId,
          createdAt: new Date('2026-09-08T11:00:00+08:00'),
        },
      ],
    });

    const teacherRule = await prisma.teacherEarningRule.create({
      data: {
        campusId: campusA.campusId,
        scopeKey: `finance-overview-teacher-${runId}`,
        basisType: 'PER_COMPLETED_SESSION',
        unitAmountFen: 500,
        eligibleLessonKinds: ['REGULAR'],
        countedAttendanceStatuses: ['PRESENT'],
        version: 1,
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
        createdByUserId: superAdmin.id,
      },
    });
    const teacherBasis = await prisma.teacherEarningBasis.create({
      data: {
        campusId: campusA.campusId,
        teacherProfileId: campusA.teacherId,
        teachingRecordId: campusA.teachingRecordId,
        lessonSessionId: campusA.lessonId,
        selectedRuleId: teacherRule.id,
        lessonKind: 'REGULAR',
        lessonUnits: 100,
        attendeeCount: 2,
        attendanceSnapshot: [],
        completedAt: new Date('2026-09-08T10:55:00+08:00'),
        status: 'PRICED',
        createdAt: new Date('2026-09-08T11:00:00+08:00'),
      },
    });
    await prisma.teacherEarningEntry.create({
      data: {
        campusId: campusA.campusId,
        teacherProfileId: campusA.teacherId,
        earningBasisId: teacherBasis.id,
        entryType: 'ACCRUAL',
        amountFen: 500,
        status: 'AVAILABLE',
        ruleSnapshot: { unitAmountFen: 500 },
        reviewableAt: new Date('2026-09-08T11:00:00+08:00'),
        createdAt: new Date('2026-09-08T11:00:00+08:00'),
      },
    });
    const partnerRule = await prisma.partnerEarningRule.create({
      data: {
        campusId: campusA.campusId,
        scopeKey: `finance-overview-partner-${runId}`,
        unitPriceFen: 1000,
        shareBasisPoints: 4000,
        eligibleLessonKinds: ['REGULAR'],
        countedAttendanceStatuses: ['PRESENT'],
        version: 1,
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
        createdByUserId: superAdmin.id,
      },
    });
    const partnerBasis = await prisma.partnerEarningBasis.create({
      data: {
        campusId: campusA.campusId,
        teachingRecordId: campusA.teachingRecordId,
        lessonSessionId: campusA.lessonId,
        selectedRuleId: partnerRule.id,
        lessonKind: 'REGULAR',
        lessonUnits: 100,
        actualAttendeeCount: 2,
        countedAttendeeCount: 2,
        attendanceSnapshot: [],
        completedAt: new Date('2026-09-08T10:55:00+08:00'),
        status: 'PRICED',
        createdAt: new Date('2026-09-08T11:00:00+08:00'),
      },
    });
    await prisma.partnerEarningEntry.create({
      data: {
        campusId: campusA.campusId,
        earningBasisId: partnerBasis.id,
        entryType: 'ACCRUAL',
        amountFen: 800,
        status: 'AVAILABLE',
        ruleSnapshot: { unitPriceFen: 1000, shareBasisPoints: 4000 },
        reviewableAt: new Date('2026-09-08T11:00:00+08:00'),
        createdAt: new Date('2026-09-08T11:00:00+08:00'),
      },
    });

    const refundProof = await storedFile('FINANCE_REFUND_PROOF', finance.id);
    const refund = await prisma.financeRefundRequest.create({
      data: {
        issuanceId: issuance.id,
        mainUnits: 1,
        giftUnits: 0,
        referenceAmountFen: 300,
        amountFen: 300,
        reason: '财务总览退费测试',
        status: 'PAID',
        requestedByUserId: finance.id,
        createdAt: new Date('2026-09-05T09:00:00+08:00'),
      },
    });
    await prisma.financeRefundPayment.create({
      data: {
        refundId: refund.id,
        amountFen: 300,
        paidAt: new Date('2026-09-09T12:00:00+08:00'),
        proofFileId: refundProof.id,
        externalReference: `finance-refund-${runId}`,
        recordedByUserId: finance.id,
      },
    });

    const payoutProof = await storedFile('PAYOUT_PROOF', superAdmin.id);
    const latestPolicy = await prisma.teacherWithdrawalPolicy.aggregate({
      _max: { version: true },
    });
    const policy = await prisma.teacherWithdrawalPolicy.create({
      data: {
        minimumAmountFen: 1,
        dailyRequestLimit: 10,
        version: (latestPolicy._max.version ?? 0) + 1,
        status: 'ACTIVE',
        effectiveFrom: new Date('2026-01-01T00:00:00+08:00'),
        createdByUserId: superAdmin.id,
      },
    });
    await prisma.withdrawal.create({
      data: {
        requestNo: `TW-${runId}`,
        campusId: campusA.campusId,
        teacherProfileId: campusA.teacherId,
        requestedByUserId: campusA.teacherUserId,
        policyId: policy.id,
        amountFen: 450,
        status: 'PAID',
        policySnapshot: { version: policy.version },
        paidByUserId: superAdmin.id,
        paidAt: new Date('2026-09-09T13:00:00+08:00'),
        payoutReference: `PAYOUT-${runId}`,
        payoutProofFileId: payoutProof.id,
        createdAt: new Date('2026-09-05T10:00:00+08:00'),
      },
    });

    const product = await prisma.courseProduct.create({
      data: {
        campusId: campusA.campusId,
        name: '拼团体验课',
        summary: '财务总览测试课程',
        priceFen: 1990,
        mainUnits: 100,
        giftUnits: 0,
        validityDays: 30,
        status: 'ACTIVE',
        createdByUserId: superAdmin.id,
      },
    });
    const order = await prisma.enrollmentOrder.create({
      data: {
        orderNo: `ORDER-${runId}`,
        parentUserId: parent.id,
        studentId: campusA.studentId,
        campusId: campusA.campusId,
        courseProductId: product.id,
        productNameSnapshot: product.name,
        priceFenSnapshot: 1990,
        mainUnitsSnapshot: 100,
        giftUnitsSnapshot: 0,
        validityDaysSnapshot: 30,
        status: 'REFUNDED',
        createdAt: new Date('2026-09-04T09:00:00+08:00'),
      },
    });
    orderId = order.id;
    const orderProof = await storedFile('PAYMENT_PROOF', parent.id, true);
    await prisma.enrollmentPaymentProof.create({
      data: {
        orderId: order.id,
        storedFileId: orderProof.id,
        attemptNo: 1,
        submittedByUserId: parent.id,
        submittedAt: new Date('2026-09-04T09:10:00+08:00'),
      },
    });
    const campaign = await prisma.groupCampaign.create({
      data: {
        code: `GROUP-${runId}`,
        campusId: campusA.campusId,
        courseProductId: product.id,
        title: '财务总览拼团',
        description: '测试拼团资金流水',
        priceFen: 1990,
        startsAt: new Date('2026-09-01T00:00:00+08:00'),
        endsAt: new Date('2026-09-30T23:59:59+08:00'),
        status: 'CLOSED',
        createdByUserId: superAdmin.id,
      },
    });
    const team = await prisma.groupTeam.create({
      data: {
        campaignId: campaign.id,
        leaderUserId: parent.id,
        status: 'CANCELLED',
        paidMemberCount: 1,
      },
    });
    const member = await prisma.groupMember.create({
      data: {
        campaignId: campaign.id,
        teamId: team.id,
        parentUserId: parent.id,
        studentId: campusA.studentId,
        enrollmentOrderId: order.id,
        status: 'REFUNDED',
        reservationExpiresAt: new Date('2026-09-04T10:00:00+08:00'),
        paidAt: new Date('2026-09-04T09:20:00+08:00'),
      },
    });
    await prisma.paymentTransaction.createMany({
      data: [
        {
          groupMemberId: member.id,
          enrollmentOrderId: order.id,
          type: 'PAYMENT',
          provider: 'MOCK',
          outTradeNo: `PAY-${runId}`,
          providerTradeNo: `MOCK-PAY-${runId}`,
          amountFen: 1990,
          status: 'SUCCEEDED',
          succeededAt: new Date('2026-09-04T09:20:00+08:00'),
          createdAt: new Date('2026-09-04T09:15:00+08:00'),
        },
        {
          groupMemberId: member.id,
          enrollmentOrderId: order.id,
          type: 'REFUND',
          provider: 'MOCK',
          outTradeNo: `REFUND-${runId}`,
          providerTradeNo: `MOCK-REFUND-${runId}`,
          amountFen: 200,
          status: 'SUCCEEDED',
          succeededAt: new Date('2026-09-09T14:00:00+08:00'),
          createdAt: new Date('2026-09-09T13:55:00+08:00'),
        },
      ],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const getAs = (url: string, token = finance.token) =>
    request(server).get(url).set('Authorization', `Bearer ${token}`);

  it('paginates packages but summarizes all campuses and rewinds the cutoff balance', async () => {
    const response = await getAs('/finance/hours').query({
      campusIds: `${campusA.campusId},${campusB.campusId}`,
      from: '2026-09-08',
      to: '2026-09-08',
      page: 1,
      pageSize: 1,
    });
    expect(response.status).toBe(200);
    const data = responseData<OverviewData>(response);
    expect(data).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 1,
      summary: {
        studentCount: 2,
        consumedMainUnits: 300,
        consumedGiftUnits: 0,
        remainingUnits: 1300,
      },
    });
    expect(data.items).toHaveLength(1);
    const cutoff = await getAs('/finance/hours').query({
      campusIds: campusA.campusId,
      from: '2026-09-08',
      to: '2026-09-08',
      page: 1,
      pageSize: 20,
    });
    expect(cutoff.status).toBe(200);
    expect(responseData<OverviewData>(cutoff).items[0]).toMatchObject({
      campusId: campusA.campusId,
      studentName: '长沙甲同学',
      consumedMainUnits: 100,
      mainRemainingUnits: 800,
      unitPriceFen: 10_000,
      priceStatus: 'KNOWN',
      validFrom: '2026-08-31T16:00:00.000Z',
      expiresAt: '2027-08-31T15:59:59.999Z',
    });
  });

  it('shows platform orders and streams the latest receipt proof without review controls', async () => {
    const listed = await getAs('/finance/oversight/orders').query({
      campusIds: campusA.campusId,
      from: '2026-09-04',
      to: '2026-09-04',
      status: 'REFUNDED',
    });
    expect(listed.status).toBe(200);
    expect(responseData<OverviewData>(listed).items).toEqual([
      expect.objectContaining({
        id: orderId,
        source: 'GROUP_BUYING',
        studentName: '长沙甲同学',
        amountFen: 1990,
        status: 'REFUNDED',
        proofAvailable: true,
      }),
    ]);

    const proof = await getAs(`/finance/oversight/orders/${orderId}/proof`);
    expect(proof.status).toBe(200);
    expect(proof.headers['content-type']).toMatch(/^image\/png/);
    expect(proof.headers['cache-control']).toBe('private, no-store');
    expect(Buffer.from(proof.body)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]),
    );
  });

  it('reports campus lesson revenue and existing teacher and partner earnings', async () => {
    const response = await getAs('/finance/oversight/earnings').query({
      campusIds: `${campusA.campusId},${campusB.campusId}`,
      region: '长沙市',
      from: '2026-09-08',
      to: '2026-09-08',
    });
    expect(response.status).toBe(200);
    const data = responseData<OverviewData>(response);
    expect(data.rows).toEqual([
      expect.objectContaining({
        campusId: campusA.campusId,
        grossLessonRevenueFen: 2000,
        teacherEarningFen: 500,
        partnerEarningFen: 800,
        platformRetainedFen: 1200,
        knownContributionFen: 700,
      }),
    ]);
    expect(data.summary).toMatchObject({
      grossLessonRevenueFen: 2000,
      teacherEarningFen: 500,
      partnerEarningFen: 800,
      platformRetainedFen: 1200,
      knownContributionFen: 700,
    });
  });

  it('lists real parent refunds and teacher withdrawals while marking partner payouts unavailable', async () => {
    const response = await getAs('/finance/oversight/payouts').query({
      campusIds: campusA.campusId,
      from: '2026-09-01',
      to: '2026-09-30',
      category: 'ALL',
      pageSize: 20,
    });
    expect(response.status).toBe(200);
    const data = responseData<OverviewData>(response);
    expect(data).toMatchObject({
      total: 3,
      coverage: {
        parentRefunds: 'AVAILABLE',
        teacherWithdrawals: 'AVAILABLE',
        partnerPayouts: 'NOT_IMPLEMENTED',
      },
    });
    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'TEACHER_WITHDRAWAL',
          subjectName: '长沙甲老师',
          amountFen: 450,
          status: 'PAID',
          proofAvailable: true,
        }),
        expect.objectContaining({
          category: 'PARENT_REFUND',
          subjectName: '长沙甲同学',
          amountFen: 300,
          status: 'PAID',
          proofAvailable: true,
        }),
        expect.objectContaining({
          category: 'PARENT_REFUND',
          subjectName: '长沙甲同学',
          amountFen: 200,
          status: 'SUCCEEDED',
          proofAvailable: false,
        }),
      ]),
    );

    const partner = await getAs('/finance/oversight/payouts').query({
      campusIds: campusA.campusId,
      category: 'PARTNER_PAYOUT',
    });
    expect(partner.status).toBe(200);
    expect(responseData<OverviewData>(partner)).toMatchObject({
      total: 0,
      items: [],
    });
  });

  it('exports and summarizes real cash movements without inventing fees', async () => {
    const response = await getAs('/finance/oversight/cash-flow').query({
      campusIds: campusA.campusId,
      from: '2026-09-01',
      to: '2026-09-30',
      pageSize: 20,
    });
    expect(response.status).toBe(200);
    const data = responseData<OverviewData>(response);
    expect(data).toMatchObject({
      total: 5,
      summary: { inflowFen: 91_990, outflowFen: 950, feeFen: null },
      feeStatus: 'NOT_RECORDED',
    });
    expect(data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: 'INFLOW', amountFen: 90_000 }),
        expect.objectContaining({ direction: 'INFLOW', amountFen: 1990 }),
        expect.objectContaining({ direction: 'OUTFLOW', amountFen: 300 }),
        expect.objectContaining({ direction: 'OUTFLOW', amountFen: 200 }),
        expect.objectContaining({ direction: 'OUTFLOW', amountFen: 450 }),
      ]),
    );

    const auditBefore = await prisma.auditLog.count({
      where: { actorUserId: finance.id, action: 'FINANCE_OVERSIGHT_EXPORT' },
    });
    const exported = await getAs('/finance/oversight/cash-flow/export')
      .query({
        campusIds: campusA.campusId,
        from: '2026-09-01',
        to: '2026-09-30',
      })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
        response.on('error', callback);
      });
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const workbook = new Workbook();
    await workbook.xlsx.load(exported.body as Buffer);
    expect(workbook.getWorksheet('资金流水')?.rowCount).toBe(6);
    await expect(
      prisma.auditLog.count({
        where: { actorUserId: finance.id, action: 'FINANCE_OVERSIGHT_EXPORT' },
      }),
    ).resolves.toBe(auditBefore + 1);
  });

  it('includes every actual refund in known contribution and leaves net profit unavailable', async () => {
    const response = await getAs('/finance/oversight/profitability').query({
      campusIds: `${campusA.campusId},${campusB.campusId}`,
      region: '长沙市',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(response.status).toBe(200);
    const data = responseData<OverviewData>(response);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]).toMatchObject({
      campusId: campusA.campusId,
      grossLessonRevenueFen: 2000,
      teacherEarningFen: 500,
      partnerEarningFen: 800,
      refundFen: 500,
      knownContributionFen: 200,
      feeFen: null,
      netProfitFen: null,
    });
    expect(data).toMatchObject({
      feeStatus: 'NOT_RECORDED',
      summary: {
        refundFen: 500,
        knownContributionFen: 200,
        feeFen: null,
        netProfitFen: null,
      },
    });
  });

  it('rejects anonymous, non-finance, campus-bound finance and mixed identities on every route', async () => {
    await request(server).get('/finance/oversight/orders').expect(401);
    const routes = [
      '/finance/hours',
      '/finance/oversight/orders',
      `/finance/oversight/orders/${orderId}/proof`,
      '/finance/oversight/earnings',
      '/finance/oversight/payouts',
      '/finance/oversight/cash-flow',
      '/finance/oversight/profitability',
      '/finance/oversight/cash-flow/export',
    ];
    for (const current of [hr, superAdmin, scopedFinance, mixedFinance]) {
      for (const route of routes) {
        const response = await getAs(route, current.token);
        expect(response.status).toBe(403);
      }
    }
  });

  it('validates date order and campus-list syntax', async () => {
    await getAs('/finance/oversight/cash-flow')
      .query({ from: '2026-09-10', to: '2026-09-09' })
      .expect(400);
    await getAs('/finance/oversight/earnings')
      .query({ campusIds: `${campusA.campusId},not-a-uuid` })
      .expect(400);
  });
});
