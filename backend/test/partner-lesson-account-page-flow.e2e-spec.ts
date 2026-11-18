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
interface AccountPage {
  data: {
    viewState: string;
    summary: { totalBalanceLabel: string } | null;
    items: Array<{ id: string; studentName: string; typeLabel: string }>;
    page: number;
    total: number;
    hasMore: boolean;
    refreshError: string;
    loadingMore: boolean;
    ledgerLoading: boolean;
  };
  setData: jest.Mock;
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetry(): void;
  onLoadMore(): void;
  onLedgerReachBottom(): void;
  onEntryTypeChange(event: { detail: { value: string } }): void;
  onEarningsTap(): void;
}
describe('partner lesson account session protection through isolated TCP', () => {
  const runTag = `placcount-${randomUUID().slice(0, 8)}`;
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const users: string[] = [],
    campuses: string[] = [],
    students: string[] = [];
  const packages: string[] = [],
    ledger: string[] = [],
    pages: AccountPage[] = [];
  let app: INestApplication, prisma: PrismaService, server: Server;
  let transport: CampaignPageTransport, port: number;
  let owner: { id: string; token: string },
    other: { id: string; token: string };
  let runtime: { dataDriver: 'api'; apiBaseUrl: string; accessToken: string };
  let fixtureSnapshot: unknown;
  const snapshot = async () => ({
    packages: await prisma.coursePackage.findMany({
      where: { id: { in: packages } },
      orderBy: { id: 'asc' },
    }),
    ledger: await prisma.lessonLedgerEntry.findMany({
      where: { id: { in: ledger } },
      orderBy: { id: 'asc' },
    }),
  });
  const settle = async (page: AccountPage) => {
    for (let index = 0; index < 3; index++) {
      await page.pendingRequest;
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async () => {
    const page = captureCampaignPage<AccountPage>('lesson-account');
    pages.push(page);
    page.onLoad();
    page.onShow();
    await settle(page);
    return page;
  };
  const native = () =>
    host.wx as {
      request: CampaignPageTransport['request'];
      navigateTo: jest.Mock;
    };
  const hold = (path: string, delivery: 'held' | 'lost' = 'held') => {
    const original = native().request;
    let assigned = false;
    native().request = (options) => {
      if (!assigned && new URL(options.url).pathname === path) {
        assigned = true;
        transport.deliverNext(delivery);
      }
      return original(options);
    };
    return () => {
      native().request = original;
    };
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const actor = async (suffix: string) => {
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
      const student = await prisma.student.create({
        data: { campusId: campus.id, displayName: `${runTag}-${suffix}学员` },
      });
      students.push(student.id);
      const count = suffix === 'owner' ? 21 : 7;
      const coursePackage = await prisma.coursePackage.create({
        data: {
          campusId: campus.id,
          studentId: student.id,
          name: `${runTag}-${suffix}课包`,
          validFrom: new Date('2020-01-01T00:00:00Z'),
          mainBalanceUnits: count * 100,
          giftBalanceUnits: suffix === 'owner' ? 100 : 0,
        },
      });
      packages.push(coursePackage.id);
      for (let index = 0; index < (suffix === 'owner' ? 22 : 1); index++) {
        const gift = index === 21;
        const row = await prisma.lessonLedgerEntry.create({
          data: {
            campusId: campus.id,
            studentId: student.id,
            coursePackageId: coursePackage.id,
            actorUserId: user.id,
            entryType: gift ? 'GRANT' : 'ADJUSTMENT',
            bucket: gift ? 'GIFT' : 'MAIN',
            deltaUnits: suffix === 'owner' ? 100 : 700,
            balanceBeforeUnits: gift ? 0 : index * 100,
            balanceAfterUnits: gift
              ? 100
              : (index + 1) * (suffix === 'owner' ? 100 : 700),
            idempotencyKey: `${runTag}-${suffix}-${index}`,
            reason: '隔离合成读取夹具',
            createdAt: new Date(Date.UTC(2026, 9, 1, 0, index)),
          },
        });
        ledger.push(row.id);
      }
      return {
        id: user.id,
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    owner = await actor('owner');
    other = await actor('other');
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
      true,
    );
    for (const key of ['wx', 'Page'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: transport.request,
      navigateTo: jest.fn(),
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
      expect(
        (
          await prisma.user.findMany({
            where: { id: { in: users } },
            select: { status: true },
          })
        ).every((user) => user.status === 'DISABLED'),
      ).toBe(true);
      expect(await snapshot()).toEqual(fixtureSnapshot);
      expect(
        await prisma.userRole.findMany({
          where: { userId: { in: users } },
          orderBy: { userId: 'asc' },
          select: { userId: true, roleCode: true, campusId: true },
        }),
      ).toEqual(
        users
          .map((id, index) => ({
            userId: id,
            roleCode: 'PARTNER',
            campusId: campuses[index],
          }))
          .sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      const where = { campusId: { in: campuses } };
      expect(await prisma.coursePackage.count({ where })).toBe(packages.length);
      expect(await prisma.lessonLedgerEntry.count({ where })).toBe(
        ledger.length,
      );
      const zeroSideEffects = {
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
      process.stdout.write(
        `PARTNER_LESSON_ACCOUNT_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds: users,
          campusIds: campuses,
          studentIds: students,
          packageIds: packages,
          ledgerIds: ledger,
          immutableFixtures: true,
          fixtureSha256: createHash('sha256')
            .update(JSON.stringify(fixtureSnapshot))
            .digest('hex'),
          disabled: true,
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
          `PARTNER_LESSON_ACCOUNT_SERVER_CLOSED ${JSON.stringify({ runTag, port, refused: true })}\n`,
        );
      }
    }
  });
  it('reads actual scoped balances, 20-to-22 pagination and one grant without changing the campus total', async () => {
    const page = await open();
    expect(page.data).toMatchObject({
      viewState: 'ready',
      summary: { totalBalanceLabel: '22' },
      page: 1,
      total: 22,
      hasMore: true,
    });
    expect(page.data.items).toHaveLength(20);
    page.onLoadMore();
    page.onLedgerReachBottom();
    await settle(page);
    expect(page.data.page).toBe(2);
    expect(page.data.hasMore).toBe(false);
    expect(page.data.items).toHaveLength(22);
    expect(new Set(page.data.items.map((item) => item.id)).size).toBe(22);
    expect(
      page.data.items.every(
        (item) => item.studentName === `${runTag}-owner学员`,
      ),
    ).toBe(true);
    expect(page.data.items.some((item) => item.id === ledger[22])).toBe(false);
    page.onEntryTypeChange({ detail: { value: '1' } });
    await settle(page);
    expect(page.data).toMatchObject({
      page: 1,
      total: 1,
      hasMore: false,
      summary: { totalBalanceLabel: '22' },
    });
    expect(page.data.items).toMatchObject([
      { id: ledger[21], typeLabel: '课时发放' },
    ]);
    page.onUnload();
  });
  it('clears loaded data on identity replacement, avoids replacement requests and reads its own campus on a fresh page', async () => {
    const page = await open();
    const start = transport.calls.length;
    try {
      runtime.accessToken = other.token;
      page.onShow();
      page.onRetry();
      page.onLoadMore();
      page.onLedgerReachBottom();
      page.onEntryTypeChange({ detail: { value: '2' } });
      page.onEarningsTap();
      await settle(page);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        summary: null,
        items: [],
        page: 0,
        total: 0,
      });
      expect(transport.calls).toHaveLength(start);
      const fresh = await open();
      expect(fresh.data.summary?.totalBalanceLabel).toBe('7');
      expect(fresh.data.items).toMatchObject([
        { id: ledger[22], studentName: `${runTag}-other学员` },
      ]);
      fresh.onUnload();
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it('cancels queued readers before sending the replacement token', async () => {
    const page = captureCampaignPage<AccountPage>('lesson-account');
    pages.push(page);
    const start = transport.calls.length;
    page.onLoad();
    try {
      runtime.accessToken = other.token;
      page.onShow();
      await settle(page);
      expect(transport.calls).toHaveLength(start);
      expect(page.data.viewState).toBe('forbidden');
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it('discards a held actual HTTP 200 after identity replacement without a lifecycle event', async () => {
    const page = await open();
    const restore = hold('/partners/me/lesson-account');
    page.onRetry();
    const reading = page.pendingRequest;
    const start = transport.calls.length;
    try {
      await transport.idle();
      expect(transport.calls.slice(start)).toMatchObject([
        { path: '/partners/me/profile', status: 200 },
        { path: '/partners/me/lesson-account', status: 200, delivery: 'held' },
      ]);
      runtime.accessToken = other.token;
      transport.release();
      await reading;
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        summary: null,
        items: [],
      });
      expect(transport.calls).toHaveLength(start + 2);
    } finally {
      runtime.accessToken = owner.token;
      restore();
      transport.release();
      await reading;
      page.onUnload();
    }
  });
  it('ignores a hidden held success and reloads the same owner on return', async () => {
    const page = await open();
    const restore = hold('/partners/me/lesson-account');
    page.onRetry();
    const reading = page.pendingRequest;
    try {
      await transport.idle();
      page.onHide();
      const writes = page.setData.mock.calls.length;
      transport.release();
      await reading;
      expect(page.setData).toHaveBeenCalledTimes(writes);
      restore();
      page.onShow();
      await settle(page);
      expect(page.data).toMatchObject({
        viewState: 'ready',
        summary: { totalBalanceLabel: '22' },
        total: 22,
      });
    } finally {
      restore();
      transport.release();
      await reading;
      page.onUnload();
    }
  });
  it('retains scoped content after a lost GET reply and recovers through a read-only retry', async () => {
    const page = await open();
    const rows = page.data.items;
    const restore = hold('/partners/me/lesson-account', 'lost');
    try {
      page.onRetry();
      await settle(page);
      expect(page.data.viewState).toBe('ready');
      expect(page.data.items).toBe(rows);
      expect(page.data.refreshError).not.toBe('');
      restore();
      page.onRetry();
      await settle(page);
      expect(page.data.refreshError).toBe('');
      expect(page.data.total).toBe(22);
    } finally {
      restore();
      page.onUnload();
    }
  });
  it.each(['profile', 'lesson-account'] as const)(
    'clears immediately on actual HTTP 403 while the %s reply remains held',
    async (held) => {
      const page = await open();
      const role = {
        userId: owner.id,
        campusId: campuses[0],
        roleCode: 'PARTNER' as const,
      };
      const restore = hold(`/partners/me/${held}`);
      let reading: Promise<void> | undefined;
      try {
        expect(
          (
            await prisma.userRole.updateMany({
              where: role,
              data: { roleCode: 'TEACHER' },
            })
          ).count,
        ).toBe(1);
        const start = transport.calls.length;
        page.onRetry();
        reading = page.pendingRequest;
        await transport.idle();
        expect(transport.calls.slice(start)).toHaveLength(2);
        expect(
          transport.calls.slice(start).every((call) => call.status === 403),
        ).toBe(true);
        expect(
          transport.calls
            .slice(start)
            .find((call) => call.path === `/partners/me/${held}`)?.delivery,
        ).toBe('held');
        expect(page.data).toMatchObject({
          viewState: 'forbidden',
          summary: null,
          items: [],
          page: 0,
          total: 0,
          hasMore: false,
          ledgerLoading: false,
          loadingMore: false,
        });
        expect(page.pendingRequest).toBeUndefined();
        const writes = page.setData.mock.calls.length;
        transport.release();
        await reading;
        expect(page.setData).toHaveBeenCalledTimes(writes);
        process.stdout.write(
          `PARTNER_LESSON_ACCOUNT_EARLY_DENIAL ${JSON.stringify({
            runTag,
            held,
            status: 403,
            clearedBeforeSibling: true,
            lateResponseIgnored: true,
          })}\n`,
        );
      } finally {
        restore();
        transport.release();
        await reading;
        expect(
          (
            await prisma.userRole.updateMany({
              where: { ...role, roleCode: 'TEACHER' },
              data: { roleCode: 'PARTNER' },
            })
          ).count,
        ).toBe(1);
        page.onUnload();
      }
    },
  );
  it('clears scoped data on actual HTTP 401 after its synthetic account is disabled', async () => {
    const page = await open();
    try {
      expect(
        (
          await prisma.user.updateMany({
            where: {
              id: owner.id,
              displayName: `${runTag}-owner`,
              status: 'ACTIVE',
            },
            data: { status: 'DISABLED' },
          })
        ).count,
      ).toBe(1);
      const start = transport.calls.length;
      page.onRetry();
      await settle(page);
      expect(transport.calls.slice(start)).toHaveLength(2);
      expect(
        transport.calls.slice(start).every((call) => call.status === 401),
      ).toBe(true);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        summary: null,
        items: [],
      });
    } finally {
      expect(
        (
          await prisma.user.updateMany({
            where: {
              id: owner.id,
              displayName: `${runTag}-owner`,
              status: 'DISABLED',
            },
            data: { status: 'ACTIVE' },
          })
        ).count,
      ).toBe(1);
      page.onUnload();
    }
  });
  it('requires explicit account opt-in and still rejects account writes and other reads', () => {
    const options = {
      url: `${runtime.apiBaseUrl}/partners/me/lesson-account`,
      method: 'GET' as const,
      header: { Authorization: `Bearer ${owner.token}` },
      success: jest.fn(),
      fail: jest.fn(),
    };
    const restricted = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token]),
    );
    expect(() => restricted.request(options)).toThrow('outside its scope');
    expect(() => transport.request({ ...options, method: 'POST' })).toThrow(
      'outside its scope',
    );
    expect(() =>
      transport.request({
        ...options,
        url: `${runtime.apiBaseUrl}/partners/me/students/${students[0]}`,
      }),
    ).toThrow('outside its scope');
  });
});
