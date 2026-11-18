import { createHash, randomUUID } from 'node:crypto';
import { createConnection, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AuthService } from '../src/modules/auth/auth.service';
import { PartnerScopeService } from '../src/common/auth/partner-scope.service';
import { PartnerEarningQueryService } from '../src/modules/partner-earning/partner-earning-query.service';
import { PartnerEarningRuleService } from '../src/modules/partner-earning/partner-earning-rule.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  CampaignPageTransport,
  captureCampaignPage,
} from './support/partner-campaign-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);

interface EarningsPage {
  data: {
    viewState: string;
    anchorDate: string;
    statusIndex: number;
    summary: {
      estimatedTotalLabel: string;
      pendingReviewLabel: string;
      availableLabel: string;
      reversedNetLabel: string;
    } | null;
    rule: { id: string; unitPriceLabel: string; shareLabel: string } | null;
    entries: Array<{
      id: string;
      campusId: string;
      amountLabel: string;
      isReversal: boolean;
    }>;
    page: number;
    total: number;
    hasMore: boolean;
    loadingMore: boolean;
    refreshError: string;
  };
  setData: jest.Mock;
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onLogin(): void;
  onRetry(): void;
  onLoadMore(): void;
  onStatusChange(event: { detail: { value: string } }): void;
  onPeriodTap(event: { currentTarget: { dataset: { period: string } } }): void;
  onAnchorDateChange(event: { detail: { value: string } }): void;
}
interface AccountPreviewPage {
  data: {
    viewState: string;
    summary: { totalBalanceLabel: string } | null;
    earningPreviewState: string;
    earningAccountState: string;
    earningAccount: {
      estimatedTotalLabel: string;
      pendingReviewLabel: string;
    } | null;
    earningPreviewItems: Array<{
      id: string;
      amountLabel: string;
      typeLabel: string;
      registeredAtLabel: string;
      completedAtLabel: string;
    }>;
  };
  pendingRequest?: Promise<void>;
  earningPreviewPending?: Promise<void>;
  earningAccountPending?: Promise<void>;
  subjectPending?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onRetry(): void;
  onEarningsRetry(): void;
  onPullDownRefresh(): void;
}
const paths = {
  summary: '/partners/me/earnings/summary',
  rule: '/partners/me/earning-rule',
  entries: '/partners/me/earnings',
};
describe('partner earnings owner protection through isolated TCP', () => {
  const runTag = `peowner-${randomUUID().slice(0, 8)}`;
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const userIds: string[] = [],
    campusIds: string[] = [],
    ruleIds: string[] = [];
  const pages: EarningsPage[] = [];
  const previewPages: AccountPreviewPage[] = [];
  const storage = new Map<string, unknown>();
  const fixtureIds: Record<string, string[]> = {};
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number;
  let transport: CampaignPageTransport;
  let previewTransport: CampaignPageTransport;
  let owner: { id: string; token: string },
    other: { id: string; token: string };
  let runtime: { dataDriver: 'api'; apiBaseUrl: string; accessToken: string };
  let before: unknown, rolesBefore: unknown;
  const snapshot = async () => ({
    rules: await prisma.partnerEarningRule.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    bases: await prisma.partnerEarningBasis.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    entries: await prisma.partnerEarningEntry.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    lessons: await prisma.lessonSession.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    teaching: await prisma.teachingRecord.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    attendance: await prisma.attendanceRecord.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    groups: await prisma.classGroup.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    teachers: await prisma.teacherProfile.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
    students: await prisma.student.findMany({
      where: { campusId: { in: campusIds } },
      orderBy: { id: 'asc' },
    }),
  });
  const settle = async (page: EarningsPage) => {
    for (let index = 0; index < 3; index++) {
      await page.pendingRequest;
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async () => {
    const page = captureCampaignPage<EarningsPage>('earnings');
    pages.push(page);
    page.data.anchorDate = '2026-10-14';
    page.onLoad();
    page.onShow();
    await settle(page);
    return page;
  };
  const settlePreview = async (page: AccountPreviewPage) => {
    await Promise.all([
      page.pendingRequest,
      page.earningPreviewPending,
      page.earningAccountPending,
      page.subjectPending,
    ]);
    await previewTransport.idle();
  };
  const openPreview = async () => {
    const page = captureCampaignPage<AccountPreviewPage>('lesson-account');
    previewPages.push(page);
    page.onLoad();
    page.onShow();
    await settlePreview(page);
    return page;
  };
  const native = () => host.wx as { request: CampaignPageTransport['request'] };
  const hold = (routes: string[], delivery: 'held' | 'lost' = 'held') => {
    const original = native().request;
    const assigned = new Set<string>();
    native().request = (options) => {
      const path = new URL(options.url).pathname;
      if (routes.includes(path) && !assigned.has(path)) {
        assigned.add(path);
        transport.deliverNext(delivery);
      }
      return original(options);
    };
    return () => {
      native().request = original;
    };
  };
  const cleared = (page: EarningsPage) => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden',
      summary: null,
      rule: null,
      entries: [],
      page: 0,
      total: 0,
      hasMore: false,
      loadingMore: false,
      refreshError: '',
    });
    expect(page.pendingRequest).toBeUndefined();
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp());
    server = app.getHttpServer() as Server;
    const actor = async (suffix: 'owner' | 'other') => {
      const campus = await prisma.campus.create({
        data: {
          code: `${runTag}-${suffix}`,
          name: `${runTag}-${suffix}合成校区`,
        },
      });
      campusIds.push(campus.id);
      const user = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}`,
          roles: { create: { roleCode: 'PARTNER', campusId: campus.id } },
        },
      });
      userIds.push(user.id);
      const teacher = await prisma.user.create({
        data: {
          displayName: `${runTag}-${suffix}-teacher`,
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
      const teacherId = teacher.teacherProfile!.id;
      const group = await prisma.classGroup.create({
        data: {
          campusId: campus.id,
          teacherId,
          name: `${runTag}-${suffix}`,
          courseName: `${runTag}-${suffix}课程`,
        },
      });
      const student = await prisma.student.create({
        data: { campusId: campus.id, displayName: `${runTag}-${suffix}学员` },
      });
      const unitPriceFen = suffix === 'owner' ? 1000 : 3000;
      const shareBasisPoints = suffix === 'owner' ? 4000 : 3000;
      const amountFen = suffix === 'owner' ? 400 : 900;
      const rule = await prisma.partnerEarningRule.create({
        data: {
          campusId: campus.id,
          scopeKey: `campus:${campus.id}:partner`,
          unitPriceFen,
          shareBasisPoints,
          eligibleLessonKinds: ['REGULAR'],
          countedAttendanceStatuses: ['PRESENT'],
          version: 1,
          status: 'ACTIVE',
          effectiveFrom: new Date('2020-01-01T00:00:00Z'),
          createdByUserId: user.id,
        },
      });
      ruleIds.push(rule.id);
      for (let index = 0; index < (suffix === 'owner' ? 21 : 1); index++) {
        const reversed = suffix === 'owner' && index === 0;
        const completedAt = new Date(Date.UTC(2026, 9, 1, 3, index));
        const reversedAt = new Date('2026-10-02T03:00:00Z');
        const lesson = await prisma.lessonSession.create({
          data: {
            campusId: campus.id,
            classGroupId: group.id,
            teacherId,
            startsAt: new Date(completedAt.getTime() - 3_600_000),
            endsAt: completedAt,
            completedAt,
            status: reversed ? 'REVERSED' : 'COMPLETED',
            ...(reversed ? { reversedAt, reversalReason: '合成读取夹具' } : {}),
          },
        });
        await prisma.attendanceRecord.create({
          data: {
            campusId: campus.id,
            lessonSessionId: lesson.id,
            studentId: student.id,
            status: 'PRESENT',
            recordedByUserId: teacher.id,
          },
        });
        const teaching = await prisma.teachingRecord.create({
          data: {
            campusId: campus.id,
            lessonSessionId: lesson.id,
            teacherId,
            attendeeCount: 1,
            lessonUnits: 100,
            recordedByUserId: teacher.id,
            completedAt,
            status: reversed ? 'REVERSED' : 'COMPLETED',
            ...(reversed ? { reversedAt, reversalReason: '合成读取夹具' } : {}),
          },
        });
        const basis = await prisma.partnerEarningBasis.create({
          data: {
            campusId: campus.id,
            teachingRecordId: teaching.id,
            lessonSessionId: lesson.id,
            selectedRuleId: rule.id,
            lessonKind: 'REGULAR',
            lessonUnits: 100,
            actualAttendeeCount: 1,
            countedAttendeeCount: 1,
            attendanceSnapshot: [{ studentId: student.id, status: 'PRESENT' }],
            completedAt,
            status: reversed ? 'REVERSED' : 'PRICED',
          },
        });
        const ruleSnapshot = {
          ruleId: rule.id,
          ruleVersion: 1,
          unitPriceFen,
          shareBasisPoints,
          eligibleLessonKinds: ['REGULAR'],
          countedAttendanceStatuses: ['PRESENT'],
          settlementDelayDays: 0,
          lessonKind: 'REGULAR',
          lessonUnits: 100,
          actualAttendeeCount: 1,
          countedAttendeeCount: 1,
          perAttendeeAmountFen: amountFen,
          amountFen,
        };
        const entry = await prisma.partnerEarningEntry.create({
          data: {
            campusId: campus.id,
            earningBasisId: basis.id,
            entryType: 'ACCRUAL',
            amountFen,
            status: reversed
              ? 'REVERSED'
              : index > 10
                ? 'AVAILABLE'
                : 'PENDING_REVIEW',
            ruleSnapshot,
            reviewableAt: completedAt,
            createdAt: completedAt,
          },
        });
        if (reversed)
          await prisma.partnerEarningEntry.create({
            data: {
              campusId: campus.id,
              earningBasisId: basis.id,
              entryType: 'REVERSAL',
              amountFen: -amountFen,
              status: 'REVERSED',
              ruleSnapshot,
              reviewableAt: reversedAt,
              createdAt: reversedAt,
              reversalOfId: entry.id,
            },
          });
      }
      return {
        id: user.id,
        token: (await app.get(AuthService).issueSessionForUser(user.id))
          .accessToken,
      };
    };
    owner = await actor('owner');
    other = await actor('other');
    before = await snapshot();
    for (const [kind, rows] of Object.entries(
      before as Record<string, Array<{ id: string }>>,
    ))
      fixtureIds[kind] = rows.map((row) => row.id);
    rolesBefore = await prisma.userRole.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, roleCode: true, campusId: true },
      orderBy: { userId: 'asc' },
    });
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
      true,
    );
    previewTransport = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token, other.token]),
      false,
      false,
      false,
      true,
      true,
    );
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
      for (const page of previewPages) page.onUnload();
      await transport?.drain();
      await previewTransport?.drain();
      assertPartnerPdfTestTarget(process.env);
      const disabled = await prisma.user.updateMany({
        where: { id: { in: userIds }, displayName: { startsWith: runTag } },
        data: { status: 'DISABLED' },
      });
      expect(disabled.count).toBe(userIds.length);
      expect(await snapshot()).toEqual(before);
      expect(
        await prisma.userRole.findMany({
          where: { userId: { in: userIds } },
          select: { userId: true, roleCode: true, campusId: true },
          orderBy: { userId: 'asc' },
        }),
      ).toEqual(rolesBefore);
      const where = { campusId: { in: campusIds } };
      const zeroSideEffects = {
        orders: await prisma.enrollmentOrder.count({ where }),
        receipts: await prisma.financeReceipt.count({ where }),
        lessonLedger: await prisma.lessonLedgerEntry.count({ where }),
        packages: await prisma.coursePackage.count({ where }),
        teacherEarnings: await prisma.teacherEarningEntry.count({ where }),
        withdrawals: await prisma.withdrawal.count({ where }),
        campaigns: await prisma.campaign.count({ where }),
      };
      expect(Object.values(zeroSideEffects).every((count) => count === 0)).toBe(
        true,
      );
      process.stdout.write(
        `PARTNER_EARNINGS_OWNERSHIP ${JSON.stringify({
          runTag,
          userIds,
          campusIds,
          fixtureIds,
          roles: rolesBefore,
          immutableFixtures: true,
          fixtureSha256: createHash('sha256')
            .update(JSON.stringify(before))
            .digest('hex'),
          disabled: true,
          zeroSideEffects,
          disposition:
            'synthetic fixtures retained; users disabled; no deletion',
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
          `PARTNER_EARNINGS_SERVER_CLOSED ${JSON.stringify({ runTag, port, refused: true })}\n`,
        );
      }
    }
  });
  it('reads scoped nonempty totals, frozen rule, 20-to-22 unique entries and the negative reversal', async () => {
    const page = await open();
    expect(page.data).toMatchObject({
      viewState: 'ready',
      page: 1,
      total: 22,
      hasMore: true,
      summary: {
        estimatedTotalLabel: '¥80.00',
        pendingReviewLabel: '¥40.00',
        availableLabel: '¥40.00',
        reversedNetLabel: '-¥4.00',
      },
      rule: { id: ruleIds[0], unitPriceLabel: '¥10.00', shareLabel: '40%' },
    });
    expect(page.data.entries).toHaveLength(20);
    expect(
      page.data.entries.some(
        (row) => row.isReversal && row.amountLabel === '-¥4.00',
      ),
    ).toBe(true);
    page.onLoadMore();
    page.onLoadMore();
    await settle(page);
    expect(page.data).toMatchObject({ page: 2, total: 22, hasMore: false });
    expect(new Set(page.data.entries.map((row) => row.id)).size).toBe(22);
    expect(
      page.data.entries.every((row) => row.campusId === campusIds[0]),
    ).toBe(true);
    page.onStatusChange({ detail: { value: '2' } });
    await settle(page);
    expect(page.data).toMatchObject({
      page: 1,
      total: 10,
      hasMore: false,
      summary: { estimatedTotalLabel: '¥80.00' },
    });
    page.onAnchorDateChange({ detail: { value: '2026-09-01' } });
    await settle(page);
    expect(page.data).toMatchObject({
      viewState: 'empty',
      total: 0,
      entries: [],
      summary: { estimatedTotalLabel: '¥0.00' },
    });
    expect(page.data.rule?.id).toBe(ruleIds[0]);
    page.onUnload();
  });
  it.each(['owner', 'other'] as const)(
    'excludes rejected %s earnings from the total while retaining their journal entries',
    async (suffix) => {
      const index = suffix === 'owner' ? 0 : 1;
      const actor = suffix === 'owner' ? owner : other;
      const entry = await prisma.partnerEarningEntry.findFirstOrThrow({
        where: { campusId: campusIds[index], status: 'PENDING_REVIEW' },
      });
      try {
        await prisma.partnerEarningEntry.update({
          where: { id: entry.id },
          data: { status: 'REJECTED' },
        });
        await request(server)
          .get(paths.summary)
          .query({ period: 'MONTH', anchorDate: '2026-10-14' })
          .set('Authorization', `Bearer ${actor.token}`)
          .expect(200)
          .expect(({ body }: { body: { data: unknown } }) => {
            expect(body.data).toEqual({
              estimatedTotalFen: index === 0 ? 7600 : 0,
              pendingReviewFen: index === 0 ? 3600 : 0,
              availableFen: index === 0 ? 4000 : 0,
              reversedNetFen: index === 0 ? -400 : 0,
              currency: 'CNY',
            });
          });
        runtime.accessToken = actor.token;
        const page = await open();
        expect(page.data.summary?.estimatedTotalLabel).toBe(
          index === 0 ? '¥76.00' : '¥0.00',
        );
        page.onStatusChange({ detail: { value: '3' } });
        await settle(page);
        expect(page.data).toMatchObject({
          viewState: 'ready',
          total: 1,
          entries: [{ id: entry.id }],
          summary: {
            estimatedTotalLabel: index === 0 ? '¥76.00' : '¥0.00',
          },
        });
        page.onUnload();
      } finally {
        runtime.accessToken = owner.token;
        await prisma.partnerEarningEntry.update({
          where: { id: entry.id },
          data: { status: entry.status, updatedAt: entry.updatedAt },
        });
      }
    },
  );
  it.each(['AVAILABLE', 'REJECTED'] as const)(
    'keeps all summary amounts at one read point during a concurrent %s review',
    async (status) => {
      const entry = await prisma.partnerEarningEntry.findFirstOrThrow({
        where: { campusId: campusIds[0], status: 'PENDING_REVIEW' },
      });
      let changed = false;
      let releaseFirst!: () => void;
      const firstRead = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      let claimed = false;
      const atReadBoundary = async <T>(read: () => PromiseLike<T>) => {
        if (claimed) {
          await firstRead;
          return read();
        }
        claimed = true;
        try {
          const result = await read();
          await prisma.partnerEarningEntry.update({
            where: { id: entry.id },
            data: { status },
          });
          changed = true;
          return result;
        } finally {
          releaseFirst();
        }
      };
      const instrument = (client: Prisma.TransactionClient) =>
        ({
          campus: client.campus,
          partnerEarningEntry: {
            aggregate: (args: Prisma.PartnerEarningEntryAggregateArgs) =>
              atReadBoundary(() => client.partnerEarningEntry.aggregate(args)),
            groupBy: (args: Prisma.PartnerEarningEntryGroupByArgs) =>
              atReadBoundary(() => client.partnerEarningEntry.groupBy(args)),
          },
        }) as unknown as Prisma.TransactionClient;
      const instrumented = instrument(prisma);
      const service = new PartnerEarningQueryService(
        {
          ...instrumented,
          $transaction: (
            read: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: { isolationLevel: Prisma.TransactionIsolationLevel },
          ) => prisma.$transaction((tx) => read(instrument(tx)), options),
        } as PrismaService,
        app.get(PartnerScopeService),
        app.get(PartnerEarningRuleService),
      );
      try {
        const result = await service.getSummary(
          {
            userId: owner.id,
            roles: [{ code: 'PARTNER', campusId: campusIds[0] }],
          },
          { period: 'MONTH', anchorDate: '2026-10-14' },
        );
        expect(changed).toBe(true);
        expect(result).toEqual({
          estimatedTotalFen: 8000,
          pendingReviewFen: 4000,
          availableFen: 4000,
          reversedNetFen: -400,
          currency: 'CNY',
        });
        await request(server)
          .get(paths.summary)
          .query({ period: 'MONTH', anchorDate: '2026-10-14' })
          .set('Authorization', `Bearer ${owner.token}`)
          .expect(200)
          .expect(({ body }: { body: { data: unknown } }) => {
            expect(body.data).toMatchObject({
              estimatedTotalFen: status === 'REJECTED' ? 7600 : 8000,
              pendingReviewFen: 3600,
              availableFen: status === 'AVAILABLE' ? 4400 : 4000,
            });
          });
      } finally {
        await prisma.partnerEarningEntry.update({
          where: { id: entry.id },
          data: { status: entry.status, updatedAt: entry.updatedAt },
        });
      }
    },
  );
  it('clears an old page on identity replacement and reads only the new campus on a fresh page', async () => {
    const page = await open();
    const count = transport.calls.length;
    try {
      runtime.accessToken = other.token;
      page.onShow();
      page.onRetry();
      page.onLoadMore();
      page.onStatusChange({ detail: { value: '2' } });
      page.onPeriodTap({ currentTarget: { dataset: { period: 'DAY' } } });
      page.onAnchorDateChange({ detail: { value: '2026-09-01' } });
      await settle(page);
      cleared(page);
      expect(transport.calls).toHaveLength(count);
      const fresh = await open();
      expect(fresh.data).toMatchObject({
        summary: { estimatedTotalLabel: '¥9.00' },
        rule: { id: ruleIds[1] },
        total: 1,
      });
      expect(
        fresh.data.entries.every((row) => row.campusId === campusIds[1]),
      ).toBe(true);
      fresh.onUnload();
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it('cancels queued readers without sending the replacement token', async () => {
    const page = captureCampaignPage<EarningsPage>('earnings');
    pages.push(page);
    const count = transport.calls.length;
    page.onLoad();
    try {
      runtime.accessToken = other.token;
      page.onShow();
      await settle(page);
      cleared(page);
      expect(transport.calls).toHaveLength(count);
    } finally {
      runtime.accessToken = owner.token;
      page.onUnload();
    }
  });
  it('discards a held actual HTTP 200 after identity changes without a lifecycle event', async () => {
    const page = await open();
    const restore = hold([paths.entries]);
    page.onRetry();
    const reading = page.pendingRequest;
    try {
      await transport.idle();
      expect(transport.calls.at(-1)?.status).toBe(200);
      runtime.accessToken = other.token;
      transport.release();
      await reading;
      cleared(page);
    } finally {
      runtime.accessToken = owner.token;
      restore();
      transport.release();
      await reading;
      page.onUnload();
    }
  });
  it('ignores a hidden held reply and reloads the same owner on return', async () => {
    const page = await open();
    const restore = hold([paths.rule]);
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
      expect(page.data).toMatchObject({ viewState: 'ready', total: 22 });
    } finally {
      restore();
      transport.release();
      await reading;
      page.onUnload();
    }
  });
  it('retains scoped content after a lost GET reply and recovers by read-only retry', async () => {
    const page = await open(),
      entries = page.data.entries;
    const restore = hold([paths.summary], 'lost');
    try {
      page.onRetry();
      await settle(page);
      expect(page.data.entries).toBe(entries);
      expect(page.data.viewState).toBe('ready');
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
  it('clears and stops actual reads after explicit logout despite a failed navigation and a held success', async () => {
    const page = await open();
    const restore = hold([paths.entries]);
    page.onRetry();
    const reading = page.pendingRequest;
    try {
      await transport.idle();
      const reads = transport.calls.length;
      page.onLogin();
      expect(runtime.accessToken).toBe('');
      expect(storage.get('education.session.logged-out')).toBe(true);
      cleared(page);
      transport.release();
      await reading;
      page.onRetry();
      page.onLoadMore();
      page.onShow();
      await settle(page);
      cleared(page);
      expect(transport.calls).toHaveLength(reads);
    } finally {
      runtime.accessToken = owner.token;
      storage.delete('education.session.logged-out');
      restore();
      transport.release();
      await reading;
      page.onUnload();
    }
  });
  it.each([
    { source: 'summary', code: 401 },
    { source: 'rule', code: 401 },
    { source: 'entries', code: 401 },
    { source: 'summary', code: 403 },
    { source: 'rule', code: 403 },
    { source: 'entries', code: 403 },
  ] as const)(
    'clears on actual $source HTTP $code while both other replies remain held',
    async ({ source, code }) => {
      const page = await open();
      const role = {
        userId: owner.id,
        campusId: campusIds[0],
        roleCode: 'PARTNER' as const,
      };
      const restore = hold(
        Object.entries(paths)
          .filter(([key]) => key !== source)
          .map(([, value]) => value),
      );
      let reading: Promise<void> | undefined;
      try {
        if (code === 401) {
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
        } else
          expect(
            (
              await prisma.userRole.updateMany({
                where: role,
                data: { roleCode: 'TEACHER' },
              })
            ).count,
          ).toBe(1);
        const count = transport.calls.length;
        page.onRetry();
        reading = page.pendingRequest;
        await transport.idle();
        const calls = transport.calls.slice(count);
        expect(calls).toHaveLength(3);
        expect(calls.every((call) => call.status === code)).toBe(true);
        expect(calls.filter((call) => call.delivery === 'held')).toHaveLength(
          2,
        );
        expect(
          calls.find((call) => call.path === paths[source])?.delivery,
        ).toBe('success');
        cleared(page);
        const writes = page.setData.mock.calls.length;
        transport.release();
        await reading;
        expect(page.setData).toHaveBeenCalledTimes(writes);
        process.stdout.write(
          `PARTNER_EARNINGS_EARLY_DENIAL ${JSON.stringify({
            runTag,
            source,
            status: code,
            clearedBeforeBothSiblings: true,
            lateResponseIgnored: true,
          })}\n`,
        );
      } finally {
        restore();
        transport.release();
        await reading;
        if (code === 401)
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
  it('rejects caller-supplied campus scope on query routes and ignores it for the current-rule route', async () => {
    for (const path of [paths.summary, paths.entries])
      await request(server)
        .get(path)
        .auth(owner.token, { type: 'bearer' })
        .query({ campusId: campusIds[1] })
        .expect(400);
    const response = await request(server)
      .get(paths.rule)
      .auth(owner.token, { type: 'bearer' })
      .query({ campusId: campusIds[1] })
      .expect(200);
    expect(
      (response.body as { data: { id: string; campusId: string } }).data,
    ).toMatchObject({ id: ruleIds[0], campusId: campusIds[0] });
  });
  it('reads three actual recent earnings in an empty lesson account, preserving reversal dates and campus isolation', async () => {
    const original = native().request;
    native().request = previewTransport.request;
    try {
      const first = await openPreview();
      const expected = await prisma.partnerEarningEntry.findMany({
        where: { campusId: campusIds[0] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: { id: true },
      });
      expect(first.data).toMatchObject({
        viewState: 'empty',
        summary: { totalBalanceLabel: '0' },
        earningPreviewState: 'ready',
        earningAccountState: 'ready',
        earningAccount: {
          estimatedTotalLabel: '¥80.00',
          pendingReviewLabel: '¥40.00',
        },
      });
      expect(first.data.earningPreviewItems.map((row) => row.id)).toEqual(
        expected.map((row) => row.id),
      );
      expect(first.data.earningPreviewItems[0]).toMatchObject({
        amountLabel: '-¥4.00',
        typeLabel: '收益冲正',
        registeredAtLabel: '2026年10月2日 11:00',
        completedAtLabel: '2026年10月1日 11:00',
      });
      const count = previewTransport.calls.length;
      expect(count).toBe(5);
      expect(
        previewTransport.calls.filter((call) => call.path === paths.summary),
      ).toHaveLength(1);
      expect(
        previewTransport.calls.filter((call) => call.path === paths.entries),
      ).toHaveLength(1);
      runtime.accessToken = other.token;
      first.onEarningsRetry();
      await settlePreview(first);
      expect(first.data).toMatchObject({
        viewState: 'forbidden',
        summary: null,
        earningPreviewItems: [],
        earningAccount: null,
      });
      expect(previewTransport.calls).toHaveLength(count);
      const second = await openPreview();
      expect(second.data.earningPreviewItems).toHaveLength(1);
      expect(second.data.earningPreviewItems[0].amountLabel).toBe('¥9.00');
      expect(await snapshot()).toEqual(before);
      process.stdout.write(
        `PARTNER_ACCOUNT_EARNINGS_TCP ${JSON.stringify({
          runTag,
          port,
          recent: 3,
          negativeReversal: true,
          emptyLessonAccount: true,
          campusIsolation: true,
          sourceUnchanged: true,
        })}\n`,
      );
    } finally {
      runtime.accessToken = owner.token;
      for (const page of previewPages) page.onUnload();
      await previewTransport.drain();
      native().request = original;
    }
  });
  it('clears the whole account on actual earnings 403 before two held account replies', async () => {
    const original = native().request;
    native().request = previewTransport.request;
    const role = {
      userId: owner.id,
      campusId: campusIds[0],
      roleCode: 'PARTNER' as const,
    };
    let changed = false;
    let reads: Array<Promise<void>> = [];
    try {
      const page = await openPreview();
      expect(
        (
          await prisma.userRole.updateMany({
            where: role,
            data: { roleCode: 'TEACHER' },
          })
        ).count,
      ).toBe(1);
      changed = true;
      native().request = (options) => {
        if (new URL(options.url).pathname !== paths.entries)
          previewTransport.deliverNext('held');
        return previewTransport.request(options);
      };
      const count = previewTransport.calls.length;
      page.onPullDownRefresh();
      reads = [
        page.pendingRequest!,
        page.earningPreviewPending!,
        page.earningAccountPending!,
        page.subjectPending!,
      ];
      await previewTransport.idle();
      const calls = previewTransport.calls.slice(count);
      expect(calls).toHaveLength(5);
      expect(calls.filter((call) => call.delivery === 'held')).toHaveLength(4);
      expect(calls.find((call) => call.path === paths.entries)?.status).toBe(
        403,
      );
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        summary: null,
        earningPreviewItems: [],
      });
      previewTransport.release();
      await Promise.all(reads);
      expect(page.data).toMatchObject({
        viewState: 'forbidden',
        summary: null,
        earningPreviewItems: [],
      });
    } finally {
      previewTransport.release();
      await Promise.all(reads);
      if (changed)
        expect(
          (
            await prisma.userRole.updateMany({
              where: { ...role, roleCode: 'TEACHER' },
              data: { roleCode: 'PARTNER' },
            })
          ).count,
        ).toBe(1);
      for (const page of previewPages) page.onUnload();
      await previewTransport.drain();
      native().request = original;
    }
  });
  it('requires explicit earnings opt-in and rejects earnings writes and unrelated reads', () => {
    const options = {
      url: `${runtime.apiBaseUrl}${paths.entries}`,
      method: 'GET' as const,
      header: { Authorization: `Bearer ${owner.token}` },
      success: jest.fn(),
      fail: jest.fn(),
    };
    const restricted = new CampaignPageTransport(
      runtime.apiBaseUrl,
      new Set([owner.token]),
    );
    for (const path of Object.values(paths)) {
      expect(() =>
        restricted.request({ ...options, url: `${runtime.apiBaseUrl}${path}` }),
      ).toThrow('outside its scope');
      expect(() =>
        transport.request({
          ...options,
          url: `${runtime.apiBaseUrl}${path}`,
          method: 'POST',
        }),
      ).toThrow('outside its scope');
    }
    expect(() =>
      transport.request({
        ...options,
        url: `${runtime.apiBaseUrl}/partners/me/lesson-account`,
      }),
    ).toThrow('outside its scope');
  });
});
