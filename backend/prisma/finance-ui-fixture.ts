import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export async function prepareFinanceUiFixture(
  prisma: PrismaClient,
  code = 'LOCAL-FINANCE-UI-QA',
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${code}))`;
    const existing = await tx.campus.findUnique({
      where: { code },
      include: { students: { include: { parentBindings: true } } },
    });
    if (existing) {
      const student = existing.students[0];
      if (
        existing.name !== '本地财务验收校区' ||
        existing.students.length !== 1 ||
        student.displayName !== '财务验收学员' ||
        student.parentBindings.length !== 1
      ) {
        throw new Error('Fixture differs; existing records were not changed');
      }
      return {
        campusId: existing.id,
        studentId: student.id,
        parentUserId: student.parentBindings[0].parentUserId,
      };
    }
    const campus = await tx.campus.create({
      data: { code, name: '本地财务验收校区' },
    });
    const student = await tx.student.create({
      data: { campusId: campus.id, displayName: '财务验收学员' },
    });
    const parent = await tx.user.create({
      data: {
        displayName: '财务验收家长',
        roles: { create: { roleCode: 'PARENT', campusId: campus.id } },
        authIdentities: {
          create: { provider: 'MOCK', subject: `${code}-parent` },
        },
        parentStudentBindings: {
          create: {
            campusId: campus.id,
            studentId: student.id,
            isPrimary: true,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        campusId: campus.id,
        actorUserId: parent.id,
        action: 'LOCAL_FINANCE_UI_FIXTURE_CREATE',
        resourceType: 'Student',
        resourceId: student.id,
        outcome: 'SUCCESS',
        details: { localTestOnly: true },
      },
    });
    return {
      campusId: campus.id,
      studentId: student.id,
      parentUserId: parent.id,
    };
  });
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? '';
  const target = new URL(connectionString);
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.AUTH_DRIVER !== 'mock' ||
    !['localhost', '127.0.0.1', 'postgres'].includes(target.hostname) ||
    target.pathname !== '/education_app'
  ) {
    throw new Error('UI fixture requires local mock-auth development database');
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    console.log(JSON.stringify(await prepareFinanceUiFixture(prisma)));
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module)
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Fixture preparation failed',
    );
    process.exitCode = 1;
  });
