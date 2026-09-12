import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedTeacherCore } from '../prisma/seed';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

describe('group buying deterministic seed', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });

  afterAll(async () => prisma.$disconnect());

  it('is repeatable and does not create unpaid group business records', async () => {
    await seedTeacherCore(prisma);
    await seedTeacherCore(prisma);

    const campaign = await prisma.groupCampaign.findUniqueOrThrow({
      where: { code: 'GROUP-1990-DEMO' },
      include: {
        campus: true,
        courseProduct: true,
        teams: true,
        members: true,
      },
    });

    expect(campaign).toMatchObject({
      priceFen: 1990,
      status: 'ACTIVE',
      maxPaidMembers: 3,
      campus: {
        customerServiceName: '启明课程顾问',
        contactPhone: '0731-88886666',
      },
      teams: [],
      members: [],
    });
    expect(campaign.courseProduct.campusId).toBe(campaign.campusId);
    expect(
      await prisma.groupCampaign.count({
        where: { code: 'GROUP-1990-DEMO' },
      }),
    ).toBe(1);
    expect(
      await prisma.enrollmentOrder.count({
        where: { orderNo: { startsWith: 'GROUP-' } },
      }),
    ).toBe(0);
  });
});
