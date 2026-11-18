import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createConnection, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { AuthService } from '../src/modules/auth/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { assertApplicationPageTestTarget } from './support/partner-application-page-policy';
import { createPartnerPdfTestApp } from './support/partner-pdf-test-app';
import {
  ApplicationPageTransport,
  captureApplicationPage,
} from './support/partner-application-page-harness';

assertApplicationPageTestTarget(process.env);
jest.setTimeout(60_000);
const own = '/partner-applicants/me/application';
const base = '/management/partner-applications';
const basics = {
  institutionName: '',
  province: '合成省',
  city: '合成市',
  district: '合成区',
  detailedAddress: '合成路15号',
  contactPhone: '000-00000000',
};
const bank = {
  bankName: '合成银行',
  accountHolder: '合成机构',
  accountNumber: '0000123456789',
};
type Fields = typeof basics;
interface Material {
  kind: string;
  storedFileId: string;
}
interface History {
  submissionId: string;
  review: { decision: string; reason: string } | null;
}
interface Runtime {
  dataDriver: 'api';
  apiBaseUrl: string;
  accessToken: string;
  enableTestAccountSwitcher: false;
  partnerApplicantSession?: { token: string; me: { applicantId: string } };
}
interface PageBase {
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  pendingLoad?: Promise<void>;
  pendingSave?: Promise<void>;
  pendingLogin?: Promise<void>;
  pendingRequest?: Promise<void>;
  working?: Promise<void>;
}
type Event = {
  currentTarget: { dataset: Record<string, string> };
  detail: { value: string };
};
interface ApplicantPage extends PageBase {
  data: {
    viewState: string;
    applicationId: string;
    version: number;
    statusLabel: string;
    form: Fields;
    bankForm: typeof bank;
    bankOpen: boolean;
    materialsOpen: boolean;
    materialsDraft: Material[];
    reviewHistory: History[];
    readonly: boolean;
    dirty: boolean;
    bankDirty: boolean;
    materialsDirty: boolean;
    submitUncertain: boolean;
    reopenUncertain: boolean;
    canReopen: boolean;
    approvalReady: boolean;
    formalArchive: boolean;
    message: string;
    historyMessage: string;
  };
  onApplicantLogin(): Promise<void>;
  onRegionChange(event: { detail: { value: string[] } }): void;
  onFieldInput(event: Event): void;
  onBankFieldInput(event: Event): void;
  onSave(): Promise<void>;
  onBankToggle(): void;
  onBankSave(): Promise<void>;
  onMaterialsToggle(): void;
  onMaterialChoose(event: Event): Promise<void>;
  onMaterialsSave(): Promise<void>;
  onMaterialPreview(event: Event): Promise<void>;
  onSubmit(): void;
  onReopen(): void;
  onSubmissionReload(): Promise<void>;
  onFormalLogin(): void;
  onBankRetry(): Promise<void>;
}
interface ReviewPage extends PageBase {
  data: {
    viewState: string;
    rows: Array<{ applicationId: string; submissionId: string }>;
    detail: {
      submissionId: string;
      basicInformation: Fields;
      status: string;
    } | null;
    bankInformation: typeof bank | null;
    uncertain: boolean;
    canReject: boolean;
  };
  onKeywordInput(event: Event): void;
  onSearch(): void;
  onOpen(event: Event): Promise<void>;
  onBank(): Promise<void>;
  onPreview(event: Event): Promise<void>;
  onReasonInput(event: Event): void;
  onReject(): void;
  onApprove(): void;
}
interface EntryPage extends PageBase {
  data: { viewState: string; campusName: string; displayName?: string };
}
interface LoginPage extends PageBase {
  data: { viewState: string; errorMessage: string };
  onWechatLoginTap(): Promise<void>;
}
const event = (dataset: Record<string, string> = {}, value = ''): Event => ({
  currentTarget: { dataset },
  detail: { value },
});

