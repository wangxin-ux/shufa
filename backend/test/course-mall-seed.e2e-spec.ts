import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedTeacherCore } from '../prisma/seed';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

describe('course mall deterministic seed', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });

  afterAll(async () => prisma.$disconnect());

  it('is repeatable and never grants a package for an unreviewed order', async () => {
    await seedTeacherCore(prisma);
    await seedTeacherCore(prisma);

    expect(await prisma.courseProduct.count()).toBeGreaterThanOrEqual(2);
    const order = await prisma.enrollmentOrder.findUniqueOrThrow({
      where: { orderNo: 'ENR-DEMO-20260831-001' },
      include: { coursePackage: true, paymentProofs: true, reviews: true },
    });
    expect(order).toMatchObject({
      status: 'AWAITING_PROOF',
      version: 1,
      coursePackage: null,
      paymentProofs: [],
      reviews: [],
    });
  });
});
