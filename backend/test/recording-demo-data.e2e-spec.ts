import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  assertLocalRecordingDemoEnvironment,
  prepareRecordingDemo,
  RECORDING_DEMO_SUBJECTS,
  RECORDING_DEMO_WEST_USER_IDS,
  WEST_CAMPUS_ID,
} from '../prisma/prepare-recording-demo';

jest.setTimeout(30_000);

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

describe('recording demo preparation', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects production, real auth, and non-local databases', () => {
    expect(() =>
      assertLocalRecordingDemoEnvironment({
        NODE_ENV: 'production',
        AUTH_DRIVER: 'mock',
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/education_app?schema=public',
      }),
    ).toThrow('local mock-auth development database');
    expect(() =>
      assertLocalRecordingDemoEnvironment({
        NODE_ENV: 'development',
        AUTH_DRIVER: 'wechat',
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/education_app?schema=public',
      }),
    ).toThrow('local mock-auth development database');
    expect(() =>
      assertLocalRecordingDemoEnvironment({
        NODE_ENV: 'development',
        AUTH_DRIVER: 'mock',
        DATABASE_URL:
          'postgresql://app:secret@example.com:5432/education_app?schema=public',
      }),
    ).toThrow('local mock-auth development database');
  });

  it('prepares eleven single-role accounts and remains idempotent', async () => {
    const first = await prepareRecordingDemo(prisma, {
      now: new Date('2026-09-11T09:00:00+08:00'),
      storageRoot: './storage/test-recording-demo',
    });
    const issuedPackageId = await issueRecordingPackage(
      prisma,
      first.headquarters.pendingReceiptId,
    );
    const second = await prepareRecordingDemo(prisma, {
      now: new Date('2026-09-11T09:05:00+08:00'),
      storageRoot: './storage/test-recording-demo',
    });
    const third = await prepareRecordingDemo(prisma, {
      now: new Date('2026-09-11T09:10:00+08:00'),
      storageRoot: './storage/test-recording-demo',
    });

    expect(first.accountCount).toBe(11);
    expect(second.accountCount).toBe(11);
    expect(third.accountCount).toBe(11);
    expect(second.eastStudentInitialHours).toEqual({
      studentName: '陈晨',
      mainBalanceUnits: 900,
      giftBalanceUnits: 200,
    });
    expect(second.resetFinanceIssuanceCount).toBe(1);
    expect(third.resetFinanceIssuanceCount).toBe(0);
    expect(second.headquarters.pendingReceiptId).not.toBe(
      first.headquarters.pendingReceiptId,
    );
    expect(third.headquarters.pendingReceiptId).toBe(
      second.headquarters.pendingReceiptId,
    );
    expect(
      await prisma.coursePackage.findUniqueOrThrow({
        where: { id: issuedPackageId },
        select: {
          mainBalanceUnits: true,
          giftBalanceUnits: true,
          isActive: true,
          financeIssuance: {
            select: {
              corrections: {
                select: { status: true },
              },
            },
          },
        },
      }),
    ).toEqual({
      mainBalanceUnits: 0,
      giftBalanceUnits: 0,
      isActive: false,
      financeIssuance: {
        corrections: [{ status: 'APPLIED' }],
      },
    });
    expect(
      await prisma.lessonLedgerEntry.findMany({
        where: {
          coursePackageId: issuedPackageId,
          entryType: 'CORRECTION',
        },
        orderBy: { bucket: 'asc' },
        select: { bucket: true, deltaUnits: true },
      }),
    ).toEqual([
      { bucket: 'MAIN', deltaUnits: -1000 },
      { bucket: 'GIFT', deltaUnits: -200 },
    ]);
    const activeBalances = await prisma.coursePackage.aggregate({
      where: {
        studentId: '40000000-0000-4000-8000-000000000001',
        isActive: true,
      },
      _sum: { mainBalanceUnits: true, giftBalanceUnits: true },
    });
    expect(activeBalances._sum).toEqual({
      mainBalanceUnits: 900,
      giftBalanceUnits: 200,
    });
    expect(
      await prisma.financeReceipt.findUniqueOrThrow({
        where: { id: third.headquarters.pendingReceiptId },
        select: { studentId: true, issuance: { select: { id: true } } },
      }),
    ).toEqual({
      studentId: '40000000-0000-4000-8000-000000000001',
      issuance: null,
    });
    await expect(
      prisma.parentLeaveRequest.findUnique({
        where: {
          parentUserId_studentId_lessonSessionId: {
            parentUserId: '20000000-0000-4000-8000-000000000003',
            studentId: '40000000-0000-4000-8000-000000000001',
            lessonSessionId: '70000000-0000-4000-8000-000000000002',
          },
        },
        select: { status: true, reason: true, version: true },
      }),
    ).resolves.toEqual({
      status: 'PENDING',
      reason: '参加学校活动，请审批本次请假。',
      version: 1,
    });
    expect(
      await prisma.authIdentity.count({
        where: { subject: { in: [...RECORDING_DEMO_SUBJECTS] } },
      }),
    ).toBe(11);
    expect(
      await prisma.userRole.findMany({
        where: { userId: { in: [...RECORDING_DEMO_WEST_USER_IDS] } },
        select: { roleCode: true, campusId: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        { roleCode: 'PARENT', campusId: WEST_CAMPUS_ID },
        { roleCode: 'TEACHER', campusId: WEST_CAMPUS_ID },
        { roleCode: 'CAMPUS_MANAGER', campusId: WEST_CAMPUS_ID },
        { roleCode: 'PARTNER', campusId: WEST_CAMPUS_ID },
      ]),
    );
  });
});

async function issueRecordingPackage(prisma: PrismaClient, receiptId: string) {
  const receipt = await prisma.financeReceipt.findUniqueOrThrow({
    where: { id: receiptId },
    select: { campusId: true, studentId: true, amountFen: true },
  });
  const financeIdentity = await prisma.authIdentity.findUniqueOrThrow({
    where: {
      provider_subject: {
        provider: 'MOCK',
        subject: 'mock-demo-finance',
      },
    },
    select: { userId: true },
  });
  return prisma.$transaction(async (tx) => {
    const coursePackage = await tx.coursePackage.create({
      data: {
        campusId: receipt.campusId,
        studentId: receipt.studentId,
        name: '录屏复位测试课包',
        mainBalanceUnits: 1000,
        giftBalanceUnits: 200,
        paidAmountFen: receipt.amountFen,
        validFrom: new Date('2026-09-11T09:01:00+08:00'),
      },
    });
    await tx.financePackageIssuance.create({
      data: {
        receiptId,
        coursePackageId: coursePackage.id,
        originalAmountFen: receipt.amountFen,
        initialMainUnits: 1000,
        initialGiftUnits: 200,
        name: coursePackage.name,
        validFrom: coursePackage.validFrom,
        expiresAt: null,
        issuedByUserId: financeIdentity.userId,
      },
    });
    for (const [bucket, units] of [
      ['MAIN', 1000],
      ['GIFT', 200],
    ] as const) {
      await tx.lessonLedgerEntry.create({
        data: {
          campusId: receipt.campusId,
          studentId: receipt.studentId,
          coursePackageId: coursePackage.id,
          entryType: 'GRANT',
          bucket,
          deltaUnits: units,
          balanceBeforeUnits: 0,
          balanceAfterUnits: units,
          idempotencyKey: `recording-reset-test:${coursePackage.id}:${bucket}`,
          actorUserId: financeIdentity.userId,
          reason: '录屏复位测试发包',
        },
      });
    }
    return coursePackage.id;
  });
}
