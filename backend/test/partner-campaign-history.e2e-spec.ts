import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
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

type Campaign = { id: string; status: string; canPromote: boolean };
type CampaignPage = {
  data: Campaign[];
  meta: { page: number; total: number; totalPages: number };
};
interface DetailPage {
  data: {
    viewState: string;
    campaign: Campaign | null;
    shareCopy: string;
    showPoster: boolean;
    posterPath: string;
    errorMessage: string;
  };
  pendingRequest?: Promise<void>;
  onLoad(options: { id: string }): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(): Promise<void>;
  onCopyText(): void;
  onOpenPoster(): void;
  onShareAppMessage(): { path: string };
}
const payload = <T>(response: { body: unknown }) =>
  (response.body as { data: T }).data;

describe('partner ongoing and ended legacy campaign history', () => {
  const runTag = `pch-${randomUUID().slice(0, 8)}`;
  const campusIds: string[] = [];
  const userIds: string[] = [];
  const productIds: string[] = [];
  const ids: Record<string, string> = {};
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;
  let token: string;
  let teacherToken: string;
  let pagePort: number | undefined;
  const origin = async () => {
    if (!server.listening) {
      await app.listen(0, '127.0.0.1');
      pagePort = (server.address() as AddressInfo).port;
    }
    return `http://127.0.0.1:${pagePort}`;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    for (const suffix of ['a', 'b']) {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${suffix}`, name: `${runTag}合成校区` },
      });
      campusIds.push(campus.id);
    }
    for (const roleCode of ['PARTNER', 'TEACHER'] as const) {
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}合成账号`,
          roles: { create: { roleCode, campusId: campusIds[0] } },
        },
      });
      userIds.push(user.id);
      if (roleCode === 'TEACHER') {
        await prisma.teacherProfile.create({
          data: {
            userId: user.id,
            campusId: campusIds[0],
            employeeCode: `${runTag}-teacher`,
          },
        });
      }
      const session = await app.get(AuthService).issueSessionForUser(user.id);
      if (roleCode === 'PARTNER') token = session.accessToken;
      else teacherToken = session.accessToken;
    }
    for (const campusId of campusIds) {
      const product = await prisma.courseProduct.create({
        data: {
          campusId,
          name: `${runTag}体验课`,
          summary: '合成测试课程',
          priceFen: 1990,
          mainUnits: 100,
          giftUnits: 0,
          validityDays: 30,
          status: 'ACTIVE',
          createdByUserId: userIds[0],
        },
      });
      productIds.push(product.id);
    }
    const now = Date.now();
    for (const [name, status, start, end, foreign] of [
      ['ongoing', 'ACTIVE', -86_400_000, 86_400_000, false],
      ['expired', 'ACTIVE', -172_800_000, -86_400_000, false],
      ['closed', 'CLOSED', -86_400_000, 86_400_000, false],
      ['draft', 'DRAFT', -86_400_000, 86_400_000, false],
      ['cancelled', 'CANCELLED', -86_400_000, 86_400_000, false],
      ['future', 'ACTIVE', 86_400_000, 172_800_000, false],
      ['foreign', 'ACTIVE', -172_800_000, -86_400_000, true],
    ] as const) {
      const index = foreign ? 1 : 0;
      const campaign = await prisma.groupCampaign.create({
        data: {
          code: `${runTag}-${name}`,
          campusId: campusIds[index],
          courseProductId: productIds[index],
          title: `${runTag}测试活动`,
          description: '合成活动，不含真实报名或资金',
          priceFen: 1990,
          createdByUserId: userIds[0],
          status,
          startsAt: new Date(now + start),
          endsAt: new Date(now + end),
        },
      });
      ids[name] = campaign.id;
    }
  });

  afterAll(async () => {
    try {
      if (prisma && userIds.length) {
        assertPartnerPdfTestTarget(process.env);
        await prisma.user.updateMany({
          where: { id: { in: userIds }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
      }
    } finally {
      await app?.close();
      if (pagePort) {
        expect(server.listening).toBe(false);
        process.stdout.write(
          `PARTNER_CAMPAIGN_DETAIL_SERVER_CLOSED ${JSON.stringify({
            runTag,
            port: pagePort,
            listening: false,
          })}\n`,
        );
      }
      process.stdout.write(
        `PARTNER_CAMPAIGN_HISTORY_FIXTURE ${JSON.stringify({
          runTag,
          userIds,
          campusIds,
          productIds,
          ids,
          disposition: 'retained; owned test users disabled; no deletion',
        })}\n`,
      );
    }
  });

  const list = (query: Record<string, unknown> = {}, bearer = token) =>
    request(server)
      .get('/partners/me/group-campaigns')
      .query(query)
      .auth(bearer, { type: 'bearer' });
  const detail = (id: string) =>
    request(server)
      .get(`/partners/me/group-campaigns/${id}`)
      .auth(token, { type: 'bearer' });

  it('keeps the omitted phase on ongoing local campaigns', async () => {
    const response = await list().expect(200);
    expect(payload<Campaign[]>(response)).toEqual([
      expect.objectContaining({
        id: ids.ongoing,
        status: 'ACTIVE',
        canPromote: true,
      }),
    ]);
  });

  it('paginates ended history without leaking draft, future or another campus', async () => {
    const first = await list({ phase: 'ENDED', page: 1, pageSize: 1 }).expect(
      200,
    );
    const second = await list({ phase: 'ENDED', page: 2, pageSize: 1 }).expect(
      200,
    );
    const page = first.body as CampaignPage;
    expect(page.meta).toMatchObject({ page: 1, total: 2, totalPages: 2 });
    expect(payload<Campaign[]>(first)[0]).toMatchObject({
      id: ids.closed,
      canPromote: false,
    });
    expect(payload<Campaign[]>(second)[0]).toMatchObject({
      id: ids.expired,
      canPromote: false,
    });
    const beyond = await list({ phase: 'ENDED', page: 3, pageSize: 1 }).expect(
      200,
    );
    expect(payload<Campaign[]>(beyond)).toEqual([]);
    expect((beyond.body as CampaignPage).meta.total).toBe(2);
  });

  it('reads ended details but keeps excluded and cross-campus ids inaccessible', async () => {
    for (const name of ['expired', 'closed']) {
      const response = await detail(ids[name]).expect(200);
      expect(payload<Campaign>(response)).toMatchObject({
        id: ids[name],
        canPromote: false,
      });
      expect(Object.keys(payload<Campaign>(response))).not.toContain('teams');
    }
    for (const name of ['draft', 'cancelled', 'future', 'foreign']) {
      await detail(ids[name]).expect(404);
    }
  });

  it('rejects unknown phase, spoofed campus and wrong-role access', async () => {
    await list({ phase: 'DRAFT' }).expect(400);
    await list({ phase: 'ENDED', campusId: campusIds[1] }).expect(400);
    await list({}, teacherToken).expect(403);
    await request(server).get('/partners/me/group-campaigns').expect(401);
  });

  it.each(
    ['token', 'origin', 'driver'].flatMap((replacement) =>
      ['queued', 'held', 'shown'].map((timing) => ({ replacement, timing })),
    ),
  )(
    'clears real detail on $replacement replacement at $timing',
    async ({ replacement, timing }) => {
      const currentOrigin = await origin();
      const transport = new CampaignPageTransport(
        currentOrigin,
        new Set([token, teacherToken]),
        false,
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
        dataDriver: 'api',
        apiBaseUrl: currentOrigin,
        accessToken: token,
      };
      let page: DetailPage | undefined;
      const clipboard = jest.fn();
      const replace = () => {
        runtime = {
          ...runtime,
          ...(replacement === 'token'
            ? { accessToken: teacherToken }
            : replacement === 'origin'
              ? { apiBaseUrl: `${currentOrigin}/replacement` }
              : { dataDriver: 'mock' as const }),
        };
      };
      try {
        host.wx = {
          getStorageSync: (key: string) =>
            key === 'education.runtime' ? runtime : undefined,
          request: transport.request,
          hideShareMenu: jest.fn(),
          showShareMenu: jest.fn(),
          setClipboardData: clipboard,
        };
        host.getCurrentPages = () => (page ? [page] : []);
        page = captureCampaignPage<DetailPage>('group-detail');
        if (timing === 'held') transport.deliverNext('held');
        page.onLoad({ id: ids.ongoing });
        const initialRead = page.pendingRequest;
        if (timing === 'queued') replace();
        else {
          page.onShow();
          await transport.idle();
          expect(transport.calls).toMatchObject([
            {
              method: 'GET',
              path: `/partners/me/group-campaigns/${ids.ongoing}`,
              status: 200,
            },
          ]);
          if (timing === 'shown') {
            await initialRead;
            expect(page.data).toMatchObject({
              viewState: 'ready',
              campaign: { id: ids.ongoing, canPromote: true },
            });
            expect(page.data.shareCopy).not.toBe('');
            page.onHide();
          }
          replace();
          if (timing === 'held') transport.release();
          else page.onShow();
        }
        await initialRead;
        expect(page.data).toMatchObject({
          viewState: 'forbidden',
          campaign: null,
          shareCopy: '',
          posterPath: '',
          showPoster: false,
          errorMessage: '登录已更新，请重新登录',
        });
        await page.load();
        page.onCopyText();
        page.onOpenPoster();
        expect(page.onShareAppMessage().path).toBe('/pages/bootstrap/index');
        expect(clipboard).not.toHaveBeenCalled();
        await transport.idle();
        expect(transport.calls).toHaveLength(timing === 'queued' ? 0 : 1);
        process.stdout.write(
          `PARTNER_CAMPAIGN_DETAIL_SESSION ${JSON.stringify({
            runTag,
            replacement,
            timing,
            readCount: transport.calls.length,
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
    'uses the current real detail after preloading the %s module in another environment',
    async (initialDriver) => {
      const currentOrigin = await origin();
      const transport = new CampaignPageTransport(
        currentOrigin,
        new Set([token]),
        false,
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
        apiBaseUrl: `${currentOrigin}/previous`,
        accessToken: token,
      };
      let page: DetailPage | undefined;
      try {
        host.wx = {
          getStorageSync: (key: string) =>
            key === 'education.runtime' ? runtime : undefined,
          request: transport.request,
          hideShareMenu: jest.fn(),
          showShareMenu: jest.fn(),
        };
        host.getCurrentPages = () => (page ? [page] : []);
        host.Page = (config: DetailPage) => {
          const instance = {
            ...config,
            data: structuredClone(config.data),
            setData: (patch: object) => Object.assign(instance.data, patch),
          };
          page = instance;
        };
        jest.isolateModules(() => {
          jest.requireActual('../../frontend/services/partner-runtime.ts');
          runtime = {
            ...runtime,
            dataDriver: 'api',
            apiBaseUrl: currentOrigin,
          };
          jest.requireActual(
            '../../frontend/pages/partner/group-detail/index.ts',
          );
        });
        expect(page).toBeDefined();
        page!.onLoad({ id: ids.ongoing });
        page!.onShow();
        await page!.pendingRequest;
        await transport.idle();
        expect(transport.calls).toMatchObject([
          {
            method: 'GET',
            path: `/partners/me/group-campaigns/${ids.ongoing}`,
            status: 200,
          },
        ]);
        expect(page!.data).toMatchObject({
          viewState: 'ready',
          campaign: { id: ids.ongoing, canPromote: true },
        });
        process.stdout.write(
          `PARTNER_CAMPAIGN_DETAIL_RUNTIME ${JSON.stringify({
            runTag,
            initialDriver,
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
  it('requires explicit detail transport opt-in and never permits detail writes', () => {
    const currentOrigin = 'http://127.0.0.1:1';
    const options = {
      url: `${currentOrigin}/partners/me/group-campaigns/${ids.ongoing}`,
      method: 'GET' as const,
      header: { Authorization: `Bearer ${token}` },
      success: jest.fn(),
      fail: jest.fn(),
    };
    expect(() =>
      new CampaignPageTransport(currentOrigin, new Set([token])).request(
        options,
      ),
    ).toThrow('outside its scope');
    const transport = new CampaignPageTransport(
      currentOrigin,
      new Set([token]),
      false,
      true,
    );
    for (const method of ['POST', 'PUT'] as const) {
      expect(() => transport.request({ ...options, method })).toThrow(
        'outside its scope',
      );
    }
    expect(transport.calls).toHaveLength(0);
  });
  it('does not expose ended history through the teacher promotion endpoints', async () => {
    const response = await request(server)
      .get('/teachers/me/group-campaigns')
      .auth(teacherToken, { type: 'bearer' })
      .expect(200);
    expect(payload<Campaign[]>(response).map(({ id }) => id)).toEqual([
      ids.ongoing,
    ]);
    await request(server)
      .get(`/teachers/me/group-campaigns/${ids.expired}`)
      .auth(teacherToken, { type: 'bearer' })
      .expect(404);
    await request(server)
      .get('/teachers/me/group-campaigns')
      .query({ phase: 'ENDED' })
      .auth(teacherToken, { type: 'bearer' })
      .expect(400);
  });
});
