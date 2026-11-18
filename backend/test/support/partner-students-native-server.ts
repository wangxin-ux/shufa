import 'reflect-metadata';
import { deepStrictEqual, strictEqual } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';
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
  allowStudentNativeRequest,
  type StudentNativeScope,
} from './partner-students-native-policy';

const runTag = `studentsnative-${randomUUID().slice(0, 8)}`;
const logPath = resolve(
  __dirname,
  `../../../docs/verification/partner-student-subjects-2026-10-16-native-${runTag}.log`,
);
writeFileSync(logPath, '', { flag: 'wx' });
function emit(kind: string, value: object) {
  const line = `${JSON.stringify({ kind, runTag, ...value })}\n`;
  appendFileSync(logPath, line);
  process.stdout.write(line);
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

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
    throw new Error('Existing isolated PostgreSQL mapping required');
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
    JWT_ACCESS_SECRET: `students-native-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `students-native-refresh-${randomUUID()}`,
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
  const scope: StudentNativeScope = {
    partnerId: '',
    loginCode: `students-native-${randomUUID()}`,
    studentIds: [],
  };
  const subjectIds: string[] = [];
  const packageIds: string[] = [];
  const activity = new NativeCampaignActivity();
  // Track guard work even when its HTTP response has already been interrupted.
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
  const traces: object[] = [];
  let phase: 'setup' | 'native' | 'stopping' = 'setup';
  app.use(express.json({ limit: '4kb' }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    activity.observeResponse(res);
    res.once('finish', () => {
      const query: Record<string, unknown> = {};
      for (const key of [
        'page',
        'pageSize',
        'query',
        'subjectId',
        'balanceBand',
      ])
        if (typeof req.query[key] === 'string') query[key] = req.query[key];
      traces.push({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        query,
      });
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
          // Every admitted request still passes the application's real guards.
        }
        if (
          !allowStudentNativeRequest(scope, {
            method: req.method,
            path: req.path,
            actorId,
            body: req.body as unknown,
          })
        )
          return res
            .status(403)
            .json({ error: { code: 'FIXTURE_SCOPE_DENIED' } });
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
  let campusId = '';
  let seeded = false;
  let port = 0;
  let baseline: Awaited<ReturnType<typeof facts>> | undefined;
  let closing: Promise<void> | undefined;
  async function facts() {
    const where = { campusId };
    return {
      students: await prisma.student.findMany({
        where,
        orderBy: { id: 'asc' },
        include: { coursePackages: { orderBy: { id: 'asc' } } },
      }),
      subjects: await prisma.campusSubject.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      roles: await prisma.userRole.findMany({
        where: { userId: scope.partnerId },
        select: { userId: true, roleCode: true, campusId: true },
      }),
      sideEffects: {
        ledger: await prisma.lessonLedgerEntry.count({ where }),
        orders: await prisma.enrollmentOrder.count({ where }),
        receipts: await prisma.financeReceipt.count({ where }),
        partnerEarnings: await prisma.partnerEarningEntry.count({ where }),
        teacherEarnings: await prisma.teacherEarningEntry.count({ where }),
        withdrawals: await prisma.withdrawal.count({ where }),
        campaigns: await prisma.campaign.count({ where }),
        audits: await prisma.auditLog.count({ where }),
      },
    };
  }
  async function disable() {
    assertFreeCampaignNativeTarget(process.env);
    const result = await prisma.user.updateMany({
      where: { id: scope.partnerId, displayName: `${runTag}-partner` },
      data: { status: 'DISABLED' },
    });
    strictEqual(result.count, 1, 'Owned synthetic partner required');
    return result.count;
  }
  const stop = () => {
    if (closing) return closing;
    closing = (async () => {
      phase = 'stopping';
      await activity.idle().catch(() => {
        emit('drain-blocked', {
          port,
          activeRequests: activity.size,
          reason: 'No closeout writes started',
        });
        throw new Error('Native requests did not drain');
      });
      let unchanged = false;
      let disabled = 0;
      try {
        if (seeded && baseline) {
          const after = await facts();
          deepStrictEqual(after, baseline);
          unchanged = true;
          emit('immutable', {
            fixtureSha256: hash(after),
            sideEffects: after.sideEffects,
          });
        }
      } finally {
        try {
          if (seeded) disabled = await disable();
        } finally {
          await app.close();
          emit('closed', {
            campusId,
            partnerId: scope.partnerId,
            disabled,
            seeded,
            unchanged,
            port,
            traces,
            disposition: 'synthetic records retained; no deletion',
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
        strictEqual(refused, true, 'Temporary listener closure required');
      }
    })();
    return closing;
  };
  try {
    await app.init();
    prisma = app.get(PrismaService);
    const actual = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT current_database()::text AS name
    `;
    strictEqual(actual[0].name, target.pathname.slice(1));
    await prisma.$transaction(async (tx) => {
      const campus = await tx.campus.create({
        data: { code: runTag, name: '合成学员科目验证校区' },
      });
      campusId = campus.id;
      const user = await tx.user.create({
        data: {
          displayName: `${runTag}-partner`,
          roles: { create: { roleCode: 'PARTNER', campusId } },
          authIdentities: {
            create: { provider: 'MOCK', subject: scope.loginCode },
          },
        },
      });
      scope.partnerId = user.id;
      for (const [name, isActive] of [
        ['合成书法', true],
        ['合成口才', false],
      ] as const) {
        const subject = await tx.campusSubject.create({
          data: { campusId, name, isActive },
        });
        subjectIds.push(subject.id);
      }
      for (let index = 0; index < 25; index++) {
        const student = await tx.student.create({
          data: {
            campusId,
            displayName: `合成学员${String(index + 1).padStart(2, '0')}`,
          },
        });
        scope.studentIds.push(student.id);
        const pack = await tx.coursePackage.create({
          data: {
            campusId,
            studentId: student.id,
            subjectId: index === 22 ? null : subjectIds[0],
            name: '合成验证课包',
            validFrom: new Date(
              index === 24 ? '2099-01-01T00:00:00Z' : '2020-01-01T00:00:00Z',
            ),
            expiresAt: index === 21 ? new Date('2021-01-01T00:00:00Z') : null,
            isActive: index !== 23,
            mainBalanceUnits: index === 0 ? 200 : index === 22 ? 400 : 0,
          },
        });
        packageIds.push(pack.id);
      }
      for (const [subjectId, units] of [
        [subjectIds[0], 0],
        [subjectIds[1], 1000],
      ] as const) {
        const pack = await tx.coursePackage.create({
          data: {
            campusId,
            studentId: scope.studentIds[0],
            subjectId,
            name: '合成重复或跨科目课包',
            mainBalanceUnits: units,
            validFrom: new Date('2020-01-01T00:00:00Z'),
          },
        });
        packageIds.push(pack.id);
      }
    });
    seeded = true;
    baseline = await facts();
    strictEqual(
      Object.values(baseline.sideEffects).every((count) => count === 0),
      true,
    );
    phase = 'native';
    await app.listen(0, '127.0.0.1');
    port = ((app.getHttpServer() as Server).address() as AddressInfo).port;
    emit('ready', {
      origin: `http://127.0.0.1:${port}`,
      port,
      campusId,
      partnerId: scope.partnerId,
      studentIds: scope.studentIds,
      subjectIds,
      packageIds,
      fixtureSha256: hash(baseline),
      sideEffects: baseline.sideEffects,
      logPath,
    });
    process.stdout.write(
      `${JSON.stringify({ kind: 'ephemeral-login', runTag, code: scope.loginCode })}\n`,
    );
    const input = createInterface({ input: process.stdin });
    let controls = Promise.resolve();
    const timer = setTimeout(() => input.close(), 20 * 60_000);
    input.on('line', (line) => {
      controls = controls
        .then(async () => {
          if (line === 'snapshot') {
            await activity.idle();
            emit('snapshot', { fixtureSha256: hash(await facts()), traces });
          } else if (line === 'disable') {
            await activity.idle();
            emit('disabled', {
              partnerId: scope.partnerId,
              count: await disable(),
            });
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
            reason: 'Native control failed; credentials withheld',
            partnerId: scope.partnerId,
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
          partnerId: scope.partnerId,
        });
        process.exitCode = 1;
      });
    });
  } catch {
    emit('failure', {
      reason: 'Native setup failed; credentials withheld',
      partnerId: scope.partnerId,
    });
    await stop();
    process.exitCode = 1;
  }
}

void main().catch(() => {
  emit('failure', { reason: 'Native startup failed; credentials withheld' });
  process.exitCode = 1;
});
