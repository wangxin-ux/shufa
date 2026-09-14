import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { seedTeacherCore } from '../prisma/seed';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

if (!new URL(TEST_DATABASE_URL).pathname.includes('education_app_test')) {
  throw new Error('Campus manager seed tests must use education_app_test');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
});

async function readManagerCounts() {
  return {
    roles: await prisma.userRole.count({
      where: { roleCode: 'CAMPUS_MANAGER' },
    }),
    identities: await prisma.authIdentity.count({
      where: {
        provider: 'MOCK',
        subject: 'mock-demo-east-campus-manager',
      },
    }),
  };
}

describe('campus manager seed', () => {
  afterAll(async () => prisma.$disconnect());

  it('is repeatable and creates one single-role east campus manager', async () => {
    await seedTeacherCore(prisma);
    const first = await readManagerCounts();
    await seedTeacherCore(prisma);
    const second = await readManagerCounts();

    expect(first).toEqual({ roles: 1, identities: 1 });
    expect(second).toEqual(first);

    const identity = await prisma.authIdentity.findUniqueOrThrow({
      where: {
        provider_subject: {
          provider: 'MOCK',
          subject: 'mock-demo-east-campus-manager',
        },
      },
      select: {
        user: {
          select: {
            displayName: true,
            roles: {
              select: { roleCode: true, campusId: true },
            },
          },
        },
      },
    });

    expect(identity.user).toEqual({
      displayName: '周园长',
      roles: [
        {
          roleCode: 'CAMPUS_MANAGER',
          campusId: '10000000-0000-4000-8000-000000000001',
        },
      ],
    });
  });
});
