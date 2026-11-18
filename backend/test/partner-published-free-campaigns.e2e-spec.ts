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
interface Review {
  versionId: string;
  campaignId: string;
  version: number;
}
interface Draft {
  draftId: string;
  version: number;
}
interface Summary {
  campaignId: string;
  versionId: string;
  draftId: string;
  title: string;
  availability: string;
  sequence: number;
  registeredCount: number;
}
interface ListPage {
  data: {
    viewState: string;
    campaigns: Array<{ id: string }>;
    drafts: Array<{ draftId: string }>;
    freeCampaigns: Array<Summary & { statusLabel: string }>;
    campaignKindIndex: number;
    phase: string;
    page: number;
    hasMore: boolean;
    errorMessage: string;
    refreshError: string;
  };
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onCreate(): void;
  load(reset: boolean): Promise<void>;
  onCampaignKindChange(event: { detail: { value: string } }): void;
  onPhaseTap(event: { currentTarget: { dataset: { phase: string } } }): void;
  onOpen(event: { currentTarget: { dataset: { id: string } } }): void;
}
const data = <T>(res: { body: unknown }) => (res.body as { data: T }).data;
const meta = (res: { body: unknown }) =>
  (res.body as { meta: { total: number; totalPages: number } }).meta;
const base = '/partners/me/campaign-drafts';
const published = '/partners/me/free-campaigns';

