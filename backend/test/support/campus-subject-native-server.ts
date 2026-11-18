import 'reflect-metadata';
import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import { createConnection, type AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { Request, Response, NextFunction } from 'express';
import type { ExecutionContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { load as parseYaml } from 'js-yaml';
import { defer, finalize } from 'rxjs';
import { configureApplication } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AccessTokenGuard } from '../../src/modules/auth/access-token.guard';
import { assertFreeCampaignNativeTarget } from './free-campaign-native-policy';
import { NativeCampaignActivity } from './free-campaign-native-activity';
import {
  allowSubjectNativeRequest,
  type SubjectNativeScope,
} from './campus-subject-native-policy';

const runTag = `subjectnative-${randomUUID().slice(0, 8)}`;
const logPath = resolve(
  __dirname,
  `../../../docs/verification/campus-subjects-2026-10-16-native-${runTag}.log`,
);
writeFileSync(logPath, '', { flag: 'wx' });
const emit = (kind: string, value: object) => {
  const line = `${JSON.stringify({ kind, runTag, ...value })}\n`;
  appendFileSync(logPath, line);
  process.stdout.write(line);
};

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
  if (!database.ports.includes('5433:5432'))
    throw new Error('Existing isolated database required');
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
    PORT: '3001',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: `subject-native-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `subject-native-refresh-${randomUUID()}`,
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
  const scope: SubjectNativeScope = {
    adminId: '',
    partnerId: '',
    campusId: '',
    subjectId: '',
    packageId: '',
    adminLogin: `subject-native-${randomUUID()}`,
    partnerLogin: `subject-native-${randomUUID()}`,
    renamedSubject: '合成书法新名称',
    bindingReason: '合成课包关联验证',
  };
  const activity = new NativeCampaignActivity();
  // Include guard work that can outlive an interrupted HTTP response.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Each guard retains its receiver.
  const authenticate = AccessTokenGuard.prototype.canActivate;
  Object.defineProperty(AccessTokenGuard.prototype, 'canActivate', {
    configurable: true,
    writable: true,
    value: function (this: AccessTokenGuard, context: ExecutionContext) {
      return activity.during(() => authenticate.call(this, context));
    },
  });
  let phase: 'setup' | 'native' | 'stopping' = 'setup';
  const traces: object[] = [];
  const jwt = new JwtService();
  app.use(express.json({ limit: '16kb' }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    activity.observeResponse(res);
    res.once('finish', () =>
      traces.push({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        query: req.query,
        phase,
      }),
    );
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
          /* Application guards still authenticate every admitted request. */
        }
        // Ranking revisions are outside this subject-only fixture.
        if (
          req.method === 'GET' &&
          req.path === '/partners/me/rankings' &&
          actorId === scope.partnerId
        )
          return res
            .status(503)
            .json({ error: { code: 'FIXTURE_RANKING_NOT_INCLUDED' } });
        if (
          !allowSubjectNativeRequest(scope, {
            method: req.method,
            path: req.path,
            actorId,
            body: req.body as unknown,
          })
        )
          return res
            .status(403)
            .json({ error: { code: 'FIXTURE_SCOPE_DENIED' } });
        if (req.method === 'PATCH' && !req.headers['idempotency-key'])
          return res
            .status(400)
            .json({ error: { code: 'FIXTURE_KEY_REQUIRED' } });
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
  let prisma: PrismaService;
  let port = 0;
  let ownedUsers: string[] = [];
  let baseline: Awaited<ReturnType<typeof facts>> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  async function facts() {
    return {
      package: await prisma.coursePackage.findUnique({
        where: { id: scope.packageId },
        select: {
          subjectId: true,
          subjectVersion: true,
          mainBalanceUnits: true,
          giftBalanceUnits: true,
        },
      }),
      subject: await prisma.campusSubject.findUnique({
        where: { id: scope.subjectId },
        select: { id: true, name: true, version: true, isActive: true },
      }),
      ledger: await prisma.lessonLedgerEntry.findMany({
        where: { campusId: scope.campusId },
        orderBy: { id: 'asc' },
      }),
      financial: {
        receipts: await prisma.financeReceipt.count({
          where: { campusId: scope.campusId },
        }),
        orders: await prisma.enrollmentOrder.count({
          where: { campusId: scope.campusId },
        }),
        partnerEarnings: await prisma.partnerEarningEntry.count({
          where: { campusId: scope.campusId },
        }),
        teacherEarnings: await prisma.teacherEarningEntry.count({
          where: { campusId: scope.campusId },
        }),
      },
      audits: await prisma.auditLog.findMany({
        where: { campusId: scope.campusId },
        orderBy: { createdAt: 'asc' },
        select: { actorUserId: true, action: true, resourceId: true },
      }),
    };
  }
  const stop = () => {
    if (closing) return closing;
    closing = (async () => {
      if (closed) return;
      phase = 'stopping';
      try {
        await activity.idle();
      } catch {
        emit('drain-blocked', {
          activeRequests: activity.size,
          ownedUsers,
          port,
          reason: 'Requests remain active; closeout writes not started',
        });
        throw new Error('Fixture closeout blocked by active requests');
      }
      assertFreeCampaignNativeTarget(process.env);
      let retained: object = {};
      let disabled = 0;
      try {
        if (baseline) {
          const after = await facts();
          deepStrictEqual(after.ledger, baseline.ledger);
          deepStrictEqual(after.financial, baseline.financial);
          deepStrictEqual(
            [after.package?.mainBalanceUnits, after.package?.giftBalanceUnits],
            [
              baseline.package?.mainBalanceUnits,
              baseline.package?.giftBalanceUnits,
            ],
          );
          retained = {
            after,
            historicalLedgerUnchanged: true,
            financialUnchanged: true,
            balancesUnchanged: true,
            intendedWritesObserved:
              after.subject?.name === scope.renamedSubject &&
              after.subject.version === 2 &&
              after.package?.subjectId === scope.subjectId &&
              after.package.subjectVersion === 2,
          };
        }
      } finally {
        try {
          if (ownedUsers.length) {
            const result = await prisma.user.updateMany({
              where: {
                id: { in: ownedUsers },
                displayName: { startsWith: runTag },
              },
              data: { status: 'DISABLED' },
            });
            disabled = result.count;
          }
        } finally {
          await app.close();
          closed = true;
          emit('closed', {
            campusId: scope.campusId,
            ownedUsers,
            disabled,
            ownershipConfirmed: disabled === ownedUsers.length,
            drained: true,
            port,
            ...retained,
            traces,
            disposition: 'synthetic records retained; no deletion',
          });
        }
      }
      if (disabled !== ownedUsers.length)
        throw new Error('Fixture ownership changed');
      if (port) {
        const refused = await new Promise<boolean>((done) => {
          const socket = createConnection({ host: '127.0.0.1', port });
          socket.once('connect', () => {
            socket.destroy();
            done(false);
          });
          socket.once('error', () => done(true));
          socket.setTimeout(1500, () => {
            socket.destroy();
            done(false);
          });
        });
        emit('port-check', { port, refused });
        if (!refused) throw new Error('Fixture listener is still open');
      }
    })();
    return closing;
  };
  try {
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.$transaction(async (tx) => {
      const campus = await tx.campus.create({
        data: {
          code: runTag,
          name: '合成科目验证校区',
          timezone: 'Asia/Shanghai',
        },
      });
      scope.campusId = campus.id;
      for (const roleCode of ['SUPER_ADMIN', 'PARTNER'] as const) {
        const user = await tx.user.create({
          data: {
            displayName: `${runTag}-${roleCode}`,
            roles: {
              create: {
                roleCode,
                campusId: roleCode === 'SUPER_ADMIN' ? null : campus.id,
              },
            },
            authIdentities: {
              create: {
                provider: 'MOCK',
                subject:
                  roleCode === 'SUPER_ADMIN'
                    ? scope.adminLogin
                    : scope.partnerLogin,
              },
            },
          },
        });
        if (roleCode === 'SUPER_ADMIN') scope.adminId = user.id;
        else scope.partnerId = user.id;
      }
      const student = await tx.student.create({
        data: { campusId: campus.id, displayName: '合成学员' },
      });
      const subject = await tx.campusSubject.create({
        data: { campusId: campus.id, name: '合成书法原名称' },
      });
      scope.subjectId = subject.id;
      const pack = await tx.coursePackage.create({
        data: {
          campusId: campus.id,
          studentId: student.id,
          name: '合成书法课包',
          validFrom: new Date('2020-01-01T00:00:00Z'),
          mainBalanceUnits: 1000,
          giftBalanceUnits: 200,
        },
      });
      scope.packageId = pack.id;
      await tx.lessonLedgerEntry.create({
        data: {
          campusId: campus.id,
          studentId: student.id,
          coursePackageId: pack.id,
          actorUserId: scope.adminId,
          entryType: 'GRANT',
          bucket: 'MAIN',
          deltaUnits: 1000,
          balanceBeforeUnits: 0,
          balanceAfterUnits: 1000,
          idempotencyKey: `${runTag}-main`,
          reason: '合成主课时发放',
        },
      });
      await tx.coursePackage.update({
        where: { id: pack.id },
        data: { subjectId: subject.id },
      });
      await tx.lessonLedgerEntry.create({
        data: {
          campusId: campus.id,
          studentId: student.id,
          coursePackageId: pack.id,
          actorUserId: scope.adminId,
          entryType: 'GRANT',
          bucket: 'GIFT',
          deltaUnits: 200,
          balanceBeforeUnits: 0,
          balanceAfterUnits: 200,
          idempotencyKey: `${runTag}-gift`,
          reason: '合成赠课发放',
        },
      });
      await tx.coursePackage.update({
        where: { id: pack.id },
        data: { subjectId: null },
      });
    });
    ownedUsers = [scope.adminId, scope.partnerId];
    baseline = await facts();
    phase = 'native';
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as Server;
    port = (server.address() as AddressInfo).port;
    const { adminLogin, partnerLogin, ...evidenceScope } = scope;
    emit('ready', {
      origin: `http://127.0.0.1:${port}`,
      port,
      scope: evidenceScope,
      before: baseline,
      logPath,
    });
    process.stdout.write(
      `${JSON.stringify({ kind: 'ephemeral-login', runTag, adminLogin, partnerLogin })}\n`,
    );
    const input = createInterface({ input: process.stdin });
    let controls = Promise.resolve();
    const timer = setTimeout(() => input.close(), 15 * 60_000);
    input.on('line', (line) => {
      controls = controls
        .then(async () => {
          if (line === 'snapshot') {
            await activity.idle();
            emit('snapshot', { summary: await facts(), traces });
          } else if (line === 'stop') {
            try {
              await stop();
            } finally {
              input.close();
            }
          }
        })
        .catch(() => {
          emit('failure', {
            reason: 'Fixture control failed; credentials withheld',
            ownedUsers,
          });
          process.exitCode = 1;
          input.close();
        });
    });
    input.on('close', () => {
      clearTimeout(timer);
      void controls.then(stop).catch(() => {
        emit('failure', {
          reason: 'Fixture closeout failed; credentials withheld',
          ownedUsers,
        });
        process.exitCode = 1;
      });
    });
  } catch {
    emit('failure', {
      reason: 'Fixture setup failed; credentials withheld',
      ownedUsers,
    });
    await stop();
    process.exitCode = 1;
  }
}

void main().catch(() => {
  emit('failure', { reason: 'Fixture startup failed; credentials withheld' });
  process.exitCode = 1;
});
