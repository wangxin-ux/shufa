import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { prepareHeadquartersDemoData } from './prepare-headquarters-demo-data';
import { prepareLiveDemo } from './prepare-live-demo';
import { seedTeacherCore } from './seed';

export const RECORDING_DEMO_SUBJECTS = [
  'mock-demo-east-parent',
  'mock-demo-east-partner',
  'mock-demo-east-teacher',
  'mock-demo-east-campus-manager',
  'mock-demo-super-admin',
  'mock-demo-hr',
  'mock-demo-finance',
  'mock-demo-west-parent',
  'mock-demo-west-teacher',
  'mock-demo-west-campus-manager',
  'mock-demo-west-partner',
] as const;

export const RECORDING_DEMO_WEST_USER_IDS = [
  '20000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000008',
  '20000000-0000-4000-8000-000000000009',
] as const;

export const WEST_CAMPUS_ID = '10000000-0000-4000-8000-000000000002';

const EAST_STUDENT_ID = '40000000-0000-4000-8000-000000000001';

export function assertLocalRecordingDemoEnvironment(environment: {
  NODE_ENV?: string;
  AUTH_DRIVER?: string;
  DATABASE_URL?: string;
}): void {
  let database: URL | null = null;
  try {
    database = new URL(environment.DATABASE_URL ?? '');
  } catch {
    database = null;
  }
  if (
    environment.NODE_ENV !== 'development' ||
    environment.AUTH_DRIVER !== 'mock' ||
    !database ||
    !['localhost', '127.0.0.1', 'postgres'].includes(database.hostname) ||
    database.pathname !== '/education_app'
  ) {
    throw new Error(
      'Recording demo preparation requires the local mock-auth development database',
    );
  }
}