describe('application and review Pages through local TCP and isolated PostgreSQL', () => {
  const runTag = `apage-${randomUUID().slice(0, 8)}`;
  const key = randomBytes(32);
  const host = globalThis as unknown as Record<string, unknown>;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  const pages: PageBase[] = [];
  const userIds: string[] = [],
    applicantIds: string[] = [],
    applicationIds: string[] = [];
  const campusIds: string[] = [];
  const codes = new Set<string>(),
    tokens = new Set<string>();
  const storage = new Map<string, unknown>();
  let app: INestApplication,
    prisma: PrismaService,
    server: Server,
    port: number;
  let transport: ApplicationPageTransport, runtime: Runtime, adminToken: string;
  let loginCode = '',
    serial = 0,
    png: Buffer;
  const native = () =>
    host.wx as {
      previewImage: jest.Mock;
      navigateTo: jest.Mock;
      reLaunch: jest.Mock;
    };
  const settle = async (page?: PageBase) => {
    for (let count = 0; count < 8; count++) {
      await page?.pendingLoad;
      await page?.pendingSave;
      await page?.pendingLogin;
      await page?.pendingRequest;
      await page?.working;
      await transport.idle();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  const capture = <T extends PageBase & { data: object }>(
    kind: Parameters<typeof captureApplicationPage>[0],
  ) => {
    const page = captureApplicationPage<T>(kind);
    pages.push(page);
    page.onLoad();
    page.onShow();
    return page;
  };
  const wire = (
    path: string,
    token: string,
    method: 'GET' | 'POST' | 'PUT' = 'GET',
    data?: unknown,
  ) =>
    new Promise<{ status: number; data: unknown }>((resolve, reject) =>
      transport.request({
        url: runtime.apiBaseUrl + path,
        method,
        header: { Authorization: `Bearer ${token}` },
        data,
        success: (response) =>
          resolve({ status: response.statusCode, data: response.data }),
        fail: () => reject(new Error('Synthetic boundary request failed')),
      }),
    );
  const matches = (path: string) =>
    transport.calls.filter(
      (call) => call.path === path && call.method === 'POST',
    );
  const replayed = (path: string) => {
    const calls = matches(path);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.status)).toEqual([200, 200]);
    expect(calls.map((call) => call.delivery)).toEqual(['lost', 'success']);
    expect(typeof calls[0].key).toBe('string');
    expect(calls[0].key!.length).toBeGreaterThanOrEqual(8);
    expect(calls[1].key).toBe(calls[0].key);
    expect(calls[1].body).toEqual(calls[0].body);
  };
  const frozen = (submissionId: string) =>
    prisma.partnerApplicationSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: {
        bankRecord: true,
        materialRecord: {
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
  const freshApplicant = async () => {
    storage.clear();
    const subject = `${runTag}-${++serial}`;
    const user = await prisma.user.create({
      data: {
        displayName: `${runTag}-申请${serial}`,
        authIdentities: { create: { provider: 'WECHAT', subject } },
        partnerApplicant: { create: {} },
      },
      include: { partnerApplicant: true },
    });
    userIds.push(user.id);
    applicantIds.push(user.partnerApplicant!.id);
    loginCode = `mock-wechat-login:${subject}`;
    codes.add(loginCode);
    runtime = {
      dataDriver: 'api',
      apiBaseUrl: `http://127.0.0.1:${port}`,
      accessToken: '',
      enableTestAccountSwitcher: false,
    };
    const page = capture<ApplicantPage>('application');
    await settle(page);
    expect(page.data.viewState).toBe('login');
    await page.onApplicantLogin();
    await settle(page);
    expect(page.data.viewState).toBe('empty');
    expect(runtime.accessToken).toBe('');
    expect(runtime.partnerApplicantSession?.me.applicantId).toBe(
      user.partnerApplicant!.id,
    );
    return {
      page,
      userId: user.id,
      applicantId: user.partnerApplicant!.id,
      code: loginCode,
    };
  };
  const saveBasics = async (page: ApplicantPage, name: string) => {
    for (const [field, value] of Object.entries({
      ...basics,
      institutionName: name,
    })) {
      if (
        ['institutionName', 'detailedAddress', 'contactPhone'].includes(field)
      )
        page.onFieldInput(event({ field }, value));
    }
    page.onRegionChange({
      detail: { value: [basics.province, basics.city, basics.district] },
    });
    await page.onSave();
    await settle(page);
    if (!applicationIds.includes(page.data.applicationId))
      applicationIds.push(page.data.applicationId);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.form.institutionName).toBe(name);
    expect(page.data.dirty).toBe(false);
    const application = await prisma.partnerApplication.findUniqueOrThrow({
      where: { id: page.data.applicationId },
    });
    expect(application.applicantId).toBe(
      runtime.partnerApplicantSession!.me.applicantId,
    );
    transport.applications.set(
      runtime.partnerApplicantSession!.token,
      application.id,
    );
  };
  const saveBank = async (page: ApplicantPage, value = bank) => {
    if (!page.data.bankOpen) page.onBankToggle();
    await settle(page);
    for (const [field, content] of Object.entries(value))
      page.onBankFieldInput(event({ field }, content));
    await page.onBankSave();
    await settle(page);
    expect(page.data.bankForm).toEqual(value);
    expect(page.data.bankDirty).toBe(false);
  };
  const addMaterial = async (page: ApplicantPage, kind: string) => {
    if (!page.data.materialsOpen) page.onMaterialsToggle();
    await settle(page);
    await page.onMaterialChoose(event({ kind }));
    await settle(page);
    expect(page.data.materialsDirty).toBe(true);
    await page.onMaterialsSave();
    await settle(page);
    expect(page.data.materialsDirty).toBe(false);
  };
  const openReview = async (
    applicationId: string,
    submissionId: string,
    name: string,
  ) => {
    runtime = {
      ...runtime,
      accessToken: adminToken,
      partnerApplicantSession: undefined,
    };
    const page = capture<ReviewPage>('review');
    await settle(page);
    page.onKeywordInput(event({}, name));
    page.onSearch();
    await settle(page);
    expect(page.data.rows).toEqual([
      expect.objectContaining({ applicationId, submissionId }),
    ]);
    await page.onOpen(event({ aid: applicationId, sid: submissionId }));
    await settle(page);
    expect(page.data.detail?.submissionId).toBe(submissionId);
    expect(page.data.canReject).toBe(true);
    return page;
  };
  beforeAll(async () => {
    ({ app, prisma } = await createPartnerPdfTestApp((builder) =>
      builder
        .overrideProvider('PARTNER_APPLICANT_RATE_LIMIT')
        .useValue({ check: () => Promise.resolve() })
        .overrideProvider('PARTNER_APPLICATION_PRIVATE_KEY_RING')
        .useValue({
          current: () => ({ id: runTag, key }),
          get: (id: string) => (id === runTag ? key : undefined),
        })
        .overrideProvider('PARTNER_APPLICATION_MATERIAL_RUN_TAG')
        .useValue(runTag)
        .overrideProvider('PARTNER_APPLICATION_REGION_CATALOG')
        .useValue({
          version: 'synthetic-page-v1',
          matches: (p: string, c: string, d: string) =>
            p === basics.province && c === basics.city && d === basics.district,
        }),
    ));
    const admin = await prisma.user.create({
      data: {
        displayName: `${runTag}-审核员`,
        roles: { create: { roleCode: 'SUPER_ADMIN', campusId: null } },
      },
    });
    userIds.push(admin.id);
    adminToken = (await app.get(AuthService).issueSessionForUser(admin.id))
      .accessToken;
    tokens.add(adminToken);
    png = await sharp({
      create: { width: 12, height: 8, channels: 3, background: '#f5d671' },
    })
      .png()
      .toBuffer();
    server = app.getHttpServer() as Server;
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
    transport = new ApplicationPageTransport(
      `http://127.0.0.1:${port}`,
      tokens,
      codes,
    );
    transport.images.set('wxfile://synthetic-selection.png', png);
    for (const name of ['wx', 'Page', 'getCurrentPages'])
      globals.set(name, Object.getOwnPropertyDescriptor(host, name));
    host.getCurrentPages = () => [{}, pages.at(-1)];
    host.wx = {
      getStorageSync: (name: string) =>
        name === 'education.runtime' ? runtime : storage.get(name),
      setStorageSync: (name: string, value: unknown) => {
        if (name === 'education.runtime') runtime = value as Runtime;
        else storage.set(name, value);
      },
      request: transport.request,
      uploadFile: transport.upload,
      downloadFile: transport.download,
      login: (input: { success(result: { code: string }): void }) =>
        input.success({ code: loginCode }),
      getRandomValues: (input: {
        length: number;
        success(result: { randomValues: ArrayBuffer }): void;
      }) => {
        input.success({
          randomValues: Uint8Array.from(randomBytes(input.length)).buffer,
        });
      },
      getWindowInfo: () => ({
        statusBarHeight: 24,
        windowWidth: 390,
        windowHeight: 844,
      }),
      getMenuButtonBoundingClientRect: () => ({
        top: 32,
        left: 295,
        height: 32,
      }),
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn(),
      chooseMedia: (input: { success(result: object): void }) =>
        input.success({
          tempFiles: [
            {
              tempFilePath: 'wxfile://synthetic-selection.png',
              size: png.length,
            },
          ],
          type: 'image',
        }),
      showModal: (input: {
        success?(result: { confirm: boolean; cancel: boolean }): void;
      }) => input.success?.({ confirm: true, cancel: false }),
      previewImage: jest.fn((input: { success?(): void }) => input.success?.()),
      navigateTo: jest.fn(),
      reLaunch: jest.fn(),
      stopPullDownRefresh: jest.fn(),
      showToast: jest.fn(),
    };
  });
  afterEach(async () => {
    for (const page of pages) page.onHide();
    await transport?.drain();
  });
  afterAll(async () => {
    try {
      for (const page of pages) page.onUnload();
      await transport?.drain();
    } finally {
      try {
        if (prisma) {
          assertApplicationPageTestTarget(process.env);
          const disabled = await prisma.user.updateMany({
            where: {
              id: { in: userIds },
              displayName: { startsWith: `${runTag}-` },
            },
            data: { status: 'DISABLED' },
          });
          expect(disabled.count).toBe(userIds.length);
          const uploads = await prisma.partnerApplicationUpload.findMany({
            where: { runTag, ownerUserId: { in: userIds } },
            select: {
              id: true,
              applicationId: true,
              storedFileId: true,
              state: true,
              adoptedAt: true,
              storageKey: true,
            },
            orderBy: { id: 'asc' },
          });
          const approvals = await prisma.$queryRaw<
            Array<{ userId: string; campusId: string; submissionId: string }>
          >`
            SELECT "userId", "campusId", "submissionId" FROM "PartnerApplicationApproval"
            WHERE "userId" = ANY(${userIds}::uuid[])`;
          const where = {
            campusId: { in: approvals.map((row) => row.campusId) },
          };
          const zeroSideEffects = {
            orders: await prisma.enrollmentOrder.count({ where }),
            ledger: await prisma.lessonLedgerEntry.count({ where }),
            receipts: await prisma.financeReceipt.count({ where }),
            earnings: await prisma.partnerEarningEntry.count({ where }),
            withdrawals: await prisma.withdrawal.count({ where }),
          };
          expect(
            Object.values(zeroSideEffects).every((count) => count === 0),
          ).toBe(true);
          process.stdout.write(
            `APPLICATION_PAGE_OWNERSHIP ${JSON.stringify({
              runTag,
              userIds,
              applicantIds,
              applicationIds,
              campusIds,
              port,
              disabled: disabled.count,
              uploads,
              approvals,
              zeroSideEffects,
              requestStatuses: transport?.calls.map(
                ({ method, path, status, delivery }) => ({
                  method,
                  path,
                  status,
                  delivery,
                }),
              ),
              disposition:
                'owned synthetic users disabled; all fixtures and encrypted files retained; no deletion',
            })}\n`,
          );
        }
      } finally {
        await app?.close();
        for (const [name, descriptor] of globals) {
          if (descriptor) Object.defineProperty(host, name, descriptor);
          else Reflect.deleteProperty(host, name);
        }
        if (port) {
          expect(server.listening).toBe(false);
          await new Promise<void>((resolve, reject) => {
            const socket = createConnection({ host: '127.0.0.1', port });
            socket.setTimeout(1500);
            socket.once('connect', () => {
              socket.destroy();
              reject(new Error('Temporary listener remains open'));
            });
            socket.once('timeout', () => {
              socket.destroy();
              reject(new Error('Listener closure unconfirmed'));
            });
            socket.once('error', (error: NodeJS.ErrnoException) => {
              socket.destroy();
              if (error.code === 'ECONNREFUSED') resolve();
              else reject(error);
            });
          });
          process.stdout.write(
            `APPLICATION_PAGE_LISTENER_CLOSED ${JSON.stringify({ port, refused: true })}\n`,
          );
        }
      }
    }
  });

  it('runs save, submit, reject, reopen, resubmit, approve and active formal login without duplicate or rewritten facts', async () => {
    const actor = await freshApplicant();
    const page = actor.page;
    const name = `${runTag}-机构首稿`;
    await saveBasics(page, name);
    await saveBank(page);
    for (const kind of [
      'BUSINESS_LICENSE',
      'INSTITUTION_LOGO',
      'LEGAL_ID_FRONT',
      'LEGAL_ID_BACK',
      'STORE_FRONT',
      'ENVIRONMENT',
    ])
      await addMaterial(page, kind);
    expect(page.data.materialsDraft).toHaveLength(6);
    const oldMaterial = page.data.materialsDraft.find(
      (file) => file.kind === 'BUSINESS_LICENSE',
    )!;
    await page.onMaterialPreview(event({ id: oldMaterial.storedFileId }));
    await settle(page);
    expect(transport.downloads).toHaveLength(1);
    expect(await sharp(transport.downloads[0]).metadata()).toMatchObject({
      format: 'png',
      width: 12,
      height: 8,
    });
    expect(native().previewImage).toHaveBeenCalledTimes(1);
    const applicantToken = runtime.partnerApplicantSession!.token;
    expect(
      (await wire('/auth/wechat/login', '', 'POST', { code: actor.code }))
        .status,
    ).toBe(401);
    transport.deliverNext(`${own}/submit`, 'lost');
    page.onSubmit();
    await settle(page);
    expect(page.data.submitUncertain).toBe(true);
    expect(
      await prisma.partnerApplicationSubmission.count({
        where: { applicationId: page.data.applicationId },
      }),
    ).toBe(1);
    page.onSubmit();
    await settle(page);
    replayed(`${own}/submit`);
    expect(page.data.statusLabel).toBe('待审核');
    const firstId = page.data.reviewHistory[0].submissionId;
    const original = await frozen(firstId);
    expect(original.applicationId).toBe(page.data.applicationId);
    transport.submissions.set(firstId, original.applicationId);
    expect(original.materialRecord.items).toHaveLength(6);
    const applicantRuntime = runtime;
    page.onHide();
    const reviewer = await openReview(page.data.applicationId, firstId, name);
    await reviewer.onBank();
    expect(reviewer.data.bankInformation).toEqual(bank);
    await reviewer.onPreview(event({ id: oldMaterial.storedFileId }));
    expect(transport.downloads[1]).toEqual(transport.downloads[0]);
    reviewer.onReasonInput(event({}, '合成驳回：请更新机构名称和营业执照'));
    const firstPath = `${base}/${page.data.applicationId}/submissions/${firstId}`;
    transport.deliverNext(`${firstPath}/reject`, 'lost');
    reviewer.onReject();
    await settle(reviewer);
    expect(reviewer.data.uncertain).toBe(true);
    reviewer.onReject();
    await settle(reviewer);
    replayed(`${firstPath}/reject`);
    const firstReview = await prisma.partnerApplicationReview.findUniqueOrThrow(
      { where: { submissionId: firstId } },
    );
    reviewer.onUnload();
    runtime = applicantRuntime;
    page.onShow();
    await settle(page);
    expect(page.data.statusLabel).toBe('已驳回');
    expect(page.data.canReopen).toBe(true);
    transport.deliverNext(`${own}/reopen`, 'lost');
    page.onReopen();
    await settle(page);
    expect(page.data.reopenUncertain).toBe(true);
    page.onReopen();
    await settle(page);
    replayed(`${own}/reopen`);
    expect(page.data.statusLabel).toBe('草稿');
    expect(page.data.readonly).toBe(false);
    const amendedName = `${runTag}-机构补交`;
    await saveBasics(page, amendedName);
    const amendedBank = {
      ...bank,
      accountHolder: '合成补交账户',
      accountNumber: '0000987654321',
    };
    await saveBank(page, amendedBank);
    await addMaterial(page, 'BUSINESS_LICENSE');
    expect(page.data.materialsDraft).toHaveLength(6);
    expect(
      page.data.materialsDraft.some(
        (file) => file.storedFileId === oldMaterial.storedFileId,
      ),
    ).toBe(false);
    expect(await frozen(firstId)).toEqual(original);
    page.onSubmit();
    await settle(page);
    expect(page.data.statusLabel).toBe('待审核');
    const secondId = page.data.reviewHistory[0].submissionId;
    expect(secondId).not.toBe(firstId);
    expect(page.data.reviewHistory).toHaveLength(2);
    const second = await frozen(secondId);
    expect(second.applicationId).toBe(page.data.applicationId);
    transport.submissions.set(secondId, second.applicationId);
    expect(second.institutionName).toBe(amendedName);
    expect(second.bankRecordId).not.toBe(original.bankRecordId);
    expect(second.materialRecordId).not.toBe(original.materialRecordId);
    const updatedApplicantRuntime = runtime;
    page.onHide();
    const approver = await openReview(
      page.data.applicationId,
      secondId,
      amendedName,
    );
    await approver.onBank();
    expect(approver.data.bankInformation).toEqual(amendedBank);
    expect((await wire(firstPath, applicantToken)).status).toBe(401);
    expect((await wire('/partners/me/dashboard', applicantToken)).status).toBe(
      401,
    );
    expect(
      (await wire('/partners/me/earnings/summary', applicantToken)).status,
    ).toBe(401);
    const approvePath = `${base}/${page.data.applicationId}/submissions/${secondId}/approve`;
    transport.deliverNext(approvePath, 'lost');
    approver.onApprove();
    await settle(approver);
    expect(approver.data.uncertain).toBe(true);
    approver.onApprove();
    await settle(approver);
    replayed(approvePath);
    expect(approver.data.detail?.status).toBe('APPROVED');
    const approvals = await prisma.$queryRaw<
      Array<{ userId: string; campusId: string }>
    >`
      SELECT "userId", "campusId" FROM "PartnerApplicationApproval" WHERE "submissionId" = ${secondId}::uuid`;
    expect(approvals).toHaveLength(1);
    expect(approvals[0].userId).toBe(actor.userId);
    campusIds.push(approvals[0].campusId);
    expect(
      await prisma.userRole.findMany({
        where: { userId: actor.userId },
        select: { roleCode: true, campusId: true },
      }),
    ).toEqual([{ roleCode: 'PARTNER', campusId: approvals[0].campusId }]);
    expect(
      await prisma.campus.findUniqueOrThrow({
        where: { id: approvals[0].campusId },
      }),
    ).toMatchObject({
      name: amendedName,
      mapVisible: false,
      latitude: null,
      longitude: null,
    });
    expect(await frozen(firstId)).toEqual(original);
    expect(await frozen(secondId)).toEqual(second);
    expect(
      await prisma.partnerApplicationReview.findUniqueOrThrow({
        where: { submissionId: firstId },
      }),
    ).toEqual(firstReview);
    expect(
      await prisma.partnerApplicationReview.count({
        where: { submission: { applicationId: page.data.applicationId } },
      }),
    ).toBe(2);
    approver.onUnload();
    runtime = updatedApplicantRuntime;
    page.onShow();
    await settle(page);
    expect(page.data.approvalReady).toBe(true);
    expect(runtime.accessToken).toBe('');
    expect(runtime.partnerApplicantSession!.token === applicantToken).toBe(
      true,
    );
    expect((await wire('/partners/me/dashboard', applicantToken)).status).toBe(
      401,
    );
    expect(
      (await wire('/partners/me/earnings/summary', applicantToken)).status,
    ).toBe(401);
    page.onFormalLogin();
    expect(native().navigateTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: '/pages/partner/login/index' }),
    );
    page.onHide();
    loginCode = actor.code;
    const login = capture<LoginPage>('login');
    await login.onWechatLoginTap();
    await settle(login);
    expect(login.data.errorMessage).toBe('');
    expect(native().reLaunch).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: '/pages/partner/home/index' }),
    );
    expect(runtime.accessToken.length).toBeGreaterThan(20);
    expect(runtime.accessToken === applicantToken).toBe(false);
    expect(await wire('/me', runtime.accessToken)).toMatchObject({
      status: 200,
      data: {
        data: {
          userId: actor.userId,
          roles: [{ code: 'PARTNER', campusId: approvals[0].campusId }],
        },
      },
    });
    login.onHide();
    const home = capture<EntryPage>('home');
    await settle(home);
    expect(home.data).toMatchObject({
      viewState: 'empty',
      campusName: amendedName,
    });
    home.onHide();
    const profile = capture<EntryPage>('profile');
    await settle(profile);
    expect(profile.data).toMatchObject({
      viewState: 'ready',
      campusName: amendedName,
      displayName: `${runTag}-申请1`,
    });
    profile.onHide();
    const archive = capture<ApplicantPage>('application');
    await settle(archive);
    expect(archive.data).toMatchObject({
      viewState: 'ready',
      formalArchive: true,
      readonly: true,
      approvalReady: false,
    });
    expect(archive.data.form.institutionName).toBe(amendedName);
    expect(archive.data.bankForm.accountNumber).toBe('');
    expect(archive.data.materialsDraft).toEqual([]);
    expect((await wire(own, runtime.accessToken)).status).toBe(401);
    process.stdout.write(
      `APPLICATION_PAGE_CHAIN ${JSON.stringify({
        applicationId: page.data.applicationId,
        userId: actor.userId,
        firstId,
        secondId,
        immutableFirstSha256: createHash('sha256')
          .update(JSON.stringify(original))
          .digest('hex'),
        immutableSecondSha256: createHash('sha256')
          .update(JSON.stringify(second))
          .digest('hex'),
        replayed: ['submit', 'reject', 'reopen', 'approve'],
        formalHomeProfile: true,
        applicantTokenRejectedAfterApproval: true,
      })}\n`,
    );
  });

  it('clears every loaded private partition on a real revoked applicant session', async () => {
    const actor = await freshApplicant();
    await saveBasics(actor.page, `${runTag}-失权机构`);
    await saveBank(actor.page);
    await addMaterial(actor.page, 'BUSINESS_LICENSE');
    expect(actor.page.data.bankForm.accountNumber).toBe(bank.accountNumber);
    expect(actor.page.data.materialsDraft).toHaveLength(1);
    await prisma.partnerApplicantSession.updateMany({
      where: { applicantId: actor.applicantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await actor.page.onBankRetry();
    await settle(actor.page);
    expect(actor.page.data).toMatchObject({
      viewState: 'login',
      applicationId: '',
      form: { institutionName: '' },
      bankForm: { accountNumber: '' },
      materialsDraft: [],
      reviewHistory: [],
    });
    expect(runtime.partnerApplicantSession).toBeUndefined();
    expect(transport.calls.at(-1)).toMatchObject({
      path: `${own}/bank-information`,
      status: 401,
    });
    expect(
      await prisma.userRole.count({ where: { userId: actor.userId } }),
    ).toBe(0);
  });

  it('ignores a genuine completed application read delivered after hide and rereads on return', async () => {
    const actor = await freshApplicant();
    await saveBasics(actor.page, `${runTag}-隐藏机构`);
    transport.deliverNext(own, 'held');
    const reading = actor.page.onSubmissionReload();
    await transport.idle();
    actor.page.onHide();
    const before = structuredClone(actor.page.data);
    transport.release();
    await reading;
    await settle(actor.page);
    expect(actor.page.data).toEqual(before);
    actor.page.onShow();
    await settle(actor.page);
    expect(actor.page.data).toMatchObject({
      viewState: 'ready',
      readonly: false,
      form: { institutionName: `${runTag}-隐藏机构` },
    });
    expect(
      transport.calls.filter(
        (call) => call.path === own && call.delivery === 'held',
      ),
    ).toHaveLength(1);
  });
});
