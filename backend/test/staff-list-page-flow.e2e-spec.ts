import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { ManagementWorkspaceService } from '../src/modules/management/management-workspace.service';
import { StaffAccountManagementService } from '../src/modules/management/staff-account-management.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';

function assertTarget() {
  const target = assertPartnerPdfTestTarget(process.env);
  if (
    target.port !== '5433' ||
    target.pathname !== '/education_app_test_partner_pdf_20261012contact_test'
  )
    throw new Error('Approved isolated staff list database required');
}
assertTarget();
jest.setTimeout(60_000);

type Account = {
  id: string;
  version: number;
  status: string;
  bindingStatus: string;
  maskedPhone: string;
};
interface StaffPage {
  data: {
    accounts: Account[];
    campuses: Array<{ id: string }>;
    viewState: string;
    page: number;
    total: number;
    totalPages: number;
    pageLoading: boolean;
    pageError: string;
    keyword: string;
  };
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onKeywordInput(event: { detail: { value: string } }): void;
  onSearch(): void;
  onNextPage(): Promise<void>;
  onPreviousPage(): Promise<void>;
  updateStatus(id: string, version: number, status: string): Promise<void>;
  unbindWechat(id: string, version: number): Promise<void>;
  setData(patch: object): void;
}
type WireOptions = {
  url: string;
  method: string;
  header: Record<string, string>;
  data?: { status?: string; expectedVersion?: number };
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: { errMsg: string }): void;
};
type Call = {
  path: string;
  method: string;
  page: number | null;
  query: string | null;
  status?: number;
  rows?: number;
  total?: number;
  delivery: 'success' | 'held' | 'lost';
};

