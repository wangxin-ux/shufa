import { randomUUID } from 'node:crypto';
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
interface StudentPage {
  data: {
    viewState: string;
    studentId: string;
    detail: { displayName: string } | null;
    growthItems: unknown[];
    growthState: string;
    refreshError: string;
  };
  setData: jest.Mock;
  pendingRequest?: Promise<void>;
  growthPending?: Promise<void>;
  onLoad(query: { id: string }): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetry(): void;
  onMoreGrowth(): void;
  onPreviewPhoto(): Promise<void>;
}
describe('partner student detail session protection through isolated TCP', () => {
  const runTag = `psdetail-${randomUUID().slice(0, 8)}`;
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const users: string[] = [],
    campuses: string[] = [],
    pages: StudentPage[] = [];
  let app: INestApplication, prisma: PrismaService, server: Server;
  let transport: CampaignPageTransport, studentId: string, port: number;
  let owner: { id: string; token: string },
    other: { id: string; token: string };
  let runtime: { dataDriver: 'api'; apiBaseUrl: string; accessToken: string };
  const settle = async (page: StudentPage) => {
    for (let index = 0; index < 4; index++) {
      await Promise.all([page.pendingRequest, page.growthPending]);
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async () => {
    const page = captureCampaignPage<StudentPage>('student-detail');
    pages.push(page);
    page.onLoad({ id: studentId });
    page.onShow();
    await settle(page);
    return page;
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
      return {
        id: user.id,
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    owner = await actor('owner');
    other = await actor('other');
    studentId = (
      await prisma.student.create({
        data: { campusId: campuses[0], displayName: '合成详情学员' },
      })
    ).id;
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
      true,
    );
    for (const key of ['wx', 'Page'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: transport.request,
      previewImage: jest.fn(),
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
      const stored = await prisma.user.findMany({
        where: { id: { in: users } },
        select: { status: true },
      });
      expect(stored.every((row) => row.status === 'DISABLED')).toBe(true);
      const where = { campusId: { in: campuses } };
      const zeroSideEffects = {
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
      expect(await prisma.student.count({ where })).toBe(1);
      process.stdout.write(
        `PARTNER_STUDENT_DETAIL_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds: users,
          campusIds: campuses,
          studentId,
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
          `PARTNER_STUDENT_DETAIL_SERVER_CLOSED ${JSON.stringify({ runTag, port, refused: true })}\n`,
        );
      }
    }
  });
  it('clears an already loaded student when identity changes and sends no request for the replacement token', async () => {
    const page = await open();
    expect(page.data).toMatchObject({
      viewState: 'ready',
      detail: { displayName: '合成详情学员' },
      growthState: 'ready',
    });
    const start = transport.calls.length;
    try {
      runtime.accessToken = other.token;
      page.onShow();
      page.onRetry();
      page.onMoreGrowth();
      await page.onPreviewPhoto();
      await settle(page);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        studentId: '',
        detail: null,
        growthItems: [],
      });
      expect(transport.calls).toHaveLength(start);
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
    const fresh = await open();
    expect(fresh.data.detail?.displayName).toBe('合成详情学员');
    fresh.onUnload();
  });
  it('ignores a held actual HTTP 200 after the identity changes without a lifecycle event', async () => {
    const page = await open();
    const start = transport.calls.length;
    transport.deliverNext('held');
    page.onRetry();
    const reading = page.pendingRequest;
    await transport.idle();
    expect(transport.calls.slice(start)).toMatchObject([
      { path: '/partners/me/profile', status: 200, delivery: 'held' },
      { path: `/partners/me/students/${studentId}`, status: 200 },
    ]);
    try {
      runtime.accessToken = other.token;
      transport.release();
      await reading;
      await settle(page);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        detail: null,
        growthItems: [],
      });
      expect(transport.calls).toHaveLength(start + 2);
    } finally {
      runtime.accessToken = owner.token;
      transport.release();
      page.onUnload();
    }
  });
  it('ignores an old successful read while hidden and reloads the same identity on return', async () => {
    const page = await open();
    transport.deliverNext('held');
    page.onRetry();
    const reading = page.pendingRequest;
    await transport.idle();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    transport.release();
    await reading;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow();
    await settle(page);
    expect(page.data).toMatchObject({
      viewState: 'ready',
      detail: { displayName: '合成详情学员' },
      growthState: 'ready',
    });
    page.onUnload();
  });
  it('requires explicit opt-in before the existing transport can read student details', () => {
    const restricted = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token]),
    );
    expect(() =>
      restricted.request({
        url: `${runtime.apiBaseUrl}/partners/me/students/${studentId}`,
        method: 'GET',
        header: { Authorization: `Bearer ${owner.token}` },
        success: jest.fn(),
        fail: jest.fn(),
      }),
    ).toThrow('outside its scope');
  });
  it.each(['profile', 'student'] as const)(
    'revokes loaded content on an actual 403 while the %s reply is held',
    async (held) => {
      const page = await open();
      const role = {
        userId: owner.id,
        campusId: campuses[0],
        roleCode: 'PARTNER' as const,
      };
      const native = host.wx as { request: CampaignPageTransport['request'] };
      const originalRequest = native.request;
      const heldPath =
        held === 'profile'
          ? '/partners/me/profile'
          : `/partners/me/students/${studentId}`;
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
        native.request = (options) => {
          if (new URL(options.url).pathname === heldPath)
            transport.deliverNext('held');
          return originalRequest(options);
        };
        const start = transport.calls.length;
        page.onRetry();
        reading = page.pendingRequest;
        await transport.idle();
        expect(transport.calls.slice(start)).toHaveLength(2);
        expect(
          transport.calls.slice(start).every((row) => row.status === 403),
        ).toBe(true);
        expect(
          transport.calls.slice(start).find((row) => row.path === heldPath)
            ?.delivery,
        ).toBe('held');
        expect(page.data).toMatchObject({
          viewState: 'forbidden',
          detail: null,
          growthItems: [],
        });
        await page.onPreviewPhoto();
        const writes = page.setData.mock.calls.length;
        transport.release();
        await reading;
        expect(page.setData).toHaveBeenCalledTimes(writes);
        process.stdout.write(
          `PARTNER_STUDENT_DETAIL_EARLY_DENIAL ${JSON.stringify({
            runTag,
            held,
            status: 403,
            clearedBeforeSibling: true,
            lateResponseIgnored: true,
          })}\n`,
        );
      } finally {
        native.request = originalRequest;
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
  it('clears loaded private content after actual HTTP 403 for the same token with revoked partner role', async () => {
    const page = await open();
    const role = {
      userId: owner.id,
      campusId: campuses[0],
      roleCode: 'PARTNER' as const,
    };
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
      await settle(page);
      expect(transport.calls.slice(start)).toMatchObject([
        { path: '/partners/me/profile', status: 403 },
        { path: `/partners/me/students/${studentId}`, status: 403 },
      ]);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        detail: null,
        growthItems: [],
      });
    } finally {
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
  });
});
