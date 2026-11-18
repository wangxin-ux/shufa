import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import request from 'supertest';
import type { Prisma } from '@prisma/client';
import { AuthService } from '../../src/modules/auth/auth.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { assertTeacherPdfTestTarget } from './teacher-feedback-integration-target';
import { createTeacherPdfTestApp as createOriginalApp } from './teacher-pdf-test-app';

export { completeTeacherFixtureCleanup } from './teacher-pdf-test-app';

interface Allocation {
  execution: string;
  purpose?: string;
  oldUserIds: string[];
  oldCampusIds: string[];
}

function allocationForExecution() {
  assertTeacherPdfTestTarget(process.env);
  const execution = process.env.TEACHER_FEEDBACK_INTEGRATION_EXECUTION!;
  const directory = process.env.TEACHER_FEEDBACK_INTEGRATION_EVIDENCE!;
  const allocation = JSON.parse(
    readFileSync(join(directory, `${execution}-allocation.json`), 'utf8'),
  ) as Allocation;
  const rankingFlag = process.env.TEACHER_ACCOUNT_RANKING_INTEGRATION_ENABLED;
  const rankings = rankingFlag === '1';
  if (
    allocation.execution !== execution ||
    (rankingFlag !== undefined && rankingFlag !== '1') ||
    (rankings && allocation.purpose !== 'teacher-account-rankings') ||
    (!rankings && allocation.purpose === 'teacher-account-rankings')
  ) {
    throw new Error('Feedback execution allocation mismatch');
  }
  const accountPattern = rankings
    ? /^trank-20261025-[a-f0-9]{8}-/
    : /^(tratings-20261025-|tarchive-20261025-|tfeedback-main)/;
  const accountAction = rankings
    ? 'TEACHER_ACCOUNT_RANKING_INTEGRATION_ACCOUNT'
    : 'TEACHER_FEEDBACK_INTEGRATION_ACCOUNT';
  return {
    allocation,
    execution,
    directory,
    accountPattern,
    accountAction,
    rankings,
  };
}

export async function createTeacherFixtureUser(
  prisma: PrismaService,
  data: Prisma.UserCreateInput,
) {
  const { allocation, execution, accountPattern, accountAction } =
    allocationForExecution();
  return prisma.$transaction(async (transaction) => {
    const user = await transaction.user.create({
      data,
      include: { teacherProfile: true, roles: true },
    });
    const role = user.roles[0];
    if (
      !role?.campusId ||
      user.roles.length !== 1 ||
      !['TEACHER', 'PARENT'].includes(role.roleCode) ||
      allocation.oldCampusIds.includes(role.campusId) ||
      !accountPattern.test(user.displayName)
    ) {
      throw new Error('Account is outside the current feedback fixture');
    }
    await transaction.auditLog.create({
      data: {
        campusId: role.campusId,
        actorUserId: user.id,
        action: accountAction,
        resourceType: 'User',
        resourceId: user.id,
        outcome: 'SUCCESS',
        details: { execution, syntheticOnly: true },
      } satisfies Prisma.AuditLogUncheckedCreateInput,
    });
    return user;
  });
}