describe('partner owned approved free activity list', () => {
  const runTag = `cpublished-${randomUUID().slice(0, 8)}`;
  const users: string[] = [];
  const campaigns: string[] = [];
  let app: INestApplication, prisma: PrismaService, server: Server;
  let campusId: string, outsideId: string;
  let partner: string,
    admin: string,
    outside: string,
    parent: string,
    parentId: string;
  let first: Draft & Review;
  let pagePort: number | undefined;
  const interceptCount = (afterCount: () => Promise<void>) => {
    const extension = prisma.$extends({
      query: {
        campaign: {
          count: async ({ args, query }) => {
            const total = await query(args);
            await afterCount();
            return total;
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
  const call = (
    method: 'get' | 'post' | 'put',
    path: string,
    token = partner,
    body?: object,
  ) => {
    const pending = request(server)
      [method](path)
      .auth(token, { type: 'bearer' });
    if (body) pending.send(body);
    if (method === 'post') pending.set('Idempotency-Key', randomUUID());
    return pending;
  };
  const create = async (
    token = partner,
    start = Date.now() + 3_600_000,
    maximum: number | null = null,
  ) => {
    let draft = data<Draft>(
      await call('post', base, token, {
        title: `${runTag}批准标题`,
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成纯登记内容',
      }).expect(200),
    );
    draft = data<Draft>(
      await call('put', `${base}/${draft.draftId}/free-registration`, token, {
        expectedVersion: draft.version,
        freeRegistration: {
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(Date.now() + 7_200_000).toISOString(),
          capacityMode: maximum === null ? 'UNLIMITED' : 'LIMITED',
          maxRegistrations: maximum,
        },
      }).expect(200),
    );
    const review = data<Review>(
      await call('post', `${base}/${draft.draftId}/submit`, token, {
        expectedVersion: draft.version,
      }).expect(200),
    );
    campaigns.push(review.campaignId);
    return { ...draft, ...review };
  };
  const approve = async (row: Review) => {
    await call(
      'post',
      `/management/campaign-reviews/${row.versionId}/approve`,
      admin,
      {
        expectedVersion: row.version,
      },
    ).expect(200);
  };
  const close = async (id: string) => {
    const row = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    await call('post', `/management/campaigns/${id}/close`, admin, {
      expectedVersion: row.version,
      reason: '合成活动关闭测试',
    }).expect(200);
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
      roleCode: 'PARTNER' | 'SUPER_ADMIN' | 'PARENT',
      campus: string | null,
    ) => {
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
    partner = (await actor('PARTNER', campusId)).token;
    admin = (await actor('SUPER_ADMIN', null)).token;
    outside = (await actor('PARTNER', outsideId)).token;
    const family = await actor('PARENT', campusId);
    parent = family.token;
    parentId = family.id;
  });
  afterAll(async () => {
    try {
      assertPartnerPdfTestTarget(process.env);
      await prisma?.user.updateMany({
        where: { id: { in: users }, displayName: { startsWith: runTag } },
        data: { status: 'DISABLED' },
      });
      process.stdout.write(
        `PARTNER_PUBLISHED_FREE_OWNERSHIP ${JSON.stringify({
          runTag,
          campusIds: [campusId, outsideId],
          userIds: users,
          campaignIds: campaigns,
          disposition:
            'synthetic users disabled; fixtures retained; no deletion',
        })}\n`,
      );
    } finally {
      await app?.close();
      if (pagePort) {
        expect(server.listening).toBe(false);
        process.stdout.write(
          `PARTNER_PUBLISHED_FREE_SERVER_CLOSED ${JSON.stringify({ runTag, port: pagePort, listening: false })}\n`,
        );
      }
    }
  });
  it('reads an empty owned list without creating activity, review, registration or audit facts', async () => {
    const before = await prisma.auditLog.count({ where: { campusId } });
    const response = await call('get', published).expect(200);
    expect(data(response)).toEqual([]);
    expect(meta(response).total).toBe(0);
    expect(await prisma.campaign.count({ where: { campusId } })).toBe(0);
    expect(
      await prisma.campaignRegistration.count({ where: { campusId } }),
    ).toBe(0);
    expect(await prisma.auditLog.count({ where: { campusId } })).toBe(before);
  });
  it('filters approved current versions before paging while freezing title and deriving full/not-started/closed/expired', async () => {
    first = await create(partner, Date.now() - 60_000, 1);
    await approve(first);
    const student = await prisma.student.create({
      data: { campusId, displayName: `${runTag}合成学员` },
    });
    await prisma.parentStudentBinding.create({
      data: { campusId, studentId: student.id, parentUserId: parentId },
    });
    await call(
      'post',
      `/parents/me/free-campaigns/${first.campaignId}/registrations`,
      parent,
      {
        versionId: first.versionId,
        studentId: student.id,
      },
    ).expect(200);
    for (let i = 0; i < 20; i++) {
      const row = await create();
      await approve(row);
    }
    const pending = await create();
    const rejected = await create();
    await call(
      'post',
      `/management/campaign-reviews/${rejected.versionId}/reject`,
      admin,
      {
        expectedVersion: rejected.version,
        reason: '合成待改内容',
      },
    ).expect(200);
    const closed = await create();
    await approve(closed);
    await close(closed.campaignId);
    // Insert a past synthetic snapshot; never mutate an existing frozen version.
    const template = await prisma.campaignVersion.findUniqueOrThrow({
      where: { id: first.versionId },
    });
    const expiredDraft = await prisma.partnerCampaignDraft.create({
      data: {
        campusId,
        createdByUserId: users[0],
        title: `${runTag}过期夹具`,
        campaignType: 'FREE_REGISTRATION',
        version: 2,
      },
    });
    const expired = await prisma.campaign.create({
      data: { campusId, draftId: expiredDraft.id },
    });
    campaigns.push(expired.id);
    const expiredVersion = await prisma.campaignVersion.create({
      data: {
        ...template,
        id: randomUUID(),
        campaignId: expired.id,
        capacityMode: 'UNLIMITED',
        maxRegistrations: null,
        startsAt: new Date(Date.now() - 120_000),
        endsAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.campaign.update({
      where: { id: expired.id, campusId },
      data: { publishedVersionId: expiredVersion.id },
    });
    const foreign = await create(outside);
    await approve(foreign);
    await call('put', `${base}/${first.draftId}/basic-information`, partner, {
      expectedVersion: 2,
      basicInformation: {
        title: '未批准私有修改',
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '新私有内容',
      },
    }).expect(200);
    const newer = data<Review>(
      await call('post', `${base}/${first.draftId}/submit`, partner, {
        expectedVersion: 3,
      }).expect(200),
    );
    const ongoing = await call(
      'get',
      `${published}?phase=ONGOING&pageSize=100`,
    ).expect(200);
    const rows = data<Summary[]>(ongoing);
    expect(meta(ongoing).total).toBe(21);
    expect(
      rows.filter((row) => row.availability === 'NOT_STARTED'),
    ).toHaveLength(20);
    expect(
      rows.find((row) => row.campaignId === first.campaignId),
    ).toMatchObject({
      title: `${runTag}批准标题`,
      versionId: first.versionId,
      sequence: 1,
      availability: 'FULL',
      registeredCount: 1,
    });
    expect(rows.map((row) => row.versionId)).not.toContain(newer.versionId);
    expect(rows.map((row) => row.campaignId)).not.toContain(pending.campaignId);
    const ended = await call('get', `${published}?phase=ENDED`).expect(200);
    expect(meta(ended).total).toBe(2);
    expect(
      data<Summary[]>(ended)
        .map((row) => row.availability)
        .sort(),
    ).toEqual(['CLOSED', 'ENDED']);
    expect(Object.keys(rows[0]).sort()).toEqual(
      [
        'campaignId',
        'versionId',
        'draftId',
        'sequence',
        'title',
        'startsAt',
        'endsAt',
        'timezone',
        'availability',
        'registeredCount',
        'maxRegistrations',
        'remainingRegistrations',
      ].sort(),
    );
  });
  it('returns stable 20 then 1 pages and keeps foreign campuses out', async () => {
    const firstPage = await call(
      'get',
      `${published}?phase=ONGOING&page=1&pageSize=20`,
    ).expect(200);
    const secondPage = await call(
      'get',
      `${published}?phase=ONGOING&page=2&pageSize=20`,
    ).expect(200);
    expect(data<Summary[]>(firstPage)).toHaveLength(20);
    expect(data<Summary[]>(secondPage)).toHaveLength(1);
    expect(meta(firstPage)).toMatchObject({ total: 21, totalPages: 2 });
    expect(
      new Set(
        [...data<Summary[]>(firstPage), ...data<Summary[]>(secondPage)].map(
          (row) => row.campaignId,
        ),
      ).size,
    ).toBe(21);
    expect(meta(await call('get', published, outside).expect(200)).total).toBe(
      1,
    );
  });
  it.each([
    'phase=',
    'phase=DRAFT',
    'phase=ongoing',
    'phase=ONGOING&phase=ENDED',
    'page=0',
    'campusId=foreign',
    'ownerId=foreign',
  ])('rejects invalid or overriding query %s', async (query) => {
    await call('get', `${published}?${query}`).expect(400);
  });
  it('denies parent, administration and anonymous callers without enlarging roles', async () => {
    await call('get', published, parent).expect(403);
    await call('get', published, admin).expect(403);
    await request(server).get(published).expect(401);
  });
  it('reads real 20 then 21 Page rows through TCP, retries only GET and opens the owned editor', async () => {
    await app.listen(0, '127.0.0.1');
    pagePort = (server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${pagePort}`;
    const transport = new CampaignPageTransport(
      origin,
      new Set([partner]),
      true,
    );
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(
      ['wx', 'Page', 'getCurrentPages'].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(host, key),
      ]),
    );
    let page: ListPage | undefined;
    const navigate = jest.fn();
    try {
      host.wx = {
        getStorageSync: (key: string) =>
          key === 'education.runtime'
            ? { dataDriver: 'api', apiBaseUrl: origin, accessToken: partner }
            : undefined,
        request: transport.request,
        navigateTo: navigate,
        stopPullDownRefresh: jest.fn(),
      };
      host.getCurrentPages = () => (page ? [page] : []);
      page = captureCampaignPage<ListPage>('group-campaigns');
      page.onLoad();
      page.onShow();
      await page.pendingRequest;
      await transport.idle();
      page.onCampaignKindChange({ detail: { value: '1' } });
      await page.pendingRequest;
      await transport.idle();
      expect(page.data).toMatchObject({
        viewState: 'ready',
        campaignKindIndex: 1,
        page: 1,
        hasMore: true,
      });
      expect(page.data.freeCampaigns).toHaveLength(20);
      await page.load(false);
      await transport.idle();
      expect(page.data.freeCampaigns).toHaveLength(21);
      expect(page.data.hasMore).toBe(false);
      const frozen = page.data.freeCampaigns.find(
        (row) => row.campaignId === first.campaignId,
      )!;
      expect(frozen).toMatchObject({
        title: `${runTag}批准标题`,
        sequence: 1,
        statusLabel: '名额已满',
      });
      page.onOpen({ currentTarget: { dataset: { id: first.campaignId } } });
      expect(navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          url: `/pages/partner/campaign-editor/index?id=${first.draftId}`,
        }),
      );
      transport.deliverNext('lost');
      await page.load(true);
      await transport.idle();
      expect(page.data.viewState).toBe('ready');
      expect(page.data.refreshError).not.toBe('');
      await page.load(true);
      await transport.idle();
      expect(page.data.refreshError).toBe('');
      page.onPhaseTap({ currentTarget: { dataset: { phase: 'ENDED' } } });
      await page.pendingRequest;
      await transport.idle();
      expect(
        page.data.freeCampaigns.map((row) => row.availability).sort(),
      ).toEqual(['CLOSED', 'ENDED']);
      expect(transport.calls.every((row) => row.method === 'GET')).toBe(true);
      process.stdout.write(
        `PARTNER_PUBLISHED_FREE_PAGE ${JSON.stringify({
          runTag,
          port: pagePort,
          pagination: [20, 21],
          ended: 2,
          calls: transport.calls.map(({ method, path, status, delivery }) => ({
            method,
            path,
            status,
            delivery,
          })),
        })}\n`,
      );
    } finally {
      try {
        page?.onUnload();
        await transport.drain();
        await page?.pendingRequest;
      } finally {
        for (const [key, descriptor] of previous) {
          if (descriptor) Object.defineProperty(host, key, descriptor);
          else Reflect.deleteProperty(host, key);
        }
      }
    }
  });
  it('authorizes this transport read only when opted in and never permits owned-list writes', () => {
    const origin = 'http://127.0.0.1:1';
    const options = {
      url: `${origin}${published}`,
      method: 'GET' as const,
      header: { Authorization: `Bearer ${partner}` },
      success: jest.fn(),
      fail: jest.fn(),
    };
    expect(() =>
      new CampaignPageTransport(origin, new Set([partner])).request(options),
    ).toThrow('outside its scope');
    const transport = new CampaignPageTransport(
      origin,
      new Set([partner]),
      true,
    );
    for (const method of ['POST', 'PUT'] as const) {
      expect(() => transport.request({ ...options, method })).toThrow(
        'outside its scope',
      );
    }
  });
  it.each(
    ['token', 'origin', 'driver'].flatMap((replacement) =>
      ['queued', 'held', 'shown'].map((timing) => ({
        replacement,
        timing,
      })),
    ),
  )(
    'invalidates the first legacy Page for $replacement replacement at $timing',
    async ({ replacement, timing }) => {
      if (!server.listening) {
        await app.listen(0, '127.0.0.1');
        pagePort = (server.address() as AddressInfo).port;
      }
      const origin = `http://127.0.0.1:${pagePort}`;
      const transport = new CampaignPageTransport(
        origin,
        new Set([partner, outside]),
        true,
      );
      const host = globalThis as unknown as Record<string, unknown>;
      const previous = new Map(
        ['wx', 'Page', 'getCurrentPages'].map((key) => [
          key,
          Object.getOwnPropertyDescriptor(host, key),
        ]),
      );
      let page: ListPage | undefined;
      let runtime: {
        dataDriver: 'api' | 'mock';
        apiBaseUrl: string;
        accessToken: string;
      } = {
        dataDriver: 'api',
        apiBaseUrl: origin,
        accessToken: partner,
      };
      const replace = () => {
        runtime = {
          ...runtime,
          ...(replacement === 'token'
            ? { accessToken: outside }
            : replacement === 'origin'
              ? { apiBaseUrl: `${origin}/replacement` }
              : { dataDriver: 'mock' as const }),
        };
      };
      const navigate = jest.fn();
      try {
        host.wx = {
          getStorageSync: (key: string) =>
            key === 'education.runtime' ? runtime : undefined,
          request: transport.request,
          navigateTo: navigate,
          stopPullDownRefresh: jest.fn(),
        };
        host.getCurrentPages = () => (page ? [page] : []);
        page = captureCampaignPage<ListPage>('group-campaigns');
        if (timing === 'held') transport.deliverNext('held');
        page.onLoad();
        const initialRead = page.pendingRequest;
        if (timing === 'queued') {
          replace();
        } else {
          page.onShow();
          await transport.idle();
          expect(transport.calls).toMatchObject([
            {
              method: 'GET',
              path: '/partners/me/group-campaigns',
              status: 200,
              delivery: timing === 'held' ? 'held' : 'success',
            },
          ]);
          if (timing === 'shown') {
            await initialRead;
            expect(page.data).toMatchObject({
              viewState: 'empty',
              campaignKindIndex: 0,
              page: 1,
            });
            page.onHide();
          }
          replace();
          if (timing === 'held') transport.release();
          else page.onShow();
        }
        await initialRead;
        expect(page.data).toMatchObject({
          viewState: 'forbidden',
          campaigns: [],
          drafts: [],
          freeCampaigns: [],
          campaignKindIndex: 0,
          phase: 'ONGOING',
          page: 0,
          hasMore: false,
          errorMessage: '登录已更新，请重新登录',
          refreshError: '',
        });
        page.onCampaignKindChange({ detail: { value: '1' } });
        page.onPhaseTap({ currentTarget: { dataset: { phase: 'DRAFT' } } });
        page.onCreate();
        await page.load(true);
        await page.load(false);
        await transport.idle();
        expect(transport.calls).toHaveLength(timing === 'queued' ? 0 : 1);
        expect(navigate).not.toHaveBeenCalled();
        expect(page.data).toMatchObject({
          campaignKindIndex: 0,
          phase: 'ONGOING',
        });
        process.stdout.write(
          `PARTNER_CAMPAIGN_LIST_SESSION ${JSON.stringify({
            runTag,
            replacement,
            timing,
            readCount: transport.calls.length,
            navigations: navigate.mock.calls.length,
            viewState: page.data.viewState,
          })}\n`,
        );
      } finally {
        try {
          page?.onUnload();
          await transport.drain();
        } finally {
          for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(host, key, descriptor);
            else Reflect.deleteProperty(host, key);
          }
        }
      }
    },
  );
  it.each(['api', 'mock'] as const)(
    'uses the current TCP origin after loading the %s service module in another environment',
    async (initialDriver) => {
      const origin = `http://127.0.0.1:${pagePort}`;
      const transport = new CampaignPageTransport(
        origin,
        new Set([partner]),
        true,
      );
      const host = globalThis as unknown as Record<string, unknown>;
      const previous = new Map(
        ['wx', 'Page', 'getCurrentPages'].map((key) => [
          key,
          Object.getOwnPropertyDescriptor(host, key),
        ]),
      );
      let runtime: {
        dataDriver: 'api' | 'mock';
        apiBaseUrl: string;
        accessToken: string;
      } = {
        dataDriver: initialDriver,
        apiBaseUrl: `${origin}/previous`,
        accessToken: partner,
      };
      let page: ListPage | undefined;
      try {
        host.wx = {
          getStorageSync: (key: string) =>
            key === 'education.runtime' ? runtime : undefined,
          request: transport.request,
          navigateTo: jest.fn(),
          stopPullDownRefresh: jest.fn(),
        };
        host.getCurrentPages = () => (page ? [page] : []);
        host.Page = (config: ListPage) => {
          const instance = {
            ...config,
            data: structuredClone(config.data),
            setData: (patch: object) => Object.assign(instance.data, patch),
          };
          page = instance;
        };
        jest.isolateModules(() => {
          jest.requireActual('../../frontend/services/partner-runtime.ts');
          runtime = { ...runtime, dataDriver: 'api', apiBaseUrl: origin };
          jest.requireActual(
            '../../frontend/pages/partner/group-campaigns/index.ts',
          );
        });
        expect(page).toBeDefined();
        page!.onLoad();
        page!.onShow();
        await page!.pendingRequest;
        await transport.idle();
        expect(transport.calls).toMatchObject([
          {
            method: 'GET',
            path: '/partners/me/group-campaigns',
            status: 200,
            delivery: 'success',
          },
        ]);
        expect(page!.data).toMatchObject({
          viewState: 'empty',
          campaigns: [],
          page: 1,
          errorMessage: '',
        });
        process.stdout.write(
          `PARTNER_CAMPAIGN_LIST_RUNTIME ${JSON.stringify({
            runTag,
            initialDriver,
            currentDriver: 'api',
            readCount: transport.calls.length,
            status: transport.calls[0].status,
          })}\n`,
        );
      } finally {
        try {
          page?.onUnload();
          await transport.drain();
        } finally {
          for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(host, key, descriptor);
            else Reflect.deleteProperty(host, key);
          }
        }
      }
    },
  );
  it('holds count and rows in one snapshot when normal closure commits between them', async () => {
    const afterCount = jest.fn(() => close(first.campaignId));
    const spy = interceptCount(afterCount);
    try {
      const response = await call(
        'get',
        `${published}?phase=ONGOING&pageSize=100`,
      ).expect(200);
      expect(meta(response).total).toBe(21);
      expect(data<Summary[]>(response)).toHaveLength(21);
      expect(
        data<Summary[]>(response).find(
          (row) => row.campaignId === first.campaignId,
        )?.availability,
      ).toBe('FULL');
      expect(afterCount).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(meta(await call('get', published).expect(200)).total).toBe(20);
  });
  it('rejects a campus change after the data snapshot and rechecks an inactive reader', async () => {
    const spy = interceptCount(async () => {
      await prisma.userRole.updateMany({
        where: { userId: users[0], roleCode: 'PARTNER', campusId },
        data: { campusId: outsideId },
      });
    });
    try {
      await call('get', published).expect(403);
    } finally {
      spy.mockRestore();
      await prisma.userRole.updateMany({
        where: { userId: users[0], roleCode: 'PARTNER', campusId: outsideId },
        data: { campusId },
      });
    }
    await prisma.user.update({
      where: { id: users[0] },
      data: { status: 'DISABLED' },
    });
    await call('get', published).expect(401);
  });
  it('preserves zero order, payment, course, hours and earnings side effects', async () => {
    for (const model of [
      prisma.groupCampaign,
      prisma.enrollmentOrder,
      prisma.coursePackage,
      prisma.lessonLedgerEntry,
      prisma.partnerEarningEntry,
      prisma.teacherEarningEntry,
      prisma.financeReceipt,
      prisma.withdrawal,
    ]) {
      expect(
        await (model.count as (args: object) => Promise<number>)({
          where: { campusId: { in: [campusId, outsideId] } },
        }),
      ).toBe(0);
    }
  });
});
