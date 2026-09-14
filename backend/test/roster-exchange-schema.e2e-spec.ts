import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://app:app_test_password@localhost:5433/education_app_test?schema=public';

describe('roster phone schema constraints', () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }),
  });
  const phone = `+86139${Date.now().toString().slice(-8)}`;
  const createdIds: string[] = [];

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.$disconnect();
  });

  it('rejects the same normalized phone across parent and staff fields', async () => {
    const parent = await prisma.user.create({
      data: { displayName: '导入家长', parentPhone: phone },
      select: { id: true },
    });
    createdIds.push(parent.id);

    await expect(
      prisma.user.create({
        data: { displayName: '导入教师', staffPhone: phone },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a user carrying both parent and staff phone kinds', async () => {
    await expect(
      prisma.user.create({
        data: {
          displayName: '冲突账号',
          parentPhone: `+86138${Date.now().toString().slice(-8)}`,
          staffPhone: `+86137${Date.now().toString().slice(-8)}`,
        },
      }),
    ).rejects.toBeDefined();
  });
});
