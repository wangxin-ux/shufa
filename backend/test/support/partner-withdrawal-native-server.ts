import 'reflect-metadata';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createRequire } from 'node:module';
import { createConnection, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { ExecutionContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { load as parseYaml } from 'js-yaml';
import { defer, finalize } from 'rxjs';
import { configureApplication } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AccessTokenGuard } from '../../src/modules/auth/access-token.guard';
import { NativeCampaignActivity } from './free-campaign-native-activity';
import { assertFreeCampaignNativeTarget } from './free-campaign-native-policy';
import {
  allowWithdrawalNativeRequest,
  type WithdrawalNativeScope,
} from './partner-withdrawal-native-policy';

const runTag = `pwnative-${randomUUID().slice(0, 8)}`;
const logPath = resolve(
  __dirname,
  `../../../docs/verification/partner-withdrawal-2026-10-16-native-${runTag}.log`,
);
writeFileSync(logPath, '', { flag: 'wx' });
function emit(kind: string, value: object) {
  const line = `${JSON.stringify({ kind, runTag, ...value })}\n`;
  appendFileSync(logPath, line);
  process.stdout.write(line);
}

async function main() {
  const compose = parseYaml(
    readFileSync(resolve(__dirname, '../../../docker-compose.yml'), 'utf8'),
  ) as {
    services: {
      postgres_test: {
        ports: string[];
        environment: { POSTGRES_USER: string; POSTGRES_PASSWORD: string };
      };
    };
  };
  const database = compose.services.postgres_test;
  strictEqual(database.ports.includes('5433:5432'), true);
  const target = new URL(
    'postgresql://127.0.0.1:5433/education_app_test_partner_pdf_20261012contact_test',
  );
  target.username = database.environment.POSTGRES_USER;
  target.password = database.environment.POSTGRES_PASSWORD;
  Object.assign(process.env, {
    DATABASE_URL: target.href,
    PARTNER_PDF_TEST_DB_NAME: target.pathname.slice(1),
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    PARTNER_WITHDRAWAL_DRIVER: 'mock',
    PORT: '3001',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: `withdrawal-native-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `withdrawal-native-refresh-${randomUUID()}`,
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_ROOT: './storage/partner-pdf-test',
    PAYOUT_DRIVER: 'manual',
    TZ: 'Asia/Shanghai',
  });
  assertFreeCampaignNativeTarget(process.env);
  const load = createRequire(__filename);
  const { AppModule } = load(
    '../../src/app.module',
  ) as typeof import('../../src/app.module');
  const express = createRequire(load.resolve('@nestjs/platform-express'))(
    'express',
  ) as typeof import('express');
  const app = await NestFactory.create(AppModule, { logger: false });
  const scope: WithdrawalNativeScope = {
    adminId: '',
    partnerId: '',
    campusId: '',
    earningId: '',
    runTag,
    adminLogin: `pwnative-admin-${randomUUID()}`,
    partnerLogin: `pwnative-partner-${randomUUID()}`,
    withdrawals: new Map(),
  };
  const activity = new NativeCampaignActivity();
  // A disconnected response can leave authentication or a transaction in flight.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Retains the guard receiver.
  const authenticate = AccessTokenGuard.prototype.canActivate;
  Object.defineProperty(AccessTokenGuard.prototype, 'canActivate', {
    configurable: true,
    writable: true,
    value: function (this: AccessTokenGuard, context: ExecutionContext) {
      return activity.during(() => authenticate.call(this, context));
    },
  });
  const jwt = new JwtService();
  let phase: 'setup' | 'native' | 'stopping' = 'setup';
  let prisma: PrismaService;
  let port = 0;
  let users: string[] = [];
  let originalEarning: unknown;
  let closing: Promise<void> | undefined;
  app.use(express.json({ limit: '4kb' }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    activity.observeResponse(res);
    const path = req.path;
    res.once('finish', () => {
      emit('http', { method: req.method, path, status: res.statusCode });
    });
    void activity
      .during(async () => {
        if (phase !== 'native')
          return res.status(503).json({ error: { code: 'FIXTURE_STOPPING' } });
        let actorId: string | undefined;
        try {
          const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
          if (scheme === 'Bearer' && token) {
            const payload = await jwt.verifyAsync<{
              sub: string;
              kind: string;
            }>(token, { secret: process.env.JWT_ACCESS_SECRET });
            if (payload.kind === 'access') actorId = payload.sub;
          }
        } catch {
          // The application still authenticates every admitted protected request.
        }
        if ([scope.partnerId, scope.adminId].includes(actorId ?? '')) {
          const rows = await prisma.partnerWithdrawal.findMany({
            where: {
              campusId: scope.campusId,
              requestedByUserId: scope.partnerId,
            },
            select: { id: true, proof: { select: { fileId: true } } },
          });
          scope.withdrawals = new Map(
            rows.map((w) => [w.id, w.proof?.fileId ?? null]),
          );
        }
        if (
          !allowWithdrawalNativeRequest(scope, {
            method: req.method,
            path,
            actorId,
            body: req.body as unknown,
            query: req.query,
          })
        )
          return res
            .status(403)
            .json({ error: { code: 'FIXTURE_SCOPE_DENIED' } });
        if (path === '/management/campuses') {
          // Confine the real directory controller to this run's unique campus code.
          const url = new URL(req.url, 'http://127.0.0.1');
          url.searchParams.set('query', runTag);
          req.url = url.pathname + url.search;
        }
        next();
      })
      .catch(() => {
        if (!res.headersSent)
          res.status(503).json({ error: { code: 'FIXTURE_GATE_FAILED' } });
      });
  });
  app.useGlobalInterceptors({
    intercept(_context, next) {
      const end = activity.begin();
      return defer(() => next.handle()).pipe(finalize(end));
    },
  });
  configureApplication(app);
  async function facts() {
    return {
      campusId: scope.campusId,
      profile: await prisma.partnerSettlementProfile.findUnique({
        where: { campusId: scope.campusId },
      }),
      sources: await prisma.partnerSettlementSource.findMany({
        where: { campusId: scope.campusId },
      }),
      withdrawals: await prisma.partnerWithdrawal.findMany({
        where: { campusId: scope.campusId },
        orderBy: { createdAt: 'asc' },
        include: { allocations: true, proof: true },
      }),
      audits: await prisma.auditLog.findMany({
        where: { campusId: scope.campusId },
        orderBy: { createdAt: 'asc' },
        select: {
          action: true,
          resourceId: true,
          actorUserId: true,
          outcome: true,
        },
      }),
      issues: await prisma.partnerSettlementIssue.count({
        where: { allocation: { withdrawal: { campusId: scope.campusId } } },
      }),
    };
  }
  const stop = () => {
    if (closing) return closing;
    closing = (async () => {
      phase = 'stopping';
      await activity.idle();
      try {
        if (users.length) {
          deepStrictEqual(
            await prisma.partnerEarningEntry.findUnique({
              where: { id: scope.earningId },
            }),
            originalEarning,
          );
          emit('facts', await facts());
        }
      } finally {
        try {
          if (users.length) {
            assertFreeCampaignNativeTarget(process.env);
            const disabled = await prisma.user.updateMany({
              where: { id: { in: users }, displayName: { startsWith: runTag } },
              data: { status: 'DISABLED' },
            });
            strictEqual(disabled.count, users.length);
            emit('disabled', { userIds: users, count: disabled.count });
          }
        } finally {
          await app.close();
          emit('closed', {
            port,
            userIds: users,
            campusId: scope.campusId,
            disposition: 'synthetic records and proof retained; no deletion',
          });
        }
      }
      if (port) {
        const refused = await new Promise<boolean>((done) => {
          const socket = createConnection({ host: '127.0.0.1', port });
          socket.once('connect', () => {
            socket.destroy();
            done(false);
          });
          socket.once('error', (error: NodeJS.ErrnoException) =>
            done(error.code === 'ECONNREFUSED'),
          );
          socket.setTimeout(1500, () => {
            socket.destroy();
            done(false);
          });
        });
        emit('port-check', { port, refused });
        strictEqual(refused, true);
      }
    })();
    return closing;
  };
  try {
    await app.init();
    prisma = app.get(PrismaService);
    const actual = await prisma.$queryRaw<
      Array<{ name: string }>
    >`SELECT current_database()::text AS name`;
    strictEqual(actual[0].name, target.pathname.slice(1));
    const seeded = await prisma.$transaction(async (tx) => {
      const campus = await tx.campus.create({
        data: { code: runTag, name: '原生提现合成校区' },
      });
      const admin = await tx.user.create({
        data: {
          displayName: `${runTag}-admin`,
          roles: { create: { roleCode: 'SUPER_ADMIN', campusId: null } },
          authIdentities: {
            create: { provider: 'MOCK', subject: scope.adminLogin },
          },
        },
      });
      const partner = await tx.user.create({
        data: {
          displayName: `${runTag}-partner`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
          authIdentities: {
            create: { provider: 'MOCK', subject: scope.partnerLogin },
          },
        },
      });
      const teacher = await tx.user.create({
        data: {
          displayName: `${runTag}-teacher`,
          roles: { create: { roleCode: 'TEACHER', campusId: campus.id } },
        },
      });
      const profile = await tx.teacherProfile.create({
        data: {
          userId: teacher.id,
          campusId: campus.id,
          employeeCode: runTag,
        },
      });
      const group = await tx.classGroup.create({
        data: {
          campusId: campus.id,
          teacherId: profile.id,
          name: runTag,
          courseName: '模拟课程',
        },
      });
      const rule = await tx.partnerEarningRule.create({
        data: {
          campusId: campus.id,
          scopeKey: runTag,
          unitPriceFen: 100000,
          shareBasisPoints: 1000,
          eligibleLessonKinds: ['REGULAR'],
          countedAttendanceStatuses: ['PRESENT'],
          version: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          createdByUserId: admin.id,
        },
      });
      const now = new Date();
      const lesson = await tx.lessonSession.create({
        data: {
          campusId: campus.id,
          teacherId: profile.id,
          classGroupId: group.id,
          startsAt: new Date(now.getTime() - 3600000),
          endsAt: now,
          completedAt: now,
          status: 'COMPLETED',
        },
      });
      const teaching = await tx.teachingRecord.create({
        data: {
          campusId: campus.id,
          teacherId: profile.id,
          lessonSessionId: lesson.id,
          attendeeCount: 0,
          lessonUnits: 100,
          recordedByUserId: teacher.id,
          completedAt: now,
        },
      });
      const basis = await tx.partnerEarningBasis.create({
        data: {
          campusId: campus.id,
          teachingRecordId: teaching.id,
          lessonSessionId: lesson.id,
          selectedRuleId: rule.id,
          lessonKind: 'REGULAR',
          lessonUnits: 100,
          actualAttendeeCount: 0,
          countedAttendeeCount: 0,
          attendanceSnapshot: [],
          completedAt: now,
          status: 'PRICED',
        },
      });
      const earning = await tx.partnerEarningEntry.create({
        data: {
          campusId: campus.id,
          earningBasisId: basis.id,
          amountFen: 100000,
          entryType: 'ACCRUAL',
          status: 'AVAILABLE',
          reviewedByUserId: admin.id,
          reviewedAt: now,
          reviewableAt: now,
          ruleSnapshot: { simulated: true },
        },
      });
      return { campus, admin, partner, teacher, earning };
    });
    users = [seeded.admin.id, seeded.partner.id, seeded.teacher.id];
    Object.assign(scope, {
      adminId: seeded.admin.id,
      partnerId: seeded.partner.id,
      campusId: seeded.campus.id,
      earningId: seeded.earning.id,
    });
    originalEarning = seeded.earning;
    phase = 'native';
    await app.listen(0, '127.0.0.1');
    port = ((app.getHttpServer() as Server).address() as AddressInfo).port;
    emit('ready', {
      origin: `http://127.0.0.1:${port}`,
      port,
      campusId: scope.campusId,
      earningId: scope.earningId,
      userIds: users,
      logPath,
      directoryQuery: runTag,
      policy: {
        minimumAmountFen: 10000,
        dailyRequestLimit: 2,
        applicationAmountFen: 80000,
      },
    });
    process.stdout.write(
      `${JSON.stringify({ kind: 'ephemeral-login', adminCode: scope.adminLogin, partnerCode: scope.partnerLogin })}\n`,
    );
    const input = createInterface({ input: process.stdin });
    let controls = Promise.resolve();
    const timer = setTimeout(() => input.close(), 20 * 60_000);
    input.on('line', (line) => {
      controls = controls
        .then(async () => {
          if (line === 'checkpoint') {
            await activity.idle();
            emit('checkpoint', await facts());
          }
          if (line === 'stop') {
            try {
              await stop();
            } finally {
              input.close();
            }
          }
        })
        .catch(() => {
          emit('failure', {
            reason: 'Native control failed; credentials withheld',
          });
          process.exitCode = 1;
          input.close();
        });
    });
    input.on('close', () => {
      clearTimeout(timer);
      void controls.then(stop).catch(() => {
        emit('failure', {
          reason: 'Native closeout failed; credentials withheld',
        });
        process.exitCode = 1;
      });
    });
  } catch {
    emit('failure', { reason: 'Native setup failed; credentials withheld' });
    await stop();
    process.exitCode = 1;
  }
}
void main().catch(() => {
  emit('failure', { reason: 'Native startup failed; credentials withheld' });
  process.exitCode = 1;
});
