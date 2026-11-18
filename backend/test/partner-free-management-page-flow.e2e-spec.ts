import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
interface Editor {
  data: {
    viewState: string;
    draftId: string;
    version: number;
    form: { title: string; campaignType: string };
    freeForm: { maxRegistrations: string };
    dirty: boolean;
    freeDirty: boolean;
    freeSaveUnknown: boolean;
    needsVersionRefresh: boolean;
    freeReady: boolean;
    hasFreeCampaign: boolean;
    canSharePublished: boolean;
    publishedPath: string;
    freeMessage: string;
    lifecycle: string;
    history: Array<{ versionId: string; title: string }>;
    historyHasMore: boolean;
    registrations: Array<{ studentLabel: string }>;
    registrationTotal: number;
    registrationFilterIndex: number;
    listError: string;
    listLoading: boolean;
  };
  setData: jest.Mock;
  pendingLoad?: Promise<void>;
  listPending?: Promise<void>;
  onLoad(query: { id: string }): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onInput(event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }): void;
  onTypeChange(event: { detail: { value: string } }): void;
  onFreeInput(event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }): void;
  onSave(): Promise<void>;
  onFreeSave(): Promise<void>;
  onSubmit(): Promise<void>;
  onReload(): Promise<void>;
  onBack(): void;
  onFreeTab(event: { currentTarget: { dataset: { tab: string } } }): void;
  onRegistrationFilterChange(event: { detail: { value: string } }): void;
  onListRetry(): Promise<void>;
  onListMore(): Promise<void>;
  onCopyPath(): void;
  onShareAppMessage(): { title: string; path: string };
}
type Actor = { id: string; token: string };
const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;

