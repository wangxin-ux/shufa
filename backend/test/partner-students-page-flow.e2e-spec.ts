import { createHash, randomUUID } from 'node:crypto';
import { createConnection, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
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
interface StudentsPage {
  data: {
    viewState: string;
    items: Array<{ id: string; displayName: string }>;
    page: number;
    total: number;
    hasMore: boolean;
    loadingMore: boolean;
    paginationError: string;
    expandedId: string;
    expandedState: string;
    expandedDetail: unknown;
    expandedPhotoRetrying: boolean;
    subjectId: string;
    subjectOptions: Array<{ value: string; label: string }>;
    subjectError: string;
  };
  setData: jest.Mock;
  pendingResetRequest?: Promise<void>;
  subjectPending?: Promise<void>;
  expansionRequests: Map<string, Promise<void>>;
  expansionCache: Map<string, unknown>;
  navigating: boolean;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetry(): void;
  onPullDownRefresh(): void;
  loadStudents(reset: boolean): Promise<void>;
  onLoadMore(): void;
  onRetryMore(): void;
  onSearchInput(event: { detail: { value: string } }): void;
  onBalanceChange(event: { detail: { value: string } }): void;
  onSubjectChange(event: { detail: { value: string } }): void;
  loadSubjects(): Promise<void>;
  onStudentToggle(event: { currentTarget: { dataset: { id: string } } }): void;
  onStudentMore(event: { currentTarget: { dataset: { id: string } } }): void;
  onLogin(): void;
}
describe('partner students owner protection through isolated TCP', () => {
  const runTag = `psowner-${randomUUID().slice(0, 8)}`;
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const users: string[] = [],
    campuses: string[] = [],
    studentIds: string[] = [],
    subjectIds: string[] = [],
    packageIds: string[] = [];
  const pages: StudentsPage[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number;
  let transport: CampaignPageTransport;
  let owner: { id: string; token: string },
    other: { id: string; token: string };
  let runtime: { dataDriver: 'api'; apiBaseUrl: string; accessToken: string };
  let fixtureSnapshot: unknown;
  const snapshot = () =>
    prisma.student.findMany({
      where: { campusId: { in: campuses } },
      orderBy: { id: 'asc' },
      include: { coursePackages: { orderBy: { id: 'asc' } } },
    });
  const event = (id: string) => ({ currentTarget: { dataset: { id } } });
  const native = () =>
    host.wx as {
      request: CampaignPageTransport['request'];
      navigateTo: jest.Mock;
      reLaunch: jest.Mock;
      showToast: jest.Mock;
      stopPullDownRefresh: jest.Mock;
    };
  const settle = async (page: StudentsPage) => {
    for (let index = 0; index < 3; index++) {
      await Promise.all([
        page.pendingResetRequest,
        page.subjectPending,
        ...page.expansionRequests.values(),
      ]);
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async () => {
    const page = captureCampaignPage<StudentsPage>('students');
    pages.push(page);
    page.onLoad();
    page.onShow();
    await settle(page);
    return page;
  };
  const cleared = (page: StudentsPage) => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      items: [],
      page: 0,
      total: 0,
      hasMore: false,
      loadingMore: false,
      paginationError: '',
      expandedId: '',
      expandedState: 'idle',
      expandedDetail: null,
      expandedPhotoRetrying: false,
      subjectId: '',
      subjectOptions: [],
      subjectError: '',
    });
    expect(page.expansionRequests.size).toBe(0);
    expect(page.expansionCache.size).toBe(0);
    expect(page.pendingResetRequest).toBeUndefined();
    expect(page.navigating).toBe(false);
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const actor = async (suffix: string, count: number) => {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${suffix}`, name: `${runTag}合成校区` },
      });
      campuses.push(campus.id);
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      users.push(user.id);
      for (let index = 1; index <= count; index++) {
        studentIds.push(
          (
            await prisma.student.create({
              data: {
                campusId: campus.id,
                displayName:
                  suffix === 'owner'
                    ? `合成学员${String(index).padStart(2, '0')}`
                    : '另一校区合成学员',
              },
            })
          ).id,
        );
      }
      return {
        id: user.id,
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    owner = await actor('owner', 22);
    other = await actor('other', 1);
    for (const [campusId, name, isActive] of [
      [campuses[0], `${runTag}书法`, true],
      [campuses[0], `${runTag}归档口才`, false],
      [campuses[1], `${runTag}其他校区书法`, true],
    ] as const) {
      subjectIds.push(
        (
          await prisma.campusSubject.create({
            data: { campusId, name, isActive },
          })
        ).id,
      );
    }
    const addPackage = async (studentId: string, subjectId: string | null) => {
      packageIds.push(
        (
          await prisma.coursePackage.create({
            data: {
              campusId: campuses[0],
              studentId,
              subjectId,
              name: `${runTag}有效零课时包`,
              validFrom: new Date('2020-01-01T00:00:00Z'),
            },
          })
        ).id,
      );
    };
    for (const studentId of studentIds.slice(0, 21)) {
      await addPackage(studentId, subjectIds[0]);
    }
    await addPackage(studentIds[0], subjectIds[0]);
    await addPackage(studentIds[0], subjectIds[1]);
    await addPackage(studentIds[0], null);
    fixtureSnapshot = await snapshot();
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: `http://127.0.0.1:${port}`,
      accessToken: owner.token,
    };
    transport = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token, other.token]),
      false,
      false,
      false,
      false,
      false,
      true,
    );
    for (const key of ['wx', 'Page'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    const storage = new Map<string, unknown>();
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : storage.get(key),
      setStorageSync: (key: string, value: unknown) => {
        if (key === 'education.runtime') runtime = value as typeof runtime;
        else storage.set(key, value);
      },
      request: transport.request,
      navigateTo: jest.fn(),
      reLaunch: jest.fn(),
      showToast: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
  });
  afterAll(async () => {
    try {
      for (const page of pages) page.onUnload();
      await transport?.drain();
      assertPartnerPdfTestTarget(process.env);
      const disabled = await prisma.user.updateMany({
        where: { id: { in: users }, displayName: { startsWith: runTag } },
        data: { status: 'DISABLED' },
      });
      expect(disabled.count).toBe(users.length);
      expect(await snapshot()).toEqual(fixtureSnapshot);
      const stored = await prisma.user.findMany({
        where: { id: { in: users } },
        select: { status: true },
      });
      expect(stored.every((row) => row.status === 'DISABLED')).toBe(true);
      const roles = await prisma.userRole.findMany({
        where: { userId: { in: users } },
        select: { userId: true, roleCode: true, campusId: true },
        orderBy: { userId: 'asc' },
      });
      expect(roles).toEqual(
        users
          .map((userId, index) => ({
            userId,
            roleCode: 'PARTNER',
            campusId: campuses[index],
          }))
          .sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      const where = { campusId: { in: campuses } };
      const zeroSideEffects = {
        ledger: await prisma.lessonLedgerEntry.count({ where }),
        orders: await prisma.enrollmentOrder.count({ where }),
        receipts: await prisma.financeReceipt.count({ where }),
        partnerEarnings: await prisma.partnerEarningEntry.count({ where }),
        teacherEarnings: await prisma.teacherEarningEntry.count({ where }),
        withdrawals: await prisma.withdrawal.count({ where }),
        campaigns: await prisma.campaign.count({ where }),
      };
      expect(Object.values(zeroSideEffects).every((count) => count === 0)).toBe(
        true,
      );
      expect(await prisma.coursePackage.count({ where })).toBe(
        packageIds.length,
      );
      expect(await prisma.campusSubject.count({ where })).toBe(
        subjectIds.length,
      );
      expect(await prisma.student.count({ where })).toBe(23);
      process.stdout.write(
        `PARTNER_STUDENTS_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds: users,
          campusIds: campuses,
          studentIds,
          subjectIds,
          packageIds,
          disabled: true,
          immutableFixtures: true,
          fixtureSha256: createHash('sha256')
            .update(JSON.stringify(fixtureSnapshot))
            .digest('hex'),
          zeroSideEffects,
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
        await new Promise<void>((resolve, reject) => {
          const socket = createConnection({ host: '127.0.0.1', port });
          socket.setTimeout(1500);
          socket.once('connect', () => {
            socket.destroy();
            reject(Error('Temporary listener remains open'));
          });
          socket.once('timeout', () => {
            socket.destroy();
            reject(Error('Temporary listener closure unconfirmed'));
          });
          socket.once('error', (error: NodeJS.ErrnoException) => {
            socket.destroy();
            if (error.code === 'ECONNREFUSED') resolve();
            else reject(error);
          });
        });
        process.stdout.write(
          `PARTNER_STUDENTS_SERVER_CLOSED ${JSON.stringify({ runTag, port, refused: true })}\n`,
        );
      }
    }
  });
  it('AND-filters the actual page by subject, balance and name, preserving paging, expansion and archived choices', async () => {
    const page = await open();
    expect(page.data.subjectError).toBe('');
    const choose = async (subjectId: string) => {
      const index = page.data.subjectOptions.findIndex(
        (item) => item.value === subjectId,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      page.onSubjectChange({ detail: { value: String(index) } });
      await settle(page);
    };
    expect(
      page.data.subjectOptions.find((item) => item.value === subjectIds[1])
        ?.label,
    ).toContain('已归档');
    expect(
      page.data.subjectOptions.some((item) => item.value === subjectIds[2]),
    ).toBe(false);
    await choose(subjectIds[0]);
    expect(page.data).toMatchObject({ total: 21, page: 1, hasMore: true });
    expect(page.data.items).toHaveLength(20);
    await page.loadStudents(false);
    expect(page.data).toMatchObject({ total: 21, page: 2, hasMore: false });
    expect(new Set(page.data.items.map((item) => item.id)).size).toBe(21);
    page.onStudentToggle(event(studentIds[0]));
    await settle(page);
    expect(page.data.expandedState).toBe('ready');
    page.onSearchInput({ detail: { value: ' 合成学员01 ' } });
    page.onBalanceChange({ detail: { value: '1' } });
    await settle(page);
    expect(page.data).toMatchObject({
      total: 1,
      page: 1,
      expandedState: 'ready',
    });
    expect(page.data.items[0].id).toBe(studentIds[0]);
    await choose(subjectIds[1]);
    expect(page.data.total).toBe(1);
    expect(page.data.expandedState).toBe('ready');
    await choose('UNCLASSIFIED');
    expect(page.data.items.map((item) => item.id)).toEqual([studentIds[0]]);
    page.onSearchInput({ detail: { value: '' } });
    page.onBalanceChange({ detail: { value: '0' } });
    await settle(page);
    expect(page.data.total).toBe(2);
    await choose('');
    expect(page.data).toMatchObject({ total: 22, page: 1, hasMore: true });
    page.onUnload();
  });
  it('reads 20 then 22 unique students in owner campus and reuses only the current expansion cache', async () => {
    const page = await open();
    expect(page.data).toMatchObject({
      viewState: 'ready',
      page: 1,
      total: 22,
      hasMore: true,
    });
    expect(page.data.items).toHaveLength(20);
    const first = page.data.items[0].id;
    page.onStudentToggle(event(first));
    await settle(page);
    expect(page.data.expandedState).toBe('ready');
    const reads = transport.calls.length;
    page.onStudentToggle(event(first));
    page.onStudentToggle(event(first));
    await settle(page);
    expect(transport.calls).toHaveLength(reads);
    await page.loadStudents(false);
    expect(page.data).toMatchObject({ page: 2, total: 22, hasMore: false });
    expect(new Set(page.data.items.map((item) => item.id))).toEqual(
      new Set(studentIds.slice(0, 22)),
    );
    expect(page.data.expandedId).toBe(first);
    page.onUnload();
  });
  it('combines name and zero balance filters, renews a matching expansion, and clears a missing selection', async () => {
    const page = await open();
    page.onStudentToggle(event(studentIds[1]));
    await settle(page);
    const reads = transport.calls.length;
    page.onSearchInput({ detail: { value: ' 学员02 ' } });
    page.onBalanceChange({ detail: { value: '1' } });
    await settle(page);
    expect(page.data).toMatchObject({
      total: 1,
      expandedId: studentIds[1],
      expandedState: 'ready',
    });
    expect(page.data.items.map((row) => row.id)).toEqual([studentIds[1]]);
    expect(transport.calls.slice(reads).map((row) => row.path)).toEqual([
      '/partners/me/students',
      `/partners/me/students/${studentIds[1]}`,
    ]);
    page.onBalanceChange({ detail: { value: '3' } });
    await settle(page);
    expect(page.data).toMatchObject({
      viewState: 'empty',
      total: 0,
      items: [],
      expandedDetail: null,
      expandedId: '',
    });
    expect(page.expansionCache.size).toBe(0);
    page.onUnload();
  });
  it('clears on account replacement without fetching replacement data until a fresh page opens', async () => {
    const page = await open();
    const reads = transport.calls.length;
    try {
      runtime.accessToken = other.token;
      page.onShow();
      page.onRetry();
      page.onLoadMore();
      await settle(page);
      cleared(page);
      expect(transport.calls).toHaveLength(reads);
      const fresh = await open();
      expect(fresh.data.items.map((row) => row.id)).toEqual([studentIds[22]]);
      fresh.onUnload();
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it.each(['list', 'expanded'] as const)(
    'discards a held actual %s HTTP 200 after token replacement',
    async (source) => {
      const page = await open();
      transport.deliverNext('held');
      const reading =
        source === 'list'
          ? page.loadStudents(false)
          : (page.onStudentToggle(event(studentIds[0])),
            page.expansionRequests.get(studentIds[0]));
      await transport.idle();
      expect(transport.calls.at(-1)).toMatchObject({
        status: 200,
        delivery: 'held',
      });
      try {
        runtime.accessToken = other.token;
        transport.release();
        await reading;
        cleared(page);
      } finally {
        runtime.accessToken = owner.token;
        transport.release();
        page.onUnload();
      }
    },
  );
  it('ignores a hidden first-page reply then reloads the same owner on return', async () => {
    const page = await open();
    transport.deliverNext('held');
    page.onRetry();
    const reading = page.pendingResetRequest;
    await transport.idle();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    transport.release();
    await reading;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow();
    await settle(page);
    expect(page.data).toMatchObject({ viewState: 'ready', total: 22, page: 1 });
    page.onUnload();
  });
  it('retains rows on a lost next-page GET and retries page two', async () => {
    const page = await open();
    transport.deliverNext('lost');
    await page.loadStudents(false);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.items).toHaveLength(20);
    expect(page.data.paginationError).not.toBe('');
    await page.loadStudents(false);
    expect(page.data).toMatchObject({
      page: 2,
      total: 22,
      paginationError: '',
      loadingMore: false,
    });
    expect(page.data.items).toHaveLength(22);
    page.onUnload();
  });
  it('does not stop a new pull refresh when a hidden old actual HTTP 200 arrives', async () => {
    const page = await open();
    transport.deliverNext('held');
    page.onPullDownRefresh();
    const old = page.pendingResetRequest;
    await transport.idle();
    page.onHide();
    transport.deliverNext('held');
    page.onShow();
    page.onPullDownRefresh();
    const fresh = page.pendingResetRequest;
    await transport.idle();
    const stops = native().stopPullDownRefresh.mock.calls.length;
    transport.release();
    await Promise.all([old, fresh]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops + 1);
    expect(page.data).toMatchObject({ viewState: 'ready', total: 22 });
    page.onUnload();
  });
  it('cannot read another campus student or override its list scope through query parameters', async () => {
    const read = (route: string) =>
      new Promise<{ statusCode: number; data: unknown }>((resolve, reject) => {
        transport.request({
          url: `${runtime.apiBaseUrl}${route}`,
          method: 'GET',
          header: { Authorization: `Bearer ${owner.token}` },
          success: resolve,
          fail: reject,
        });
      });
    expect(
      (await read(`/partners/me/students/${studentIds[22]}`)).statusCode,
    ).toBe(404);
    expect(
      (await read(`/partners/me/students?campusId=${campuses[1]}`)).statusCode,
    ).toBe(400);
    const actual = await read('/partners/me/students?page=2&pageSize=20');
    expect(actual.statusCode).toBe(200);
    const envelope = actual.data as {
      data: Array<{ id: string }>;
      meta: { total: number };
    };
    expect(envelope.meta.total).toBe(22);
    expect(envelope.data).toHaveLength(2);
    expect(
      envelope.data.every((row) => studentIds.slice(0, 22).includes(row.id)),
    ).toBe(true);
  });
  it.each(
    ['list', 'expanded', 'subjects'].flatMap((source) =>
      [401, 403].map((code) => ({ source, code })),
    ),
  )(
    'clears $source actual HTTP $code immediately while a successful sibling reply is held',
    async ({ source, code }) => {
      const page = await open();
      transport.deliverNext('held');
      const sibling =
        source === 'list'
          ? (page.onStudentToggle(event(studentIds[0])),
            page.expansionRequests.get(studentIds[0]))
          : page.loadStudents(false);
      await transport.idle();
      expect(transport.calls.at(-1)).toMatchObject({
        status: 200,
        delivery: 'held',
      });
      const role = { userId: owner.id, campusId: campuses[0] };
      try {
        if (code === 401) {
          expect(
            (
              await prisma.user.updateMany({
                where: { id: owner.id, displayName: `${runTag}-owner` },
                data: { status: 'DISABLED' },
              })
            ).count,
          ).toBe(1);
        } else {
          expect(
            (
              await prisma.userRole.updateMany({
                where: { ...role, roleCode: 'PARTNER' },
                data: { roleCode: 'TEACHER' },
              })
            ).count,
          ).toBe(1);
        }
        if (source === 'list') await page.loadStudents(false);
        else if (source === 'subjects') await page.loadSubjects();
        else {
          page.onStudentToggle(event(studentIds[0]));
          await Promise.all([...page.expansionRequests.values()]);
        }
        await transport.idle();
        expect(transport.calls.at(-1)).toMatchObject({ status: code });
        cleared(page);
        const writes = page.setData.mock.calls.length;
        transport.release();
        await sibling;
        expect(page.setData).toHaveBeenCalledTimes(writes);
        process.stdout.write(
          `PARTNER_STUDENTS_EARLY_DENIAL ${JSON.stringify({
            runTag,
            source,
            code,
            clearedBeforeSibling: true,
            lateResponseIgnored: true,
          })}\n`,
        );
      } finally {
        transport.release();
        await sibling;
        if (code === 401) {
          expect(
            (
              await prisma.user.updateMany({
                where: { id: owner.id, displayName: `${runTag}-owner` },
                data: { status: 'ACTIVE' },
              })
            ).count,
          ).toBe(1);
        } else {
          expect(
            (
              await prisma.userRole.updateMany({
                where: { ...role, roleCode: 'TEACHER' },
                data: { roleCode: 'PARTNER' },
              })
            ).count,
          ).toBe(1);
        }
        page.onUnload();
      }
    },
  );
  it('stops after explicit logout and failed navigation even if a held 200 arrives', async () => {
    const page = await open();
    transport.deliverNext('held');
    const reading = page.loadStudents(false);
    await transport.idle();
    native().reLaunch.mockImplementationOnce((options: { fail?: () => void }) =>
      options.fail?.(),
    );
    try {
      page.onLogin();
      expect(runtime.accessToken).toBe('');
      cleared(page);
      transport.release();
      await reading;
      const reads = transport.calls.length;
      page.onRetry();
      page.onShow();
      page.onLoadMore();
      await settle(page);
      cleared(page);
      expect(transport.calls).toHaveLength(reads);
    } finally {
      runtime.accessToken = owner.token;
      transport.release();
      page.onUnload();
    }
  });
  it('clears changed identity in the current native navigation callback without a stale toast', async () => {
    const page = await open();
    page.onStudentToggle(event(studentIds[0]));
    await settle(page);
    page.onStudentMore(event(studentIds[0]));
    const calls = native().navigateTo.mock.calls as unknown[][];
    const options = calls.at(-1)![0] as { fail: () => void };
    const toasts = native().showToast.mock.calls.length;
    try {
      runtime.accessToken = other.token;
      options.fail();
      cleared(page);
      expect(native().showToast).toHaveBeenCalledTimes(toasts);
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it('keeps the default transport closed to lists and the explicit flag closed to writes or growth', () => {
    const denied = (
      driver: CampaignPageTransport,
      route: string,
      method: 'GET' | 'POST' = 'GET',
    ) => {
      expect(() =>
        driver.request({
          url: `${runtime.apiBaseUrl}${route}`,
          method,
          header: { Authorization: `Bearer ${owner.token}` },
          success: jest.fn(),
          fail: jest.fn(),
        }),
      ).toThrow('outside its scope');
    };
    const restricted = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token]),
    );
    denied(restricted, '/partners/me/students');
    denied(restricted, '/partners/me/subjects');
    denied(restricted, `/partners/me/students/${studentIds[0]}`);
    denied(transport, '/partners/me/students', 'POST');
    denied(transport, `/partners/me/students/${studentIds[0]}/growth`);
    denied(transport, '/partners/me/profile');
  });
});
