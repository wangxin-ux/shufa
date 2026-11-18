import { randomInt, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { isDeepStrictEqual } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service';
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
    throw new Error('Approved isolated staff creation test database required');
}
assertTarget();
jest.setTimeout(60_000);

type CreationInput = {
  displayName: string;
  phone: string;
  roleCode: 'CAMPUS_MANAGER' | 'PARTNER' | 'HR' | 'FINANCE';
  campusId: string | null;
};
type Actor = { id: string; token: string };
type WireReply = { statusCode: number; data: unknown };
type WireOptions = {
  url: string;
  method: string;
  header: Record<string, string>;
  data?: unknown;
  success(response: WireReply): void;
  fail(error: { errMsg: string }): void;
};
type WireCall = {
  method: string;
  path: string;
  page?: number;
  rows?: number;
  total?: number;
  request?: unknown;
  key?: string;
  status?: number;
  response?: unknown;
  delivery: 'success' | 'lost' | 'held';
};
interface StaffPage {
  campusesReady: boolean;
  data: {
    viewState: string;
    accounts: Array<{
      id: string;
      campusId: string | null;
      maskedPhone: string;
      roleCode: string;
    }>;
    campuses: Array<{ id: string }>;
    createCampusIndex: number;
    createName: string;
    createPhone: string;
    createOpen: boolean;
    submitting: boolean;
    keyword: string;
  };
  setData(patch: object): void;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  load(): Promise<void>;
  onToggleCreate(): void;
  onNameInput(event: { detail: { value: string } }): void;
  onPhoneInput(event: { detail: { value: string } }): void;
  onRoleChange(event: { detail: { value: string } }): void;
  onCampusChange(event: { detail: { value: string } }): void;
  onKeywordInput(event: { detail: { value: string } }): void;
  onCreate(): Promise<void>;
}

