import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { RoleCode } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { assertPartnerPdfTestTarget } from './support/partner-pdf-test-database';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import { CampaignPageTransport } from './support/partner-campaign-page-harness';

assertPartnerPdfTestTarget(process.env);
jest.setTimeout(60_000);
interface PageHost {
  data: object;
  setData: jest.Mock;
  onLoad(query: Record<string, string>): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  pendingLoad?: Promise<void>;
  pendingRequest?: Promise<void>;
  pendingSave?: Promise<void>;
  pendingWrite?: Promise<void>;
  freePending?: Promise<void>;
  listPending?: Promise<void>;
  working?: Promise<void>;
  pending?: Promise<void>;
}
interface Editor extends PageHost {
  submitAttempt?: unknown;
  data: {
    viewState: string;
    draftId: string;
    version: number;
    freeReady: boolean;
    freeDirty: boolean;
    submitUncertain: boolean;
    submitRefreshNeeded: boolean;
    freeSaveUnknown: boolean;
    needsVersionRefresh: boolean;
    hasPendingReview: boolean;
    form: { title: string };
    publishedPath: string;
    history: Array<{ versionId: string; campaignId: string; status: string }>;
    registrations: Array<{
      registrationId: string;
      status: string;
      studentName: string | null;
    }>;
    registrationTotal: number;
    registrationFilterIndex: number;
    registrationPage: number;
    registrationHasMore: boolean;
    registrationCountLabel: string;
    listError: string;
    freeMessage: string;
  };
  onInput(event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }): void;
  onFreeInput(event: {
    currentTarget: { dataset: { field: string } };
    detail: { value: string };
  }): void;
  onTypeChange(event: { detail: { value: string } }): void;
  onCapacityChange(event: { detail: { value: string } }): void;
  onSave(): Promise<void>;
  onFreeSave(): Promise<void>;
  onSubmit(): Promise<void>;
  onFreeTab(event: { currentTarget: { dataset: { tab: string } } }): void;
  onRegistrationFilterChange(event: { detail: { value: string } }): void;
  onListMore(): Promise<void>;
  onListRetry(): Promise<void>;
  onReload(): Promise<void>;
  onCopyPath(): void;
}
interface Reviewer extends PageHost {
  data: {
    viewState: string;
    uncertain: boolean;
    detail: { status: string; publishedVersionId: string | null } | null;
    reason: string;
    needsRefresh: boolean;
  };
  onApprove(): void;
  onReject(): void;
  onCloseCampaign(): void;
  onRetryAction(): void;
  onReasonInput(event: { detail: { value: string } }): void;
  onReload(): Promise<void>;
}
interface Parent extends PageHost {
  intent?: { kind: string; key: string };
  data: {
    viewState: string;
    uncertain: boolean;
    conflict: boolean;
    busy: boolean;
    readbackRequired: boolean;
    selectedStudentId: string;
    campaigns: unknown[];
    registrations: Array<{ registrationId: string; status: string }>;
    mode: string;
    campaign: {
      versionId: string;
      registeredCount: number;
      eligibleStudents: Array<{ studentId: string }>;
    } | null;
    registration: {
      registrationId: string;
      status: string;
      version: number;
      versionId: string;
      canCancel: boolean;
      title: string;
    } | null;
  };
  onStudentChange(event: { detail: { value: string } }): void;
  onRegister(): Promise<void>;
  onRetryWrite(): Promise<void>;
  onCancel(): void;
  onReload(): Promise<void>;
  onTabChange(event: { currentTarget: { dataset: { tab: string } } }): void;
  onOpenRegistration(event: {
    currentTarget: { dataset: { id: string } };
  }): Promise<void>;
}
type Actor = { id: string; token: string };

