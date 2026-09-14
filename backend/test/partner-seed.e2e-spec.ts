import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedTeacherCore } from '../prisma/seed';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

if (!new URL(TEST_DATABASE_URL).pathname.includes('education_app_test')) {
  throw new Error('Partner seed tests must use education_app_test');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});

async function readPartnerCounts() {
  return {
    roles: await prisma.userRole.count({ where: { roleCode: 'PARTNER' } }),
    identities: await prisma.authIdentity.count({
      where: { provider: 'MOCK', subject: 'mock-demo-east-partner' },
    }),
  };
}

describe('partner seed', () => {
  afterAll(async () => prisma.$disconnect());

  it('is repeatable and creates one single-role east campus partner', async () => {
    await seedTeacherCore(prisma);
    const first = await readPartnerCounts();
    await seedTeacherCore(prisma);
    const second = await readPartnerCounts();

    expect(first).toEqual({ roles: 1, identities: 1 });
    expect(second).toEqual(first);

    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: {
        provider_subject: {
          provider: 'MOCK',
          subject: 'mock-demo-east-partner',
        },
      },
      select: {
        user: {
          select: {
            displayName: true,
            roles: { select: { roleCode: true, campusId: true } },
          },
        },
      },
    });

    expect(identity.user).toEqual({
      displayName: '朱元璋',
      roles: [
        {
          roleCode: 'PARTNER',
          campusId: '10000000-0000-4000-8000-000000000001',
        },
      ],
    });
  });

  it('seeds the configurable campus rule and a consistent historical earning', async () => {
    await seedTeacherCore(prisma);

    await expect(
      prisma.partnerEarningRule.findFirstOrThrow({
        where: {
          scopeKey:
            'campus:10000000-0000-4000-8000-000000000001:partner',
          status: 'ACTIVE',
        },
        select: {
          unitPriceFen: true,
          shareBasisPoints: true,
          countedAttendanceStatuses: true,
        },
      }),
    ).resolves.toEqual({
      unitPriceFen: 1000,
      shareBasisPoints: 4000,
      countedAttendanceStatuses: ['PRESENT'],
    });

    await expect(
      prisma.partnerEarningBasis.findFirstOrThrow({
        where: {
          lessonSessionId: '70000000-0000-4000-8000-000000000001',
        },
        include: { entries: true },
      }),
    ).resolves.toMatchObject({
      actualAttendeeCount: 2,
      countedAttendeeCount: 2,
      status: 'PRICED',
      entries: [
        expect.objectContaining({
          entryType: 'ACCRUAL',
          amountFen: 800,
          status: 'AVAILABLE',
        }),
      ],
    });
  });
});
