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
interface TeachersPage {
  data: {
    viewState: string;
    query: string;
    items: Array<{
      id: string;
      displayName: string;
      classLabel: string;
      activeStudentCountLabel: string;
    }>;
    expandedId: string;
    page: number;
    total: number;
    hasMore: boolean;
    loadingMore: boolean;
    refreshError: string;
    paginationError: string;
  };
  setData: jest.Mock;
  pendingRequest?: Promise<void>;
  pendingKey: string;
  contentKey: string;
  searchTimer: ReturnType<typeof setTimeout> | null;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetry(): void;
  onLoadMore(): void;
  onRetryMore(): void;
  onLogin(): void;
  onPullDownRefresh(): void;
  loadTeachers(reset: boolean): Promise<void>;
  onSearchInput(event: { detail: { value: string } }): void;
  onClearSearch(): void;
  onTeacherToggle(event: { currentTarget: { dataset: { id: string } } }): void;
}
describe('partner teachers owner protection through isolated TCP', () => {
  const runTag = `ptowner-${randomUUID().slice(0, 8)}`;
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const users: string[] = [],
    campuses: string[] = [],
    teacherIds: string[] = [],
    groupIds: string[] = [];
  const pages: TeachersPage[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number;
  let owner: { id: string; token: string },
    other: { id: string; token: string };
  let runtime: { dataDriver: 'api'; apiBaseUrl: string; accessToken: string };
  let transport: CampaignPageTransport, fixtureSnapshot: unknown;
  const snapshot = async () => ({
    teachers: await prisma.teacherProfile.findMany({
      where: { campusId: { in: campuses } },
      orderBy: { id: 'asc' },
    }),
    groups: await prisma.classGroup.findMany({
      where: { campusId: { in: campuses } },
      orderBy: { id: 'asc' },
    }),
  });
  const native = () =>
    host.wx as { reLaunch: jest.Mock; stopPullDownRefresh: jest.Mock };
  const event = (id: string) => ({ currentTarget: { dataset: { id } } });
  const settle = async (page: TeachersPage) => {
    for (let index = 0; index < 3; index++) {
      await page.pendingRequest;
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async () => {
    const page = captureCampaignPage<TeachersPage>('teachers');
    pages.push(page);
    page.onLoad();
    page.onShow();
    await settle(page);
    return page;
  };
  const cleared = (page: TeachersPage) => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      query: '',
      items: [],
      expandedId: '',
      page: 0,
      total: 0,
      hasMore: false,
      loadingMore: false,
      refreshError: '',
      paginationError: '',
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingKey).toBe('');
    expect(page.contentKey).toBe('');
    expect(page.searchTimer).toBeNull();
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const actor = async (suffix: string, count: number) => {
      const campus = await prisma.campus.create({
        data: { code: `${runTag}-${suffix}`, name: `${runTag}合成校区` },
      });
      campuses.push(campus.id);
      const partner = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      users.push(partner.id);
      for (let index = 1; index <= count; index++) {
        const user = await prisma.user.create({
          data: {
            displayName:
              suffix === 'owner'
                ? `${runTag}-合成教师${String(index).padStart(2, '0')}`
                : `${runTag}-另一校区教师`,
            roles: { create: { roleCode: 'TEACHER', campusId: campus.id } },
            teacherProfile: {
              create: {
                campusId: campus.id,
                employeeCode: `${runTag}-${suffix}-${index}`,
                specialties: ['合成课程'],
              },
            },
          },
          include: { teacherProfile: true },
        });
        users.push(user.id);
        teacherIds.push(user.teacherProfile!.id);
        if (index === 1)
          groupIds.push(
            (
              await prisma.classGroup.create({
                data: {
                  campusId: campus.id,
                  teacherId: user.teacherProfile!.id,
                  name:
                    suffix === 'owner' ? '本人合成班级' : '另一校区合成班级',
                  courseName: '合成课程',
                },
              })
            ).id,
          );
      }
      return {
        id: partner.id,
        token: (await app.get(AuthService).issueSessionForUser(partner.id))
          .accessToken,
      };
    };
    owner = await actor('owner', 22);
    other = await actor('other', 1);
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
      false,
      true,
    );
    const storage = new Map<string, unknown>();
    for (const key of ['wx', 'Page'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : storage.get(key),
      setStorageSync: (key: string, value: unknown) => {
        if (key === 'education.runtime') runtime = value as typeof runtime;
        else storage.set(key, value);
      },
      request: transport.request,
      stopPullDownRefresh: jest.fn(),
      reLaunch: jest.fn((options: { fail?: () => void }) => options.fail?.()),
    };
  });
  afterAll(async () => {
    try {
      for (const page of pages) page.onUnload();
      await transport?.drain();
      assertPartnerPdfTestTarget(process.env);
      expect(
        (
          await prisma.user.updateMany({
            where: {
              id: { in: users },
              displayName: { startsWith: `${runTag}-` },
            },
            data: { status: 'DISABLED' },
          })
        ).count,
      ).toBe(users.length);
      expect(
        await prisma.user.count({
          where: {
            id: { in: users },
            displayName: { startsWith: `${runTag}-` },
            status: 'DISABLED',
          },
        }),
      ).toBe(25);
      expect(await snapshot()).toEqual(fixtureSnapshot);
      const roles = await prisma.userRole.findMany({
        where: { userId: { in: users } },
        select: { userId: true, roleCode: true, campusId: true },
        orderBy: { userId: 'asc' },
      });
      expect(roles).toEqual(
        users
          .map((userId, index) => ({
            userId,
            roleCode: index === 0 || index === 23 ? 'PARTNER' : 'TEACHER',
            campusId: campuses[index < 23 ? 0 : 1],
          }))
          .sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      const where = { campusId: { in: campuses } };
      const zeroSideEffects = {
        students: await prisma.student.count({ where }),
        lessons: await prisma.lessonSession.count({ where }),
        coursePackages: await prisma.coursePackage.count({ where }),
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
      process.stdout.write(
        `PARTNER_TEACHERS_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds: users,
          campusIds: campuses,
          teacherIds,
          groupIds,
          roles,
          disabled: true,
          immutableFixtures: true,
          zeroSideEffects,
          fixtureSha256: createHash('sha256')
            .update(JSON.stringify(fixtureSnapshot))
            .digest('hex'),
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
          `PARTNER_TEACHERS_SERVER_CLOSED ${JSON.stringify({ runTag, port, refused: true })}\n`,
        );
      }
    }
  });
  it('reads 20 then 22 unique teachers in owner campus and folds without extra reads', async () => {
    const page = await open();
    expect(page.data).toMatchObject({
      viewState: 'ready',
      total: 22,
      page: 1,
      hasMore: true,
    });
    expect(page.data.items).toHaveLength(20);
    expect(page.data.items[0]).toMatchObject({
      id: teacherIds[0],
      classLabel: '本人合成班级',
      activeStudentCountLabel: '0',
    });
    const reads = transport.calls.length;
    page.onTeacherToggle(event(teacherIds[0]));
    page.onTeacherToggle(event(teacherIds[1]));
    expect(page.data.expandedId).toBe(teacherIds[1]);
    expect(transport.calls).toHaveLength(reads);
    await page.loadTeachers(false);
    expect(page.data).toMatchObject({
      page: 2,
      total: 22,
      hasMore: false,
      expandedId: teacherIds[1],
    });
    expect(new Set(page.data.items.map((row) => row.id))).toEqual(
      new Set(teacherIds.slice(0, 22)),
    );
    page.onUnload();
  });
  it('searches a trimmed name, keeps matching expansion on refresh and clears the filter', async () => {
    const page = await open();
    page.onSearchInput({ detail: { value: ' 教师02 ' } });
    page.onRetry();
    await settle(page);
    expect(page.data.items.map((row) => row.id)).toEqual([teacherIds[1]]);
    expect(page.data.total).toBe(1);
    page.onTeacherToggle(event(teacherIds[1]));
    await page.loadTeachers(true);
    expect(page.data.expandedId).toBe(teacherIds[1]);
    page.onClearSearch();
    page.onRetry();
    await settle(page);
    expect(page.data).toMatchObject({
      query: '',
      total: 22,
      page: 1,
      expandedId: '',
    });
    expect(page.searchTimer).toBeNull();
    page.onUnload();
  });
  it('does not fetch replacement data until a fresh page opens for the other token', async () => {
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
      expect(fresh.data.items).toMatchObject([
        { id: teacherIds[22], classLabel: '另一校区合成班级' },
      ]);
      expect(fresh.data.total).toBe(1);
      fresh.onUnload();
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it('cancels a queued initial GET after token replacement', async () => {
    const page = captureCampaignPage<TeachersPage>('teachers');
    pages.push(page);
    const reads = transport.calls.length;
    page.onLoad();
    try {
      runtime.accessToken = other.token;
      await settle(page);
      cleared(page);
      expect(transport.calls).toHaveLength(reads);
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it('discards a held actual HTTP 200 after token replacement without a lifecycle event', async () => {
    const page = await open();
    page.onTeacherToggle(event(teacherIds[0]));
    transport.deliverNext('held');
    const reading = page.loadTeachers(false);
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
  });
  it('retains same-filter rows and fold on a lost refresh, then retries without pagination', async () => {
    const page = await open();
    page.onTeacherToggle(event(teacherIds[0]));
    transport.deliverNext('lost');
    await page.loadTeachers(true);
    expect(page.data).toMatchObject({
      viewState: 'ready',
      total: 22,
      expandedId: teacherIds[0],
    });
    expect(page.data.items).toHaveLength(20);
    expect(page.data.refreshError).not.toBe('');
    const reads = transport.calls.length;
    page.onLoadMore();
    await settle(page);
    expect(transport.calls).toHaveLength(reads);
    await page.loadTeachers(true);
    expect(page.data.refreshError).toBe('');
    page.onUnload();
  });
  it('retains rows after a lost next-page GET and retries page two', async () => {
    const page = await open();
    transport.deliverNext('lost');
    await page.loadTeachers(false);
    expect(page.data.items).toHaveLength(20);
    expect(page.data.paginationError).not.toBe('');
    await page.loadTeachers(false);
    expect(page.data).toMatchObject({
      page: 2,
      total: 22,
      paginationError: '',
      loadingMore: false,
    });
    expect(page.data.items).toHaveLength(22);
    page.onUnload();
  });
  it.each(
    [true, false].flatMap((reset) =>
      [401, 403].map((code) => ({ reset, code })),
    ),
  )(
    'clears loaded rows and fold on actual HTTP $code for reset=$reset',
    async ({ reset, code }) => {
      const page = await open();
      page.onTeacherToggle(event(teacherIds[0]));
      const role = { userId: owner.id, campusId: campuses[0] };
      try {
        if (code === 401)
          expect(
            (
              await prisma.user.updateMany({
                where: { id: owner.id, displayName: `${runTag}-owner` },
                data: { status: 'DISABLED' },
              })
            ).count,
          ).toBe(1);
        else
          expect(
            (
              await prisma.userRole.updateMany({
                where: { ...role, roleCode: 'PARTNER' },
                data: { roleCode: 'TEACHER' },
              })
            ).count,
          ).toBe(1);
        await page.loadTeachers(reset);
        expect(transport.calls.at(-1)).toMatchObject({
          path: '/partners/me/teachers',
          status: code,
        });
        cleared(page);
        process.stdout.write(
          `PARTNER_TEACHERS_DENIAL ${JSON.stringify({ runTag, reset, code, rowsAndFoldCleared: true })}\n`,
        );
      } finally {
        if (code === 401)
          expect(
            (
              await prisma.user.updateMany({
                where: { id: owner.id, displayName: `${runTag}-owner` },
                data: { status: 'ACTIVE' },
              })
            ).count,
          ).toBe(1);
        else
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
  it('logs out current credentials and stops reads after a failed native reLaunch and held 200', async () => {
    const page = await open();
    transport.deliverNext('held');
    const reading = page.loadTeachers(false);
    await transport.idle();
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
  it.each(['hide', 'unload'])(
    'ignores an old HTTP reply and pull callback after %s',
    async (lifecycle) => {
      const page = await open();
      transport.deliverNext('held');
      page.onPullDownRefresh();
      const old = page.pendingRequest;
      await transport.idle();
      if (lifecycle === 'hide') page.onHide();
      else page.onUnload();
      const writes = page.setData.mock.calls.length;
      const stops = native().stopPullDownRefresh.mock.calls.length;
      transport.release();
      await old;
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops);
      if (lifecycle === 'hide') {
        page.onShow();
        page.onPullDownRefresh();
        await settle(page);
        expect(page.data).toMatchObject({ viewState: 'ready', total: 22 });
        expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops + 1);
      }
      page.onUnload();
    },
  );
  it('rejects campus overrides and unsupported paging with the real endpoint', async () => {
    const read = (query: string) =>
      new Promise<{ statusCode: number; data: unknown }>((resolve, reject) => {
        transport.request({
          url: `${runtime.apiBaseUrl}/partners/me/teachers?${query}`,
          method: 'GET',
          header: { Authorization: `Bearer ${owner.token}` },
          success: resolve,
          fail: reject,
        });
      });
    for (const query of [`campusId=${campuses[1]}`, 'page=0', 'pageSize=101']) {
      expect((await read(query)).statusCode).toBe(400);
    }
  });
  it('keeps the default transport closed to teachers and explicit opt-in closed to extra paths or writes', () => {
    const restricted = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token]),
    );
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
    denied(restricted, '/partners/me/teachers');
    denied(transport, '/partners/me/teachers', 'POST');
    denied(transport, `/partners/me/teachers/${teacherIds[0]}`);
    denied(transport, '/partners/me/students');
    denied(transport, '/partners/me/profile');
  });
});