describe('three real free-campaign Pages through local TCP and isolated PostgreSQL', () => {
  const runTag = `fcpage-${randomUUID().slice(0, 8)}`;
  const userIds: string[] = [];
  const tokens = new Set<string>();
  const pages: PageHost[] = [];
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let app: INestApplication;
  let prisma: PrismaService;
  let campusId: string;
  let studentId: string;
  let partner: Actor;
  let admin: Actor;
  let parent: Actor;
  let origin: string;
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };
  let transport: CampaignPageTransport;
  const clipboard: string[] = [];

  const actor = async (
    roleCode: RoleCode,
    scope: string | null,
  ): Promise<Actor> => {
    const row = await prisma.user.create({
      data: {
        displayName: `${runTag}-${userIds.length}`,
        roles: { create: { roleCode, campusId: scope } },
      },
    });
    userIds.push(row.id);
    const token = (await app.get(AuthService).issueSessionForUser(row.id))
      .accessToken;
    tokens.add(token);
    return { id: row.id, token };
  };
  const capture = <T extends PageHost>(route: string): T => {
    const allowed = [
      'partner/campaign-editor',
      'super-admin/campaign-review-detail',
      'parent/campaign-registration',
    ];
    if (!allowed.includes(route))
      throw new Error('Page fixture route is outside its scope');
    let page: T | undefined;
    host.Page = (value: T) => {
      page = {
        ...value,
        data: structuredClone(value.data),
        setData: jest.fn((patch: object) => Object.assign(page!.data, patch)),
      };
    };
    jest.isolateModules(() => {
      jest.requireActual(`../../frontend/pages/${route}/index.ts`);
    });
    if (!page) throw new Error('Actual Page did not register');
    pages.push(page);
    return page;
  };
  const tasks = (page: PageHost) =>
    [
      page.pendingLoad,
      page.pendingRequest,
      page.pendingSave,
      page.pendingWrite,
      page.freePending,
      page.listPending,
      page.working,
      page.pending,
    ].filter((p): p is Promise<void> => p !== undefined);
  const settle = async (page: PageHost) => {
    for (let round = 0; round < 4; round++) {
      await Promise.all(tasks(page));
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const open = async <T extends PageHost>(
    route: string,
    owner: Actor,
    query: Record<string, string> = {},
  ): Promise<T> => {
    runtime.accessToken = owner.token;
    const page = capture<T>(route);
    page.onLoad(query);
    page.onShow();
    await settle(page);
    return page;
  };
  const edit = (page: Editor, field: string, value: string, free = false) => {
    const event = {
      currentTarget: { dataset: { field } },
      detail: { value },
    };
    if (free) page.onFreeInput(event);
    else page.onInput(event);
  };
  const configured = async (owner: Actor = partner): Promise<Editor> => {
    const page = await open<Editor>('partner/campaign-editor', owner);
    edit(page, 'title', `${runTag}免费活动`);
    edit(page, 'shareDescription', '合成资料：只记录报名，不自动送课');
    page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
    await page.onSave();
    await settle(page);
    expect(page.data.freeReady).toBe(true);
    edit(page, 'startsAt', new Date(Date.now() - 60_000).toISOString(), true);
    edit(page, 'endsAt', new Date(Date.now() + 3_600_000).toISOString(), true);
    page.onCapacityChange({ detail: { value: 'LIMITED' } });
    edit(page, 'maxRegistrations', '1', true);
    await page.onFreeSave();
    await settle(page);
    expect(page.data).toMatchObject({
      viewState: 'ready',
      version: 2,
      freeDirty: false,
    });
    return page;
  };
  const submitted = async () => {
    const editor = await configured();
    await editor.onSubmit();
    await settle(editor);
    const version = editor.data.history[0];
    expect(version.status).toBe('SUBMITTED');
    editor.onUnload();
    return { draftId: editor.data.draftId, ...version };
  };
  const live = async () => {
    const row = await submitted();
    const review = await open<Reviewer>(
      'super-admin/campaign-review-detail',
      admin,
      { id: row.versionId },
    );
    expect(review.data.detail?.status).toBe('SUBMITTED');
    review.onApprove();
    await settle(review);
    expect(review.data.detail?.status).toBe('APPROVED');
    review.onUnload();
    return row;
  };
  const registered = async (owner?: Actor, childId?: string) => {
    const guardian = owner ?? (await actor('PARENT', campusId));
    let selectedId = childId;
    if (!selectedId) {
      selectedId = (
        await prisma.student.create({
          data: { campusId, displayName: `${runTag}-cancel-child` },
        })
      ).id;
      await prisma.parentStudentBinding.create({
        data: { campusId, parentUserId: guardian.id, studentId: selectedId },
      });
    }
    const candidate = await live();
    const family = await open<Parent>(
      'parent/campaign-registration',
      guardian,
      {
        campaignId: candidate.campaignId,
        versionId: candidate.versionId,
      },
    );
    expect(family.data.campaign?.eligibleStudents).toContainEqual(
      expect.objectContaining({ studentId: selectedId }),
    );
    family.onStudentChange({ detail: { value: selectedId } });
    expect(family.data).toMatchObject({ canRegister: true });
    await family.onRegister();
    await settle(family);
    expect(family.data.registration).toMatchObject({
      status: 'REGISTERED',
      version: 1,
      canCancel: true,
    });
    return {
      candidate,
      family,
      owner: guardian,
      registrationId: family.data.registration!.registrationId,
    };
  };
  const cancelledOnce = async (id: string, actorId?: string) => {
    const row = await prisma.campaignRegistration.findUniqueOrThrow({
      where: { id },
    });
    const expectedActor = actorId ?? row.parentUserId;
    expect(row).toMatchObject({
      campusId,
      status: 'CANCELLED',
      version: 2,
      cancelledByUserId: expectedActor,
    });
    expect(row.cancelledAt).not.toBeNull();
    expect(
      await prisma.auditLog.count({
        where: {
          campusId,
          resourceId: id,
          action: 'FREE_CAMPAIGN_CANCEL',
          actorUserId: expectedActor,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.campaignRegistration.count({
        where: { campaignId: row.campaignId, status: 'REGISTERED' },
      }),
    ).toBe(0);
    return row;
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
    parent = await actor('PARENT', campusId);
    studentId = (
      await prisma.student.create({
        data: { campusId, displayName: `${runTag}学员` },
      })
    ).id;
    await prisma.parentStudentBinding.create({
      data: { campusId, parentUserId: parent.id, studentId },
    });
    await app.listen(0, '127.0.0.1');
    const address = (
      app.getHttpServer() as { address(): AddressInfo }
    ).address();
    origin = `http://127.0.0.1:${address.port}`;
    transport = new CampaignPageTransport(origin, tokens, true);
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: partner.token,
    };
    for (const key of ['wx', 'Page', 'getCurrentPages'])
      globals.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) =>
        key === 'education.runtime' ? runtime : undefined,
      request: transport.request,
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({
        top: 32,
        left: 295,
        height: 32,
        bottom: 64,
      }),
      showModal: (options: {
        success(result: { confirm: boolean; cancel: boolean }): void;
      }) => options.success({ confirm: true, cancel: false }),
      setClipboardData: (options: { data: string; success(): void }) => {
        clipboard.push(options.data);
        options.success();
      },
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    host.getCurrentPages = () => [{}, ...pages];
  });
  afterEach(async () => {
    const pending = pages.flatMap(tasks);
    for (const page of pages.splice(0)) page.onUnload();
    await transport.drain();
    await Promise.all(pending);
  });
  afterAll(async () => {
    try {
      if (prisma) {
        assertPartnerPdfTestTarget(process.env);
        const disabled = await prisma.user.updateMany({
          where: { id: { in: userIds }, displayName: { startsWith: runTag } },
          data: { status: 'DISABLED' },
        });
        expect(disabled.count).toBe(userIds.length);
        const owned = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { status: true },
        });
        expect(owned.every((u) => u.status === 'DISABLED')).toBe(true);
        process.stdout.write(
          `FREE_CAMPAIGN_PAGE_OWNERSHIP ${JSON.stringify({ runTag, campusId, userIds, allOwnedUsersDisabled: true, disposition: 'retained; no deletion' })}\n`,
        );
        process.stdout.write(
          `FREE_CAMPAIGN_PAGE_HTTP ${JSON.stringify({ runTag, calls: transport.calls.map(({ method, path, status, delivery }) => ({ method, path, status, delivery })) })}\n`,
        );
        const financial = {
          groups: await prisma.groupCampaign.count({ where: { campusId } }),
          orders: await prisma.enrollmentOrder.count({ where: { campusId } }),
          products: await prisma.courseProduct.count({ where: { campusId } }),
          packages: await prisma.coursePackage.count({ where: { campusId } }),
          ledger: await prisma.lessonLedgerEntry.count({ where: { campusId } }),
          payments: await prisma.paymentTransaction.count({
            where: { enrollmentOrder: { campusId } },
          }),
          partnerEarnings: await prisma.partnerEarningEntry.count({
            where: { campusId },
          }),
          teacherEarnings: await prisma.teacherEarningEntry.count({
            where: { campusId },
          }),
        };
        expect(Object.values(financial).every((count) => count === 0)).toBe(
          true,
        );
        const registrations = await prisma.campaignRegistration.findMany({
          where: { campusId },
          select: {
            id: true,
            campaignId: true,
            versionId: true,
            studentId: true,
            parentUserId: true,
            status: true,
            version: true,
            cancelledByUserId: true,
          },
          orderBy: { id: 'asc' },
        });
        process.stdout.write(
          `FREE_CAMPAIGN_PAGE_FACTS ${JSON.stringify({ runTag, campusId, registrations, financial })}\n`,
        );
      }
    } finally {
      try {
        await app?.close();
        if (app && origin) {
          const listenerClosed = !(
            app.getHttpServer() as { listening: boolean }
          ).listening;
          expect(listenerClosed).toBe(true);
          process.stdout.write(
            `FREE_CAMPAIGN_PAGE_CLOSED ${JSON.stringify({ runTag, port: Number(new URL(origin).port), listenerClosed })}\n`,
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

  it('configures, retries lost submission and approval receipts, registers, cancels and reads the partner result', async () => {
    const editor = await configured();
    transport.deliverNext('lost');
    await editor.onSubmit();
    await settle(editor);
    expect(editor.data.submitUncertain).toBe(true);
    const first = transport.calls.findLast((c) => c.path.endsWith('/submit'))!;
    await editor.onSubmit();
    await settle(editor);
    const replay = transport.calls.findLast((c) => c.path.endsWith('/submit'))!;
    expect(replay.key).toBe(first.key);
    const candidate = editor.data.history[0];
    const draftId = editor.data.draftId;
    editor.onUnload();
    const review = await open<Reviewer>(
      'super-admin/campaign-review-detail',
      admin,
      { id: candidate.versionId },
    );
    transport.deliverNext('lost');
    review.onApprove();
    await settle(review);
    expect(review.data.uncertain).toBe(true);
    const approval = transport.calls.findLast((c) =>
      c.path.endsWith('/approve'),
    )!;
    review.onRetryAction();
    await settle(review);
    expect(
      transport.calls.findLast((c) => c.path.endsWith('/approve'))!.key,
    ).toBe(approval.key);
    expect(review.data.detail?.status).toBe('APPROVED');
    review.onUnload();
    const family = await open<Parent>('parent/campaign-registration', parent, {
      campaignId: candidate.campaignId,
      versionId: candidate.versionId,
    });
    family.onStudentChange({ detail: { value: studentId } });
    transport.deliverNext('lost');
    await family.onRegister();
    await settle(family);
    expect(family.data.uncertain).toBe(true);
    const registration = transport.calls.findLast(
      (c) => c.method === 'POST' && c.path.endsWith('/registrations'),
    )!;
    await family.onRetryWrite();
    await settle(family);
    expect(
      transport.calls.findLast(
        (c) => c.method === 'POST' && c.path.endsWith('/registrations'),
      )!.key,
    ).toBe(registration.key);
    expect(family.data.registration?.status).toBe('REGISTERED');
    family.onCancel();
    await settle(family);
    expect(family.data.registration?.status).toBe('CANCELLED');
    family.onUnload();
    const results = await open<Editor>('partner/campaign-editor', partner, {
      id: draftId,
    });
    results.onCopyPath();
    expect(clipboard.at(-1)).toBe(
      `/pages/parent/campaign-registration/index?campaignId=${candidate.campaignId}&versionId=${candidate.versionId}`,
    );
    results.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } });
    await settle(results);
    expect(results.data.registrationTotal).toBe(1);
    expect(results.data.registrations[0].status).toBe('CANCELLED');
    expect(JSON.stringify(results.data.registrations)).not.toMatch(
      /parentUserId|parentPhone|openid|homeAddress/,
    );
    expect(await prisma.enrollmentOrder.count({ where: { campusId } })).toBe(0);
    expect(await prisma.lessonLedgerEntry.count({ where: { campusId } })).toBe(
      0,
    );
    results.onUnload();
    const closing = await open<Reviewer>(
      'super-admin/campaign-review-detail',
      admin,
      { id: candidate.versionId },
    );
    closing.onReasonInput({ detail: { value: '合成资料：活动下架' } });
    closing.onCloseCampaign();
    await settle(closing);
    expect(closing.data.detail).toMatchObject({ lifecycle: 'CLOSED' });
    closing.onUnload();
    const closed = await open<Parent>('parent/campaign-registration', parent, {
      campaignId: candidate.campaignId,
      versionId: candidate.versionId,
    });
    expect(closed.data.campaign).toMatchObject({ availability: 'CLOSED' });
  });

  it('filters the actual partner roster through TCP before 20-to-21 pagination and retries only its GET', async () => {
    const editor = await configured();
    editor.onCapacityChange({ detail: { value: 'UNLIMITED' } });
    await editor.onFreeSave();
    await settle(editor);
    await editor.onSubmit();
    await settle(editor);
    const candidate = editor.data.history[0];
    const draftId = editor.data.draftId;
    editor.onUnload();
    const review = await open<Reviewer>(
      'super-admin/campaign-review-detail',
      admin,
      { id: candidate.versionId },
    );
    review.onApprove();
    await settle(review);
    expect(review.data.detail?.status).toBe('APPROVED');
    review.onUnload();
    const { ParentFreeCampaignService } = jest.requireActual<{
      ParentFreeCampaignService: new (options: {
        dataDriver: 'api';
        apiBaseUrl: string;
        accessToken: () => string;
      }) => {
        register(
          campaignId: string,
          versionId: string,
          studentId: string,
          key: string,
        ): Promise<{ registrationId: string; version: number }>;
        cancel(
          registrationId: string,
          version: number,
          key: string,
        ): Promise<unknown>;
      };
    }>('../../frontend/pages/parent/runtime/free-campaign.service.ts');
    const registration = new ParentFreeCampaignService({
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: () => parent.token,
    });
    for (let index = 0; index < 22; index++) {
      const child = await prisma.student.create({
        data: { campusId, displayName: `${runTag}-filter-${index}` },
      });
      await prisma.parentStudentBinding.create({
        data: { campusId, parentUserId: parent.id, studentId: child.id },
      });
      const row = await registration.register(
        candidate.campaignId,
        candidate.versionId,
        child.id,
        randomUUID(),
      );
      if (index === 21)
        await registration.cancel(
          row.registrationId,
          row.version,
          randomUUID(),
        );
    }
    const results = await open<Editor>('partner/campaign-editor', partner, {
      id: draftId,
    });
    results.onFreeTab({ currentTarget: { dataset: { tab: 'registrations' } } });
    await settle(results);
    expect(results.data).toMatchObject({
      registrationFilterIndex: 0,
      registrationTotal: 22,
      registrationCountLabel: '报名记录：22',
    });
    expect(results.data.registrations).toHaveLength(20);
    const writes = transport.calls.filter(
      (call) => call.method !== 'GET',
    ).length;
    results.onRegistrationFilterChange({ detail: { value: '1' } });
    expect(results.data).toMatchObject({
      registrationTotal: 0,
      registrationPage: 0,
      registrations: [],
      registrationCountLabel: '',
    });
    await settle(results);
    expect(results.data).toMatchObject({
      registrationTotal: 21,
      registrationCountLabel: '已报名：21',
      registrationHasMore: true,
    });
    expect(results.data.registrations).toHaveLength(20);
    await results.onListMore();
    await settle(results);
    expect(results.data.registrations).toHaveLength(21);
    expect(
      results.data.registrations.every((row) => row.status === 'REGISTERED'),
    ).toBe(true);
    expect(results.data.registrationHasMore).toBe(false);
    transport.deliverNext('lost');
    results.onRegistrationFilterChange({ detail: { value: '2' } });
    await settle(results);
    expect(results.data.listError).toBeTruthy();
    expect(results.data.registrationCountLabel).toBe('');
    await results.onListRetry();
    await settle(results);
    expect(results.data).toMatchObject({
      registrationFilterIndex: 2,
      registrationTotal: 1,
      registrationCountLabel: '已撤销：1',
      registrationHasMore: false,
      listError: '',
    });
    expect(results.data.registrations).toEqual([
      expect.objectContaining({ status: 'CANCELLED' }),
    ]);
    results.onRegistrationFilterChange({ detail: { value: '0' } });
    await settle(results);
    expect(results.data.registrationTotal).toBe(22);
    expect(
      transport.calls.filter((call) => call.method !== 'GET'),
    ).toHaveLength(writes);
    expect(JSON.stringify(results.data.registrations)).not.toMatch(
      /parentUserId|parentPhone|openid|homeAddress/,
    );
    process.stdout.write(
      `PARTNER_REGISTRATION_FILTER_TCP ${JSON.stringify({ runTag, draftId, total: 22, registered: 21, cancelled: 1, pageSize: 20, readOnlyRetries: true })}\n`,
    );
  });

  it('reads the frozen rejection and resubmits from the actual partner editor', async () => {
    const candidate = await submitted();
    const review = await open<Reviewer>(
      'super-admin/campaign-review-detail',
      admin,
      { id: candidate.versionId },
    );
    review.onReasonInput({ detail: { value: '合成资料：补充说明后再提交' } });
    review.onReject();
    await settle(review);
    expect(review.data.detail?.status).toBe('REJECTED');
    review.onUnload();
    const editor = await open<Editor>('partner/campaign-editor', partner, {
      id: candidate.draftId,
    });
    expect(editor.data.history[0].status).toBe('REJECTED');
    edit(editor, 'shareDescription', '已补充说明的合成活动');
    await editor.onSave();
    await settle(editor);
    await editor.onSubmit();
    await settle(editor);
    expect(editor.data.history[0].status).toBe('SUBMITTED');
    expect(editor.data.history[0].versionId).not.toBe(candidate.versionId);
  });

  it('preserves a selected student on capacity conflict and clears data after live binding revocation', async () => {
    const candidate = await live();
    const family = await open<Parent>('parent/campaign-registration', parent, {
      campaignId: candidate.campaignId,
      versionId: candidate.versionId,
    });
    family.onStudentChange({ detail: { value: studentId } });
    const guardian = await actor('PARENT', campusId);
    await prisma.parentStudentBinding.create({
      data: { campusId, parentUserId: guardian.id, studentId },
    });
    const { ParentFreeCampaignService } = jest.requireActual<{
      ParentFreeCampaignService: new (options: {
        dataDriver: 'api';
        apiBaseUrl: string;
        accessToken: () => string;
      }) => {
        register(
          campaignId: string,
          versionId: string,
          studentId: string,
          key: string,
        ): Promise<unknown>;
      };
    }>('../../frontend/pages/parent/runtime/free-campaign.service.ts');
    const service = new ParentFreeCampaignService({
      dataDriver: 'api',
      apiBaseUrl: origin,
      accessToken: () => guardian.token,
    });
    await service.register(
      candidate.campaignId,
      candidate.versionId,
      studentId,
      randomUUID(),
    );
    await family.onRegister();
    await settle(family);
    expect(family.data).toMatchObject({
      conflict: true,
      campaign: { versionId: candidate.versionId },
    });
    const otherStudents = family.data
      .campaign!.eligibleStudents.filter((row) => row.studentId !== studentId)
      .map((row) => row.studentId)
      .sort();
    await prisma.parentStudentBinding.updateMany({
      where: { parentUserId: parent.id, studentId, campusId },
      data: {
        campusId: (
          await prisma.campus.create({
            data: { code: `${runTag}-moved`, name: '合成其他校区' },
          })
        ).id,
      },
    });
    await family.onReload();
    await settle(family);
    expect(
      family.data.campaign?.eligibleStudents.map((row) => row.studentId).sort(),
    ).toEqual(otherStudents);
  });

  it('ignores a held HTTP reply after the actual parent Page leaves', async () => {
    const candidate = await live();
    runtime.accessToken = parent.token;
    const family = capture<Parent>('parent/campaign-registration');
    transport.deliverNext('held');
    family.onLoad({
      campaignId: candidate.campaignId,
      versionId: candidate.versionId,
    });
    family.onShow();
    await transport.idle();
    family.onHide();
    const before = structuredClone(family.data);
    transport.release();
    await settle(family);
    expect(family.data).toEqual(before);
  });

  it('starts a fresh HTTP read on return and ignores an older reply after binding revocation', async () => {
    const candidate = await live();
    const guardian = await actor('PARENT', campusId);
    const binding = await prisma.parentStudentBinding.create({
      data: { campusId, parentUserId: guardian.id, studentId },
    });
    runtime.accessToken = guardian.token;
    const family = capture<Parent>('parent/campaign-registration');
    const path = `/parents/me/free-campaigns/${candidate.campaignId}`;
    const before = transport.calls.filter((c) => c.path === path).length;
    transport.deliverNext('held');
    family.onLoad({
      campaignId: candidate.campaignId,
      versionId: candidate.versionId,
    });
    family.onShow();
    await transport.idle();
    expect(transport.calls.filter((c) => c.path === path)).toHaveLength(
      before + 1,
    );
    const oldRequest = family.pendingRequest;
    family.onHide();
    const otherCampus = await prisma.campus.create({
      data: { code: `${runTag}-revoked`, name: '合成解绑校区' },
    });
    await prisma.parentStudentBinding.update({
      where: { id: binding.id },
      data: { campusId: otherCampus.id },
    });
    family.onShow();
    await transport.idle();
    expect(family.data.campaign?.eligibleStudents).toEqual([]);
    transport.release();
    await oldRequest;
    await settle(family);
    expect(transport.calls.filter((c) => c.path === path)).toHaveLength(
      before + 2,
    );
    expect(family.data.campaign?.eligibleStudents).toEqual([]);
  });

  it.each(['APPROVED', 'REJECTED'] as const)(
    'reads the current %s review after replaying a lost submission receipt',
    async (status) => {
      const editor = await configured();
      transport.deliverNext('lost');
      await editor.onSubmit();
      await settle(editor);
      expect(editor.data.submitUncertain).toBe(true);
      const first = transport.calls.findLast((c) =>
        c.path.endsWith('/submit'),
      )!;
      const candidate = await prisma.campaignVersion.findFirstOrThrow({
        where: { campaign: { draftId: editor.data.draftId } },
      });
      const review = await open<Reviewer>(
        'super-admin/campaign-review-detail',
        admin,
        { id: candidate.id },
      );
      if (status === 'APPROVED') review.onApprove();
      else {
        review.onReasonInput({ detail: { value: '合成资料：请补充说明' } });
        review.onReject();
      }
      await settle(review);
      expect(review.data.detail?.status).toBe(status);
      review.onUnload();
      runtime.accessToken = partner.token;
      await editor.onSubmit();
      await settle(editor);
      expect(
        transport.calls.findLast((c) => c.path.endsWith('/submit'))!.key,
      ).toBe(first.key);
      expect(editor.data).toMatchObject({
        submitUncertain: false,
        hasPendingReview: false,
        history: [expect.objectContaining({ status })],
      });
      expect(
        await prisma.campaignVersion.count({
          where: { campaignId: candidate.campaignId },
        }),
      ).toBe(1);
      if (status === 'APPROVED') {
        expect(editor.data.publishedPath).toBe(
          `/pages/parent/campaign-registration/index?campaignId=${candidate.campaignId}&versionId=${candidate.id}`,
        );
      } else {
        await editor.onSubmit();
        await settle(editor);
        expect(editor.data.history[0].status).toBe('SUBMITTED');
        expect(editor.data.history[0].versionId).not.toBe(candidate.id);
      }
    },
  );

  it('keeps the partner conflict gate and local input across hide/show until explicit reread', async () => {
    const editor = await configured();
    const originalTitle = editor.data.form.title;
    const concurrent = await open<Editor>('partner/campaign-editor', partner, {
      id: editor.data.draftId,
    });
    edit(concurrent, 'title', `${runTag}合成其他修改`);
    await concurrent.onSave();
    await settle(concurrent);
    concurrent.onUnload();
    await editor.onSubmit();
    await settle(editor);
    expect(
      transport.calls.findLast((c) => c.path.endsWith('/submit')),
    ).toMatchObject({
      status: 409,
    });
    expect(editor.data.needsVersionRefresh).toBe(true);
    const before = transport.calls.filter((c) => c.method !== 'GET').length;
    editor.onHide();
    editor.onShow();
    await settle(editor);
    expect(editor.data).toMatchObject({
      needsVersionRefresh: true,
      form: { title: originalTitle },
    });
    await editor.onSubmit();
    await settle(editor);
    expect(transport.calls.filter((c) => c.method !== 'GET')).toHaveLength(
      before,
    );
    await editor.onReload();
    await settle(editor);
    expect(editor.data).toMatchObject({
      needsVersionRefresh: false,
      version: concurrent.data.version,
    });
  });

  it('blocks partner writes after a committed receipt read fails and retries only current-state reads', async () => {
    const editor = await configured();
    transport.deliverNext('held');
    const submitting = editor.onSubmit();
    await transport.idle();
    transport.deliverNext('lost');
    transport.release();
    await submitting;
    await settle(editor);
    expect(editor.data).toMatchObject({
      submitUncertain: false,
      submitRefreshNeeded: true,
      publishedPath: '',
    });
    const before = transport.calls.filter((c) => c.method !== 'GET').length;
    await editor.onSave();
    await editor.onFreeSave();
    await settle(editor);
    expect(transport.calls.filter((c) => c.method !== 'GET')).toHaveLength(
      before,
    );
    await editor.onSubmit();
    await settle(editor);
    expect(editor.data).toMatchObject({
      submitRefreshNeeded: false,
      hasPendingReview: true,
      history: [expect.objectContaining({ status: 'SUBMITTED' })],
    });
    expect(transport.calls.filter((c) => c.method !== 'GET')).toHaveLength(
      before,
    );
    expect(
      await prisma.campaignVersion.count({
        where: { campaign: { draftId: editor.data.draftId } },
      }),
    ).toBe(1);
  });

  it.each(['user', 'role'] as const)(
    'clears private partner data when a later current-state read sees %s revocation after an earlier read failure',
    async (target) => {
      const owner = await actor('PARTNER', campusId);
      const editor = await configured(owner);
      const wxHost = host.wx as {
        request: (
          options: Parameters<CampaignPageTransport['request']>[0],
        ) => unknown;
      };
      const originalRequest = wxHost.request;
      let delayedHistory:
        Parameters<CampaignPageTransport['request']>[0] | undefined;
      let failConfiguration = true;
      wxHost.request = (options) => {
        const path = new URL(options.url).pathname;
        if (
          options.method === 'GET' &&
          path ===
            `/partners/me/campaign-drafts/${editor.data.draftId}/versions`
        ) {
          delayedHistory = options;
          return;
        }
        if (
          failConfiguration &&
          options.method === 'GET' &&
          path ===
            `/partners/me/campaign-drafts/${editor.data.draftId}/free-registration`
        ) {
          failConfiguration = false;
          transport.deliverNext('lost');
        }
        return originalRequest(options);
      };
      try {
        await editor.onSubmit();
        await settle(editor);
        expect(editor.data).toMatchObject({
          viewState: 'ready',
          submitRefreshNeeded: true,
        });
        expect(delayedHistory).toBeDefined();
        if (target === 'user') {
          await prisma.user.update({
            where: { id: owner.id },
            data: { status: 'DISABLED' },
          });
        } else {
          await prisma.userRole.updateMany({
            where: { userId: owner.id, campusId },
            data: { roleCode: 'TEACHER' },
          });
        }
        originalRequest(delayedHistory!);
        await transport.idle();
        await settle(editor);
        expect(
          transport.calls.findLast((c) => c.path.endsWith('/versions')),
        ).toMatchObject({ status: target === 'user' ? 401 : 403 });
        expect(editor.data).toMatchObject({
          viewState: 'forbidden',
          form: { title: '' },
          freeReady: false,
          history: [],
          registrations: [],
          publishedPath: '',
          submitUncertain: false,
          submitRefreshNeeded: false,
        });
        expect(editor.submitAttempt).toBeUndefined();
      } finally {
        wxHost.request = originalRequest;
      }
    },
  );

  it('keeps the admin conflict gate and reason across hide/show until explicit reread', async () => {
    const candidate = await submitted();
    const review = await open<Reviewer>(
      'super-admin/campaign-review-detail',
      admin,
      { id: candidate.versionId },
    );
    review.onReasonInput({ detail: { value: '合成资料：保留审核原因' } });
    const concurrent = await open<Reviewer>(
      'super-admin/campaign-review-detail',
      admin,
      { id: candidate.versionId },
    );
    concurrent.onApprove();
    await settle(concurrent);
    concurrent.onUnload();
    review.onApprove();
    await settle(review);
    expect(
      transport.calls.findLast((c) => c.path.endsWith('/approve')),
    ).toMatchObject({
      status: 409,
    });
    expect(review.data.needsRefresh).toBe(true);
    const before = transport.calls.filter((c) => c.method !== 'GET').length;
    review.onHide();
    review.onShow();
    await settle(review);
    expect(review.data).toMatchObject({
      needsRefresh: true,
      reason: '合成资料：保留审核原因',
    });
    review.onApprove();
    await settle(review);
    expect(transport.calls.filter((c) => c.method !== 'GET')).toHaveLength(
      before,
    );
    await review.onReload();
    await settle(review);
    expect(review.data).toMatchObject({
      needsRefresh: false,
      detail: { status: 'APPROVED' },
      reason: '合成资料：保留审核原因',
    });
  });

  it.each(['user', 'role'] as const)(
    'clears the actual parent Page when a lost-receipt retry meets %s revocation',
    async (target) => {
      const candidate = await live();
      const guardian = await actor('PARENT', campusId);
      await prisma.parentStudentBinding.create({
        data: { campusId, parentUserId: guardian.id, studentId },
      });
      const family = await open<Parent>(
        'parent/campaign-registration',
        guardian,
        {
          campaignId: candidate.campaignId,
          versionId: candidate.versionId,
        },
      );
      family.onStudentChange({ detail: { value: studentId } });
      transport.deliverNext('lost');
      await family.onRegister();
      await settle(family);
      expect(family.data.uncertain).toBe(true);
      const initial = transport.calls.findLast(
        (call) =>
          call.method === 'POST' && call.path.endsWith('/registrations'),
      )!;
      if (target === 'user') {
        await prisma.user.update({
          where: { id: guardian.id },
          data: { status: 'DISABLED' },
        });
      } else {
        await prisma.userRole.updateMany({
          where: { userId: guardian.id, campusId },
          data: { roleCode: 'TEACHER' },
        });
      }
      await family.onRetryWrite();
      await settle(family);
      const retry = transport.calls.findLast(
        (call) =>
          call.method === 'POST' && call.path.endsWith('/registrations'),
      )!;
      expect(retry).toMatchObject({
        key: initial.key,
        status: target === 'user' ? 401 : 403,
      });
      expect(family.data).toMatchObject({
        viewState: 'forbidden',
        campaign: null,
        registration: null,
        uncertain: false,
      });
      expect(
        await prisma.campaignRegistration.count({
          where: { campaignId: candidate.campaignId, studentId },
        }),
      ).toBe(1);
    },
  );

  it.each(['unchanged', 'closed', 'replaced'] as const)(
    'replays a lost cancellation through the parent Page after the campaign is %s',
    async (state) => {
      const { candidate, family, registrationId, owner } = await registered();
      const title = family.data.registration!.title;
      transport.deliverNext('lost');
      family.onCancel();
      await settle(family);
      const path = `/parents/me/campaign-registrations/${registrationId}/cancel`;
      const first = transport.calls.findLast((call) => call.path === path)!;
      expect(first).toMatchObject({
        status: 200,
        delivery: 'lost',
        body: { expectedVersion: 1 },
      });
      expect(family.data).toMatchObject({
        uncertain: true,
        registration: { status: 'REGISTERED', version: 1 },
      });
      const committed = await cancelledOnce(registrationId);
      family.onHide();
      if (state === 'closed') {
        const closing = await open<Reviewer>(
          'super-admin/campaign-review-detail',
          admin,
          { id: candidate.versionId },
        );
        closing.onReasonInput({ detail: { value: '合成资料：撤销后关闭' } });
        closing.onCloseCampaign();
        await settle(closing);
        expect(closing.data.detail).toMatchObject({ lifecycle: 'CLOSED' });
        closing.onUnload();
      } else if (state === 'replaced') {
        const editor = await open<Editor>('partner/campaign-editor', partner, {
          id: candidate.draftId,
        });
        edit(editor, 'title', `${runTag}新版合成活动`);
        await editor.onSave();
        await settle(editor);
        await editor.onSubmit();
        await settle(editor);
        const next = editor.data.history[0];
        expect(next.versionId).not.toBe(candidate.versionId);
        editor.onUnload();
        const approval = await open<Reviewer>(
          'super-admin/campaign-review-detail',
          admin,
          { id: next.versionId },
        );
        approval.onApprove();
        await settle(approval);
        expect(approval.data.detail?.status).toBe('APPROVED');
        approval.onUnload();
      }
      runtime.accessToken = owner.token;
      const beforeReturn = transport.calls.length;
      family.onShow();
      await settle(family);
      expect(transport.calls).toHaveLength(beforeReturn);
      await family.onRetryWrite();
      await settle(family);
      const replay = transport.calls.findLast((call) => call.path === path)!;
      expect(replay).toMatchObject({
        status: 200,
        key: first.key,
        body: first.body,
      });
      expect(transport.calls.filter((call) => call.path === path)).toHaveLength(
        2,
      );
      expect(family.data).toMatchObject({
        uncertain: false,
        readbackRequired: false,
        registration: {
          status: 'CANCELLED',
          version: 2,
          canCancel: false,
          versionId: candidate.versionId,
          title,
        },
      });
      expect(await cancelledOnce(registrationId)).toEqual(committed);
      family.onCancel();
      await settle(family);
      expect(transport.calls.filter((call) => call.path === path)).toHaveLength(
        2,
      );
    },
  );

  it('retries only result GET after a committed cancellation readback loses its reply', async () => {
    const { family, registrationId } = await registered();
    transport.deliverNext('held');
    family.onCancel();
    const cancelling = family.pendingWrite!;
    await transport.idle();
    await cancelledOnce(registrationId);
    transport.deliverNext('lost');
    transport.release();
    await cancelling;
    await settle(family);
    expect(family.data).toMatchObject({
      registration: null,
      uncertain: false,
      busy: false,
      readbackRequired: true,
    });
    const before = transport.calls.length;
    family.onCancel();
    await family.onRegister();
    await family.onRetryWrite();
    await settle(family);
    expect(transport.calls).toHaveLength(before);
    await family.onReload();
    await settle(family);
    const followup = transport.calls.slice(before);
    expect(followup).toEqual([
      expect.objectContaining({
        method: 'GET',
        path: `/parents/me/campaign-registrations/${registrationId}`,
        status: 200,
      }),
    ]);
    expect(family.data).toMatchObject({
      readbackRequired: false,
      registration: { status: 'CANCELLED', version: 2, canCancel: false },
    });
    await cancelledOnce(registrationId);
  });

  it.each(['before-show', 'after-show'] as const)(
    'applies a committed hidden cancellation only when visible with delivery %s',
    async (order) => {
      const { family, registrationId } = await registered();
      transport.deliverNext('held');
      family.onCancel();
      const cancelling = family.pendingWrite!;
      await transport.idle();
      await cancelledOnce(registrationId);
      family.onHide();
      const updates = family.setData.mock.calls.length;
      const calls = transport.calls.length;
      if (order === 'before-show') {
        transport.release();
        await cancelling;
        expect(family.setData).toHaveBeenCalledTimes(updates);
        expect(transport.calls).toHaveLength(calls);
        expect(family.data.registration?.status).toBe('REGISTERED');
        family.onShow();
      } else {
        family.onShow();
        await transport.idle();
        expect(transport.calls).toHaveLength(calls);
        transport.release();
        await cancelling;
      }
      await settle(family);
      expect(transport.calls.slice(calls)).toEqual([
        expect.objectContaining({
          method: 'GET',
          path: `/parents/me/campaign-registrations/${registrationId}`,
          status: 200,
        }),
      ]);
      expect(family.data).toMatchObject({
        busy: false,
        readbackRequired: false,
        registration: { status: 'CANCELLED', version: 2, canCancel: false },
      });
      await cancelledOnce(registrationId);
    },
  );

  it('ignores an unloaded cancellation reply and reads retained cancellation from a new Page', async () => {
    const { family, registrationId, owner } = await registered();
    transport.deliverNext('held');
    family.onCancel();
    const cancelling = family.pendingWrite!;
    await transport.idle();
    await cancelledOnce(registrationId);
    family.onUnload();
    const updates = family.setData.mock.calls.length;
    const before = transport.calls.length;
    transport.release();
    await cancelling;
    await settle(family);
    expect(family.setData).toHaveBeenCalledTimes(updates);
    expect(transport.calls).toHaveLength(before);
    const reopened = await open<Parent>('parent/campaign-registration', owner);
    reopened.onTabChange({
      currentTarget: { dataset: { tab: 'REGISTRATIONS' } },
    });
    await settle(reopened);
    expect(reopened.data.registrations).toContainEqual(
      expect.objectContaining({ registrationId, status: 'CANCELLED' }),
    );
    await reopened.onOpenRegistration({
      currentTarget: { dataset: { id: registrationId } },
    });
    await settle(reopened);
    expect(reopened.data.registration).toMatchObject({
      registrationId,
      status: 'CANCELLED',
      version: 2,
      canCancel: false,
    });
    expect(
      transport.calls.slice(before).every((call) => call.method === 'GET'),
    ).toBe(true);
    await cancelledOnce(registrationId);
  });

  it.each(['user', 'role', 'binding', 'student'] as const)(
    'rejects a lost cancellation replay after same-token %s revocation and clears private content',
    async (target) => {
      const guardian = await actor('PARENT', campusId);
      const child = await prisma.student.create({
        data: { campusId, displayName: `${runTag}-${target}-child` },
      });
      const binding = await prisma.parentStudentBinding.create({
        data: { campusId, parentUserId: guardian.id, studentId: child.id },
      });
      const { family, registrationId } = await registered(guardian, child.id);
      transport.deliverNext('lost');
      family.onCancel();
      await settle(family);
      expect(family.data.uncertain).toBe(true);
      const path = `/parents/me/campaign-registrations/${registrationId}/cancel`;
      const initial = transport.calls.findLast((call) => call.path === path)!;
      const committed = await cancelledOnce(registrationId, guardian.id);
      if (target === 'user') {
        await prisma.user.update({
          where: { id: guardian.id },
          data: { status: 'DISABLED' },
        });
      } else if (target === 'role') {
        await prisma.userRole.updateMany({
          where: { userId: guardian.id, campusId },
          data: { roleCode: 'TEACHER' },
        });
      } else if (target === 'binding') {
        const other = await prisma.campus.create({
          data: {
            code: `${runTag}-cancel-binding`,
            name: '合成绑定失效校区',
          },
        });
        await prisma.parentStudentBinding.update({
          where: { id: binding.id },
          data: { campusId: other.id },
        });
      } else {
        await prisma.student.update({
          where: { id: child.id },
          data: { isActive: false },
        });
      }
      expect(runtime.accessToken).toBe(guardian.token);
      await family.onRetryWrite();
      await settle(family);
      expect(
        transport.calls.findLast((call) => call.path === path),
      ).toMatchObject({
        status: target === 'user' ? 401 : 403,
        key: initial.key,
        body: initial.body,
      });
      expect(family.data).toMatchObject({
        viewState: 'forbidden',
        campaign: null,
        registration: null,
        campaigns: [],
        registrations: [],
        selectedStudentId: '',
        uncertain: false,
        readbackRequired: false,
      });
      expect(family.intent).toBeUndefined();
      expect(await cancelledOnce(registrationId, guardian.id)).toEqual(
        committed,
      );
      const before = transport.calls.length;
      family.onCancel();
      await family.onRetryWrite();
      await settle(family);
      expect(transport.calls).toHaveLength(before);
    },
  );

  it.each(['response-first', 'show-first'] as const)(
    'keeps a replacement identity private when an old cancellation arrives %s',
    async (order) => {
      const { family, registrationId, owner } = await registered();
      transport.deliverNext('held');
      family.onCancel();
      const cancelling = family.pendingWrite!;
      await transport.idle();
      await cancelledOnce(registrationId, owner.id);
      const before = transport.calls.length;
      const replacement = await actor('PARENT', campusId);
      runtime.accessToken = replacement.token;
      if (order === 'show-first') {
        family.onHide();
        family.onShow();
        expect(family.data.viewState).toBe('forbidden');
      }
      transport.release();
      await cancelling;
      await settle(family);
      expect(family.data).toMatchObject({
        viewState: 'forbidden',
        campaign: null,
        registration: null,
        campaigns: [],
        registrations: [],
        selectedStudentId: '',
        busy: false,
        uncertain: false,
        readbackRequired: false,
      });
      expect(runtime.accessToken).toBe(replacement.token);
      expect(family.intent).toBeUndefined();
      expect(transport.calls).toHaveLength(before);
      await cancelledOnce(registrationId, owner.id);
    },
  );

  it('holds cancellation 409 across hide/show until an explicit current-result read', async () => {
    const { family, registrationId, owner } = await registered();
    const concurrent = await open<Parent>(
      'parent/campaign-registration',
      owner,
    );
    concurrent.onTabChange({
      currentTarget: { dataset: { tab: 'REGISTRATIONS' } },
    });
    await settle(concurrent);
    await concurrent.onOpenRegistration({
      currentTarget: { dataset: { id: registrationId } },
    });
    concurrent.onCancel();
    await settle(concurrent);
    concurrent.onUnload();
    family.onCancel();
    await settle(family);
    expect(
      transport.calls.findLast((call) => call.path.endsWith('/cancel')),
    ).toMatchObject({ status: 409, body: { expectedVersion: 1 } });
    expect(family.data).toMatchObject({
      conflict: true,
      registration: { status: 'REGISTERED', version: 1 },
    });
    const before = transport.calls.length;
    family.onHide();
    family.onShow();
    family.onCancel();
    await settle(family);
    expect(family.data.conflict).toBe(true);
    expect(transport.calls).toHaveLength(before);
    await family.onReload();
    await settle(family);
    expect(transport.calls.slice(before)).toEqual([
      expect.objectContaining({ method: 'GET', status: 200 }),
    ]);
    expect(family.data).toMatchObject({
      conflict: false,
      registration: { status: 'CANCELLED', version: 2, canCancel: false },
    });
    await cancelledOnce(registrationId);
  });
});
