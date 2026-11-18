import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { RoleCode } from '@prisma/client';
import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import {
  FreeCampaignScopeService,
  type FreeActorScope,
} from '../src/modules/group-buying/free-campaign-scope.service';
import type { Prisma } from '@prisma/client';
import { assertFreeCampaignNativeTarget } from './support/free-campaign-native-policy';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { CampaignPageTransport } from './support/partner-campaign-page-harness';
import {
  isOwnedFreeReviewPageRead,
  ownedFreeReviewRead,
} from './support/free-campaign-review-owned-read';

assertFreeCampaignNativeTarget(process.env);
jest.setTimeout(60_000);

interface HostPage {
  data: object;
  onLoad(query: Record<string, string>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  pending?: Promise<void>;
  pendingLoad?: Promise<void>;
  working?: Promise<void>;
}
interface ReviewRow {
  versionId: string;
  status: string;
  title: string;
  campusId: string;
}
interface ListPage extends HostPage {
  data: {
    viewState: string;
    rows: ReviewRow[];
    more: boolean;
    page: number;
    loading: boolean;
    statusIndex: number;
  };
  onStatus(event: { detail: { value: string } }): void;
  onMore(): Promise<void>;
  onRetry(): Promise<void>;
  onOpen(event: { currentTarget: { dataset: { id: string } } }): void;
}
interface DetailPage extends HostPage {
  reasonDraft: string;
  data: {
    viewState: string;
    detail: {
      versionId: string;
      configuration: { title: string; shareDescription: string };
      status: string;
    } | null;
    reason: string;
    canApprove: boolean;
    canReject: boolean;
    canClose: boolean;
  };
  onReload(): Promise<void>;
  onReasonInput(event: { detail: { value: string } }): void;
}
type Actor = { id: string; token: string };
type Candidate = {
  versionId: string;
  campaignId: string;
  draftId: string;
  title: string;
  version: number;
};
type Snapshot = <T>(
  user: AuthenticatedUser,
  role: 'PARENT' | 'PARTNER' | 'SUPER_ADMIN',
  read: (tx: Prisma.TransactionClient, actor: FreeActorScope) => Promise<T>,
  recheck?: (
    tx: Prisma.TransactionClient,
    actor: FreeActorScope,
    result: T,
  ) => Promise<void>,
) => Promise<T>;

describe('actual admin read Pages through TCP with exclusive PostgreSQL fixtures', () => {
  const runTag = `fcread-${randomUUID().slice(0, 8)}`;
  const ownedUsers: string[] = [];
  const fixtureIds: string[] = [];
  const candidates: Candidate[] = [];
  const pages: HostPage[] = [];
  const tokens = new Set<string>();
  const navigation: string[] = [];
  const wire: Array<{
    method: string;
    path: string;
    page: string | null;
    pageSize: string | null;
    filter: string | null;
    status?: number;
  }> = [];
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let app: INestApplication;
  let prisma: PrismaService;
  let campusId: string;
  let partner: Actor;
  let admin: Actor;
  let transport: CampaignPageTransport;
  let origin: string;
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };
  let readScope: jest.SpyInstance | undefined;
  let approved: Candidate;
  let rejected: Candidate;
  let excluded: Candidate;
  let beforeFacts: Awaited<ReturnType<typeof facts>>;

  const facts = async () => ({
    versions: await prisma.campaignVersion.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        campaignId: true,
        campusId: true,
        status: true,
        version: true,
        title: true,
        reviewedByUserId: true,
      },
    }),
    campaigns: await prisma.campaign.findMany({
      where: { campusId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        lifecycle: true,
        version: true,
        publishedVersionId: true,
      },
    }),
    auditCount: await prisma.auditLog.count({
      where: {
        campusId,
        action: {
          in: [
            'FREE_CAMPAIGN_SUBMIT',
            'FREE_CAMPAIGN_APPROVED',
            'FREE_CAMPAIGN_REJECTED',
            'FREE_CAMPAIGN_CLOSE',
          ],
        },
      },
    }),
    financial: {
      groups: await prisma.groupCampaign.count({ where: { campusId } }),
      orders: await prisma.enrollmentOrder.count({ where: { campusId } }),
      products: await prisma.courseProduct.count({ where: { campusId } }),
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
    },
  });

  const tasks = (page: HostPage) =>
    [page.pending, page.pendingLoad, page.working].filter(
      (p): p is Promise<void> => p !== undefined,
    );
  const settle = async (page: HostPage) => {
    for (let round = 0; round < 4; round++) {
      await Promise.all(tasks(page));
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async <T extends HostPage>(
    route: 'campaign-reviews' | 'campaign-review-detail',
    owner: Actor = admin,
    query: Record<string, string> = {},
  ): Promise<T> => {
    runtime.accessToken = owner.token;
    let page: T | undefined;
    host.Page = (value: T) => {
      page = {
        ...value,
        data: structuredClone(value.data),
        setData: (patch: object) => Object.assign(page!.data, patch),
      };
    };
    jest.isolateModules(() =>
      jest.requireActual(`../../frontend/pages/super-admin/${route}/index.ts`),
    );
    if (!page) throw new Error('Actual admin Page did not register');
    pages.push(page);
    page.onLoad(query);
    page.onShow();
    await settle(page);
    return page;
  };
  const retryRead = (page: ListPage | DetailPage) =>
    'onRetry' in page ? page.onRetry() : page.onReload();
  const expectReadable = (page: ListPage | DetailPage) => {
    expect(page.data.viewState).toBe('ready');
    if ('rows' in page.data) {
      expect(page.data.rows).toHaveLength(20);
      expect(page.data).toMatchObject({ page: 1, more: true });
    } else {
      expect(page.data.detail?.versionId).toBe(candidates[0].versionId);
      expect(page.data).toMatchObject({
        canApprove: true,
        canReject: true,
        canClose: true,
      });
    }
  };
  const expectPrivateCleared = (page: ListPage | DetailPage) => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      loading: false,
    });
    if ('rows' in page.data) {
      expect(page.data).toMatchObject({
        rows: [],
        page: 0,
        more: false,
        refreshError: '',
        paginationError: '',
      });
    } else {
      expect(page.data).toMatchObject({
        detail: null,
        reason: '',
        canApprove: false,
        canReject: false,
        canClose: false,
        statusLabel: '',
        startsLabel: '',
        endsLabel: '',
        submittedLabel: '',
        reviewedLabel: '',
        capacityLabel: '',
      });
      expect((page as DetailPage).reasonDraft).toBe('');
    }
  };
  const changeOwnedAdminRole = async (
    from: 'SUPER_ADMIN' | 'HR',
    to: 'SUPER_ADMIN' | 'HR',
  ) => {
    assertFreeCampaignNativeTarget(process.env);
    const changed = await prisma.userRole.updateMany({
      where: {
        userId: admin.id,
        roleCode: from,
        campusId: null,
        user: {
          displayName: `${runTag}-1-SUPER_ADMIN`,
          status: 'ACTIVE',
        },
      },
      data: { roleCode: to },
    });
    expect(changed.count).toBe(1);
  };
  const withOwnedAdminReadRevoked = async (work: () => Promise<void>) => {
    await changeOwnedAdminRole('SUPER_ADMIN', 'HR');
    try {
      await work();
    } finally {
      await changeOwnedAdminRole('HR', 'SUPER_ADMIN');
    }
  };
  const actor = async (
    roleCode: RoleCode,
    scopedCampus: string | null,
  ): Promise<Actor> => {
    const row = await prisma.user.create({
      data: {
        displayName: `${runTag}-${ownedUsers.length}-${roleCode}`,
        roles: { create: { roleCode, campusId: scopedCampus } },
      },
    });
    ownedUsers.push(row.id);
    const token = (await app.get(AuthService).issueSessionForUser(row.id))
      .accessToken;
    tokens.add(token);
    return { id: row.id, token };
  };
  const call = <T>(
    owner: Actor,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    data?: object,
  ): Promise<T> =>
    new Promise((resolve, reject) =>
      transport.request({
        url: origin + path,
        method,
        data,
        header: {
          Authorization: `Bearer ${owner.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        success(response) {
          if (response.statusCode !== 200) {
            reject(new Error(`Fixture HTTP ${response.statusCode}`));
            return;
          }
          resolve((response.data as { data: T }).data);
        },
        fail() {
          reject(new Error('Fixture TCP request failed'));
        },
      }),
    );
  const candidate = async (
    owner: Actor,
    index: number,
    include = true,
  ): Promise<Candidate> => {
    const title = `合成总端免费登记${String(index).padStart(2, '0')}`;
    const draft = await call<{ draftId: string; version: number }>(
      owner,
      'POST',
      '/partners/me/campaign-drafts',
      {
        title,
        campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成冻结说明：仅登记，不自动发放课时。',
      },
    );
    const configured = await call<{ version: number }>(
      owner,
      'PUT',
      `/partners/me/campaign-drafts/${draft.draftId}/free-registration`,
      {
        expectedVersion: draft.version,
        freeRegistration: {
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          capacityMode: 'LIMITED',
          maxRegistrations: 5,
        },
      },
    );
    const row = await call<{
      versionId: string;
      campaignId: string;
      version: number;
    }>(owner, 'POST', `/partners/me/campaign-drafts/${draft.draftId}/submit`, {
      expectedVersion: configured.version,
    });
    if (include) fixtureIds.push(row.versionId);
    return { ...row, title, draftId: draft.draftId };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    campusId = (
      await prisma.campus.create({
        data: { code: runTag, name: `${runTag}合成校区` },
      })
    ).id;
    partner = await actor('PARTNER', campusId);
    admin = await actor('SUPER_ADMIN', null);
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as { address(): AddressInfo }
    ).address();
    origin = `http://127.0.0.1:${address.port}`;
    transport = new CampaignPageTransport(origin, tokens, true);
    for (let index = 1; index <= 21; index++)
      candidates.push(await candidate(partner, index));
    approved = await candidate(partner, 22);
    await call(
      admin,
      'POST',
      `/management/campaign-reviews/${approved.versionId}/approve`,
      { expectedVersion: approved.version },
    );
    rejected = await candidate(partner, 23);
    await call(
      admin,
      'POST',
      `/management/campaign-reviews/${rejected.versionId}/reject`,
      { expectedVersion: rejected.version, reason: '合成资料：请补充说明' },
    );
    excluded = await candidate(partner, 24, false);
    beforeFacts = await facts();
    expect(beforeFacts.financial).toEqual({
      groups: 0,
      orders: 0,
      products: 0,
      packages: 0,
      ledger: 0,
      partnerEarnings: 0,
      teacherEarnings: 0,
      payments: 0,
    });
    const scope = app.get(FreeCampaignScopeService);
    const snapshot: Snapshot = scope.snapshot.bind(scope);
    const confined: Snapshot = (user, role, read, recheck) =>
      snapshot(
        user,
        role,
        (tx, current) =>
          read(
            role === 'SUPER_ADMIN' && user.userId === admin.id
              ? ownedFreeReviewRead(tx, fixtureIds)
              : tx,
            current,
          ),
        recheck,
      );
    readScope = jest.spyOn(scope, 'snapshot').mockImplementation(confined);
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: admin.token,
    };
    for (const key of ['wx', 'Page', 'getCurrentPages'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: (options: Parameters<CampaignPageTransport['request']>[0]) => {
        if (!isOwnedFreeReviewPageRead(origin, fixtureIds, options))
          throw new Error('Owned GET-only Page request required');
        const url = new URL(options.url);
        const call: (typeof wire)[number] = {
          method: options.method,
          path: url.pathname,
          page: url.searchParams.get('page'),
          pageSize: url.searchParams.get('pageSize'),
          filter: url.searchParams.get('status'),
        };
        wire.push(call);
        return transport.request({
          ...options,
          success(response) {
            call.status = response.statusCode;
            options.success(response);
          },
        });
      },
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({
        top: 32,
        left: 295,
        height: 32,
        bottom: 64,
      }),
      navigateTo: ({ url }: { url: string }) => navigation.push(url),
      stopPullDownRefresh: jest.fn(),
      showModal: () => {
        throw new Error('Read-only Page verification must not open a modal');
      },
    };
    host.getCurrentPages = () => [{}, ...pages];
  });
  afterEach(async () => {
    const pending = pages.flatMap(tasks);
    for (const page of pages.splice(0)) page.onUnload();
    await transport?.drain();
    await Promise.all(pending);
  });
  afterAll(async () => {
    try {
      if (prisma && ownedUsers.length) {
        assertFreeCampaignNativeTarget(process.env);
        const disabled = await prisma.user.updateMany({
          where: {
            id: { in: ownedUsers },
            displayName: { startsWith: runTag + '-' },
          },
          data: { status: 'DISABLED' },
        });
        expect(disabled.count).toBe(ownedUsers.length);
        const afterFacts = await facts();
        if (beforeFacts) expect(afterFacts).toEqual(beforeFacts);
        const users = await prisma.user.findMany({
          where: { id: { in: ownedUsers } },
          select: { id: true, status: true },
        });
        expect(users.every((row) => row.status === 'DISABLED')).toBe(true);
        process.stdout.write(
          `FREE_REVIEW_READ_OWNERSHIP ${JSON.stringify({ runTag, campusId, users, fixtureIds, excludedId: excluded?.versionId, facts: afterFacts, unchanged: Boolean(beforeFacts), disposition: 'retained; no deletion' })}\n`,
        );
        process.stdout.write(
          `FREE_REVIEW_READ_HTTP ${JSON.stringify({ runTag, calls: wire })}\n`,
        );
      }
    } finally {
      readScope?.mockRestore();
      try {
        await app?.close();
        if (app && origin) {
          const listenerClosed = !(
            app.getHttpServer() as { listening: boolean }
          ).listening;
          expect(listenerClosed).toBe(true);
          process.stdout.write(
            `FREE_REVIEW_READ_CLOSED ${JSON.stringify({
              runTag,
              port: Number(new URL(origin).port),
              listenerClosed,
            })}\n`,
          );
        }
      } finally {
        tokens.clear();
        if (runtime) runtime.accessToken = '';
        for (const [key, descriptor] of globals) {
          if (descriptor) Object.defineProperty(host, key, descriptor);
          else Reflect.deleteProperty(host, key);
        }
      }
    }
  });

  it('blocks Page-side approval and an excluded detail before HTTP dispatch', () => {
    const request = (host.wx as { request: CampaignPageTransport['request'] })
      .request;
    const before = transport.calls.length;
    for (const [method, path] of [
      [
        'POST',
        `/management/campaign-reviews/${candidates[0].versionId}/approve`,
      ],
      ['POST', `/management/campaign-reviews/${excluded.versionId}/approve`],
      ['GET', `/management/campaign-reviews/${excluded.versionId}`],
    ] as const) {
      expect(() =>
        request({
          url: origin + path,
          method,
          header: { Authorization: `Bearer ${admin.token}` },
          success: () => undefined,
          fail: () => undefined,
        }),
      ).toThrow('Owned GET-only Page request required');
    }
    expect(transport.calls).toHaveLength(before);
  });

  it('paginates twenty plus one pending records and excludes other retained fixtures', async () => {
    const page = await open<ListPage>('campaign-reviews');
    expect(page.data).toMatchObject({
      viewState: 'ready',
      page: 1,
      more: true,
      statusIndex: 0,
    });
    expect(page.data.rows).toHaveLength(20);
    await page.onMore();
    await settle(page);
    expect(page.data).toMatchObject({ page: 2, more: false, loading: false });
    expect(page.data.rows).toHaveLength(21);
    expect(new Set(page.data.rows.map((row) => row.versionId)).size).toBe(21);
    const expected = await prisma.campaignVersion.findMany({
      where: { id: { in: candidates.map((row) => row.versionId) } },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    });
    expect(
      page.data.rows.map(({ versionId, status }) => ({
        id: versionId,
        status,
      })),
    ).toEqual(expected);
    expect(
      page.data.rows.some((row) => row.versionId === excluded.versionId),
    ).toBe(false);
    expect(
      transport.calls.some(
        (row) =>
          row.path === '/management/campaign-reviews' && row.status === 200,
      ),
    ).toBe(true);
    for (const number of ['1', '2'])
      expect(
        wire.some(
          (row) =>
            row.path === '/management/campaign-reviews' &&
            row.page === number &&
            row.pageSize === '20' &&
            row.filter === 'SUBMITTED' &&
            row.status === 200,
        ),
      ).toBe(true);
    const before = transport.calls.length;
    await page.onMore();
    await settle(page);
    expect(transport.calls).toHaveLength(before);
  });

  it('filters approved, rejected and all states without leaking an excluded candidate', async () => {
    const page = await open<ListPage>('campaign-reviews');
    for (const [index, expected] of [
      [1, approved],
      [2, rejected],
    ] as const) {
      page.onStatus({ detail: { value: String(index) } });
      await settle(page);
      expect(page.data.rows.map((row) => row.versionId)).toEqual([
        expected.versionId,
      ]);
      expect(page.data.more).toBe(false);
    }
    page.onStatus({ detail: { value: '3' } });
    await settle(page);
    expect(page.data.rows).toHaveLength(20);
    await page.onMore();
    await settle(page);
    expect(page.data.rows).toHaveLength(23);
    expect(page.data.rows.map((row) => row.versionId).sort()).toEqual(
      [...fixtureIds].sort(),
    );
    expect(page.data.rows.every((row) => row.campusId === campusId)).toBe(true);
  });

  it('opens the frozen detail from a real Page navigation intent and reloads the list on return', async () => {
    const candidate = candidates[0];
    await call(
      partner,
      'PUT',
      `/partners/me/campaign-drafts/${candidate.draftId}/basic-information`,
      {
        expectedVersion: 2,
        basicInformation: {
          title: '合成未送审修改',
          shareDescription: '草稿新内容不应污染冻结详情',
          contactPhone: null,
          campaignType: 'FREE_REGISTRATION',
        },
      },
    );
    const list = await open<ListPage>('campaign-reviews');
    await list.onMore();
    await settle(list);
    list.onOpen({ currentTarget: { dataset: { id: candidate.versionId } } });
    expect(navigation.at(-1)).toBe(
      `/pages/super-admin/campaign-review-detail/index?id=${candidate.versionId}`,
    );
    list.onHide();
    expect(list.data.rows).toEqual([]);
    const detail = await open<DetailPage>('campaign-review-detail', admin, {
      id: candidate.versionId,
    });
    expect(detail.data).toMatchObject({
      viewState: 'ready',
      detail: {
        versionId: candidate.versionId,
        status: 'SUBMITTED',
        configuration: {
          title: candidate.title,
          shareDescription: '合成冻结说明：仅登记，不自动发放课时。',
        },
      },
      canApprove: true,
      canReject: true,
    });
    detail.onUnload();
    list.onShow();
    await settle(list);
    expect(list.data).toMatchObject({
      viewState: 'ready',
      page: 1,
      more: true,
    });
    expect(list.data.rows).toHaveLength(20);
  });

  it('ignores a held old list after a status change even when the Page drops its pending field', async () => {
    const page = await open<ListPage>('campaign-reviews');
    transport.deliverNext('held');
    const old = page.onRetry();
    await transport.idle();
    page.onStatus({ detail: { value: '1' } });
    await settle(page);
    expect(page.data.rows.map((row) => row.versionId)).toEqual([
      approved.versionId,
    ]);
    transport.release();
    await old;
    await settle(page);
    expect(page.data.rows.map((row) => row.versionId)).toEqual([
      approved.versionId,
    ]);
    expect(page.data.statusIndex).toBe(1);
  });

  it('receives actual403 and clears a partner attempting the management list', async () => {
    const offset = transport.calls.length;
    const page = await open<ListPage>('campaign-reviews', partner);
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      rows: [],
      page: 0,
      more: false,
    });
    expect(
      transport.calls
        .slice(offset)
        .some(
          (row) =>
            row.path === '/management/campaign-reviews' && row.status === 403,
        ),
    ).toBe(true);
  });

  it('clears populated list and detail, including a reason draft, on actual403 with the same token', async () => {
    const list = await open<ListPage>('campaign-reviews');
    const detail = await open<DetailPage>('campaign-review-detail', admin, {
      id: candidates[0].versionId,
    });
    expectReadable(list);
    expectReadable(detail);
    detail.onReasonInput({ detail: { value: '合成未提交的审核原因' } });
    expect(detail.reasonDraft).toBe('合成未提交的审核原因');
    const offset = transport.calls.length;
    await withOwnedAdminReadRevoked(async () => {
      expect(runtime.accessToken).toBe(admin.token);
      await list.onRetry();
      await detail.onReload();
      await settle(list);
      await settle(detail);
      expectPrivateCleared(list);
      expectPrivateCleared(detail);
      expect(
        transport.calls.slice(offset).map(({ path, status }) => ({
          path,
          status,
        })),
      ).toEqual([
        { path: '/management/campaign-reviews', status: 403 },
        {
          path: `/management/campaign-reviews/${candidates[0].versionId}`,
          status: 403,
        },
      ]);
      expect(
        await prisma.user.findUnique({
          where: { id: admin.id },
          select: {
            status: true,
            roles: { select: { roleCode: true, campusId: true } },
          },
        }),
      ).toEqual({
        status: 'ACTIVE',
        roles: [{ roleCode: 'HR', campusId: null }],
      });
    });
  });

  it.each(['campaign-reviews', 'campaign-review-detail'] as const)(
    'does not restore private %s from an old actual200 after returning to actual403',
    async (route) => {
      const page = await open<ListPage | DetailPage>(route, admin, {
        id: candidates[0].versionId,
      });
      expectReadable(page);
      const offset = transport.calls.length;
      transport.deliverNext('held');
      const old = retryRead(page);
      await transport.idle();
      expect(transport.calls[offset]).toMatchObject({
        status: 200,
        delivery: 'held',
      });
      page.onHide();
      await withOwnedAdminReadRevoked(async () => {
        page.onShow();
        await settle(page);
        expectPrivateCleared(page);
        expect(transport.calls[offset + 1]?.status).toBe(403);
        const cleared = structuredClone(page.data);
        transport.release();
        await old;
        await settle(page);
        expect(page.data).toEqual(cleared);
        expectPrivateCleared(page);
        expect(runtime.accessToken).toBe(admin.token);
      });
    },
  );

  it.each(['campaign-reviews', 'campaign-review-detail'] as const)(
    'ignores an old actual403 for %s after a new authorized read completes',
    async (route) => {
      const page = await open<ListPage | DetailPage>(route, admin, {
        id: candidates[0].versionId,
      });
      expectReadable(page);
      let old: Promise<void> | undefined;
      const offset = transport.calls.length;
      await withOwnedAdminReadRevoked(async () => {
        transport.deliverNext('held');
        old = retryRead(page);
        await transport.idle();
        expect(transport.calls[offset]).toMatchObject({
          status: 403,
          delivery: 'held',
        });
        page.onHide();
      });
      page.onShow();
      await settle(page);
      expectReadable(page);
      expect(transport.calls[offset + 1]?.status).toBe(200);
      const current = structuredClone(page.data);
      transport.release();
      await old;
      await settle(page);
      expect(page.data).toEqual(current);
      expectReadable(page);
      expect(runtime.accessToken).toBe(admin.token);
    },
  );

  it('preserves private content on connection loss and recovers by retrying only the read', async () => {
    for (const route of [
      'campaign-reviews',
      'campaign-review-detail',
    ] as const) {
      const page = await open<ListPage | DetailPage>(route, admin, {
        id: candidates[0].versionId,
      });
      expectReadable(page);
      const content = structuredClone(
        'rows' in page.data ? page.data.rows : page.data.detail,
      );
      const offset = transport.calls.length;
      transport.deliverNext('lost');
      await retryRead(page);
      await settle(page);
      expect(page.data.viewState).toBe('ready');
      expect('rows' in page.data ? page.data.rows : page.data.detail).toEqual(
        content,
      );
      expect(page.data).toMatchObject({ loading: false });
      expect(transport.calls[offset]).toMatchObject({
        method: 'GET',
        status: 200,
        delivery: 'lost',
      });
      await retryRead(page);
      await settle(page);
      expectReadable(page);
      expect(transport.calls.slice(offset).map((row) => row.method)).toEqual([
        'GET',
        'GET',
      ]);
      page.onUnload();
    }
  });

  it('clears both private Pages after only the exact synthetic admin is disabled', async () => {
    const list = await open<ListPage>('campaign-reviews');
    const detail = await open<DetailPage>('campaign-review-detail', admin, {
      id: candidates[0].versionId,
    });
    const disabled = await prisma.user.updateMany({
      where: {
        id: admin.id,
        displayName: { startsWith: runTag + '-' },
        status: 'ACTIVE',
      },
      data: { status: 'DISABLED' },
    });
    expect(disabled.count).toBe(1);
    const offset = transport.calls.length;
    await list.onRetry();
    await detail.onReload();
    await settle(list);
    await settle(detail);
    expect(list.data).toMatchObject({
      viewState: 'forbidden',
      rows: [],
      page: 0,
      more: false,
    });
    expect(detail.data).toMatchObject({
      viewState: 'forbidden',
      detail: null,
      reason: '',
      canApprove: false,
      canReject: false,
      canClose: false,
    });
    expect(
      transport.calls.slice(offset).filter((row) => row.status === 401),
    ).toHaveLength(2);
    expect(
      await prisma.user.findUnique({
        where: { id: partner.id },
        select: { status: true },
      }),
    ).toEqual({ status: 'ACTIVE' });
  });
});
