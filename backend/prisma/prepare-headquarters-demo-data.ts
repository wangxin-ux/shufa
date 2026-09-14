import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { prepareFinanceDemo } from './prepare-finance-demo';
import { prepareHrDemo } from './prepare-hr-demo';

const CORE = {
  campusId: '10000000-0000-4000-8000-000000000001',
  studentId: '40000000-0000-4000-8000-000000000002',
  teacherId: '30000000-0000-4000-8000-000000000001',
} as const;

export const HEADQUARTERS_DEMO_IDS = {
  hrRecords: {
    qualification: '71000000-0000-4000-8000-000000000001',
    training: '71000000-0000-4000-8000-000000000002',
    growth: '71000000-0000-4000-8000-000000000003',
  },
  pendingReceipt: '72000000-0000-4000-8000-000000000001',
  pendingReceipts: [
    '72000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000002',
    '72000000-0000-4000-8000-000000000003',
    '72000000-0000-4000-8000-000000000004',
  ],
  receiptProofs: [
    '73000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000002',
    '73000000-0000-4000-8000-000000000003',
    '73000000-0000-4000-8000-000000000004',
  ],
  receiptAudits: [
    '74000000-0000-4000-8000-000000000001',
    '74000000-0000-4000-8000-000000000002',
    '74000000-0000-4000-8000-000000000003',
    '74000000-0000-4000-8000-000000000004',
  ],
} as const;

const PROOF_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type DemoEnvironment = {
  NODE_ENV?: string;
  AUTH_DRIVER?: string;
  DATABASE_URL?: string;
};

export function assertLocalHeadquartersDemoEnvironment(
  environment: DemoEnvironment,
): void {
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
      'Headquarters demo preparation requires the local mock-auth development database',
    );
  }
}

