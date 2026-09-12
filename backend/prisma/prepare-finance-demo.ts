import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const FINANCE_DISPLAY_NAME = '钱会计';

export async function prepareFinanceDemo(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    const subject = 'mock-demo-finance';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subject}))`;
    const existing = await tx.authIdentity.findUnique({
      where: { provider_subject: { provider: 'MOCK', subject } },
      include: { user: { include: { roles: true } } },
    });
    if (existing) {
      if (
        existing.user.status !== 'ACTIVE' ||
        existing.user.roles.length !== 1 ||
        existing.user.roles[0].roleCode !== 'FINANCE' ||
        existing.user.roles[0].campusId !== null
      ) {
        throw new Error(
          'Existing finance demo identity differs; no account was modified',
        );
      }
      if (existing.user.displayName !== FINANCE_DISPLAY_NAME) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { displayName: FINANCE_DISPLAY_NAME },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: existing.userId,
            action: 'LOCAL_FINANCE_DEMO_ACCOUNT_RENAME',
            resourceType: 'User',
            resourceId: existing.userId,
            outcome: 'SUCCESS',
            details: {
              localDemoOnly: true,
              previousDisplayName: existing.user.displayName,
              displayName: FINANCE_DISPLAY_NAME,
            },
          },
        });
      }
      return existing.userId;
    }
    const user = await tx.user.create({
      data: {
        displayName: FINANCE_DISPLAY_NAME,
        roles: { create: { roleCode: 'FINANCE', campusId: null } },
        authIdentities: { create: { provider: 'MOCK', subject } },
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'LOCAL_FINANCE_DEMO_ACCOUNT_CREATE',
        resourceType: 'User',
        resourceId: user.id,
        outcome: 'SUCCESS',
        details: { localDemoOnly: true },
      },
    });
    return user.id;
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
    throw new Error(
      'Finance demo preparation requires the local mock-auth development database',
    );
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    await prepareFinanceDemo(prisma);
    console.log(
      'Finance demo account ready; its display name is current and no receipt or package was changed.',
    );
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Finance demo preparation failed',
    );
    process.exitCode = 1;
  });
}