describe('staff list actual Page through local TCP and PostgreSQL', () => {
  const runTag = `stafflist-${randomUUID().slice(0, 8)}`;
  const campusId = randomUUID();
  const actorId = randomUUID();
  const accountIds = Array.from({ length: 201 }, () => randomUUID()).sort();
  const allIds = [actorId, ...accountIds];
  const targetIds = new Set([accountIds[100], accountIds[200]]);
  const accountName = `${runTag}-account`;
  const calls: Call[] = [];
  const pages: StaffPage[] = [];
  const scopes: jest.SpyInstance[] = [];
  const pending = new Set<Promise<void>>();
  const held: Array<() => void> = [];
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let app: INestApplication<Server>;
  let prisma: PrismaService;
  let origin: string;
  let token: string;
  let fixtureCreated = false;
  let nextReadDelivery: Call['delivery'] = 'success';
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };

  const idle = async () => {
    for (let round = 0; round < 30; round++) {
      await Promise.all([...pending]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!pending.size) return;
    }
    throw new Error('Staff list transport did not become idle');
  };
  const release = () => {
    for (const deliver of held.splice(0)) deliver();
  };
  const wire = (options: WireOptions) => {
    const url = new URL(options.url);
    const isList = options.method === 'GET';
    const mutation =
      /^\/management\/staff-accounts\/([a-f0-9-]{36})\/(status|unbind-wechat)$/.exec(
        url.pathname,
      );
    const allowedRead =
      isList &&
      ['/management/campuses', '/management/staff-accounts'].includes(
        url.pathname,
      ) &&
      [...url.searchParams.keys()].every((key) =>
        ['page', 'pageSize', 'query'].includes(key),
      );
    const allowedWrite =
      mutation &&
      targetIds.has(mutation[1]) &&
      options.method === (mutation[2] === 'status' ? 'PATCH' : 'POST') &&
      !url.search &&
      Boolean(options.header['Idempotency-Key']) &&
      Number.isInteger(options.data?.expectedVersion) &&
      Object.keys(options.data ?? {}).every((key) =>
        ['status', 'expectedVersion'].includes(key),
      );
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      options.header.Authorization !== `Bearer ${token}` ||
      (!allowedRead && !allowedWrite)
    )
      throw new Error('Staff list request outside its owned fixture scope');
    const call: Call = {
      path: url.pathname,
      method: options.method,
      page: isList ? Number(url.searchParams.get('page')) : null,
      query: url.searchParams.get('query'),
      delivery:
        url.pathname === '/management/staff-accounts'
          ? nextReadDelivery
          : 'success',
    };
    if (url.pathname === '/management/staff-accounts')
      nextReadDelivery = 'success';
    calls.push(call);
    const outgoing = isList
      ? request(origin).get(url.pathname + url.search)
      : options.method === 'PATCH'
        ? request(origin).patch(url.pathname)
        : request(origin).post(url.pathname);
    const task = outgoing
      .set(options.header)
      .send(options.data)
      .timeout({ response: 10_000, deadline: 15_000 })
      .then(
        (response) => {
          call.status = response.status;
          const body = response.body as {
            data?: unknown[];
            meta?: { total: number };
          };
          call.rows = Array.isArray(body.data) ? body.data.length : undefined;
          call.total = body.meta?.total;
          const deliver = () =>
            options.success({
              statusCode: response.status,
              data: response.body as unknown,
            });
          if (call.delivery === 'held') held.push(deliver);
          else if (call.delivery === 'lost')
            options.fail({ errMsg: 'synthetic received reply not delivered' });
          else deliver();
        },
        () => options.fail({ errMsg: 'synthetic local TCP failure' }),
      )
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  const reads = () =>
    calls.filter((call) => call.path === '/management/staff-accounts');
  const open = async () => {
    runtime.accessToken = token;
    let page: StaffPage | undefined;
    host.Page = (definition: StaffPage) => {
      page = {
        ...definition,
        data: structuredClone(definition.data),
        setData: (patch: object) =>
          Object.assign(page!.data, structuredClone(patch)),
      };
    };
    jest.isolateModules(() =>
      jest.requireActual(
        '../../frontend/pages/super-admin/staff-accounts/index.ts',
      ),
    );
    if (!page) throw new Error('Actual staff Page did not register');
    pages.push(page);
    page.onLoad();
    page.onShow();
    await idle();
    expect(page.data.viewState).toBe('success');
    expect(page.data.campuses.map((campus) => campus.id)).toEqual([campusId]);
    expect(page.data.accounts.map((account) => account.id)).toEqual(
      accountIds.slice(0, 100),
    );
    return page;
  };
  const restoreActor = async () => {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: actorId },
        data: { status: 'ACTIVE' },
      }),
      prisma.userRole.updateMany({
        where: { userId: actorId, campusId: null },
        data: { roleCode: 'SUPER_ADMIN' },
      }),
    ]);
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    process.stdout.write(
      `STAFF_LIST_INTENT ${JSON.stringify({
        runTag,
        campusId,
        actorId,
        accountIds,
        boundAccountIds: [...targetIds],
      })}\n`,
    );
    const phones = new Set<string>();
    while (phones.size < accountIds.length)
      phones.add(`+86139${String(randomInt(100_000_000)).padStart(8, '0')}`);
    const phoneList = [...phones];
    await prisma.$transaction(async (tx) => {
      await tx.campus.create({
        data: { id: campusId, code: runTag, name: `${runTag}-campus` },
      });
      await tx.user.createMany({
        data: [
          { id: actorId, displayName: `${runTag}-actor` },
          ...accountIds.map((id, index) => ({
            id,
            displayName: accountName,
            staffPhone: phoneList[index],
            createdAt: new Date('2026-10-15T00:00:00.000Z'),
          })),
        ],
      });
      await tx.userRole.createMany({
        data: [
          { userId: actorId, roleCode: 'SUPER_ADMIN' },
          ...accountIds.map((userId) => ({
            userId,
            roleCode: 'PARTNER' as const,
            campusId,
          })),
        ],
      });
      await tx.authIdentity.createMany({
        data: [...targetIds].map((userId, index) => ({
          userId,
          provider: 'WECHAT' as const,
          subject: `${runTag}-synthetic-wechat-${index}`,
        })),
      });
    });
    fixtureCreated = true;
    token = (await app.get(AuthService).issueSessionForUser(actorId))
      .accessToken;
    const workspace = app.get(ManagementWorkspaceService);
    const listCampuses = workspace.listCampuses.bind(workspace);
    scopes.push(
      jest
        .spyOn(workspace, 'listCampuses')
        .mockImplementation((query) =>
          listCampuses({ ...query, query: runTag }),
        ),
    );
    const staff = app.get(StaffAccountManagementService);
    const listAccounts = staff.list.bind(staff);
    // Restrict global administrative reads to this run without replacing SQL.
    scopes.push(
      jest
        .spyOn(staff, 'list')
        .mockImplementation((query) => listAccounts({ ...query, campusId })),
    );
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: token,
    };
    for (const key of ['Page', 'wx'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: wire,
      showToast: jest.fn(),
      showModal: () => {
        throw new Error('Native confirmation is outside TCP verification');
      },
    };
  });
  beforeEach(() => {
    calls.length = 0;
    nextReadDelivery = 'success';
  });
  afterEach(async () => {
    for (const page of pages.splice(0)) page.onUnload();
    await idle();
    release();
    await idle();
  });
  afterAll(async () => {
    try {
      if (fixtureCreated) {
        assertTarget();
        const disabled = await prisma.user.updateMany({
          where: {
            id: { in: allIds },
            displayName: { startsWith: `${runTag}-` },
          },
          data: { status: 'DISABLED' },
        });
        const users = await prisma.user.findMany({
          where: { id: { in: allIds } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            displayName: true,
            status: true,
            accountVersion: true,
            roles: { select: { roleCode: true, campusId: true } },
          },
        });
        const audit = await prisma.auditLog.findMany({
          where: { actorUserId: actorId },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            action: true,
            resourceId: true,
            actorUserId: true,
            campusId: true,
            details: true,
          },
        });
        const claims = await prisma.idempotencyRecord.findMany({
          where: { actorUserId: actorId },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            route: true,
            status: true,
            actorUserId: true,
            responseStatus: true,
            responseBody: true,
          },
        });
        process.stdout.write(
          `STAFF_LIST_OWNERSHIP ${JSON.stringify({
            runTag,
            campusId,
            actorId,
            users,
            audit,
            claims,
            disposition: 'owned synthetic users disabled; records retained',
          })}\n`,
        );
        expect(disabled.count).toBe(allIds.length);
        expect(users).toHaveLength(202);
        expect(users.every((user) => user.status === 'DISABLED')).toBe(true);
        expect(audit).toHaveLength(3);
        expect(claims).toHaveLength(3);
      }
    } finally {
      for (const scope of scopes) scope.mockRestore();
      try {
        await app?.close();
        if (app && origin) {
          const listenerClosed = !app.getHttpServer().listening;
          process.stdout.write(
            `STAFF_LIST_CLOSED ${JSON.stringify({
              runTag,
              port: Number(new URL(origin).port),
              listenerClosed,
            })}\n`,
          );
          expect(listenerClosed).toBe(true);
        }
      } finally {
        token = '';
        if (runtime) runtime.accessToken = '';
        for (const [key, descriptor] of globals) {
          if (descriptor) Object.defineProperty(host, key, descriptor);
          else Reflect.deleteProperty(host, key);
        }
      }
    }
  });

  it('browses all 201 real accounts in stable timestamp-tie order', async () => {
    const page = await open();
    await page.onPreviousPage();
    await page.onNextPage();
    expect(page.data.accounts.map((account) => account.id)).toEqual(
      accountIds.slice(100, 200),
    );
    await page.onNextPage();
    expect(page.data.accounts.map((account) => account.id)).toEqual(
      accountIds.slice(200),
    );
    const before = reads().length;
    await page.onNextPage();
    expect(reads()).toHaveLength(before);
    await page.onPreviousPage();
    await page.onPreviousPage();
    expect(reads().map((call) => call.page)).toEqual([1, 2, 3, 2, 1]);
    expect(reads().map((call) => call.rows)).toEqual([100, 100, 1, 100, 100]);
    expect(
      reads().every((call) => call.status === 200 && call.total === 201),
    ).toBe(true);
    expect(
      page.data.accounts.every((account) =>
        /^\+86\*{4}\d{4}$/.test(account.maskedPhone),
      ),
    ).toBe(true);
    process.stdout.write(
      `STAFF_LIST_PAGES ${JSON.stringify({
        runTag,
        pages: reads().map((call) => call.page),
        rows: reads().map((call) => call.rows),
        total: 201,
      })}\n`,
    );
  });

  it('keeps the submitted query on later pages until a new search is submitted', async () => {
    const page = await open();
    page.onKeywordInput({ detail: { value: ` ${accountName} ` } });
    page.onSearch();
    await idle();
    await page.onNextPage();
    page.onKeywordInput({ detail: { value: `${runTag}-missing` } });
    await page.onNextPage();
    expect(reads().at(-1)?.query).toBe(accountName);
    expect(page.data.page).toBe(3);
    page.onSearch();
    await idle();
    expect(page.data).toMatchObject({
      viewState: 'empty',
      page: 1,
      total: 0,
      totalPages: 0,
      accounts: [],
    });
    expect(reads().at(-1)?.query).toBe(`${runTag}-missing`);
  });

  it('disables and re-enables account 101 while reloading the displayed second page', async () => {
    const page = await open();
    await page.onNextPage();
    let account = page.data.accounts[0];
    expect(account.id).toBe(accountIds[100]);
    await page.updateStatus(account.id, account.version, 'DISABLED');
    expect(page.data.page).toBe(2);
    account = page.data.accounts[0];
    expect(account).toMatchObject({ status: 'DISABLED', version: 2 });
    await page.updateStatus(account.id, account.version, 'ACTIVE');
    expect(page.data).toMatchObject({ page: 2, total: 201 });
    expect(page.data.accounts[0]).toMatchObject({
      status: 'ACTIVE',
      version: 3,
    });
    expect(
      await prisma.user.findUnique({
        where: { id: accountIds[100] },
        select: { status: true, accountVersion: true },
      }),
    ).toEqual({ status: 'ACTIVE', accountVersion: 3 });
    expect(reads().map((call) => call.page)).toEqual([1, 2, 2, 2]);
  });

  it('unbinds account 201 and reloads the final page with a persisted new version', async () => {
    const page = await open();
    await page.onNextPage();
    await page.onNextPage();
    const account = page.data.accounts[0];
    expect(account).toMatchObject({
      id: accountIds[200],
      bindingStatus: 'BOUND',
      version: 1,
    });
    await page.unbindWechat(account.id, account.version);
    expect(page.data).toMatchObject({ page: 3, total: 201 });
    expect(page.data.accounts[0]).toMatchObject({
      bindingStatus: 'UNBOUND',
      version: 2,
    });
    expect(
      await prisma.authIdentity.count({
        where: { userId: account.id, provider: 'WECHAT' },
      }),
    ).toBe(0);
    expect(reads().map((call) => call.page)).toEqual([1, 2, 3, 3]);
  });

  it('keeps page one after an undelivered real 200 and retries page two', async () => {
    const page = await open();
    nextReadDelivery = 'lost';
    await page.onNextPage();
    expect(reads().at(-1)).toMatchObject({
      status: 200,
      rows: 100,
      delivery: 'lost',
      page: 2,
    });
    expect(page.data).toMatchObject({
      page: 1,
      viewState: 'success',
      pageLoading: false,
    });
    expect(page.data.pageError).not.toBe('');
    await page.onNextPage();
    expect(page.data).toMatchObject({
      page: 2,
      pageError: '',
      pageLoading: false,
    });
    expect(reads().map((call) => call.page)).toEqual([1, 2, 2]);
  });

  it.each([200, 403])(
    'ignores a held real %s after a newer search succeeds',
    async (status) => {
      const page = await open();
      try {
        if (status === 403)
          await prisma.userRole.updateMany({
            where: { userId: actorId, roleCode: 'SUPER_ADMIN' },
            data: { roleCode: 'HR' },
          });
        nextReadDelivery = 'held';
        const old = page.onNextPage();
        await idle();
        expect(reads().at(-1)?.status).toBe(status);
        await restoreActor();
        page.onKeywordInput({ detail: { value: accountName } });
        page.onSearch();
        await idle();
        const snapshot = JSON.stringify(page.data);
        release();
        await old;
        expect(JSON.stringify(page.data)).toBe(snapshot);
        expect(page.data).toMatchObject({ viewState: 'success', page: 1 });
      } finally {
        await restoreActor();
      }
    },
  );

  it.each([401, 403])(
    'clears accounts and paging state on current real %s',
    async (status) => {
      const page = await open();
      try {
        if (status === 401)
          await prisma.user.update({
            where: { id: actorId },
            data: { status: 'DISABLED' },
          });
        else
          await prisma.userRole.updateMany({
            where: { userId: actorId, roleCode: 'SUPER_ADMIN' },
            data: { roleCode: 'HR' },
          });
        await page.onNextPage();
        expect(reads().at(-1)?.status).toBe(status);
        expect(page.data).toMatchObject({
          viewState: 'forbidden',
          accounts: [],
          campuses: [],
          page: 0,
          total: 0,
          totalPages: 0,
          pageLoading: false,
        });
        const count = calls.length;
        await page.onNextPage();
        expect(calls).toHaveLength(count);
      } finally {
        await restoreActor();
      }
    },
  );

  it.each([50, 0])(
    'recovers to page one when the real matching set shrinks to %s',
    async (remaining) => {
      const page = await open();
      page.onKeywordInput({ detail: { value: accountName } });
      page.onSearch();
      await idle();
      const renamed = accountIds.slice(remaining);
      try {
        const changed = await prisma.user.updateMany({
          where: { id: { in: renamed }, displayName: accountName },
          data: { displayName: `${runTag}-archived` },
        });
        expect(changed.count).toBe(renamed.length);
        const start = reads().length;
        await page.onNextPage();
        expect(
          reads()
            .slice(start)
            .map((call) => call.page),
        ).toEqual([2, 1]);
        expect(page.data).toMatchObject({
          viewState: remaining ? 'success' : 'empty',
          page: 1,
          total: remaining,
          totalPages: remaining ? 1 : 0,
          pageLoading: false,
        });
        expect(page.data.accounts.map((account) => account.id)).toEqual(
          accountIds.slice(0, remaining),
        );
      } finally {
        const restored = await prisma.user.updateMany({
          where: { id: { in: renamed }, displayName: `${runTag}-archived` },
          data: { displayName: accountName },
        });
        expect(restored.count).toBe(renamed.length);
      }
    },
  );

  it.each(['hide', 'owner'])(
    'discards held real paging data after %s',
    async (cause) => {
      const page = await open();
      nextReadDelivery = 'held';
      const old = page.onNextPage();
      await idle();
      expect(reads().at(-1)?.status).toBe(200);
      if (cause === 'hide') page.onHide();
      else runtime.accessToken = 'synthetic-replacement-not-issued';
      release();
      await old;
      expect(page.data).toMatchObject({
        accounts: [],
        page: 0,
        total: 0,
        totalPages: 0,
        pageLoading: false,
      });
      if (cause === 'owner') expect(page.data.viewState).toBe('forbidden');
    },
  );
});
