import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Request, Response, NextFunction } from 'express';
import type { ExecutionContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { load as parseYaml } from 'js-yaml';
import { defer, finalize } from 'rxjs';
import { configureApplication } from '../../src/common/bootstrap/configure-app';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { AccessTokenGuard } from '../../src/modules/auth/access-token.guard';
import {
  assertFreeCampaignNativeTarget,
  isNativeCampaignRequestAllowed,
  type NativeCampaignScope,
} from './free-campaign-native-policy';
import { NativeCampaignActivity } from './free-campaign-native-activity';

const emit = (kind: string, value: object) =>
  process.stdout.write(`${JSON.stringify({ kind, ...value })}\n`);

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
  const fixtureDatabase = compose.services.postgres_test;
  if (
    !fixtureDatabase.ports.includes('5433:5432') ||
    typeof fixtureDatabase.environment.POSTGRES_USER !== 'string' ||
    typeof fixtureDatabase.environment.POSTGRES_PASSWORD !== 'string'
  )
    throw new Error('Existing Compose test database configuration required');
  const target = new URL(
    'postgresql://127.0.0.1:5433/education_app_test_partner_pdf_20261012contact_test',
  );
  target.username = fixtureDatabase.environment.POSTGRES_USER;
  target.password = fixtureDatabase.environment.POSTGRES_PASSWORD;
  Object.assign(process.env, {
    DATABASE_URL: target.href,
    PARTNER_PDF_TEST_DB_NAME: target.pathname.slice(1),
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    PORT: '3001',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: `native-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `native-refresh-${randomUUID()}`,
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
  const runTag = `fcnative-${randomUUID().slice(0, 12)}`;
  const setupKey = randomUUID();
  const ownedUsers: string[] = [];
  const drafts = new Set<string>();
  const versions = new Set<string>();
  const scope: NativeCampaignScope = {
    parentId: '',
    loginCode: `${runTag}-parent`,
    studentId: '',
    campaigns: new Map(),
    registrations: new Set(),
  };
  let campusId = '';
  let prisma: PrismaService;
  let phase: 'setup' | 'native' | 'stopping' = 'setup';
  const activity = new NativeCampaignActivity();
  // Guard database reads can outlive a closed response before a handler starts.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Rebound to each guard instance below.
  const authenticate = AccessTokenGuard.prototype.canActivate;
  Object.defineProperty(AccessTokenGuard.prototype, 'canActivate', {
    value: function (this: AccessTokenGuard, context: ExecutionContext) {
      return activity.during(() => authenticate.call(this, context));
    },
    configurable: true,
    writable: true,
  });
  let stopping = false;
  let closed = false;
  const traces: object[] = [];
  const jwt = new JwtService();
  app.use(express.json({ limit: '16kb' }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    activity.observeResponse(res);
    const requestId = randomUUID();
    const requestPhase = phase;
    const safePath =
      /^\/(?:parents\/me\/(?:free-campaigns|campaign-registrations)(?:\/[a-f0-9-]+)?(?:\/registrations|\/cancel)?|auth\/login)$/.test(
        req.path,
      )
        ? req.path
        : 'fixture-setup-or-denied';
    res.once('finish', () => {
      traces.push({
        phase: requestPhase,
        method: req.method,
        path: safePath,
        page: req.query.page,
        pageSize: req.query.pageSize,
        versionId: req.query.versionId,
        status: res.statusCode,
        requestId,
      });
    });
    void activity
      .during(async () => {
        if (phase === 'stopping')
          return res.status(503).json({ error: { code: 'FIXTURE_STOPPING' } });
        if (phase === 'setup' && req.headers['x-native-setup'] === setupKey) {
          const allowed =
            (req.method === 'POST' &&
              req.path === '/partners/me/campaign-drafts') ||
            [...drafts].some(
              (id) =>
                (req.method === 'PUT' &&
                  req.path ===
                    `/partners/me/campaign-drafts/${id}/free-registration`) ||
                (req.method === 'POST' &&
                  req.path === `/partners/me/campaign-drafts/${id}/submit`),
            ) ||
            [...versions].some(
              (id) =>
                req.method === 'POST' &&
                req.path === `/management/campaign-reviews/${id}/approve`,
            );
          if (allowed) {
            next();
            return;
          }
        }
        let actorId: string | undefined;
        try {
          const authorization = req.headers.authorization;
          const [scheme, token] = authorization?.split(' ') ?? [];
          if (scheme === 'Bearer' && token) {
            const payload = await jwt.verifyAsync<{
              sub: string;
              kind: string;
            }>(token, {
              secret: process.env.JWT_ACCESS_SECRET,
            });
            if (payload.kind === 'access') actorId = payload.sub;
          }
        } catch {
          /* The production guard remains responsible for authentication. */
        }
        const rows = await prisma.campaignRegistration.findMany({
          where: {
            parentUserId: scope.parentId,
            campusId,
            studentId: scope.studentId,
            campaignId: { in: [...scope.campaigns.keys()] },
          },
          select: { id: true },
        });
        scope.registrations = new Set(rows.map((row) => row.id));
        if (
          phase !== 'native' ||
          !isNativeCampaignRequestAllowed(scope, {
            method: req.method,
            path: req.path,
            actorId,
            body: req.body as Record<string, unknown>,
          })
        )
          return res
            .status(403)
            .json({ error: { code: 'FIXTURE_SCOPE_DENIED' } });
        next();
      })
      .catch(() =>
        res.status(503).json({ error: { code: 'FIXTURE_GATE_FAILED' } }),
      );
  });
  app.useGlobalInterceptors({
    intercept(_context, next) {
      const end = activity.begin();
      return defer(() => next.handle()).pipe(finalize(end));
    },
  });
  configureApplication(app);
  const facts = async () => ({
    registrations: await prisma.campaignRegistration.findMany({
      where: { campusId, parentUserId: scope.parentId },
      select: {
        id: true,
        campusId: true,
        campaignId: true,
        versionId: true,
        studentId: true,
        parentUserId: true,
        status: true,
        version: true,
      },
    }),
    financial: {
      groups: await prisma.groupCampaign.count({ where: { campusId } }),
      orders: await prisma.enrollmentOrder.count({ where: { campusId } }),
      packages: await prisma.coursePackage.count({ where: { campusId } }),
      ledger: await prisma.lessonLedgerEntry.count({ where: { campusId } }),
      partnerEarnings: await prisma.partnerEarningEntry.count({
        where: { campusId },
      }),
      teacherEarnings: await prisma.teacherEarningEntry.count({
        where: { campusId },
      }),
      payments: await prisma.paymentTransaction.count({
        where: { enrollmentOrder: { campusId } },
      }),
      products: await prisma.courseProduct.count({ where: { campusId } }),
    },
    activeRequests: activity.size,
  });
  const waitIdle = async () => {
    await activity.idle();
  };
  const stop = async () => {
    if (closed) return;
    if (stopping) throw new Error('Fixture closeout already in progress');
    stopping = true;
    phase = 'stopping';
    try {
      await waitIdle();
      assertFreeCampaignNativeTarget(process.env);
      if (ownedUsers.length) {
        const result = await prisma.user.updateMany({
          where: {
            id: { in: ownedUsers },
            displayName: { startsWith: runTag },
          },
          data: { status: 'DISABLED' },
        });
        if (result.count !== ownedUsers.length)
          throw new Error('Fixture user ownership changed');
      }
      const summary = campusId ? await facts() : {};
      await app.close();
      closed = true;
      emit('stopped', {
        runTag,
        campusId,
        ownedUsers,
        summary,
        traces,
        disposition:
          'records retained; exactly owned synthetic users disabled; no deletion',
      });
    } finally {
      stopping = false;
    }
  };
  try {
    await app.init();
    prisma = app.get(PrismaService);
    const fixture = await prisma.$transaction(async (tx) => {
      const campus = await tx.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      });
      const makeUser = async (roleCode: 'PARENT' | 'PARTNER' | 'SUPER_ADMIN') =>
        tx.user.create({
          data: {
            displayName: `${runTag}-${roleCode}`,
            roles: {
              create: {
                roleCode,
                campusId: roleCode === 'SUPER_ADMIN' ? null : campus.id,
              },
            },
            ...(roleCode === 'PARENT'
              ? {
                  authIdentities: {
                    create: {
                      provider: 'MOCK' as const,
                      subject: scope.loginCode,
                    },
                  },
                }
              : {}),
          },
        });
      const parent = await makeUser('PARENT');
      const partner = await makeUser('PARTNER');
      const admin = await makeUser('SUPER_ADMIN');
      const student = await tx.student.create({
        data: { campusId: campus.id, displayName: '原生联调合成孩子' },
      });
      await tx.parentStudentBinding.create({
        data: {
          campusId: campus.id,
          parentUserId: parent.id,
          studentId: student.id,
        },
      });
      return {
        campusId: campus.id,
        parentId: parent.id,
        partnerId: partner.id,
        adminId: admin.id,
        studentId: student.id,
      };
    });
    campusId = fixture.campusId;
    scope.parentId = fixture.parentId;
    scope.studentId = fixture.studentId;
    ownedUsers.push(fixture.parentId, fixture.partnerId, fixture.adminId);
    await app.listen(0, '127.0.0.1');
    const port = ((app.getHttpServer() as Server).address() as AddressInfo)
      .port;
    const origin = `http://127.0.0.1:${port}`;
    let partnerToken = (
      await app.get(AuthService).issueSessionForUser(fixture.partnerId)
    ).accessToken;
    let adminToken = (
      await app.get(AuthService).issueSessionForUser(fixture.adminId)
    ).accessToken;
    const call = async <T>(
      method: string,
      path: string,
      body: object,
      token: string,
    ): Promise<T> => {
      const response = await fetch(`${origin}${path}`, {
        method,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
          'x-native-setup': setupKey,
        },
      });
      const value = (await response.json()) as { data: T };
      if (response.status !== 200)
        throw new Error(`Fixture setup failed: ${method} ${response.status}`);
      return value.data;
    };
    for (let index = 0; index < 21; index++) {
      const draft = await call<{ draftId: string; version: number }>(
        'POST',
        '/partners/me/campaign-drafts',
        {
          title: `原生联调免费活动${String(index + 1).padStart(2, '0')}`,
          campaignType: 'FREE_REGISTRATION',
          shareDescription: '合成验证资料：仅保存报名登记，不发放课时或余额。',
        },
        partnerToken,
      );
      drafts.add(draft.draftId);
      const configured = await call<{ version: number }>(
        'PUT',
        `/partners/me/campaign-drafts/${draft.draftId}/free-registration`,
        {
          expectedVersion: draft.version,
          freeRegistration: {
            startsAt: new Date(Date.now() - 60_000).toISOString(),
            endsAt: new Date(Date.now() + 3_600_000).toISOString(),
            capacityMode: 'LIMITED',
            maxRegistrations: 1,
          },
        },
        partnerToken,
      );
      const submitted = await call<{
        versionId: string;
        campaignId: string;
        version: number;
      }>(
        'POST',
        `/partners/me/campaign-drafts/${draft.draftId}/submit`,
        { expectedVersion: configured.version },
        partnerToken,
      );
      versions.add(submitted.versionId);
      await call(
        'POST',
        `/management/campaign-reviews/${submitted.versionId}/approve`,
        { expectedVersion: submitted.version },
        adminToken,
      );
      scope.campaigns.set(submitted.campaignId, submitted.versionId);
    }
    partnerToken = '';
    adminToken = '';
    await waitIdle();
    const before = await facts();
    phase = 'native';
    emit('ready', {
      runTag,
      port,
      origin,
      ...fixture,
      loginCode: scope.loginCode,
      campaigns: [...scope.campaigns.entries()],
      before,
    });
    const input = createInterface({ input: process.stdin });
    let controls = Promise.resolve();
    input.on('line', (line) => {
      controls = controls
        .then(async () => {
          if (line === 'snapshot') {
            await waitIdle();
            emit('snapshot', { summary: await facts(), traces });
          } else if (line === 'disable-parent') {
            await waitIdle();
            const result = await prisma.user.updateMany({
              where: {
                id: scope.parentId,
                displayName: `${runTag}-PARENT`,
                status: 'ACTIVE',
              },
              data: { status: 'DISABLED' },
            });
            emit('disabled-parent', { count: result.count });
          } else if (line === 'stop') {
            await stop();
            input.close();
          }
        })
        .catch(() => {
          emit('failure', { reason: 'Fixture control failed' });
        });
    });
    input.on('close', () => {
      void controls.then(stop).catch(() => {
        emit('failure', {
          reason: 'Fixture EOF closeout failed; recovery retained',
        });
        process.exitCode = 1;
      });
    });
  } catch {
    emit('failure', { reason: 'Fixture setup failed; credentials withheld' });
    await stop();
    process.exitCode = 1;
  }
}
void main().catch(() => {
  emit('failure', { reason: 'Fixture startup failed; credentials withheld' });
  process.exitCode = 1;
});
