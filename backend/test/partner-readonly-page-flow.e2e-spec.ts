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
type ReadKind = 'operations' | 'warnings' | 'attendance';
interface ReadPage {
  data: {
    viewState: string;
    anchorDate?: string;
    query?: string;
    summary?: {
      recordedCountLabel?: string;
      completedLessonCountLabel?: string;
      teacherMetrics?: Array<{ displayName: string }>;
    } | null;
    items?: Array<{ id?: string; studentId?: string; studentName: string }>;
    total?: number;
    page?: number;
    hasMore?: boolean;
    refreshError: string;
    paginationError?: string;
    pageError?: string;
  };
  pendingRequest?: Promise<void>;
  campusTimeZone?: string;
  setData: jest.Mock;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetry(): void;
  onLogin(): void;
  onPullDownRefresh(): void;
  onLoadMore?(): void;
  onSearchInput?(event: { detail: { value: string } }): void;
}
const ROUTES = {
  operations: '/partners/me/operations-summary',
  warnings: '/partners/me/warnings',
  attendance: '/partners/me/attendance',
} as const;

describe('partner remaining read pages through isolated TCP', () => {
  const runTag = `prowner-${randomUUID().slice(0, 8)}`;
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const owned = {
    userIds: [] as string[],
    campusIds: [] as string[],
    studentIds: [] as string[],
    teacherIds: [] as string[],
    groupIds: [] as string[],
    memberIds: [] as string[],
    lessonIds: [] as string[],
    teachingIds: [] as string[],
    attendanceIds: [] as string[],
  };
  const pages: ReadPage[] = [];
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number;
  let owner: { id: string; token: string },
    other: { id: string; token: string };
  let runtime: { dataDriver: 'api'; apiBaseUrl: string; accessToken: string };
  let transport: CampaignPageTransport, fixtureSnapshot: unknown;
  const snapshot = async () => {
    const where = { campusId: { in: owned.campusIds } };
    return {
      campuses: await prisma.campus.findMany({
        where: { id: { in: owned.campusIds } },
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
      lessons: await prisma.lessonSession.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      teachings: await prisma.teachingRecord.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
      attendance: await prisma.attendanceRecord.findMany({
        where,
        orderBy: { id: 'asc' },
      }),
    };
  };
  const native = () =>
    host.wx as { reLaunch: jest.Mock; stopPullDownRefresh: jest.Mock };
  const settle = async (page: ReadPage) => {
    for (let index = 0; index < 3; index++) {
      await page.pendingRequest;
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const instantiate = (kind: ReadKind) => {
    const page = captureCampaignPage<ReadPage>(kind);
    if (kind === 'operations') page.data.anchorDate = '2026-10-14';
    pages.push(page);
    return page;
  };
  const open = async (kind: ReadKind) => {
    const page = instantiate(kind);
    page.onLoad();
    page.onShow();
    await settle(page);
    expect(page.data.viewState).toBe('ready');
    return page;
  };
  const cleared = (page: ReadPage, kind: ReadKind) => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      refreshError: '',
    });
    expect(page.pendingRequest).toBeUndefined();
    if (kind === 'operations') expect(page.data.summary).toBeNull();
    else
      expect(page.data).toMatchObject({
        items: [],
        total: 0,
        page: 0,
        hasMore: false,
      });
    if (kind === 'warnings') expect(page.data.query).toBe('');
    if (kind === 'attendance') {
      expect(page.campusTimeZone).toBeUndefined();
      expect(page.data.summary).toMatchObject({ recordedCountLabel: '0' });
    }
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const actor = async (suffix: string, count: number) => {
      const campus = await prisma.campus.create({
        data: {
          code: `${runTag}-${suffix}`,
          name: `${runTag}-${suffix}合成校区`,
        },
      });
      owned.campusIds.push(campus.id);
      const partner = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      owned.userIds.push(partner.id);
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
      owned.userIds.push(teacher.id);
      owned.teacherIds.push(teacher.teacherProfile!.id);
      const group = await prisma.classGroup.create({
        data: {
          campusId: campus.id,
          teacherId: teacher.teacherProfile!.id,
          name: `${suffix}合成班级`,
          courseName: '合成课程',
        },
      });
      owned.groupIds.push(group.id);
      let studentId = '';
      for (let index = 0; index < count; index++) {
        const student = await prisma.student.create({
          data: {
            campusId: campus.id,
            displayName: `${runTag}-${suffix}合成学员${String(index).padStart(2, '0')}`,
          },
        });
        owned.studentIds.push(student.id);
        if (index === 0) studentId = student.id;
      }
      owned.memberIds.push(
        (
          await prisma.classMember.create({
            data: { campusId: campus.id, classGroupId: group.id, studentId },
          })
        ).id,
      );
      for (let index = 0; index < count; index++) {
        const startsAt = new Date(Date.UTC(2026, 9, 14, 3, index));
        const status = (['PRESENT', 'ABSENT', 'LEAVE'] as const)[index % 3];
        const lesson = await prisma.lessonSession.create({
          data: {
            campusId: campus.id,
            classGroupId: group.id,
            teacherId: teacher.teacherProfile!.id,
            startsAt,
            endsAt: new Date(startsAt.getTime() + 60_000),
            status: 'COMPLETED',
            completedAt: startsAt,
            teachingRecord: {
              create: {
                campusId: campus.id,
                teacherId: teacher.teacherProfile!.id,
                attendeeCount: status === 'PRESENT' ? 1 : 0,
                lessonUnits: 100,
                recordedByUserId: teacher.id,
                completedAt: startsAt,
              },
            },
            attendanceRecords: {
              create: {
                campusId: campus.id,
                studentId,
                status,
                recordedByUserId: teacher.id,
                recordedAt: startsAt,
              },
            },
          },
          include: { teachingRecord: true, attendanceRecords: true },
        });
        owned.lessonIds.push(lesson.id);
        owned.teachingIds.push(lesson.teachingRecord!.id);
        owned.attendanceIds.push(lesson.attendanceRecords[0].id);
      }
      return {
        id: partner.id,
        token: (await app.get(AuthService).issueSessionForUser(partner.id))
          .accessToken,
      };
    };
    owner = await actor('owner', 21);
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
      reLaunch: jest.fn((options: { fail?: () => void }) => options.fail?.()),
      stopPullDownRefresh: jest.fn(),
    };
  });
  afterAll(async () => {
    try {
      pages.forEach((page) => page.onUnload());
      await transport?.drain();
      assertPartnerPdfTestTarget(process.env);
      expect(
        (
          await prisma.user.updateMany({
            where: {
              id: { in: owned.userIds },
              displayName: { startsWith: `${runTag}-` },
            },
            data: { status: 'DISABLED' },
          })
        ).count,
      ).toBe(4);
      expect(
        await prisma.user.count({
          where: { id: { in: owned.userIds }, status: 'DISABLED' },
        }),
      ).toBe(4);
      const roles = await prisma.userRole.findMany({
        where: { userId: { in: owned.userIds } },
        select: { userId: true, roleCode: true, campusId: true },
        orderBy: { userId: 'asc' },
      });
      expect(roles).toEqual(
        owned.userIds
          .map((userId, index) => ({
            userId,
            roleCode: index % 2 === 0 ? 'PARTNER' : 'TEACHER',
            campusId: owned.campusIds[Math.floor(index / 2)],
          }))
          .sort((a, b) => a.userId.localeCompare(b.userId)),
      );
      expect(await snapshot()).toEqual(fixtureSnapshot);
      const where = { campusId: { in: owned.campusIds } };
      const zeroSideEffects = {
        packages: await prisma.coursePackage.count({ where }),
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
        `PARTNER_READONLY_OWNERSHIP ${JSON.stringify({
          runTag,
          ...owned,
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
          `PARTNER_READONLY_SERVER_CLOSED ${JSON.stringify({ runTag, port, refused: true })}\n`,
        );
      }
    }
  });

  describe.each<ReadKind>(['operations', 'warnings', 'attendance'])(
    '%s actual Page and HTTP',
    (kind) => {
      it('reads nonempty owner facts with actual campus isolation', async () => {
        const page = await open(kind);
        if (kind === 'operations')
          expect(page.data.summary).toMatchObject({
            completedLessonCountLabel: '21',
            recordedCountLabel: '21',
            teacherMetrics: [{ displayName: `${runTag}-owner合成教师` }],
          });
        else {
          expect(page.data).toMatchObject({
            total: 21,
            page: 1,
            hasMore: true,
          });
          expect(page.data.items).toHaveLength(20);
          expect(
            page.data.items!.every((item) =>
              item.studentName.startsWith(`${runTag}-owner`),
            ),
          ).toBe(true);
        }
        page.onUnload();
      });
      it('preserves facts after a lost refresh and recovers on retry', async () => {
        const page = await open(kind);
        const previous = structuredClone(page.data);
        transport.deliverNext('lost');
        page.onRetry();
        await settle(page);
        expect(page.data.viewState).toBe('ready');
        if (kind !== 'warnings')
          expect(page.data.summary).toEqual(previous.summary);
        if (kind !== 'operations')
          expect(page.data.items).toEqual(previous.items);
        expect(page.data.refreshError).not.toBe('');
        page.onRetry();
        await settle(page);
        expect(page.data.refreshError).toBe('');
        page.onUnload();
      });
      it('stops the old page when the Token changes and reads other facts only in a new instance', async () => {
        const page = await open(kind);
        const reads = transport.calls.length;
        try {
          runtime.accessToken = other.token;
          page.onShow();
          page.onRetry();
          await settle(page);
          cleared(page, kind);
          expect(transport.calls).toHaveLength(reads);
          const fresh = await open(kind);
          if (kind === 'operations')
            expect(fresh.data.summary!.teacherMetrics![0].displayName).toBe(
              `${runTag}-other合成教师`,
            );
          else expect(fresh.data).toMatchObject({ total: 1, hasMore: false });
          fresh.onUnload();
        } finally {
          runtime.accessToken = owner.token;
          page.onUnload();
        }
      });
      it('cancels the queued initial GET when the Token changes', async () => {
        const page = instantiate(kind);
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
      it('discards a held real 200 from the old owner', async () => {
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
        'clears loaded facts on real HTTP %s',
        async (code) => {
          const page = await open(kind);
          const role = { userId: owner.id, campusId: owned.campusIds[0] };
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
            const call = transport.calls.at(-1)!;
            expect(call.status).toBe(code);
            expect(call.path).toBe(
              kind === 'attendance' ? '/partners/me/profile' : ROUTES[kind],
            );
            cleared(page, kind);
            process.stdout.write(
              `PARTNER_READONLY_DENIAL ${JSON.stringify({ runTag, kind, code, stage: call.path, cleared: true })}\n`,
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
      it('keeps logout final despite failed reLaunch and a held actual pull response', async () => {
        const page = await open(kind);
        const stops = native().stopPullDownRefresh.mock.calls.length;
        transport.deliverNext('held');
        page.onPullDownRefresh();
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
          page.onPullDownRefresh();
          await settle(page);
          cleared(page, kind);
          expect(transport.calls).toHaveLength(reads);
          expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops);
        } finally {
          runtime.accessToken = owner.token;
          transport.release();
          page.onUnload();
        }
      });
      it.each<'onHide' | 'onUnload'>(['onHide', 'onUnload'])(
        'ignores old writes and pull callbacks after %s',
        async (lifecycle) => {
          const page = await open(kind);
          transport.deliverNext('held');
          page.onPullDownRefresh();
          const reading = page.pendingRequest;
          await transport.idle();
          page[lifecycle]();
          const writes = page.setData.mock.calls.length,
            stops = native().stopPullDownRefresh.mock.calls.length;
          transport.release();
          await reading;
          expect(page.setData).toHaveBeenCalledTimes(writes);
          expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops);
          page.onUnload();
        },
      );
      it('stops only the current pull when old and new actual HTTP reads overlap', async () => {
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
        await transport.idle();
        expect(fresh).not.toBe(old);
        transport.release();
        await old;
        await fresh;
        expect(native().stopPullDownRefresh).toHaveBeenCalledTimes(stops + 1);
        expect(page.data.viewState).toBe('ready');
        page.onUnload();
      });
    },
  );
  it.each<ReadKind>(['warnings', 'attendance'])(
    '%s appends page two and retries a lost second page without duplicates',
    async (kind) => {
      const page = await open(kind);
      transport.deliverNext('lost');
      page.onLoadMore!();
      await settle(page);
      expect(page.data).toMatchObject({ page: 1, total: 21, hasMore: true });
      expect(page.data.items).toHaveLength(20);
      expect(
        kind === 'warnings' ? page.data.paginationError : page.data.pageError,
      ).not.toBe('');
      page.onLoadMore!();
      await settle(page);
      expect(page.data).toMatchObject({ page: 2, total: 21, hasMore: false });
      expect(page.data.items).toHaveLength(21);
      expect(
        new Set(
          page.data.items!.map((item) =>
            kind === 'warnings' ? item.studentId : item.id,
          ),
        ).size,
      ).toBe(21);
      page.onUnload();
    },
  );
  it.each([401, 403])(
    'clears attendance on real second-stage HTTP %s after an authorized profile',
    async (code) => {
      const page = await open('attendance');
      transport.deliverNext('held');
      page.onRetry();
      const reading = page.pendingRequest;
      await transport.idle();
      expect(transport.calls.at(-1)).toMatchObject({
        path: '/partners/me/profile',
        status: 200,
      });
      const role = { userId: owner.id, campusId: owned.campusIds[0] };
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
        transport.release();
        await reading;
        await settle(page);
        expect(transport.calls.at(-1)).toMatchObject({
          path: ROUTES.attendance,
          status: code,
        });
        cleared(page, 'attendance');
        process.stdout.write(
          `PARTNER_READONLY_DENIAL ${JSON.stringify({ runTag, kind: 'attendance', code, stage: ROUTES.attendance, cleared: true })}\n`,
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
        transport.release();
        page.onUnload();
      }
    },
  );
  it('searches warnings immediately on refresh and cancels the queued debounce', async () => {
    const page = await open('warnings');
    page.onSearchInput!({ detail: { value: ` ${runTag}-owner合成学员20 ` } });
    page.onPullDownRefresh();
    await settle(page);
    expect(page.data).toMatchObject({ total: 1, page: 1, hasMore: false });
    expect(page.data.items![0].studentName).toBe(`${runTag}-owner合成学员20`);
    page.onUnload();
  });
  it('retains the default transport boundary and permits only opted-in GET paths', () => {
    const restricted = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token]),
    );
    const deny = (
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
    for (const route of Object.values(ROUTES)) {
      deny(restricted, route);
      deny(transport, route, 'POST');
    }
    deny(transport, '/partners/me/teachers');
    deny(transport, '/partners/me/students');
  });
});