export async function prepareHeadquartersDemoData(
  prisma: PrismaClient,
  options: { now?: Date; storageRoot?: string; studentId?: string } = {},
) {
  const now = options.now ?? new Date();
  const studentId = options.studentId ?? CORE.studentId;
  const hrUserId = await prepareHrDemo(prisma);
  const financeUserId = await prepareFinanceDemo(prisma);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('local-headquarters-demo-data'))`;
    const teacher = await tx.teacherProfile.findUnique({
      where: { id: CORE.teacherId },
    });
    const campus = await tx.campus.findUnique({
      where: { id: CORE.campusId },
    });
    const student = await tx.student.findUnique({
      where: { id: studentId },
    });
    if (!teacher || !campus || !student) {
      throw new Error(
        'Headquarters demo core records are missing; run db:seed first',
      );
    }

    const recordInputs = [
      {
        id: HEADQUARTERS_DEMO_IDS.hrRecords.qualification,
        kind: 'QUALIFICATION' as const,
        title: '教师资格证',
        organization: '教育主管部门',
        occurredOn: new Date('2024-06-18T00:00:00+08:00'),
        expiresOn: new Date('2029-06-17T00:00:00+08:00'),
        note: '本地演示档案，用于资质信息展示。',
      },
      {
        id: HEADQUARTERS_DEMO_IDS.hrRecords.training,
        kind: 'TRAINING' as const,
        title: '创意课堂教学研修',
        organization: '启明教研中心',
        occurredOn: new Date('2026-08-22T00:00:00+08:00'),
        expiresOn: null,
        note: '完成课堂组织、学员互动与课后反馈培训。',
      },
      {
        id: HEADQUARTERS_DEMO_IDS.hrRecords.growth,
        kind: 'GROWTH' as const,
        title: '骨干教师成长记录',
        organization: '启明东校区',
        occurredOn: new Date('2026-09-05T00:00:00+08:00'),
        expiresOn: null,
        note: '本月完成公开课复盘，进入骨干教师培养阶段。',
      },
    ];
    for (const record of recordInputs) {
      await tx.hrTeacherRecord.upsert({
        where: { id: record.id },
        update: {},
        create: {
          ...record,
          teacherId: CORE.teacherId,
          createdByUserId: hrUserId,
        },
      });
    }

    const markers = await tx.auditLog.findMany({
      where: {
        action: 'LOCAL_HEADQUARTERS_DEMO_PENDING_RECEIPT_CREATE',
        resourceType: 'FinanceReceipt',
        resourceId: { not: null },
      },
      select: { resourceId: true },
    });
    const knownReceiptIds = [
      ...new Set([
        ...HEADQUARTERS_DEMO_IDS.pendingReceipts,
        ...markers.flatMap(({ resourceId }) =>
          resourceId ? [resourceId] : [],
        ),
      ]),
    ];
    const receipts = await tx.financeReceipt.findMany({
      where: { id: { in: knownReceiptIds } },
      include: { issuance: true },
    });
    const reusable = receipts.find(
      (receipt) => receipt.issuance === null && receipt.studentId === studentId,
    );
    if (reusable) {
      return {
        hrRecordIds: recordInputs.map(({ id }) => id),
        pendingReceiptId: reusable.id,
      };
    }

    const usedReceiptIds = new Set(receipts.map(({ id }) => id));
    const slot = HEADQUARTERS_DEMO_IDS.pendingReceipts.findIndex(
      (id) => !usedReceiptIds.has(id),
    );
    const receiptId =
      slot >= 0 ? HEADQUARTERS_DEMO_IDS.pendingReceipts[slot] : randomUUID();
    const proofId =
      slot >= 0 ? HEADQUARTERS_DEMO_IDS.receiptProofs[slot] : randomUUID();
    const auditId =
      slot >= 0 ? HEADQUARTERS_DEMO_IDS.receiptAudits[slot] : randomUUID();
    const storageKey = `finance-receipts/local-demo/${receiptId}.png`;
    await tx.storedFile.upsert({
      where: { id: proofId },
      update: {},
      create: {
        id: proofId,
        purpose: 'FINANCE_RECEIPT_PROOF',
        storageKey,
        originalName: '本地演示收款凭证.png',
        mimeType: 'image/png',
        sizeBytes: PROOF_BYTES.length,
        sha256: createHash('sha256').update(PROOF_BYTES).digest('hex'),
        createdByUserId: financeUserId,
      },
    });
    const receivedOn = shanghaiDate(now);
    await tx.financeReceipt.create({
      data: {
        id: receiptId,
        campusId: CORE.campusId,
        studentId,
        amountFen: 98000,
        receivedOn,
        channel: 'WECHAT',
        proofFileId: proofId,
        note: '本地演示待录包收款，请在课包录入模块继续办理。',
        createdByUserId: financeUserId,
        createdAt: now,
      },
    });
    await tx.auditLog.upsert({
      where: { id: auditId },
      update: {},
      create: {
        id: auditId,
        campusId: CORE.campusId,
        actorUserId: financeUserId,
        action: 'LOCAL_HEADQUARTERS_DEMO_PENDING_RECEIPT_CREATE',
        resourceType: 'FinanceReceipt',
        resourceId: receiptId,
        outcome: 'SUCCESS',
        details: { localDemoOnly: true },
        createdAt: now,
      },
    });
    return {
      hrRecordIds: recordInputs.map(({ id }) => id),
      pendingReceiptId: receiptId,
    };
  });

  if (options.storageRoot) {
    await writeDemoProof(options.storageRoot, result.pendingReceiptId);
  }
  return result;
}

function shanghaiDate(value: Date) {
  return new Date(
    `${new Date(value.getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)}T00:00:00.000Z`,
  );
}

async function writeDemoProof(storageRoot: string, receiptId: string) {
  const root = path.resolve(storageRoot);
  const storageKey = `finance-receipts/local-demo/${receiptId}.png`;
  const target = path.resolve(root, ...storageKey.split('/'));
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new Error('The local demo proof path is invalid');
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, PROOF_BYTES);
}

async function main() {
  assertLocalHeadquartersDemoEnvironment(process.env);
  const connectionString = process.env.DATABASE_URL as string;
  const storageRoot = process.env.FILE_STORAGE_ROOT;
  if (!storageRoot) throw new Error('FILE_STORAGE_ROOT is required');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const result = await prepareHeadquartersDemoData(prisma, { storageRoot });
    console.log(JSON.stringify({ localDemoOnly: true, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Headquarters demo preparation failed',
    );
    process.exitCode = 1;
  });
}