export async function prepareRecordingDemo(
  prisma: PrismaClient,
  options: { now?: Date; storageRoot?: string } = {},
) {
  const now = options.now ?? new Date();
  await seedTeacherCore(prisma);
  await prepareLiveDemo(prisma, now);
  const headquarters = await prepareHeadquartersDemoData(prisma, {
    now,
    storageRoot: options.storageRoot,
    studentId: EAST_STUDENT_ID,
  });
  const resetFinanceIssuanceCount = await resetRecordingDemoFinanceIssuances(
    prisma,
    now,
  );
  const [accounts, student, coursePackages] = await Promise.all([
    prisma.authIdentity.findMany({
      where: { subject: { in: [...RECORDING_DEMO_SUBJECTS] } },
      select: {
        subject: true,
        user: {
          select: {
            displayName: true,
            roles: { select: { roleCode: true, campusId: true } },
          },
        },
      },
      orderBy: { subject: 'asc' },
    }),
    prisma.student.findUniqueOrThrow({
      where: { id: EAST_STUDENT_ID },
      select: { displayName: true },
    }),
    prisma.coursePackage.findMany({
      where: {
        studentId: EAST_STUDENT_ID,
        isActive: true,
        validFrom: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { mainBalanceUnits: true, giftBalanceUnits: true },
    }),
  ]);
  if (
    accounts.length !== RECORDING_DEMO_SUBJECTS.length ||
    accounts.some(({ user }) => user.roles.length !== 1)
  ) {
    throw new Error(
      'Recording demo accounts are incomplete or not single-role',
    );
  }
  if (coursePackages.length === 0) {
    throw new Error('Recording demo student has no active course package');
  }
  const activeBalances = coursePackages.reduce(
    (total, coursePackage) => ({
      mainBalanceUnits: total.mainBalanceUnits + coursePackage.mainBalanceUnits,
      giftBalanceUnits: total.giftBalanceUnits + coursePackage.giftBalanceUnits,
    }),
    { mainBalanceUnits: 0, giftBalanceUnits: 0 },
  );
  if (
    activeBalances.mainBalanceUnits !== 900 ||
    activeBalances.giftBalanceUnits !== 200
  ) {
    throw new Error(
      'Recording demo student balances differ from the expected 9 purchased and 2 gift lessons',
    );
  }
  return {
    preparedAt: now.toISOString(),
    accountCount: accounts.length,
    accounts,
    eastStudentInitialHours: {
      studentName: student.displayName,
      ...activeBalances,
    },
    resetFinanceIssuanceCount,
    headquarters,
  };
}

async function resetRecordingDemoFinanceIssuances(
  prisma: PrismaClient,
  now: Date,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('local-recording-demo-finance-reset'))`;
    const [financeIdentity, superAdminIdentity, markers] = await Promise.all([
      tx.authIdentity.findUnique({
        where: {
          provider_subject: {
            provider: 'MOCK',
            subject: 'mock-demo-finance',
          },
        },
        select: { userId: true },
      }),
      tx.authIdentity.findUnique({
        where: {
          provider_subject: {
            provider: 'MOCK',
            subject: 'mock-demo-super-admin',
          },
        },
        select: { userId: true },
      }),
      tx.auditLog.findMany({
        where: {
          action: 'LOCAL_HEADQUARTERS_DEMO_PENDING_RECEIPT_CREATE',
          resourceType: 'FinanceReceipt',
          resourceId: { not: null },
        },
        select: { resourceId: true },
      }),
    ]);
    if (!financeIdentity || !superAdminIdentity) {
      throw new Error(
        'Recording demo finance or super-admin account is missing',
      );
    }
    const receiptIds = markers.flatMap(({ resourceId }) =>
      resourceId ? [resourceId] : [],
    );
    if (receiptIds.length === 0) return 0;
    const receipts = await tx.financeReceipt.findMany({
      where: {
        id: { in: receiptIds },
        campusId: '10000000-0000-4000-8000-000000000001',
        studentId: EAST_STUDENT_ID,
      },
      include: {
        issuance: {
          include: {
            coursePackage: true,
            corrections: true,
            refunds: { select: { id: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    let resetCount = 0;
    for (const receipt of receipts) {
      const issuance = receipt.issuance;
      if (!issuance) continue;
      const applied = issuance.corrections.find(
        ({ status }) => status === 'APPLIED',
      );
      if (applied) {
        if (
          issuance.coursePackage.isActive ||
          issuance.coursePackage.mainBalanceUnits !== 0 ||
          issuance.coursePackage.giftBalanceUnits !== 0
        ) {
          throw new Error(
            `Applied demo correction ${applied.id} has inconsistent package balances`,
          );
        }
        continue;
      }
      if (issuance.corrections.length > 0 || issuance.refunds.length > 0) {
        throw new Error(
          `Demo receipt ${receipt.id} has an unfinished correction or refund`,
        );
      }
      await resetUntouchedDemoIssuance(tx, {
        receipt,
        financeUserId: financeIdentity.userId,
        superAdminUserId: superAdminIdentity.userId,
        now,
      });
      resetCount += 1;
    }
    return resetCount;
  });
}

async function resetUntouchedDemoIssuance(
  tx: Prisma.TransactionClient,
  input: {
    receipt: Prisma.FinanceReceiptGetPayload<{
      include: {
        issuance: {
          include: {
            coursePackage: true;
            corrections: true;
            refunds: { select: { id: true } };
          };
        };
      };
    }>;
    financeUserId: string;
    superAdminUserId: string;
    now: Date;
  },
): Promise<void> {
  const issuance = input.receipt.issuance;
  if (!issuance) return;
  const coursePackage = issuance.coursePackage;
  await tx.$queryRaw`SELECT "id" FROM "CoursePackage" WHERE "id" = ${coursePackage.id}::uuid FOR UPDATE`;
  const grants = await tx.lessonLedgerEntry.findMany({
    where: { coursePackageId: coursePackage.id },
    orderBy: { bucket: 'asc' },
  });
  const expected = [
    ['MAIN', issuance.initialMainUnits],
    ['GIFT', issuance.initialGiftUnits],
  ].filter(([, units]) => units !== 0);
  const untouched =
    coursePackage.isActive &&
    coursePackage.sourceOrderId === null &&
    coursePackage.mainBalanceUnits === issuance.initialMainUnits &&
    coursePackage.giftBalanceUnits === issuance.initialGiftUnits &&
    coursePackage.mainReservedUnits === 0 &&
    coursePackage.giftReservedUnits === 0 &&
    coursePackage.paidAmountFen === issuance.originalAmountFen &&
    grants.length === expected.length &&
    grants.every((entry, index) => {
      const [bucket, units] = expected[index];
      return (
        entry.entryType === 'GRANT' &&
        entry.bucket === bucket &&
        entry.deltaUnits === units &&
        entry.balanceBeforeUnits === 0 &&
        entry.balanceAfterUnits === units &&
        entry.lessonSessionId === null &&
        entry.reversalOfId === null &&
        entry.financeRefundId === null &&
        entry.financeCorrectionId === null
      );
    });
  if (!untouched) {
    throw new Error(
      `Demo receipt ${input.receipt.id} package history is not safe to reset: ${JSON.stringify(
        {
          package: {
            isActive: coursePackage.isActive,
            mainBalanceUnits: coursePackage.mainBalanceUnits,
            giftBalanceUnits: coursePackage.giftBalanceUnits,
            mainReservedUnits: coursePackage.mainReservedUnits,
            giftReservedUnits: coursePackage.giftReservedUnits,
            paidAmountFen: coursePackage.paidAmountFen,
            sourceOrderId: coursePackage.sourceOrderId,
          },
          issuance: {
            initialMainUnits: issuance.initialMainUnits,
            initialGiftUnits: issuance.initialGiftUnits,
            originalAmountFen: issuance.originalAmountFen,
          },
          ledger: grants.map((entry) => ({
            entryType: entry.entryType,
            bucket: entry.bucket,
            deltaUnits: entry.deltaUnits,
            balanceBeforeUnits: entry.balanceBeforeUnits,
            balanceAfterUnits: entry.balanceAfterUnits,
            lessonSessionId: entry.lessonSessionId,
            reversalOfId: entry.reversalOfId,
            financeRefundId: entry.financeRefundId,
            financeCorrectionId: entry.financeCorrectionId,
          })),
        },
      )}`,
    );
  }
  const reason = '本地录屏演示复位，不代表真实退款。';
  const correction = await tx.financeReceiptCorrection.create({
    data: {
      originalIssuanceId: issuance.id,
      type: 'VOID',
      status: 'APPLIED',
      reason,
      version: 3,
      originalAmountFen: issuance.originalAmountFen,
      sourcePackageVersion: coursePackage.version,
      requestedByUserId: input.financeUserId,
      reviewedByUserId: input.superAdminUserId,
      reviewedAt: input.now,
      appliedByUserId: input.financeUserId,
      appliedAt: input.now,
      createdAt: input.now,
      events: {
        create: [
          {
            actorUserId: input.financeUserId,
            action: 'SUBMIT',
            fromStatus: null,
            toStatus: 'SUBMITTED',
            version: 1,
            reason,
            createdAt: input.now,
          },
          {
            actorUserId: input.superAdminUserId,
            action: 'APPROVE',
            fromStatus: 'SUBMITTED',
            toStatus: 'APPROVED',
            version: 2,
            reason,
            createdAt: input.now,
          },
          {
            actorUserId: input.financeUserId,
            action: 'APPLY',
            fromStatus: 'APPROVED',
            toStatus: 'APPLIED',
            version: 3,
            reason,
            createdAt: input.now,
          },
        ],
      },
    },
  });
  for (const grant of grants) {
    await tx.lessonLedgerEntry.create({
      data: {
        campusId: input.receipt.campusId,
        studentId: input.receipt.studentId,
        coursePackageId: coursePackage.id,
        entryType: 'CORRECTION',
        bucket: grant.bucket,
        financeCorrectionId: correction.id,
        deltaUnits: -grant.deltaUnits,
        balanceBeforeUnits: grant.deltaUnits,
        balanceAfterUnits: 0,
        idempotencyKey: `recording-demo-reset:${correction.id}:${grant.bucket}`,
        reversalOfId: grant.id,
        actorUserId: input.financeUserId,
        reason,
        createdAt: input.now,
      },
    });
  }
  const updated = await tx.coursePackage.updateMany({
    where: {
      id: coursePackage.id,
      version: coursePackage.version,
      mainBalanceUnits: issuance.initialMainUnits,
      giftBalanceUnits: issuance.initialGiftUnits,
      mainReservedUnits: 0,
      giftReservedUnits: 0,
      isActive: true,
    },
    data: {
      mainBalanceUnits: 0,
      giftBalanceUnits: 0,
      isActive: false,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    throw new Error(
      `Demo receipt ${input.receipt.id} changed while it was being reset`,
    );
  }
  await tx.auditLog.create({
    data: {
      campusId: input.receipt.campusId,
      actorUserId: input.financeUserId,
      action: 'LOCAL_RECORDING_DEMO_ISSUANCE_RESET',
      resourceType: 'FinanceReceiptCorrection',
      resourceId: correction.id,
      outcome: 'SUCCESS',
      details: {
        localDemoOnly: true,
        receiptId: input.receipt.id,
        coursePackageId: coursePackage.id,
      },
      createdAt: input.now,
    },
  });
}

async function run(): Promise<void> {
  assertLocalRecordingDemoEnvironment(process.env);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const result = await prepareRecordingDemo(prisma, {
      storageRoot: process.env.FILE_STORAGE_ROOT,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Recording demo preparation failed',
    );
    process.exitCode = 1;
  });
}