describe('changed private type retains owned free campaign management through TCP', () => {
  const runTag = `cfmanage-${randomUUID().slice(0, 8)}`;
  const users: string[] = [],
    pages: Editor[] = [],
    fixtureCampaignIds: string[] = [];
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const clipboard = jest.fn<
    void,
    [{ data: string; success(result: object): void; fail(error: object): void }]
  >();
  const navigateBack = jest.fn<void, [{ fail(error: object): void }]>();
  const reLaunch = jest.fn<void, [{ fail(error: object): void }]>();
  let app: INestApplication, prisma: PrismaService, server: Server;
  let campusId: string, outsideId: string, port: number;
  let partner: Actor, admin: Actor, parent: Actor, outside: Actor;
  let draftId: string,
    campaignId: string,
    versionId: string,
    registrationId: string;
  let transport: CampaignPageTransport;
  const base = () => `/partners/me/campaign-drafts/${draftId}`;
  const recipient = () =>
    `/pages/parent/campaign-registration/index?campaignId=${campaignId}&versionId=${versionId}`;
  const call = (
    method: 'get' | 'post' | 'put',
    path: string,
    token: string,
    body?: object,
  ) => {
    const pending = request(server)
      [method](path)
      .auth(token, { type: 'bearer' });
    if (body) pending.send(body);
    if (method === 'post') pending.set('Idempotency-Key', randomUUID());
    return pending;
  };
  const settle = async (page: Editor) => {
    for (let i = 0; i < 4; i++) {
      await Promise.all([page.pendingLoad, page.listPending]);
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const interceptDraftRead = (afterRead: () => Promise<void>) => {
    const extension = prisma.$extends({
      query: {
        partnerCampaignDraft: {
          findFirst: async ({ args, query }) => {
            const row = await query(args);
            await afterRead();
            return row;
          },
        },
      },
    });
    return jest
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(
        (
          callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
          options?: object,
        ) =>
          extension.$transaction(
            (tx) => callback(tx as unknown as Prisma.TransactionClient),
            options,
          ),
      );
  };
  const open = async (id = draftId) => {
    const page = captureCampaignPage<Editor>('campaign-editor');
    pages.push(page);
    page.onLoad({ id });
    page.onShow();
    await settle(page);
    return page;
  };
  const roster = async (page: Editor) => {
    page.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } });
    await settle(page);
  };
  const createUnsubmitted = async () => {
    const basics = {
      title: '合成分区核对标题',
      campaignType: 'FREE_REGISTRATION',
      shareDescription: '合成分区核对内容',
      contactPhone: null,
    };
    const owned = data<{ draftId: string }>(
      await call(
        'post',
        '/partners/me/campaign-drafts',
        partner.token,
        basics,
      ).expect(200),
    );
    const prefix = `/partners/me/campaign-drafts/${owned.draftId}`;
    const settings = {
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      capacityMode: 'LIMITED' as const,
      maxRegistrations: 2,
    };
    await call('put', `${prefix}/free-registration`, partner.token, {
      expectedVersion: 1,
      freeRegistration: settings,
    }).expect(200);
    return { id: owned.draftId, prefix, basics, settings };
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    campusId = (
      await prisma.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      })
    ).id;
    outsideId = (
      await prisma.campus.create({
        data: { code: `${runTag}-other`, name: `${runTag}外部校区` },
      })
    ).id;
    const actor = async (
      roleCode: 'PARTNER' | 'PARENT' | 'SUPER_ADMIN',
      campus: string | null,
    ): Promise<Actor> => {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${users.length}`,
          roles: { create: { roleCode, campusId: campus } },
        },
      });
      users.push(user.id);
      return {
        id: user.id,
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    partner = await actor('PARTNER', campusId);
    admin = await actor('SUPER_ADMIN', null);
    parent = await actor('PARENT', campusId);
    outside = await actor('PARTNER', outsideId);
    draftId = data<{ draftId: string }>(
      await call('post', '/partners/me/campaign-drafts', partner.token, {
        title: '合成冻结免费标题',
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成纯登记内容',
      }).expect(200),
    ).draftId;
    await call('put', `${base()}/free-registration`, partner.token, {
      expectedVersion: 1,
      freeRegistration: {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        capacityMode: 'UNLIMITED',
        maxRegistrations: null,
      },
    }).expect(200);
    const review = data<{ campaignId: string; versionId: string }>(
      await call('post', `${base()}/submit`, partner.token, {
        expectedVersion: 2,
      }).expect(200),
    );
    campaignId = review.campaignId;
    fixtureCampaignIds.push(campaignId);
    versionId = review.versionId;
    await call(
      'post',
      `/management/campaign-reviews/${versionId}/approve`,
      admin.token,
      { expectedVersion: 1 },
    ).expect(200);
    const student = await prisma.student.create({
      data: { campusId, displayName: '合成学员' },
    });
    await prisma.parentStudentBinding.create({
      data: { campusId, parentUserId: parent.id, studentId: student.id },
    });
    registrationId = data<{ registrationId: string }>(
      await call(
        'post',
        `/parents/me/free-campaigns/${campaignId}/registrations`,
        parent.token,
        { versionId, studentId: student.id },
      ).expect(200),
    ).registrationId;
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${port}`;
    transport = new CampaignPageTransport(
      origin,
      new Set([partner.token]),
      true,
    );
    for (const key of ['wx', 'Page', 'getCurrentPages'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime'
          ? {
              dataDriver: 'api',
              apiBaseUrl: origin,
              accessToken: partner.token,
            }
          : undefined,
      request: transport.request,
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({
        top: 32,
        left: 290,
        height: 32,
      }),
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn(),
      hideShareMenu: jest.fn(),
      showShareMenu: jest.fn(),
      stopPullDownRefresh: jest.fn(),
      setClipboardData: clipboard,
      navigateBack,
      reLaunch,
    };
    host.getCurrentPages = () => pages.slice(-1);
  });
  afterAll(async () => {
    try {
      for (const page of pages) page.onUnload();
      await transport?.drain();
      assertPartnerPdfTestTarget(process.env);
      const result = await prisma?.user.updateMany({
        where: { id: { in: users }, displayName: { startsWith: runTag } },
        data: { status: 'DISABLED' },
      });
      expect(result?.count).toBe(users.length);
      process.stdout.write(
        `PARTNER_FREE_MANAGEMENT_OWNERSHIP ${JSON.stringify({
          runTag,
          campusIds: [campusId, outsideId],
          userIds: users,
          campaignIds: fixtureCampaignIds,
          registrationId,
          disposition:
            'synthetic users disabled; fixtures retained; no deletion',
        })}\n`,
      );
    } finally {
      await app?.close();
      for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
      if (port) {
        expect(server.listening).toBe(false);
        process.stdout.write(
          `PARTNER_FREE_MANAGEMENT_SERVER_CLOSED ${JSON.stringify({ runTag, port, listening: false })}\n`,
        );
      }
    }
  });
  it.each(['closed', 'replaced', 'failed-return'] as const)(
    'isolates old clipboard callbacks after %s through actual Page and TCP reads',
    async (change) => {
      const fixture = await createUnsubmitted();
      const original = data<{ campaignId: string; versionId: string }>(
        await call('post', `${fixture.prefix}/submit`, partner.token, {
          expectedVersion: 2,
        }).expect(200),
      );
      fixtureCampaignIds.push(original.campaignId);
      await call(
        'post',
        `/management/campaign-reviews/${original.versionId}/approve`,
        admin.token,
        { expectedVersion: 1 },
      ).expect(200);
      const frozen = await prisma.campaignVersion.findUniqueOrThrow({
        where: { id: original.versionId },
      });
      const page = await open(fixture.id);
      const originalPages = host.getCurrentPages;
      clipboard.mockClear();
      navigateBack.mockClear();
      reLaunch.mockClear();
      host.getCurrentPages = () => [page, page];
      try {
        expect(page.data).toMatchObject({
          dirty: false,
          freeDirty: false,
          canSharePublished: true,
        });
        page.onCopyPath();
        const old = clipboard.mock.calls[0][0];
        expect(old.data).toBe(page.data.publishedPath);
        let currentVersionId = original.versionId;
        if (change === 'closed') {
          const campaign = await prisma.campaign.findUniqueOrThrow({
            where: { id: original.campaignId },
          });
          await call(
            'post',
            `/management/campaigns/${original.campaignId}/close`,
            admin.token,
            {
              expectedVersion: campaign.version,
              reason: '合成复制在途关闭验证',
            },
          ).expect(200);
        } else if (change === 'replaced') {
          await call(
            'put',
            `${fixture.prefix}/basic-information`,
            partner.token,
            {
              expectedVersion: 2,
              basicInformation: {
                ...fixture.basics,
                title: '合成复制新版批准标题',
              },
            },
          ).expect(200);
          const next = data<{ versionId: string }>(
            await call('post', `${fixture.prefix}/submit`, partner.token, {
              expectedVersion: 3,
            }).expect(200),
          );
          currentVersionId = next.versionId;
          await call(
            'post',
            `/management/campaign-reviews/${next.versionId}/approve`,
            admin.token,
            { expectedVersion: 1 },
          ).expect(200);
        }
        const stored = await prisma.partnerCampaignDraft.findUniqueOrThrow({
          where: { id: fixture.id },
        });
        const audits = await prisma.auditLog.count({
          where: { resourceId: fixture.id },
        });
        const start = transport.calls.length;
        if (change === 'failed-return') {
          page.onBack();
          navigateBack.mock.calls[0][0].fail({});
          reLaunch.mock.calls[0][0].fail({});
        } else {
          await page.onReload();
          await settle(page);
        }
        expect(transport.calls.slice(start)).toMatchObject(
          change === 'failed-return'
            ? []
            : [
                { method: 'GET', path: fixture.prefix, status: 200 },
                {
                  method: 'GET',
                  path: `${fixture.prefix}/free-registration`,
                  status: 200,
                },
                {
                  method: 'GET',
                  path: `${fixture.prefix}/versions`,
                  status: 200,
                },
              ],
        );
        const path = `/pages/parent/campaign-registration/index?campaignId=${original.campaignId}&versionId=${currentVersionId}`;
        expect(page.data).toMatchObject({
          canSharePublished: change !== 'closed',
          publishedPath: change === 'closed' ? '' : path,
        });
        const mutations = page.setData.mock.calls.length;
        old.success({});
        expect(page.setData).toHaveBeenCalledTimes(mutations);
        page.onCopyPath();
        expect(clipboard).toHaveBeenCalledTimes(change === 'closed' ? 1 : 2);
        old.fail({});
        page.onCopyPath();
        expect(page.setData).toHaveBeenCalledTimes(mutations);
        expect(clipboard).toHaveBeenCalledTimes(change === 'closed' ? 1 : 2);
        if (change !== 'closed') {
          const current = clipboard.mock.calls[1][0];
          expect(current.data).toBe(path);
          current.fail({});
          expect(page.data.freeMessage).toBe('复制失败，请重试');
          page.onCopyPath();
          expect(clipboard).toHaveBeenCalledTimes(3);
          clipboard.mock.calls[2][0].success({});
          expect(page.data.freeMessage).toBe('家长报名路径已复制');
        }
        expect(
          transport.calls.slice(start).every((row) => row.method === 'GET'),
        ).toBe(true);
        expect(
          await prisma.partnerCampaignDraft.findUniqueOrThrow({
            where: { id: fixture.id },
          }),
        ).toEqual(stored);
        expect(
          await prisma.campaignVersion.findUniqueOrThrow({
            where: { id: original.versionId },
          }),
        ).toEqual(frozen);
        expect(
          await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
        ).toBe(audits);
        process.stdout.write(
          `PARTNER_CAMPAIGN_COPY_TCP ${JSON.stringify({
            runTag,
            draftId: fixture.id,
            change,
            oldCallbackIgnored: true,
            newerCopyLockPreserved: true,
            currentPathRetried: change !== 'closed',
            pageAddedWrite: false,
          })}\n`,
        );
      } finally {
        host.getCurrentPages = originalPages;
        page.onUnload();
      }
    },
  );
  it.each([
    ['basic', 'OPEN'],
    ['configuration', 'CLOSED'],
  ] as const)(
    'recovers %s interrupted by failed return through fresh TCP reads with %s publication',
    async (stage, lifecycle) => {
      const fixture = await createUnsubmitted();
      const review = data<{ campaignId: string; versionId: string }>(
        await call('post', `${fixture.prefix}/submit`, partner.token, {
          expectedVersion: 2,
        }).expect(200),
      );
      fixtureCampaignIds.push(review.campaignId);
      await call(
        'post',
        `/management/campaign-reviews/${review.versionId}/approve`,
        admin.token,
        { expectedVersion: 1 },
      ).expect(200);
      const page = await open(fixture.id);
      const originalPages = host.getCurrentPages;
      host.getCurrentPages = () => [page, page];
      navigateBack.mockClear();
      reLaunch.mockClear();
      try {
        expect(page.data).toMatchObject({
          dirty: false,
          freeDirty: false,
          canSharePublished: true,
        });
        const before = await prisma.partnerCampaignDraft.findUniqueOrThrow({
          where: { id: fixture.id },
        });
        const audits = await prisma.auditLog.count({
          where: { resourceId: fixture.id },
        });
        const start = transport.calls.length;
        transport.deliverNext('held');
        const reading = page.onReload();
        await transport.idle();
        if (stage === 'configuration') {
          transport.deliverNext('held');
          transport.release();
          await transport.idle();
        }
        expect(transport.calls.slice(start)).toMatchObject([
          {
            method: 'GET',
            path: fixture.prefix,
            status: 200,
            delivery: 'held',
          },
          ...(stage === 'configuration'
            ? [
                {
                  method: 'GET',
                  path: `${fixture.prefix}/free-registration`,
                  status: 200,
                  delivery: 'held',
                },
              ]
            : []),
        ]);
        if (lifecycle === 'CLOSED') {
          const campaign = await prisma.campaign.findUniqueOrThrow({
            where: { id: review.campaignId },
          });
          await call(
            'post',
            `/management/campaigns/${review.campaignId}/close`,
            admin.token,
            {
              expectedVersion: campaign.version,
              reason: '合成返回中断关闭验证',
            },
          ).expect(200);
        }
        page.onBack();
        const back = navigateBack.mock.calls[0][0];
        back.fail({});
        const fallback = reLaunch.mock.calls[0][0];
        fallback.fail({});
        expect(page.data).toMatchObject({
          viewState: 'ready',
          needsVersionRefresh: true,
          canSharePublished: false,
          publishedPath: '',
        });
        const stopped = transport.calls.length;
        await page.onSave();
        await page.onFreeSave();
        await page.onSubmit();
        expect(transport.calls).toHaveLength(stopped);
        expect(
          await prisma.partnerCampaignDraft.findUniqueOrThrow({
            where: { id: fixture.id },
          }),
        ).toEqual(before);
        expect(
          await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
        ).toBe(audits);
        page.onInput({
          currentTarget: { dataset: { field: 'title' } },
          detail: { value: '返回中断保留名称' },
        });
        page.onFreeInput({
          currentTarget: { dataset: { field: 'maxRegistrations' } },
          detail: { value: '7' },
        });
        await call(
          'put',
          `${fixture.prefix}/basic-information`,
          partner.token,
          {
            expectedVersion: 2,
            basicInformation: {
              ...fixture.basics,
              title: '合成返回恢复最新名称',
            },
          },
        ).expect(200);
        if (stage === 'basic') {
          transport.release();
          await reading;
          expect(transport.calls).toHaveLength(stopped);
          expect(page.data.needsVersionRefresh).toBe(true);
        }
        await page.onReload();
        await settle(page);
        if (stage === 'configuration') {
          const mutations = page.setData.mock.calls.length;
          transport.release();
          await reading;
          expect(page.setData).toHaveBeenCalledTimes(mutations);
        }
        expect(transport.calls.slice(stopped)).toMatchObject([
          { method: 'GET', path: fixture.prefix, status: 200 },
          {
            method: 'GET',
            path: `${fixture.prefix}/free-registration`,
            status: 200,
          },
          { method: 'GET', path: `${fixture.prefix}/versions`, status: 200 },
        ]);
        expect(page.data).toMatchObject({
          needsVersionRefresh: false,
          version: 3,
          dirty: true,
          freeDirty: true,
          form: { title: '返回中断保留名称' },
          freeForm: { maxRegistrations: '7' },
          lifecycle,
          canSharePublished: lifecycle === 'OPEN',
        });
        const mutations = page.setData.mock.calls.length;
        back.fail({});
        fallback.fail({});
        expect(reLaunch).toHaveBeenCalledTimes(1);
        expect(page.setData).toHaveBeenCalledTimes(mutations);
        expect(
          await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
        ).toBe(audits + 1);
        expect(
          await prisma.campaignVersion.count({
            where: { campaignId: review.campaignId },
          }),
        ).toBe(1);
        process.stdout.write(
          `PARTNER_CAMPAIGN_RETURN_READ_TCP ${JSON.stringify({
            runTag,
            draftId: fixture.id,
            stage,
            lifecycle,
            cancelledReads: stopped - start,
            recoveryReads: 3,
            writesBlocked: true,
            lateReadIgnored: true,
            duplicateReturnFailuresIgnored: true,
            inputsPreserved: true,
            pageAddedAudit: false,
          })}\n`,
        );
      } finally {
        host.getCurrentPages = originalPages;
        page.onUnload();
        transport.release();
        await transport.idle();
      }
    },
  );
  it.each([
    ['basic', 'OPEN'],
    ['configuration', 'CLOSED'],
  ] as const)(
    'requires read-only recovery after a lost %s refresh reply before observing %s',
    async (stage, lifecycle) => {
      const fixture = await createUnsubmitted();
      const review = data<{ campaignId: string; versionId: string }>(
        await call('post', `${fixture.prefix}/submit`, partner.token, {
          expectedVersion: 2,
        }).expect(200),
      );
      fixtureCampaignIds.push(review.campaignId);
      await call(
        'post',
        `/management/campaign-reviews/${review.versionId}/approve`,
        admin.token,
        { expectedVersion: 1 },
      ).expect(200);
      const page = await open(fixture.id);
      expect(page.data).toMatchObject({
        dirty: false,
        freeDirty: false,
        canSharePublished: true,
        lifecycle: 'OPEN',
      });
      if (lifecycle === 'CLOSED') {
        const campaign = await prisma.campaign.findUniqueOrThrow({
          where: { id: review.campaignId },
        });
        await call(
          'post',
          `/management/campaigns/${review.campaignId}/close`,
          admin.token,
          {
            expectedVersion: campaign.version,
            reason: '合成刷新丢回复关闭验证',
          },
        ).expect(200);
      }
      const before = await prisma.partnerCampaignDraft.findUniqueOrThrow({
        where: { id: fixture.id },
      });
      const audits = await prisma.auditLog.count({
        where: { resourceId: fixture.id },
      });
      const start = transport.calls.length;
      transport.deliverNext(stage === 'basic' ? 'lost' : 'held');
      page.onHide();
      page.onShow();
      if (stage === 'configuration') {
        await transport.idle();
        transport.deliverNext('lost');
        transport.release();
      }
      await settle(page);
      const failedReads = transport.calls.slice(start);
      expect(failedReads).toMatchObject([
        {
          method: 'GET',
          path: fixture.prefix,
          status: 200,
          delivery: stage === 'basic' ? 'lost' : 'held',
        },
        ...(stage === 'configuration'
          ? [
              {
                method: 'GET',
                path: `${fixture.prefix}/free-registration`,
                status: 200,
                delivery: 'lost',
              },
            ]
          : []),
      ]);
      expect(page.data).toMatchObject({
        viewState: 'ready',
        needsVersionRefresh: true,
        freeReady: true,
        dirty: false,
        freeDirty: false,
        canSharePublished: false,
        publishedPath: '',
      });
      const stopped = transport.calls.length;
      await page.onSave();
      await page.onFreeSave();
      await page.onSubmit();
      page.onHide();
      page.onShow();
      await settle(page);
      expect(transport.calls).toHaveLength(stopped);
      expect(
        await prisma.partnerCampaignDraft.findUniqueOrThrow({
          where: { id: fixture.id },
        }),
      ).toEqual(before);
      expect(
        await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
      ).toBe(audits);
      expect(
        await prisma.campaignVersion.count({
          where: { campaignId: review.campaignId },
        }),
      ).toBe(1);
      page.onInput({
        currentTarget: { dataset: { field: 'title' } },
        detail: { value: '刷新恢复保留名称' },
      });
      page.onFreeInput({
        currentTarget: { dataset: { field: 'maxRegistrations' } },
        detail: { value: '7' },
      });
      const input = structuredClone({
        form: page.data.form,
        freeForm: page.data.freeForm,
      });
      await call('put', `${fixture.prefix}/basic-information`, partner.token, {
        expectedVersion: 2,
        basicInformation: {
          ...fixture.basics,
          title: '合成服务端最新名称',
        },
      }).expect(200);
      await page.onReload();
      await settle(page);
      expect(transport.calls.slice(stopped)).toMatchObject([
        { method: 'GET', path: fixture.prefix, status: 200 },
        {
          method: 'GET',
          path: `${fixture.prefix}/free-registration`,
          status: 200,
        },
        { method: 'GET', path: `${fixture.prefix}/versions`, status: 200 },
      ]);
      expect(page.data).toMatchObject({
        viewState: 'ready',
        version: 3,
        needsVersionRefresh: false,
        dirty: true,
        freeDirty: true,
        lifecycle,
        canSharePublished: lifecycle === 'OPEN',
      });
      expect({
        form: page.data.form,
        freeForm: page.data.freeForm,
      }).toEqual(input);
      expect(
        await prisma.campaign.findUniqueOrThrow({
          where: { id: review.campaignId },
        }),
      ).toMatchObject({ publishedVersionId: review.versionId, lifecycle });
      expect(
        await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
      ).toBe(audits + 1);
      process.stdout.write(
        `PARTNER_CAMPAIGN_REFRESH_TCP ${JSON.stringify({
          runTag,
          draftId: fixture.id,
          stage,
          lifecycle,
          failedReads: failedReads.length,
          recoveryReads: 3,
          writesBlocked: true,
          inputsPreserved: true,
          version: 3,
          shareRestored: lifecycle === 'OPEN',
          pageAddedAudit: false,
        })}\n`,
      );
      page.onUnload();
    },
  );
  it.each(['OPEN', 'CLOSED'])(
    'rereads publication %s after an unsent basic save is cancelled on immediate return',
    async (lifecycle) => {
      const fixture = await createUnsubmitted();
      const review = data<{ campaignId: string; versionId: string }>(
        await call('post', `${fixture.prefix}/submit`, partner.token, {
          expectedVersion: 2,
        }).expect(200),
      );
      fixtureCampaignIds.push(review.campaignId);
      await call(
        'post',
        `/management/campaign-reviews/${review.versionId}/approve`,
        admin.token,
        { expectedVersion: 1 },
      ).expect(200);
      const page = await open(fixture.id);
      expect(page.data.canSharePublished).toBe(true);
      if (lifecycle === 'CLOSED') {
        const campaign = await prisma.campaign.findUniqueOrThrow({
          where: { id: review.campaignId },
        });
        await call(
          'post',
          `/management/campaigns/${review.campaignId}/close`,
          admin.token,
          {
            expectedVersion: campaign.version,
            reason: '合成立即返场关闭验证',
          },
        ).expect(200);
      }
      const before = await prisma.partnerCampaignDraft.findUniqueOrThrow({
        where: { id: fixture.id },
      });
      const audits = await prisma.auditLog.count({
        where: { resourceId: fixture.id },
      });
      page.onInput({
        currentTarget: { dataset: { field: 'title' } },
        detail: { value: '立即返场保留输入' },
      });
      const count = transport.calls.length;
      const saving = page.onSave();
      page.onHide();
      page.onShow();
      await saving;
      await settle(page);
      expect(transport.calls.slice(count)).toMatchObject([
        { method: 'GET', path: fixture.prefix, status: 200 },
        {
          method: 'GET',
          path: `${fixture.prefix}/free-registration`,
          status: 200,
        },
        { method: 'GET', path: `${fixture.prefix}/versions`, status: 200 },
      ]);
      expect(page.data).toMatchObject({
        viewState: 'ready',
        dirty: true,
        lifecycle,
        form: { title: '立即返场保留输入' },
        canSharePublished: lifecycle === 'OPEN',
        publishedPath:
          lifecycle === 'OPEN'
            ? `/pages/parent/campaign-registration/index?campaignId=${review.campaignId}&versionId=${review.versionId}`
            : '',
      });
      expect(
        await prisma.partnerCampaignDraft.findUniqueOrThrow({
          where: { id: fixture.id },
        }),
      ).toEqual(before);
      expect(
        await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
      ).toBe(audits);
      page.onUnload();
    },
  );
  it.each(['basic', 'free'])(
    'reconciles the other partition after an unchanged %s save replays at a newer version without creating a campaign',
    async (partition) => {
      const fixture = await createUnsubmitted();
      const page = await open(fixture.id);
      const other =
        partition === 'basic'
          ? {
              route: 'free-registration',
              body: {
                freeRegistration: { ...fixture.settings, maxRegistrations: 3 },
              },
            }
          : {
              route: 'basic-information',
              body: {
                basicInformation: {
                  ...fixture.basics,
                  title: '合成另一会话标题',
                },
              },
            };
      await call('put', `${fixture.prefix}/${other.route}`, partner.token, {
        expectedVersion: 2,
        ...other.body,
      }).expect(200);
      const audits = await prisma.auditLog.count({
        where: { resourceId: fixture.id },
      });
      const before = transport.calls.length;
      await (partition === 'basic' ? page.onSave() : page.onFreeSave());
      await settle(page);
      expect(transport.calls.slice(before)).toMatchObject([
        {
          method: 'PUT',
          path: `${fixture.prefix}/${partition === 'basic' ? 'basic-information' : 'free-registration'}`,
          body: { expectedVersion: 2 },
          status: 200,
        },
        { method: 'GET', path: fixture.prefix, status: 200 },
        {
          method: 'GET',
          path: `${fixture.prefix}/free-registration`,
          status: 200,
        },
        { method: 'GET', path: `${fixture.prefix}/versions`, status: 200 },
      ]);
      expect(page.data).toMatchObject({
        version: 3,
        dirty: partition === 'free',
        freeDirty: partition === 'basic',
        needsVersionRefresh: false,
        hasFreeCampaign: false,
        form: { title: fixture.basics.title },
        freeForm: { maxRegistrations: '2' },
      });
      const writes = transport.calls.length;
      await page.onSubmit();
      expect(transport.calls).toHaveLength(writes);
      expect(
        await prisma.partnerCampaignDraft.findUniqueOrThrow({
          where: { id: fixture.id },
        }),
      ).toMatchObject({
        version: 3,
        title:
          partition === 'basic' ? fixture.basics.title : '合成另一会话标题',
        freeMaxRegistrations: partition === 'basic' ? 3 : 2,
      });
      expect(
        await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
      ).toBe(audits);
      expect(
        await prisma.campaign.count({ where: { draftId: fixture.id } }),
      ).toBe(0);
      process.stdout.write(
        `PARTNER_FREE_SAVE_RECONCILE_TCP ${JSON.stringify({
          runTag,
          draftId: fixture.id,
          partition,
          expectedVersion: 2,
          confirmedVersion: 3,
          oppositePartitionDirty: true,
          unchangedSaveAddedAudit: false,
          submissionBlocked: true,
          campaignCreated: false,
        })}\n`,
      );
      page.onUnload();
    },
  );
  it.each(['basic', 'free'])(
    'retries only reads when a confirmed %s write is followed by a lost GET reply',
    async (partition) => {
      const fixture = await createUnsubmitted();
      const page = await open(fixture.id);
      const input = {
        currentTarget: {
          dataset: {
            field: partition === 'basic' ? 'title' : 'maxRegistrations',
          },
        },
        detail: { value: partition === 'basic' ? '合成已确认保存标题' : '5' },
      };
      if (partition === 'basic') page.onInput(input);
      else page.onFreeInput(input);
      const audits = await prisma.auditLog.count({
        where: { resourceId: fixture.id },
      });
      transport.deliverNext('held');
      const saving = partition === 'basic' ? page.onSave() : page.onFreeSave();
      await transport.idle();
      expect(
        await prisma.partnerCampaignDraft.findUniqueOrThrow({
          where: { id: fixture.id },
        }),
      ).toMatchObject({
        version: 3,
        title:
          partition === 'basic' ? input.detail.value : fixture.basics.title,
        freeMaxRegistrations: partition === 'free' ? 5 : 2,
      });
      transport.deliverNext('lost');
      transport.release();
      await saving;
      await settle(page);
      expect(page.data).toMatchObject({
        viewState: 'ready',
        version: 3,
        needsVersionRefresh: true,
        dirty: false,
        freeDirty: false,
        freeSaveUnknown: false,
      });
      const before = transport.calls.length;
      await page.onSave();
      await page.onFreeSave();
      await page.onSubmit();
      expect(transport.calls).toHaveLength(before);
      await page.onReload();
      await settle(page);
      expect(transport.calls.slice(before)).toMatchObject([
        { method: 'GET', path: fixture.prefix, status: 200 },
        {
          method: 'GET',
          path: `${fixture.prefix}/free-registration`,
          status: 200,
        },
        { method: 'GET', path: `${fixture.prefix}/versions`, status: 200 },
      ]);
      expect(page.data).toMatchObject({
        viewState: 'ready',
        version: 3,
        needsVersionRefresh: false,
        dirty: false,
        freeDirty: false,
        freeSaveUnknown: false,
      });
      expect(
        await prisma.auditLog.count({ where: { resourceId: fixture.id } }),
      ).toBe(audits + 1);
      expect(
        await prisma.campaign.count({ where: { draftId: fixture.id } }),
      ).toBe(0);
      page.onUnload();
    },
  );
  it('saves another private type while preserving the public pointer, immutable content and registration', async () => {
    const page = await open();
    page.onTypeChange({ detail: { value: 'REGULAR_GROUP' } });
    expect(page.onShareAppMessage()).toMatchObject({
      title: '合成冻结免费标题',
      path: recipient(),
    });
    page.onInput({
      currentTarget: { dataset: { field: 'title' } },
      detail: { value: '合成私有拼团草稿' },
    });
    await page.onSave();
    await settle(page);
    expect(page.data).toMatchObject({
      version: 3,
      hasFreeCampaign: true,
      freeReady: false,
      canSharePublished: true,
    });
    const before = transport.calls.length;
    await page.onFreeSave();
    await page.onSubmit();
    expect(transport.calls).toHaveLength(before);
    expect(
      await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } }),
    ).toMatchObject({ publishedVersionId: versionId });
    expect(
      await prisma.campaignVersion.findUniqueOrThrow({
        where: { id: versionId },
      }),
    ).toMatchObject({
      title: '合成冻结免费标题',
      status: 'APPROVED',
      sourceDraftVersion: 2,
    });
    expect(
      await prisma.campaignRegistration.findUniqueOrThrow({
        where: { id: registrationId },
      }),
    ).toMatchObject({ versionId, status: 'REGISTERED' });
    const config = data<{ freeRegistration: object }>(
      await call('get', `${base()}/free-registration`, partner.token).expect(
        200,
      ),
    );
    await call('put', `${base()}/free-registration`, partner.token, {
      expectedVersion: 3,
      freeRegistration: config.freeRegistration,
    }).expect(400);
    await call('post', `${base()}/submit`, partner.token, {
      expectedVersion: 3,
    }).expect(400);
    page.onUnload();
  });
  it('reopens changed metadata, reads and filters the minimum roster, and shares only frozen content', async () => {
    const page = await open();
    expect(page.data).toMatchObject({
      freeReady: false,
      hasFreeCampaign: true,
      canSharePublished: true,
    });
    expect(page.data.form).toMatchObject({
      title: '合成私有拼团草稿',
      campaignType: 'REGULAR_GROUP',
    });
    expect(page.data.history[0]).toMatchObject({
      versionId,
      title: '合成冻结免费标题',
    });
    await roster(page);
    expect(page.data.registrations[0].studentLabel).toBe('合成学员');
    page.onRegistrationFilterChange({ detail: { value: '1' } });
    await settle(page);
    expect(page.data.registrationTotal).toBe(1);
    page.onCopyPath();
    expect(clipboard).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: recipient() }),
    );
    expect(page.onShareAppMessage()).toMatchObject({
      title: '合成冻结免费标题',
      path: recipient(),
    });
    expect(
      transport.calls.every(
        (row) =>
          !row.path.startsWith('/parents/') &&
          !row.path.startsWith('/management/'),
      ),
    ).toBe(true);
    page.onUnload();
  });
  it('shares a publication behind twenty-one later rejections without scanning history and preserves it on roster return', async () => {
    await call('put', `${base()}/basic-information`, partner.token, {
      expectedVersion: 3,
      basicInformation: {
        title: '合成私有拼团草稿',
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成后续送审内容',
        contactPhone: null,
      },
    }).expect(200);
    for (let i = 0; i < 21; i++) {
      const candidate = data<{ versionId: string }>(
        await call('post', `${base()}/submit`, partner.token, {
          expectedVersion: 4,
        }).expect(200),
      );
      await call(
        'post',
        `/management/campaign-reviews/${candidate.versionId}/reject`,
        admin.token,
        { expectedVersion: 1, reason: '合成后续版本驳回' },
      ).expect(200);
    }
    await call('put', `${base()}/basic-information`, partner.token, {
      expectedVersion: 4,
      basicInformation: {
        title: '合成私有拼团草稿',
        campaignType: 'REGULAR_GROUP',
        shareDescription: '合成私有草稿内容',
        contactPhone: null,
      },
    }).expect(200);
    const before = transport.calls.length;
    const page = await open();
    expect(page.data.history).toHaveLength(20);
    expect(page.data.history.some((row) => row.versionId === versionId)).toBe(
      false,
    );
    expect(page.data.historyHasMore).toBe(true);
    expect(transport.calls.slice(before)).toMatchObject([
      { method: 'GET', path: base(), status: 200 },
      { method: 'GET', path: `${base()}/free-registration`, status: 200 },
      { method: 'GET', path: `${base()}/versions`, status: 200 },
    ]);
    expect(page.data.canSharePublished).toBe(true);
    expect(page.onShareAppMessage()).toMatchObject({
      title: '合成冻结免费标题',
      path: recipient(),
    });
    page.onCopyPath();
    expect(clipboard).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: recipient() }),
    );
    await page.onListMore();
    await settle(page);
    expect(page.data.history).toHaveLength(22);
    expect(page.data.historyHasMore).toBe(false);
    await roster(page);
    const returnStart = transport.calls.length;
    page.onHide();
    page.onShow();
    await settle(page);
    expect(transport.calls.slice(returnStart)).toMatchObject([
      { method: 'GET', path: base(), status: 200 },
      { method: 'GET', path: `${base()}/free-registration`, status: 200 },
      { method: 'GET', path: `${base()}/registrations`, status: 200 },
    ]);
    expect(page.data.canSharePublished).toBe(true);
    expect(page.onShareAppMessage().path).toBe(recipient());
    expect(page.data.registrationTotal).toBe(1);
    process.stdout.write(
      `PARTNER_FREE_PUBLICATION_TCP ${JSON.stringify({
        runTag,
        campaignId,
        versionId,
        rejectedAfterApproval: 21,
        historyPages: [20, 22],
        firstPageContainedPublication: false,
        shareAndCopyBeforePagination: true,
        rosterReturnShared: true,
        initialGetCount: 3,
        rosterReturnGetCount: 3,
      })}\n`,
    );
    page.onUnload();
  });
  it('re-reads the selected roster on return while preserving a changed-type unsaved title', async () => {
    const page = await open();
    await roster(page);
    page.onRegistrationFilterChange({ detail: { value: '1' } });
    await settle(page);
    page.onInput({
      currentTarget: { dataset: { field: 'title' } },
      detail: { value: '合成尚未保存名称' },
    });
    const before = transport.calls.length;
    page.onHide();
    page.onShow();
    await settle(page);
    expect(page.data).toMatchObject({
      registrationFilterIndex: 1,
      registrationTotal: 1,
    });
    expect(page.data.form.title).toBe('合成尚未保存名称');
    expect(transport.calls.slice(before)).toMatchObject([
      { method: 'GET', path: base(), status: 200 },
      { method: 'GET', path: `${base()}/free-registration`, status: 200 },
      { method: 'GET', path: `${base()}/registrations`, status: 200 },
    ]);
    page.onUnload();
  });
  it('retries a lost history GET without a write or another registration', async () => {
    const page = await open();
    const before = transport.calls.length;
    transport.deliverNext('lost');
    await page.onListRetry();
    await settle(page);
    expect(page.data.listError).not.toBe('');
    expect(page.data.canSharePublished).toBe(false);
    await page.onListRetry();
    await settle(page);
    expect(page.data).toMatchObject({ listError: '', canSharePublished: true });
    expect(
      transport.calls.slice(before).every((row) => row.method === 'GET'),
    ).toBe(true);
    expect(
      await prisma.campaignRegistration.count({ where: { campaignId } }),
    ).toBe(1);
    page.onUnload();
  });
  it('ignores a held history success after hiding and recovers with fresh reads', async () => {
    const page = await open();
    transport.deliverNext('held');
    const pending = page.onListRetry();
    await transport.idle();
    page.onHide();
    const before = page.setData.mock.calls.length;
    transport.release();
    await pending;
    expect(page.setData).toHaveBeenCalledTimes(before);
    page.onShow();
    await settle(page);
    expect(page.data).toMatchObject({
      viewState: 'ready',
      hasFreeCampaign: true,
      canSharePublished: true,
    });
    page.onUnload();
  });
  it('rejects foreign and other-role reads of changed-type historical management', async () => {
    for (const route of ['free-registration', 'versions', 'registrations']) {
      await call('get', `${base()}/${route}`, outside.token).expect(404);
      await call('get', `${base()}/${route}`, parent.token).expect(403);
      await call('get', `${base()}/${route}`, admin.token).expect(403);
    }
  });
  it('keeps the captured pointer and summary in one snapshot when a later approval commits during configuration reading', async () => {
    const owned = data<{ draftId: string }>(
      await call('post', '/partners/me/campaign-drafts', partner.token, {
        title: '合成快照标题',
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成快照内容',
      }).expect(200),
    );
    const prefix = `/partners/me/campaign-drafts/${owned.draftId}`;
    await call('put', `${prefix}/free-registration`, partner.token, {
      expectedVersion: 1,
      freeRegistration: {
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        capacityMode: 'UNLIMITED',
        maxRegistrations: null,
      },
    }).expect(200);
    const first = data<{ campaignId: string; versionId: string }>(
      await call('post', `${prefix}/submit`, partner.token, {
        expectedVersion: 2,
      }).expect(200),
    );
    fixtureCampaignIds.push(first.campaignId);
    await call(
      'post',
      `/management/campaign-reviews/${first.versionId}/approve`,
      admin.token,
      { expectedVersion: 1 },
    ).expect(200);
    const next = data<{ versionId: string }>(
      await call('post', `${prefix}/submit`, partner.token, {
        expectedVersion: 2,
      }).expect(200),
    );
    const approvedDuringRead = jest.fn(async () => {
      await call(
        'post',
        `/management/campaign-reviews/${next.versionId}/approve`,
        admin.token,
        { expectedVersion: 1 },
      ).expect(200);
    });
    const spy = interceptDraftRead(approvedDuringRead);
    try {
      const captured = data<Record<string, unknown>>(
        await call('get', `${prefix}/free-registration`, partner.token).expect(
          200,
        ),
      );
      expect(captured).toMatchObject({
        campaignVersion: 2,
        publishedVersionId: first.versionId,
        publishedVersion: {
          versionId: first.versionId,
          campaignId: first.campaignId,
          draftId: owned.draftId,
          status: 'APPROVED',
          sequence: 1,
        },
      });
      expect(approvedDuringRead).toHaveBeenCalledTimes(1);
      expect(Object.keys(captured.publishedVersion as object)).toEqual([
        'versionId',
        'campaignId',
        'draftId',
        'campusId',
        'title',
        'status',
        'version',
        'sequence',
        'submittedAt',
        'reviewedAt',
        'reviewReason',
      ]);
    } finally {
      spy.mockRestore();
    }
    expect(
      data<Record<string, unknown>>(
        await call('get', `${prefix}/free-registration`, partner.token).expect(
          200,
        ),
      ),
    ).toMatchObject({
      campaignVersion: 3,
      publishedVersionId: next.versionId,
      publishedVersion: { versionId: next.versionId, sequence: 2 },
    });
    process.stdout.write(
      `PARTNER_FREE_PUBLICATION_SNAPSHOT ${JSON.stringify({
        runTag,
        campaignId: first.campaignId,
        capturedVersionId: first.versionId,
        freshVersionId: next.versionId,
        repeatableRead: true,
        summaryFields: 11,
        privateActorsReturned: false,
      })}\n`,
    );
  });
  it('rejects a campus change after the publication snapshot before returning its private summary', async () => {
    const changed = jest.fn(async () => {
      expect(
        (
          await prisma.userRole.updateMany({
            where: { userId: partner.id, roleCode: 'PARTNER', campusId },
            data: { campusId: outsideId },
          })
        ).count,
      ).toBe(1);
    });
    const spy = interceptDraftRead(changed);
    try {
      await call('get', `${base()}/free-registration`, partner.token).expect(
        403,
      );
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      expect(
        (
          await prisma.userRole.updateMany({
            where: {
              userId: partner.id,
              roleCode: 'PARTNER',
              campusId: outsideId,
            },
            data: { campusId },
          })
        ).count,
      ).toBe(1);
    }
  });
  it('clears an already loaded changed-type page when its current campus changes', async () => {
    const page = await open();
    const where = {
      userId: partner.id,
      roleCode: 'PARTNER' as const,
      campusId,
    };
    try {
      expect(
        (
          await prisma.userRole.updateMany({
            where,
            data: { campusId: outsideId },
          })
        ).count,
      ).toBe(1);
      await page.onListRetry();
      await settle(page);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        hasFreeCampaign: false,
        history: [],
        registrations: [],
        publishedPath: '',
        canSharePublished: false,
      });
    } finally {
      expect(
        (
          await prisma.userRole.updateMany({
            where: {
              userId: partner.id,
              roleCode: 'PARTNER',
              campusId: outsideId,
            },
            data: { campusId },
          })
        ).count,
      ).toBe(1);
      page.onUnload();
    }
  });
  it('refreshes closure after a basic save response crosses hide/show and keeps historical management readable', async () => {
    const page = await open();
    await roster(page);
    page.onInput({
      currentTarget: { dataset: { field: 'title' } },
      detail: { value: '合成关闭时保存名称' },
    });
    transport.deliverNext('held');
    const saving = page.onSave();
    await transport.idle();
    page.onHide();
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });
    await call(
      'post',
      `/management/campaigns/${campaignId}/close`,
      admin.token,
      {
        expectedVersion: campaign.version,
        reason: '合成关闭验证',
      },
    ).expect(200);
    page.onShow();
    expect(page.data.canSharePublished).toBe(false);
    transport.release();
    await saving;
    await settle(page);
    expect(page.data).toMatchObject({
      hasFreeCampaign: true,
      freeReady: false,
      lifecycle: 'CLOSED',
      publishedPath: '',
      canSharePublished: false,
      registrationTotal: 1,
    });
    expect(page.data.form.title).toBe('合成关闭时保存名称');
    const count = clipboard.mock.calls.length;
    page.onCopyPath();
    expect(clipboard).toHaveBeenCalledTimes(count);
    expect(page.onShareAppMessage().path).toBe(
      '/pages/parent/campaign-registration/index',
    );
    page.onUnload();
  });
  it('clears retained management on real account deactivation without altering registrations', async () => {
    const page = await open();
    const fixture = await createUnsubmitted();
    const savingPage = await open(fixture.id);
    savingPage.onFreeInput({
      currentTarget: { dataset: { field: 'maxRegistrations' } },
      detail: { value: '5' },
    });
    transport.deliverNext('held');
    const saving = savingPage.onFreeSave();
    await transport.idle();
    expect(
      await prisma.partnerCampaignDraft.findUniqueOrThrow({
        where: { id: fixture.id },
      }),
    ).toMatchObject({ version: 3, freeMaxRegistrations: 5 });
    await prisma.user.update({
      where: { id: partner.id },
      data: { status: 'DISABLED' },
    });
    const before = transport.calls.length;
    transport.release();
    await saving;
    await settle(savingPage);
    expect(savingPage.data).toMatchObject({
      viewState: 'forbidden',
      draftId: '',
      version: 0,
      freeSaveUnknown: false,
      dirty: false,
      freeDirty: false,
      form: { title: '' },
      freeForm: { maxRegistrations: '' },
    });
    expect(transport.calls.slice(before)).toMatchObject([
      { method: 'GET', path: fixture.prefix, status: 401 },
    ]);
    await page.onListRetry();
    await settle(page);
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      hasFreeCampaign: false,
      history: [],
      publishedPath: '',
    });
    expect(transport.calls[transport.calls.length - 1].status).toBe(401);
    expect(
      await prisma.campaignRegistration.count({ where: { campaignId } }),
    ).toBe(1);
    savingPage.onUnload();
    page.onUnload();
  });
});
