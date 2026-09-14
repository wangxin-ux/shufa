import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  assertLocalHeadquartersDemoEnvironment,
  HEADQUARTERS_DEMO_IDS,
  prepareHeadquartersDemoData,
} from '../prisma/prepare-headquarters-demo-data';
import { prepareFinanceDemo } from '../prisma/prepare-finance-demo';
import { prepareHrDemo } from '../prisma/prepare-hr-demo';
import { seedTeacherCore } from '../prisma/seed';

jest.setTimeout(30_000);

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

describe('headquarters local demonstration data', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
    });
    await seedTeacherCore(prisma);
    await prepareHrDemo(prisma);
    await prepareFinanceDemo(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects production, non-mock auth, and a non-development database', () => {
    expect(() =>
      assertLocalHeadquartersDemoEnvironment({
        NODE_ENV: 'production',
        AUTH_DRIVER: 'mock',
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/education_app?schema=public',
      }),
    ).toThrow('local mock-auth development database');
    expect(() =>
      assertLocalHeadquartersDemoEnvironment({
        NODE_ENV: 'development',
        AUTH_DRIVER: 'wechat',
        DATABASE_URL:
          'postgresql://app:secret@localhost:5432/education_app?schema=public',
      }),
    ).toThrow('local mock-auth development database');
    expect(() =>
      assertLocalHeadquartersDemoEnvironment({
        NODE_ENV: 'development',
        AUTH_DRIVER: 'mock',
        DATABASE_URL:
          'postgresql://app:secret@example.com:5432/education_app?schema=public',
      }),
    ).toThrow('local mock-auth development database');
  });

  it('is idempotent and keeps real API pages populated without deleting existing facts', async () => {
    const receiptCountBefore = await prisma.financeReceipt.count();
    const first = await prepareHeadquartersDemoData(prisma, {
      now: new Date('2026-09-10T10:00:00+08:00'),
    });
    const receiptCountAfterFirst = await prisma.financeReceipt.count();
    const second = await prepareHeadquartersDemoData(prisma, {
      now: new Date('2026-09-10T10:05:00+08:00'),
    });

    expect(second).toEqual(first);
    expect(receiptCountAfterFirst).toBeGreaterThanOrEqual(receiptCountBefore);
    expect(await prisma.financeReceipt.count()).toBe(receiptCountAfterFirst);
    expect(first.pendingReceiptId).toBe(HEADQUARTERS_DEMO_IDS.pendingReceipt);

    const records = await prisma.hrTeacherRecord.findMany({
      where: { id: { in: Object.values(HEADQUARTERS_DEMO_IDS.hrRecords) } },
      orderBy: { kind: 'asc' },
    });
    expect(records).toHaveLength(3);
    expect(new Set(records.map(({ kind }) => kind))).toEqual(
      new Set(['QUALIFICATION', 'TRAINING', 'GROWTH']),
    );
    expect(records.every(({ archivedAt }) => archivedAt === null)).toBe(true);

    const pendingReceipt = await prisma.financeReceipt.findUniqueOrThrow({
      where: { id: first.pendingReceiptId },
      include: { issuance: true },
    });
    expect(pendingReceipt.issuance).toBeNull();
    expect(pendingReceipt.note).toContain('本地演示');
  });
});