describe('staff creation actual Page through local TCP and PostgreSQL', () => {
  const runTag = `stafftcp-${randomUUID().slice(0, 8)}`;
  const campuses = Array.from({ length: 201 }, (_, index) => ({
    id: randomUUID(),
    code:
      index === 0
        ? runTag
        : `${runTag}-catalog-${String(index).padStart(3, '0')}`,
    name: index === 0 ? `${runTag}-campus` : `${runTag}-campus-${index}`,
  }));
  const campusId = campuses[0].id;
  const actors: Actor[] = [];
  const tokens = new Set<string>();
  const inputs: CreationInput[] = [];
  const pages: StaffPage[] = [];
  const calls: WireCall[] = [];
  const pending = new Set<Promise<void>>();
  const held: Array<() => void> = [];
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const toast = jest.fn();
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: Actor;
  let otherAdmin: Actor;
  let catalogCreated = false;
  let origin: string;
  let beforeCampusDelivery: ((page: number) => Promise<void>) | undefined;
  let delivery: WireCall['delivery'] = 'success';
  let completionFault: jest.SpyInstance | undefined;
  const readScopes: jest.SpyInstance[] = [];
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };

  const idle = async () => {
    for (let round = 0; round < 30; round++) {
      await Promise.all([...pending]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!pending.size) return;
    }
    throw new Error('Staff Page fixture transport did not become idle');
  };
  const release = () => {
    for (const deliver of held.splice(0)) deliver();
  };
  const wire = (options: WireOptions) => {
    const url = new URL(options.url);
    const token = options.header.Authorization?.replace(/^Bearer /, '');
    const read =
      options.method === 'GET' &&
      ['/management/campuses', '/management/staff-accounts'].includes(
        url.pathname,
      );
    const write =
      options.method === 'POST' &&
      url.pathname === '/management/staff-accounts' &&
      inputs.some((input) => isDeepStrictEqual(input, options.data)) &&
      Boolean(options.header['Idempotency-Key']) &&
      !url.search;
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      url.hash ||
      !tokens.has(token) ||
      (!read && !write)
    )
      throw new Error('Staff fixture request is outside its owned scope');
    const call: WireCall = {
      method: options.method,
      path: url.pathname,
      page: read ? Number(url.searchParams.get('page')) : undefined,
      request: write ? { ...(options.data as CreationInput) } : undefined,
      key: options.header['Idempotency-Key'],
      delivery: write ? delivery : 'success',
    };
    if (write) delivery = 'success';
    calls.push(call);
    const outgoing = read
      ? request(origin).get(url.pathname + url.search)
      : request(origin).post(url.pathname);
    const task = outgoing
      .set(options.header)
      .send(options.data as object | undefined)
      .timeout({ response: 10_000, deadline: 15_000 })
      .then(
        async (response) => {
          call.status = response.status;
          call.response = (response.body as { data?: unknown }).data;
          if (call.path === '/management/campuses') {
            const body = response.body as {
              data?: unknown[];
              meta?: { total: number };
            };
            call.rows = Array.isArray(body.data) ? body.data.length : undefined;
            call.total = body.meta?.total;
            await beforeCampusDelivery?.(call.page!);
          }
          const deliver = () =>
            options.success({
              statusCode: response.status,
              data: response.body as unknown,
            });
          if (call.delivery === 'held') held.push(deliver);
          else if (call.delivery === 'lost')
            options.fail({ errMsg: 'synthetic committed reply not delivered' });
          else deliver();
        },
        () =>
          options.fail({ errMsg: 'synthetic local TCP connection failure' }),
      )
      .finally(() => pending.delete(task));
    pending.add(task);
  };
  const post = (input: CreationInput, key: string, actor = admin) =>
    new Promise<WireReply>((resolve, reject) =>
      wire({
        url: origin + '/management/staff-accounts',
        method: 'POST',
        data: input,
        header: {
          Authorization: `Bearer ${actor.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
        },
        success: resolve,
        fail: () => reject(new Error('Fixture POST reply was not delivered')),
      }),
    );
  const fixtureInput = (
    roleCode: CreationInput['roleCode'] = 'PARTNER',
  ): CreationInput => {
    const input = {
      displayName: `${runTag}-account-${inputs.length}`,
      phone: `139${String(randomInt(100_000_000)).padStart(8, '0')}`,
      roleCode,
      campusId: ['HR', 'FINANCE'].includes(roleCode) ? null : campusId,
    };
    inputs.push(input);
    return input;
  };
  const actor = async (): Promise<Actor> => {
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}-actor-${actors.length}`,
        roles: { create: { roleCode: 'SUPER_ADMIN' } },
      },
    });
    const owner = { id: user.id, token: '' };
    actors.push(owner);
    owner.token = (
      await app.get(AuthService).issueSessionForUser(user.id)
    ).accessToken;
    tokens.add(owner.token);
    return owner;
  };
  const open = async (): Promise<StaffPage> => {
    runtime.accessToken = admin.token;
    let page: StaffPage | undefined;
    host.Page = (definition: StaffPage) => {
      page = {
        ...definition,
        data: structuredClone(definition.data),
        setData: (patch: object) => {
          const values = structuredClone(patch) as Record<string, unknown>;
          for (const [key, value] of Object.entries(values)) {
            const indexed = /^campuses\[(\d+)\]$/.exec(key);
            if (indexed)
              page!.data.campuses[Number(indexed[1])] = value as { id: string };
            else Object.assign(page!.data, { [key]: value });
          }
        },
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
    expect(['success', 'empty'].includes(page.data.viewState)).toBe(true);
    expect(page.campusesReady).toBe(true);
    expect(page.data.campuses.map((campus) => campus.id)).toEqual(
      campuses.map((campus) => campus.id),
    );
    return page;
  };
  const fill = (page: StaffPage, input: CreationInput) => {
    page.onToggleCreate();
    page.onNameInput({ detail: { value: input.displayName } });
    page.onPhoneInput({ detail: { value: input.phone } });
    page.onRoleChange({
      detail: {
        value: String(
          ['CAMPUS_MANAGER', 'PARTNER', 'HR', 'FINANCE'].indexOf(
            input.roleCode,
          ),
        ),
      },
    });
    if (input.campusId) {
      const index = page.data.campuses.findIndex(
        (campus) => campus.id === input.campusId,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      page.onCampusChange({ detail: { value: String(index) } });
    }
    page.onKeywordInput({ detail: { value: runTag } });
  };
  const writes = () => calls.filter((call) => call.method === 'POST');
  const facts = async (input: CreationInput) => {
    const rows = await prisma.user.findMany({
      where: { displayName: input.displayName },
      select: {
        id: true,
        status: true,
        staffPhone: true,
        roles: { select: { roleCode: true, campusId: true } },
      },
    });
    expect(rows.every((row) => row.staffPhone === `+86${input.phone}`)).toBe(
      true,
    );
    const users = rows.map(({ id, status, roles }) => ({ id, status, roles }));
    const audit = await prisma.auditLog.findMany({
      where: {
        actorUserId: { in: actors.map((owner) => owner.id) },
        action: 'STAFF_ACCOUNT_CREATE',
        resourceId: { in: users.map((user) => user.id) },
      },
      select: { id: true, actorUserId: true, campusId: true, resourceId: true },
    });
    return { users, audit };
  };
  const once = async (input: CreationInput) => {
    const result = await facts(input);
    expect(result.users).toHaveLength(1);
    expect(result.audit).toHaveLength(1);
    expect(result.users[0].roles).toEqual([
      { roleCode: input.roleCode, campusId: input.campusId },
    ]);
    expect(result.audit[0]).toMatchObject({
      actorUserId: admin.id,
      campusId: input.campusId,
      resourceId: result.users[0].id,
    });
    return result.users[0].id;
  };
  const clear = (page: StaffPage) => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      accounts: [],
      campuses: [],
      createOpen: false,
      createName: '',
      createPhone: '',
      keyword: '',
      submitting: false,
    });
  };

  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    process.stdout.write(
      `STAFF_CREATE_FIXTURE_INTENT ${JSON.stringify({
        runTag,
        campusIds: campuses.map((campus) => campus.id),
      })}\n`,
    );
    await prisma.campus.createMany({ data: campuses });
    catalogCreated = true;
    admin = await actor();
    otherAdmin = await actor();
    // Keep global administrative reads inside this run's synthetic fixtures.
    const workspace = app.get(ManagementWorkspaceService);
    const listCampuses = workspace.listCampuses.bind(workspace);
    readScopes.push(
      jest
        .spyOn(workspace, 'listCampuses')
        .mockImplementation((query) =>
          listCampuses({ ...query, query: runTag }),
        ),
    );
    const staff = app.get(StaffAccountManagementService);
    const listAccounts = staff.list.bind(staff);
    readScopes.push(
      jest
        .spyOn(staff, 'list')
        .mockImplementation((query) =>
          listAccounts({ ...query, query: runTag }),
        ),
    );
    process.stdout.write(
      `STAFF_CREATE_STARTED ${JSON.stringify({
        runTag,
        campusId,
        catalogSize: campuses.length,
        actorIds: actors.map((owner) => owner.id),
      })}\n`,
    );
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as { address(): AddressInfo }
    ).address();
    origin = `http://127.0.0.1:${address.port}`;
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: admin.token,
    };
    for (const key of ['Page', 'wx'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: wire,
      showToast: toast,
      showModal: () => {
        throw new Error('Creation verification must not mutate other accounts');
      },
    };
  });
  beforeEach(() => {
    calls.length = 0;
    toast.mockClear();
    beforeCampusDelivery = undefined;
  });
  afterEach(async () => {
    completionFault?.mockRestore();
    completionFault = undefined;
    for (const page of pages.splice(0)) page.onUnload();
    await idle();
    release();
    await idle();
    delivery = 'success';
    beforeCampusDelivery = undefined;
  });
  afterAll(async () => {
    try {
      if (prisma && (catalogCreated || actors.length || inputs.length)) {
        assertTarget();
        const accounts = await prisma.user.findMany({
          where: {
            AND: [
              { displayName: { in: inputs.map((input) => input.displayName) } },
              { displayName: { startsWith: `${runTag}-account-` } },
            ],
          },
          select: {
            id: true,
            displayName: true,
            status: true,
            roles: { select: { roleCode: true, campusId: true } },
          },
        });
        const ids = [
          ...actors.map((owner) => owner.id),
          ...accounts.map((u) => u.id),
        ];
        const disabled = await prisma.user.updateMany({
          where: {
            id: { in: ids },
            displayName: { startsWith: `${runTag}-` },
          },
          data: { status: 'DISABLED' },
        });
        expect(disabled.count).toBe(ids.length);
        const users = await prisma.user.findMany({
          where: { id: { in: ids } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            displayName: true,
            status: true,
            roles: { select: { roleCode: true, campusId: true } },
          },
        });
        expect(users.every((u) => u.status === 'DISABLED')).toBe(true);
        const catalog = await prisma.campus.findMany({
          where: { id: { in: campuses.map((campus) => campus.id) } },
          orderBy: [{ code: 'asc' }, { id: 'asc' }],
          select: { id: true, code: true, name: true },
        });
        const audit = await prisma.auditLog.findMany({
          where: { actorUserId: { in: actors.map((owner) => owner.id) } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            action: true,
            resourceId: true,
            actorUserId: true,
            campusId: true,
          },
        });
        const idempotency = await prisma.idempotencyRecord.findMany({
          where: { actorUserId: { in: actors.map((owner) => owner.id) } },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            route: true,
            status: true,
            actorUserId: true,
            responseStatus: true,
          },
        });
        expect(audit).toHaveLength(accounts.length);
        expect(idempotency).toHaveLength(accounts.length);
        process.stdout.write(
          `STAFF_CREATE_OWNERSHIP ${JSON.stringify({
            runTag,
            campusId,
            campuses: catalog,
            users,
            audit,
            idempotency,
            disposition: 'synthetic accounts disabled; all records retained',
          })}\n`,
        );
        expect(catalog).toEqual(campuses);
      }
    } finally {
      for (const scope of readScopes) scope.mockRestore();
      try {
        await app?.close();
        if (app && origin) {
          const listenerClosed = !(
            app.getHttpServer() as { listening: boolean }
          ).listening;
          expect(listenerClosed).toBe(true);
          process.stdout.write(
            `STAFF_CREATE_CLOSED ${JSON.stringify({
              runTag,
              port: Number(new URL(origin).port),
              listenerClosed,
            })}\n`,
          );
        }
      } finally {
        tokens.clear();
        for (const owner of actors) owner.token = '';
        if (runtime) runtime.accessToken = '';
        for (const [key, descriptor] of globals) {
          if (descriptor) Object.defineProperty(host, key, descriptor);
          else Reflect.deleteProperty(host, key);
        }
      }
    }
  });

  it.each(['CAMPUS_MANAGER', 'PARTNER', 'HR', 'FINANCE'] as const)(
    'replays a committed %s creation after the first reply is lost',
    async (role) => {
      const page = await open();
      const input = fixtureInput(role);
      fill(page, input);
      delivery = 'lost';
      await page.onCreate();
      const id = await once(input);
      expect(writes().map((call) => call.status)).toEqual([201]);
      expect(page.data.createName === input.displayName).toBe(true);
      page.onNameInput({ detail: { value: ` ${input.displayName} ` } });
      page.onPhoneInput({ detail: { value: ` ${input.phone} ` } });
      await page.onCreate();
      await idle();
      expect(writes().map((call) => call.status)).toEqual([201, 201]);
      expect(writes()[1].key).toBe(writes()[0].key);
      expect(
        isDeepStrictEqual(writes()[0].response, writes()[1].response),
      ).toBe(true);
      expect(await once(input)).toBe(id);
      expect(page.data.createOpen).toBe(false);
      expect(page.data.accounts.map((account) => account.id)).toContain(id);
      expect(toast).toHaveBeenLastCalledWith({
        title: '账号已创建',
        icon: 'success',
      });
    },
  );

  it.each([false, true])(
    'retains the first request when a held success arrives after hide (return first: %s)',
    async (returnFirst) => {
      const page = await open();
      const input = fixtureInput();
      fill(page, input);
      delivery = 'held';
      const creating = page.onCreate();
      await idle();
      const id = await once(input);
      page.onHide();
      if (returnFirst) {
        page.onShow();
        await idle();
        expect(page.data.submitting).toBe(true);
        await page.onCreate();
        expect(writes()).toHaveLength(1);
      }
      release();
      await creating;
      expect(toast).not.toHaveBeenCalled();
      expect(page.data.createName === input.displayName).toBe(true);
      if (!returnFirst) {
        page.onShow();
        await idle();
      }
      expect(page.data.submitting).toBe(false);
      await page.onCreate();
      expect(writes().map((call) => call.status)).toEqual([201, 201]);
      expect(writes()[1].key).toBe(writes()[0].key);
      expect(
        writes().every((call) => isDeepStrictEqual(call.request, input)),
      ).toBe(true);
      expect(
        isDeepStrictEqual(writes()[0].response, writes()[1].response),
      ).toBe(true);
      expect(await once(input)).toBe(id);
    },
  );

  it('sends one POST while a creation reply is still held', async () => {
    const page = await open();
    const input = fixtureInput();
    fill(page, input);
    delivery = 'held';
    const creating = page.onCreate();
    await idle();
    await Promise.all([page.onCreate(), page.onCreate()]);
    expect(writes()).toHaveLength(1);
    release();
    await creating;
    await once(input);
    expect(page.data.submitting).toBe(false);
  });

  it('rejects a second Page racing for the same phone without extra account or audit', async () => {
    const first = await open();
    const second = await open();
    const input = fixtureInput();
    fill(first, input);
    fill(second, input);
    await Promise.all([first.onCreate(), second.onCreate()]);
    expect(
      writes()
        .map((call) => call.status)
        .sort(),
    ).toEqual([201, 409]);
    expect(writes()[1].key === writes()[0].key).toBe(false);
    await once(input);
  });

  it('returns one committed account for two simultaneous HTTP requests with the same key', async () => {
    const input = fixtureInput();
    const key = randomUUID();
    const replies = await Promise.all([post(input, key), post(input, key)]);
    expect(replies.map((reply) => reply.statusCode)).toEqual([201, 201]);
    expect(
      isDeepStrictEqual(
        (replies[0].data as { data: unknown }).data,
        (replies[1].data as { data: unknown }).data,
      ),
    ).toBe(true);
    await once(input);
  });

  it('discards a definite duplicate rejection before another visible retry', async () => {
    const page = await open();
    const input = fixtureInput();
    fill(page, input);
    await page.onCreate();
    fill(page, input);
    await page.onCreate();
    await page.onCreate();
    expect(writes().map((call) => call.status)).toEqual([201, 409, 409]);
    expect(new Set(writes().map((call) => call.key)).size).toBe(3);
    await once(input);
  });

  it.each(['body', 'actor'] as const)(
    'rejects a committed key reused with a different %s',
    async (change) => {
      const input = fixtureInput();
      const key = randomUUID();
      expect((await post(input, key)).statusCode).toBe(201);
      let next = input;
      if (change === 'body') {
        next = { ...input, displayName: `${input.displayName}-changed` };
        inputs.push(next);
      }
      const reply = await post(
        next,
        key,
        change === 'actor' ? otherAdmin : admin,
      );
      expect(reply.statusCode).toBe(409);
      expect((reply.data as { code: string }).code).toBe(
        'IDEMPOTENCY_CONFLICT',
      );
      await once(input);
      if (change === 'body') expect((await facts(next)).users).toHaveLength(0);
    },
  );

  it.each([401, 403])(
    'clears the Page when the same administrator token is denied with %s before replay',
    async (status) => {
      const page = await open();
      const input = fixtureInput();
      fill(page, input);
      delivery = 'lost';
      await page.onCreate();
      await once(input);
      toast.mockClear();
      if (status === 401)
        await prisma.user.update({
          where: { id: admin.id },
          data: { status: 'DISABLED' },
        });
      else
        await prisma.userRole.updateMany({
          where: { userId: admin.id, roleCode: 'SUPER_ADMIN', campusId: null },
          data: { roleCode: 'HR' },
        });
      try {
        await page.onCreate();
        expect(writes().map((call) => call.status)).toEqual([201, status]);
        expect(writes()[1].key).toBe(writes()[0].key);
        clear(page);
        expect(toast).not.toHaveBeenCalled();
        await once(input);
      } finally {
        await prisma.user.update({
          where: { id: admin.id },
          data: { status: 'ACTIVE' },
        });
        await prisma.userRole.updateMany({
          where: { userId: admin.id, roleCode: 'HR', campusId: null },
          data: { roleCode: 'SUPER_ADMIN' },
        });
      }
    },
  );

  it('rolls back user, role, audit and claim on completion failure, then retries the original key', async () => {
    const page = await open();
    const input = fixtureInput();
    fill(page, input);
    const idempotency = app.get(IdempotencyService);
    const complete = idempotency.complete.bind(idempotency);
    let observedTransaction = false;
    let failedKey: string | undefined;
    completionFault = jest
      .spyOn(idempotency, 'complete')
      .mockImplementation(async (transaction, attempt) => {
        if (!failedKey && attempt.route === '/management/staff-accounts') {
          failedKey = attempt.key;
          const created = await transaction.user.findFirst({
            where: { displayName: input.displayName },
            select: { id: true, roles: { select: { roleCode: true } } },
          });
          const auditCount = await transaction.auditLog.count({
            where: { resourceId: created?.id, action: 'STAFF_ACCOUNT_CREATE' },
          });
          observedTransaction = created?.roles.length === 1 && auditCount === 1;
          throw new Error('synthetic failure after account and audit writes');
        }
        return complete(transaction, attempt);
      });
    await page.onCreate();
    expect(observedTransaction).toBe(true);
    expect(writes().map((call) => call.status)).toEqual([500]);
    expect((await facts(input)).users).toHaveLength(0);
    expect(
      await prisma.idempotencyRecord.count({
        where: { key: failedKey, route: '/management/staff-accounts' },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: {
          actorUserId: admin.id,
          action: 'STAFF_ACCOUNT_CREATE',
          details: { path: ['displayName'], equals: input.displayName },
        },
      }),
    ).toBe(0);
    await page.onCreate();
    expect(writes().map((call) => call.status)).toEqual([500, 201]);
    expect(writes()[1].key).toBe(failedKey);
    await once(input);
  });

  it.each([100, 200])(
    'creates and replays a partner selected at campus index %s through all real pages',
    async (index) => {
      const page = await open();
      const reads = calls.filter(
        (call) => call.path === '/management/campuses',
      );
      expect(reads.map((call) => call.page)).toEqual([1, 2, 3]);
      expect(reads.map((call) => call.status)).toEqual([200, 200, 200]);
      expect(reads.map((call) => call.rows)).toEqual([100, 100, 1]);
      expect(reads.map((call) => call.total)).toEqual([201, 201, 201]);
      const input = fixtureInput();
      input.campusId = campuses[index].id;
      fill(page, input);
      expect(page.data.createCampusIndex).toBe(index);
      delivery = 'lost';
      await page.onCreate();
      const id = await once(input);
      await page.onCreate();
      expect(writes().map((call) => call.status)).toEqual([201, 201]);
      expect(writes()[1].key).toBe(writes()[0].key);
      expect(
        writes().every((call) => isDeepStrictEqual(call.request, input)),
      ).toBe(true);
      expect(
        isDeepStrictEqual(writes()[0].response, writes()[1].response),
      ).toBe(true);
      expect(await once(input)).toBe(id);
      expect(
        page.data.accounts.find((account) => account.id === id),
      ).toMatchObject({
        id,
        campusId: campuses[index].id,
        roleCode: 'PARTNER',
      });
      process.stdout.write(
        `STAFF_CAMPUS_CATALOG_FLOW ${JSON.stringify({
          runTag,
          catalogSize: campuses.length,
          selectedIndex: index,
          selectedCampusId: campuses[index].id,
          pages: reads.map((call) => call.page),
          rows: reads.map((call) => call.rows),
          createdAccountId: id,
          replayedOriginalKey: true,
        })}\n`,
      );
    },
  );

  it('keeps the selected campus ID when the real database ordering moves it to the final page', async () => {
    const page = await open();
    page.onCampusChange({ detail: { value: '100' } });
    const selected = campuses[100];
    try {
      await prisma.campus.update({
        where: { id: selected.id },
        data: { code: `${runTag}-zz-selected` },
      });
      await page.load();
      expect(page.data.createCampusIndex).toBe(200);
      expect(page.data.campuses[page.data.createCampusIndex].id).toBe(
        selected.id,
      );
      process.stdout.write(
        `STAFF_CAMPUS_CATALOG_REORDER ${JSON.stringify({
          runTag,
          selectedCampusId: selected.id,
          oldIndex: 100,
          newIndex: page.data.createCampusIndex,
          preserved: true,
        })}\n`,
      );
    } finally {
      await prisma.campus.update({
        where: { id: selected.id },
        data: { code: selected.code },
      });
    }
  });

  it.each([401, 403])(
    'stops real campus pagination and clears the form when access changes before page two (%s)',
    async (status) => {
      const page = await open();
      page.onNameInput({ detail: { value: `${runTag}-unsubmitted` } });
      page.onPhoneInput({ detail: { value: '13900000000' } });
      const start = calls.length;
      beforeCampusDelivery = async (requestedPage) => {
        if (requestedPage !== 1) return;
        beforeCampusDelivery = undefined;
        if (status === 401)
          await prisma.user.update({
            where: { id: admin.id },
            data: { status: 'DISABLED' },
          });
        else
          await prisma.userRole.updateMany({
            where: {
              userId: admin.id,
              roleCode: 'SUPER_ADMIN',
              campusId: null,
            },
            data: { roleCode: 'HR' },
          });
      };
      try {
        await page.load();
        const reads = calls.slice(start);
        expect(reads.map((call) => call.page)).toEqual([1, 2]);
        expect(reads.map((call) => call.status)).toEqual([200, status]);
        expect(
          reads.every((call) => call.path === '/management/campuses'),
        ).toBe(true);
        expect(page.campusesReady).toBe(false);
        clear(page);
        process.stdout.write(
          `STAFF_CAMPUS_CATALOG_DENIED ${JSON.stringify({
            runTag,
            page: 2,
            status,
            privateStateCleared: true,
            laterRequests: 0,
          })}\n`,
        );
      } finally {
        beforeCampusDelivery = undefined;
        await prisma.user.update({
          where: { id: admin.id },
          data: { status: 'ACTIVE' },
        });
        await prisma.userRole.updateMany({
          where: { userId: admin.id, roleCode: 'HR', campusId: null },
          data: { roleCode: 'SUPER_ADMIN' },
        });
      }
    },
  );
});
