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
type EntryKind = 'home' | 'profile';
interface EntryPage {
  data: {
    viewState: string;
    campusName: string;
    refreshError: string;
    partnerName?: string;
    displayName?: string;
    activeStudentCountLabel?: string;
    highlightStudent?: string;
    highlightClass?: string;
    highlightCourses?: Array<{ id: string; label: string }>;
    stats?: Array<{ key: string; value: string }>;
    menuExpanded?: boolean;
    moreExpanded?: boolean;
  };
  pendingRequest?: Promise<void>;
  navigating: boolean;
  setData: jest.Mock;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetry(): void;
  onLogin(): void;
  onPullDownRefresh(): void;
  onMenuToggle?(): void;
  onMoreToggle?(): void;
  onActionTap(event: { currentTarget: { dataset: { key: string } } }): void;
}
describe('partner home and profile owner protection through isolated TCP', () => {
  const runTag = `pentry-${randomUUID().slice(0, 8)}`;
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const userIds: string[] = [],
    campusIds: string[] = [],
    studentIds: string[] = [];
  const teacherIds: string[] = [],
    groupIds: string[] = [],
    memberIds: string[] = [];
  const pages: EntryPage[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number;
  let owner: { id: string; token: string },
    other: { id: string; token: string };
  let runtime: { dataDriver: 'api'; apiBaseUrl: string; accessToken: string };
  let transport: CampaignPageTransport, fixtureSnapshot: unknown;
  const snapshot = async () => {
    const where = { campusId: { in: campusIds } };
    return {
      campuses: await prisma.campus.findMany({
        where: { id: { in: campusIds } },
        orderBy: { id: 'asc' },
      }),
      students: await prisma.student.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      teachers: await prisma.teacherProfile.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      groups: await prisma.classGroup.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      members: await prisma.classMember.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
    };
  };
  const native = () =>
    host.wx as {
      navigateTo: jest.Mock;
      reLaunch: jest.Mock;
      showToast: jest.Mock;
      stopPullDownRefresh: jest.Mock;
    };
  const toggle = (page: EntryPage, kind: EntryKind) =>
    kind === 'home' ? page.onMenuToggle!() : page.onMoreToggle!();
  const tap = (page: EntryPage) =>
    page.onActionTap({ currentTarget: { dataset: { key: 'students' } } });
  const lastFailure = () => {
    const calls = native().navigateTo.mock.calls as unknown[][];
    return (calls.at(-1)![0] as { fail(this: void): void }).fail;
  };
  const settle = async (page: EntryPage) => {
    for (let index = 0; index < 3; index++) {
      await page.pendingRequest;
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async (kind: EntryKind) => {
    const page = captureCampaignPage<EntryPage>(kind);
    pages.push(page);
    page.onLoad();
    page.onShow();
    await settle(page);
    return page;
  };
  const cleared = (page: EntryPage, kind: EntryKind) => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      campusName: '',
      refreshError: '',
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.navigating).toBe(false);
    expect(page.data).toMatchObject(
      kind === 'home'
        ? {
            partnerName: '',
            highlightStudent: '',
            highlightClass: '',
            highlightCourses: [],
            stats: [],
            menuExpanded: false,
          }
        : { displayName: '', activeStudentCountLabel: '', moreExpanded: false },
    );
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const actor = async (suffix: string) => {
      const campus = await prisma.campus.create({
        data: {
          code: `${runTag}-${suffix}`,
          name: `${runTag}-${suffix}合成校区`,
          address: `${runTag}合成地址`,
        },
      });
      campusIds.push(campus.id);
      const partner = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      userIds.push(partner.id);
      const teacher = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}合成教师`,
          roles: { create: { roleCode: 'TEACHER', campusId: campus.id } },
          teacherProfile: {
            create: {
              campusId: campus.id,
              employeeCode: `${runTag}-${suffix}`,
            },
          },
        },
        include: { teacherProfile: true },
      });
      userIds.push(teacher.id);
      teacherIds.push(teacher.teacherProfile!.id);
      const student = await prisma.student.create({
        data: {
          campusId: campus.id,
          displayName: `${runTag}-${suffix}合成学员`,
        },
      });
      studentIds.push(student.id);
      const group = await prisma.classGroup.create({
        data: {
          campusId: campus.id,
          teacherId: teacher.teacherProfile!.id,
          name: `${suffix}合成班级`,
          courseName: '合成课程',
        },
      });
      groupIds.push(group.id);
      memberIds.push(
        (
          await prisma.classMember.create({
            data: {
              campusId: campus.id,
              classGroupId: group.id,
              studentId: student.id,
            },
          })
        ).id,
      );
      return {
        id: partner.id,
        token: (await app.get(AuthService).issueSessionForUser(partner.id))
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
      navigateTo: jest.fn(),
      showToast: jest.fn(),
      reLaunch: jest.fn((options: { fail?: () => void }) => options.fail?.()),
      stopPullDownRefresh: jest.fn(),
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
              id: { in: userIds },
              displayName: { startsWith: `${runTag}-` },
            },
            data: { status: 'DISABLED' },
          })
        ).count,
      ).toBe(4);
      expect(
        await prisma.user.count({
          where: {
            id: { in: userIds },
            displayName: { startsWith: `${runTag}-` },
            status: 'DISABLED',
          },
        }),
      ).toBe(4);
      const roles = await prisma.userRole.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, roleCode: true, campusId: true },
        orderBy: { userId: 'asc' },
      });
      expect(roles).toEqual(
        userIds
          .map((userId, index) => ({
            userId,
            roleCode: index % 2 === 0 ? 'PARTNER' : 'TEACHER',
            campusId: campusIds[Math.floor(index / 2)],
          }))
          .sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      expect(await snapshot()).toEqual(fixtureSnapshot);
      const where = { campusId: { in: campusIds } };
      const zeroSideEffects = {
        packages: await prisma.coursePackage.count({ where }),
        lessons: await prisma.lessonSession.count({ where }),
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
        `PARTNER_ENTRY_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds,
          campusIds,
          studentIds,
          teacherIds,
          groupIds,
          memberIds,
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
          `PARTNER_ENTRY_SERVER_CLOSED ${JSON.stringify({ runTag, port, refused: true })}\n`,
        );
      }
    }
  });
  describe.each<EntryKind>(['home', 'profile'])(
    '%s actual Page and HTTP',
    (kind) => {
      it('reads only owner identity and nonempty campus facts', async () => {
        const page = await open(kind);
        expect(page.data).toMatchObject({
          viewState: 'ready',
          campusName: `${runTag}-owner合成校区`,
        });
        if (kind === 'home') {
          expect(page.data).toMatchObject({
            partnerName: `${runTag}-owner`,
            highlightStudent: `${runTag}-owner合成学员`,
            highlightClass: 'owner合成班级',
            highlightCourses: [
              { id: groupIds[0], label: `合成课程 · ${runTag}-owner合成教师` },
            ],
          });
          expect(page.data.stats).toMatchObject([
            { key: 'students', value: '1' },
            { key: 'consumed', value: '0' },
            { key: 'teachers', value: '1' },
          ]);
        } else
          expect(page.data).toMatchObject({
            displayName: `${runTag}-owner`,
            activeStudentCountLabel: '1人',
          });
        page.onUnload();
      });
      it('preserves current content and open menu after a lost refresh, then recovers', async () => {
        const page = await open(kind);
        toggle(page, kind);
        transport.deliverNext('lost');
        page.onRetry();
        await settle(page);
        expect(page.data).toMatchObject({
          viewState: 'ready',
          campusName: `${runTag}-owner合成校区`,
          ...(kind === 'home'
            ? { menuExpanded: true }
            : { moreExpanded: true }),
        });
        expect(page.data.refreshError).not.toBe('');
        page.onRetry();
        await settle(page);
        expect(page.data.refreshError).toBe('');
        page.onUnload();
      });
      it('stops the old page on token replacement and recovers only through a fresh instance', async () => {
        const page = await open(kind);
        toggle(page, kind);
        const reads = transport.calls.length,
          navigations = native().navigateTo.mock.calls.length;
        try {
          runtime.accessToken = other.token;
          tap(page);
          page.onShow();
          page.onRetry();
          await settle(page);
          cleared(page, kind);
          expect(transport.calls).toHaveLength(reads);
          expect(native().navigateTo).toHaveBeenCalledTimes(navigations);
          const fresh = await open(kind);
          expect(fresh.data.campusName).toBe(`${runTag}-other合成校区`);
          fresh.onUnload();
        } finally {
          runtime.accessToken = owner.token;
          page.onUnload();
        }
      });
      it('cancels the queued initial GET when the token changes', async () => {
        const page = captureCampaignPage<EntryPage>(kind);
        pages.push(page);
        const reads = transport.calls.length;
        page.onLoad();
        try {
          runtime.accessToken = other.token;
          await settle(page);
          cleared(page, kind);
          expect(transport.calls).toHaveLength(reads);
        } finally {
          runtime.accessToken = owner.token;
          page.onUnload();
        }
      });
      it('ignores a held actual 200 after token replacement without a lifecycle event', async () => {
        const page = await open(kind);
        transport.deliverNext('held');
        page.onRetry();
        const reading = page.pendingRequest;
        await transport.idle();
        expect(transport.calls.at(-1)).toMatchObject({
          status: 200,
          delivery: 'held',
        });
        try {
          runtime.accessToken = other.token;
          transport.release();
          await reading;
          cleared(page, kind);
        } finally {
          runtime.accessToken = owner.token;
          transport.release();
          page.onUnload();
        }
      });
      it.each([401, 403])(
        'clears facts and navigation on real HTTP %s',
        async (code) => {
          const page = await open(kind);
          toggle(page, kind);
          tap(page);
          const fail = lastFailure();
          const role = { userId: owner.id, campusId: campusIds[0] };
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
            page.onRetry();
            await settle(page);
            expect(transport.calls.at(-1)).toMatchObject({
              path:
                kind === 'home'
                  ? '/partners/me/dashboard'
                  : '/partners/me/profile',
              status: code,
            });
            cleared(page, kind);
            const writes = page.setData.mock.calls.length,
              toasts = native().showToast.mock.calls.length;
            fail();
            expect(page.setData).toHaveBeenCalledTimes(writes);
            expect(native().showToast).toHaveBeenCalledTimes(toasts);
            process.stdout.write(
              `PARTNER_ENTRY_DENIAL ${JSON.stringify({ runTag, kind, code, cleared: true, lateNavigationIgnored: true })}\n`,
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
      it('checks current owner in an already issued native navigation failure', async () => {
        const page = await open(kind);
        tap(page);
        const fail = lastFailure(),
          toasts = native().showToast.mock.calls.length;
        try {
          runtime.accessToken = other.token;
          fail();
          cleared(page, kind);
          expect(native().showToast).toHaveBeenCalledTimes(toasts);
        } finally {
          runtime.accessToken = owner.token;
          page.onUnload();
        }
      });
      it('keeps logout final after failed reLaunch and a held HTTP reply', async () => {
        const page = await open(kind);
        transport.deliverNext('held');
        page.onRetry();
        const reading = page.pendingRequest;
        await transport.idle();
        try {
          const launches = native().reLaunch.mock.calls.length;
          page.onLogin();
          expect(runtime.accessToken).toBe('');
          expect(native().reLaunch).toHaveBeenCalledTimes(launches + 1);
          expect(native().reLaunch).toHaveBeenLastCalledWith({
            url: '/pages/bootstrap/index',
          });
          cleared(page, kind);
          transport.release();
          await reading;
          const reads = transport.calls.length;
          page.onShow();
          page.onRetry();
          tap(page);
          await settle(page);
          cleared(page, kind);
          expect(transport.calls).toHaveLength(reads);
        } finally {
          runtime.accessToken = owner.token;
          transport.release();
          page.onUnload();
        }
      });
      it.each(['hide', 'unload'])(
        'ignores late HTTP and pull callbacks after %s',
        async (lifecycle) => {
          const page = await open(kind);
          transport.deliverNext('held');
          page.onPullDownRefresh();
          const reading = page.pendingRequest;
          await transport.idle();
          if (lifecycle === 'hide') page.onHide();
          else page.onUnload();
          const writes = page.setData.mock.calls.length,
            stops = native().stopPullDownRefresh.mock.calls.length;
          transport.release();
          await reading;
          expect(page.setData).toHaveBeenCalledTimes(writes);
          expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops);
          page.onUnload();
        },
      );
      it('stops only the fresh pull when hidden and returned HTTP reads overlap', async () => {
        const page = await open(kind);
        const stops = native().stopPullDownRefresh.mock.calls.length;
        transport.deliverNext('held');
        page.onPullDownRefresh();
        const old = page.pendingRequest;
        await transport.idle();
        page.onHide();
        transport.deliverNext('held');
        page.onShow();
        page.onPullDownRefresh();
        const fresh = page.pendingRequest;
        expect(fresh).not.toBe(old);
        await transport.idle();
        expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops);
        transport.release();
        await old;
        await fresh;
        expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops + 1);
        expect(page.data).toMatchObject({
          viewState: 'ready',
          campusName: `${runTag}-owner合成校区`,
        });
        page.onUnload();
      });
    },
  );
  it('keeps default transport closed to entry reads and opt-in closed to extra reads or writes', () => {
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
    denied(restricted, '/partners/me/dashboard');
    denied(restricted, '/partners/me/profile');
    denied(transport, '/partners/me/dashboard', 'POST');
    denied(transport, '/partners/me/profile', 'POST');
    denied(transport, '/partners/me/teachers');
    denied(transport, '/partners/me/students');
  });
});