export async function createTeacherPdfTestApp() {
  const {
    allocation,
    execution,
    directory,
    accountPattern,
    accountAction,
    rankings,
  } = allocationForExecution();
  const applicationId = randomUUID();
  const result = await createOriginalApp();
  const { app, prisma } = result;
  if (rankings) {
    try {
      const settings = await prisma.$queryRaw<
        Array<{ replication: string; schema: string }>
      >`SELECT current_setting('session_replication_role') AS replication, current_schema() AS schema`;
      if (
        settings[0]?.replication !== 'origin' ||
        settings[0]?.schema !== 'public'
      ) {
        throw new Error('Unexpected ranking application session semantics');
      }
    } catch (error) {
      await app.close();
      throw error;
    }
  }
  const users = new Set<string>();
  const credentials: Array<{ userId: string; accessToken: string }> = [];
  const calls: Array<{ method: string; path: string; status: number }> = [];
  if (rankings) {
    app.getHttpServer().on('request', (incoming, response) => {
      response.once('finish', () => {
        calls.push({
          method: incoming.method ?? '',
          path: incoming.url ?? '',
          status: response.statusCode,
        });
      });
    });
  }
  const auth = app.get(AuthService);
  const issueSession = auth.issueSessionForUser.bind(auth);
  const close = app.close.bind(app);
  auth.issueSessionForUser = async (userId: string) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true },
    });
    if (
      allocation.oldUserIds.includes(userId) ||
      user.roles.length !== 1 ||
      !['TEACHER', 'PARENT'].includes(user.roles[0].roleCode) ||
      !user.roles[0].campusId ||
      allocation.oldCampusIds.includes(user.roles[0].campusId) ||
      !accountPattern.test(user.displayName)
    ) {
      throw new Error('Account is outside the current feedback fixture');
    }
    if (!users.has(userId)) {
      const manifest = await prisma.auditLog.count({
        where: {
          action: accountAction,
          resourceType: 'User',
          resourceId: userId,
          actorUserId: userId,
          details: { path: ['execution'], equals: execution },
        },
      });
      if (manifest !== 1) throw new Error('Account lacks its atomic manifest');
      if (!rankings) users.add(userId);
    }
    const session = await issueSession(userId);
    if (rankings) users.add(userId);
    credentials.push({ userId, accessToken: session.accessToken });
    return session;
  };
  app.close = async () => {
    let closeout: object | undefined;
    try {
      let createdAccounts = [...users];
      if (rankings) {
        const manifests = await prisma.auditLog.findMany({
          where: {
            action: accountAction,
            resourceType: 'User',
            outcome: 'SUCCESS',
            details: { path: ['execution'], equals: execution },
          },
          select: { resourceId: true, actorUserId: true, campusId: true },
        });
        if (
          manifests.some(
            (item) =>
              !item.resourceId ||
              item.resourceId !== item.actorUserId ||
              allocation.oldUserIds.includes(item.resourceId) ||
              !item.campusId ||
              allocation.oldCampusIds.includes(item.campusId),
          ) ||
          new Set(manifests.map((item) => item.resourceId)).size !==
            manifests.length
        ) {
          throw new Error('Ranking closeout account ownership mismatch');
        }
        createdAccounts = manifests.map((item) => item.resourceId!);
        await prisma.user.updateMany({
          where: { id: { in: createdAccounts }, status: { not: 'DISABLED' } },
          data: { status: 'DISABLED' },
        });
      }
      const accounts = await prisma.user.findMany({
        where: { id: { in: createdAccounts } },
        select: { id: true, status: true },
      });
      if (
        accounts.length !== createdAccounts.length ||
        accounts.some((account) => account.status !== 'DISABLED')
      ) {
        throw new Error('Feedback fixture accounts were not disabled');
      }
      const denied = [];
      for (const credential of credentials) {
        const response = await request(app.getHttpServer())
          .get('/me')
          .auth(credential.accessToken, { type: 'bearer' });
        denied.push({ userId: credential.userId, status: response.status });
        if (response.status !== 401) {
          throw new Error('A disabled feedback credential remains usable');
        }
      }
      closeout = {
        execution,
        accounts,
        denied,
        applicationClosed: true,
        ...(rankings
          ? {
              calls,
              createdAccounts,
              issuedUserIds: [...users],
              issuedCredentialCount: credentials.length,
            }
          : {}),
      };
    } finally {
      auth.issueSessionForUser = issueSession;
      await close();
    }
    writeFileSync(
      join(directory, `${execution}-${applicationId}-credentials.json`),
      JSON.stringify(closeout),
      { flag: 'wx' },
    );
  };
  return result;
}
