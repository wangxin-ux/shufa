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
import { assertFreeCampaignNativeTarget } from './free-campaign-native-policy';
import { NativeCampaignActivity } from './free-campaign-native-activity';
import {
  isPartnerFreeNativeRequestAllowed,
  type PartnerFreeNativeScope,
} from './partner-free-native-policy';

const emit = (kind: string, value: object) => {
  process.stdout.write(`${JSON.stringify({ kind, ...value })}\n`);
};

async function main() {
  const profile = process.env.PARTNER_FREE_NATIVE_PROFILE ?? 'submission';
  if (!['submission', 'configuration'].includes(profile))
    throw new Error('Unknown partner native verification profile');
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
  if (
    !database.ports.includes('5433:5432') ||
    typeof database.environment.POSTGRES_USER !== 'string' ||
    typeof database.environment.POSTGRES_PASSWORD !== 'string'
  )
    throw new Error('Existing Compose test database configuration required');
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
    JWT_ACCESS_SECRET: `partner-native-access-${randomUUID()}`,
    JWT_REFRESH_SECRET: `partner-native-refresh-${randomUUID()}`,
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
  const runTag = `pfnative-${randomUUID().slice(0, 12)}`;
  const setupKey = randomUUID();
  const ownedUsers: string[] = [];
  const approvedIds: string[] = [];
  const studentIds: string[] = [];
  const scope: PartnerFreeNativeScope = {
    partnerId: '',
    loginCode: `${runTag}-partner`,
    draftId: '',
    draftVersion: 2,
  };
  let campusId = '',
    campaignId = '';
  let prisma: PrismaService;
  let phase: 'setup' | 'native' | 'stopping' = 'setup';
  const activity = new NativeCampaignActivity();
  // Account for guard work that can outlive an interrupted HTTP response.
  // eslint-disable-next-line @typescript-eslint/unbound-method -- Rebound to the guard instance.
  const authenticate = AccessTokenGuard.prototype.canActivate;
  Object.defineProperty(AccessTokenGuard.prototype, 'canActivate', {
    value: function (this: AccessTokenGuard, context: ExecutionContext) {
      return activity.during(() => authenticate.call(this, context));
    },
    configurable: true,
    writable: true,
  });
  const traces: object[] = [];
  const jwt = new JwtService();
  app.use(express.json({ limit: '16kb' }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    activity.observeResponse(res);
    const requestPhase = phase;
    const safePath =
      req.path === '/auth/login' ||
      (scope.draftId &&
        req.path.startsWith(`/partners/me/campaign-drafts/${scope.draftId}`))
        ? req.path
        : 'fixture-setup-or-denied';
    res.once('finish', () =>
      traces.push({
        phase: requestPhase,
        method: req.method,
        path: safePath,
        page: req.query.page,
        pageSize: req.query.pageSize,
        status: res.statusCode,
      }),
    );
    void activity
      .during(async () => {
        if (phase === 'stopping')
          return res.status(503).json({ error: { code: 'FIXTURE_STOPPING' } });
        if (phase === 'setup' && req.headers['x-native-setup'] === setupKey) {
          const allowed =
            (req.method === 'POST' &&
              req.path === '/partners/me/campaign-drafts') ||
            (req.method === 'PUT' &&
              scope.draftId &&
              req.path ===
                `/partners/me/campaign-drafts/${scope.draftId}/free-registration`) ||
            (req.method === 'POST' &&
              scope.draftId &&
              req.path ===
                `/partners/me/campaign-drafts/${scope.draftId}/submit`) ||
            (req.method === 'POST' &&
              approvedIds.some(
                (id) =>
                  req.path === `/management/campaign-reviews/${id}/approve`,
              )) ||
            (req.method === 'POST' &&
              campaignId &&
              req.path ===
                `/parents/me/free-campaigns/${campaignId}/registrations`);
          if (allowed) {
            next();
            return;
          }
        }
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
          /* The actual application guard still validates every request. */
        }
        if (
          phase !== 'native' ||
          !isPartnerFreeNativeRequestAllowed(scope, {
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
    draft: await prisma.partnerCampaignDraft.findUnique({
      where: { id: scope.draftId },
      select: {
        id: true,
        campusId: true,
        version: true,
        ...(profile === 'configuration'
          ? {
              title: true,
              campaignType: true,
              shareDescription: true,
              contactPhone: true,
              freeStartsAt: true,
              freeEndsAt: true,
              freeCapacityMode: true,
              freeMaxRegistrations: true,
            }
          : {}),
      },
    }),
    campaign: await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        campusId: true,
        draftId: true,
        publishedVersionId: true,
        lifecycle: true,
      },
    }),
    versions: await prisma.campaignVersion.findMany({
      where: { campusId },
      orderBy: { sequence: 'desc' },
      select: {
        id: true,
        campusId: true,
        campaignId: true,
        status: true,
        sequence: true,
        sourceDraftVersion: true,
        submittedByUserId: true,
        reviewedByUserId: true,
        feeFen: true,
        benefitMode: true,
        ...(profile === 'configuration'
          ? {
              title: true,
              shareDescription: true,
              contactPhone: true,
              startsAt: true,
              endsAt: true,
              capacityMode: true,
              maxRegistrations: true,
            }
          : {}),
      },
    }),
    registrations: await prisma.campaignRegistration.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
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
    submitAudit: await prisma.auditLog.count({
      where: {
        campusId,
        actorUserId: scope.partnerId,
        action: 'FREE_CAMPAIGN_SUBMIT',
      },
    }),
    ...(profile === 'configuration'
      ? {
          configurationAudit: {
            basics: await prisma.auditLog.count({
              where: {
                campusId,
                actorUserId: scope.partnerId,
                resourceId: scope.draftId,
                action: 'PARTNER_CAMPAIGN_DRAFT_BASIC_SAVE',
              },
            }),
            settings: await prisma.auditLog.count({
              where: {
                campusId,
                actorUserId: scope.partnerId,
                resourceId: scope.draftId,
                action: 'FREE_CAMPAIGN_CONFIGURATION_SAVE',
              },
            }),
          },
        }
      : {}),
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
  let stopping = false,
    closed = false;
  const stop = async () => {
    if (closed) return;
    if (stopping) throw new Error('Closeout already in progress');
    stopping = true;
    phase = 'stopping';
    let accountsDisabled = false;
    try {
      let result: object;
      try {
        await activity.idle();
        assertFreeCampaignNativeTarget(process.env);
        if (ownedUsers.length) {
          const disabled = await prisma.user.updateMany({
            where: {
              id: { in: ownedUsers },
              displayName: { startsWith: runTag },
            },
            data: { status: 'DISABLED' },
          });
          if (disabled.count !== ownedUsers.length)
            throw new Error('Fixture ownership changed');
        }
        accountsDisabled = true;
        const summary = scope.draftId && campaignId ? await facts() : {};
        const users =
          profile === 'configuration'
            ? await prisma.user.findMany({
                where: { id: { in: ownedUsers } },
                orderBy: { id: 'asc' },
                select: {
                  id: true,
                  status: true,
                  displayName: true,
                  roles: { select: { roleCode: true, campusId: true } },
                },
              })
            : undefined;
        result = {
          runTag,
          campusId,
          ownedUsers,
          summary,
          traces,
          ...(users ? { users } : {}),
          disposition:
            'records retained; exactly owned users disabled; no deletion',
        };
      } finally {
        await app.close();
        closed = true;
      }
      emit('stopped', result);
    } catch {
      emit('failure', {
        reason: 'Fixture closeout failed; recovery retained',
        runTag,
        campusId,
        ownedUsers,
        accountsDisabled,
        listenerClosed: closed,
      });
      throw new Error('Fixture closeout failed; credentials withheld');
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
      const user = async (roleCode: 'PARENT' | 'PARTNER' | 'SUPER_ADMIN') =>
        tx.user.create({
          data: {
            displayName: `${runTag}-${roleCode}`,
            roles: {
              create: {
                roleCode,
                campusId: roleCode === 'SUPER_ADMIN' ? null : campus.id,
              },
            },
            ...(roleCode === 'PARTNER'
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
      const parent = await user('PARENT'),
        partner = await user('PARTNER'),
        admin = await user('SUPER_ADMIN');
      for (let index = 0; index < 21; index++) {
        const student = await tx.student.create({
          data: {
            campusId: campus.id,
            displayName: `合成孩子${String(index + 1).padStart(2, '0')}`,
          },
        });
        await tx.parentStudentBinding.create({
          data: {
            campusId: campus.id,
            parentUserId: parent.id,
            studentId: student.id,
          },
        });
        studentIds.push(student.id);
      }
      return {
        campusId: campus.id,
        parentId: parent.id,
        partnerId: partner.id,
        adminId: admin.id,
      };
    });
    campusId = fixture.campusId;
    scope.partnerId = fixture.partnerId;
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
    let parentToken = (
      await app.get(AuthService).issueSessionForUser(fixture.parentId)
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
        throw new Error(`Fixture setup HTTP ${response.status}`);
      return value.data;
    };
    const draft = await call<{ draftId: string; version: number }>(
      'POST',
      '/partners/me/campaign-drafts',
      {
        title: '合作方原生免费登记验证',
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成验证资料：仅保存报名登记，不发放课时或余额。',
      },
      partnerToken,
    );
    scope.draftId = draft.draftId;
    const configured = await call<{ version: number }>(
      'PUT',
      `/partners/me/campaign-drafts/${scope.draftId}/free-registration`,
      {
        expectedVersion: draft.version,
        freeRegistration: {
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          capacityMode: 'LIMITED',
          maxRegistrations: 30,
        },
      },
      partnerToken,
    );
    scope.draftVersion = configured.version;
    for (let index = 0; index < 20; index++) {
      const submitted = await call<{
        versionId: string;
        campaignId: string;
        version: number;
      }>(
        'POST',
        `/partners/me/campaign-drafts/${scope.draftId}/submit`,
        { expectedVersion: scope.draftVersion },
        partnerToken,
      );
      campaignId = submitted.campaignId;
      approvedIds.push(submitted.versionId);
      await call(
        'POST',
        `/management/campaign-reviews/${submitted.versionId}/approve`,
        { expectedVersion: submitted.version },
        adminToken,
      );
    }
    const publishedVersionId = approvedIds[approvedIds.length - 1];
    for (const studentId of studentIds)
      await call(
        'POST',
        `/parents/me/free-campaigns/${campaignId}/registrations`,
        { versionId: publishedVersionId, studentId },
        parentToken,
      );
    partnerToken = '';
    adminToken = '';
    parentToken = '';
    await activity.idle();
    if (profile === 'configuration')
      scope.configuration = {
        basics: {
          expectedVersion: scope.draftVersion,
          basicInformation: {
            title: '合作方合成配置保存验证',
            campaignType: 'FREE_REGISTRATION',
            shareDescription: '合成编辑资料：登记不发课，旧公开版本保持。',
            contactPhone: '0000',
          },
        },
        settings: {
          expectedVersion: scope.draftVersion + 1,
          freeRegistration: {
            startsAt: new Date(Date.now() - 120_000).toISOString(),
            endsAt: new Date(Date.now() + 7_200_000).toISOString(),
            capacityMode: 'LIMITED',
            maxRegistrations: 35,
          },
        },
      };
    const before = await facts();
    phase = 'native';
    emit('ready', {
      runTag,
      port,
      origin,
      ...fixture,
      loginCode: scope.loginCode,
      draftId: scope.draftId,
      draftVersion: scope.draftVersion,
      campaignId,
      publishedVersionId,
      approvedIds,
      studentIds,
      before,
      ...(scope.configuration
        ? { profile, configuration: scope.configuration }
        : {}),
    });
    const input = createInterface({ input: process.stdin });
    let controls = Promise.resolve();
    input.on('line', (line) => {
      controls = controls
        .then(async () => {
          if (line === 'snapshot') {
            await activity.idle();
            emit('snapshot', { summary: await facts(), traces });
          } else if (line === 'disable-partner') {
            await activity.idle();
            const result = await prisma.user.updateMany({
              where: {
                id: scope.partnerId,
                displayName: `${runTag}-PARTNER`,
                status: 'ACTIVE',
              },
              data: { status: 'DISABLED' },
            });
            emit('disabled-partner', { count: result.count });
          } else if (line === 'stop') {
            try {
              await stop();
            } finally {
              input.close();
            }
          }
        })
        .catch(() =>
          emit('failure', {
            reason: 'Fixture control failed; recovery retained',
          }),
        );
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
