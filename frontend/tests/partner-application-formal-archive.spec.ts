import { LOCAL_RUNTIME_STORAGE_KEY } from '../config/local-runtime';
import type { SessionHttpRequestOptions } from '../services/session.service';

const draft = () => ({
  applicationId: '55883f08-c9f5-4f26-927c-82ea07cb8a02', status: 'DRAFT', version: 1,
  basicInformation: {
    institutionName: '合成机构', province: '浙江省', city: '杭州市',
    district: '西湖区', detailedAddress: '合成测试路一号',
  },
  createdAt: '2026-10-09T08:00:00.000Z', updatedAt: '2026-10-09T08:00:00.000Z',
});
const profile = () => ({
  displayName: '合成正式合作方', roleCode: 'PARTNER', activeStudentCount: 0,
  campus: { id: '80bbf1bd-d4d7-4056-8bf3-f216511180fc', name: '合成校区' },
});

describe('formal application archive via the real private runtime and Page', () => {
  let stored: Record<string, any>;
  let calls: SessionHttpRequestOptions[];
  let page: any;
  let runtime: any;
  const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
  const respond = (index: number, value: unknown, statusCode = 200) => {
    calls[index].success({
      statusCode, data: statusCode === 200
        ? { data: value, requestId: 'synthetic-archive' }
        : { code: statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: '合成拒绝' },
    });
  };
  beforeEach(() => {
    jest.resetModules();
    stored = {
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3000', accessToken: 'formal-token',
      partnerApplicantSession: {
        token: 'applicant-token', expiresAt: new Date(Date.now() + 900_000).toISOString(),
        me: { applicantId: '03f20536-7c49-4eb0-bc68-f66ce27a735a', displayName: '合成申请人', formalAccountReady: false },
      },
    };
    calls = [];
    page = undefined;
    (global as any).wx = {
      getStorageSync: (key: string) => key === LOCAL_RUNTIME_STORAGE_KEY ? stored : undefined,
      setStorageSync: jest.fn((key: string, value: unknown) => {
        if (key === LOCAL_RUNTIME_STORAGE_KEY) stored = value as Record<string, any>;
      }),
      request: jest.fn((options: SessionHttpRequestOptions) => { calls.push(options); }),
      getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: 375 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 280, height: 32 }),
      navigateBack: jest.fn(), reLaunch: jest.fn(), showModal: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    (global as any).getCurrentPages = () => [{}, page];
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data, form: { ...config.data.form } } };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
    runtime = require('../pages/partner/runtime/partner-application-runtime').getPartnerApplicationRuntime();
    require('../pages/partner/application/index');
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
    delete (global as any).getCurrentPages;
  });
  const open = async () => { page.onLoad(); page.onShow(); await flush(); };
  const finish = async (application: unknown) => {
    expect(calls.map((call) => call.url)).toEqual([
      'http://127.0.0.1:3000/partners/me/profile',
      'http://127.0.0.1:3000/partners/me/application',
    ]);
    respond(0, profile());
    respond(1, application);
    await flush();
  };
  it.each([0, 1].flatMap((deniedRead) => [401, 403].map((statusCode) => ({ deniedRead, statusCode }))))(
    'clears the formal archive for late read $deniedRead status $statusCode after its sibling fails',
    async ({ deniedRead, statusCode }) => {
      await open(); await finish(draft());
      const pending = page.loadDraft(); await flush();
      const sibling = 1 - deniedRead;
      respond(2 + sibling, null, 503); await pending;
      expect(page.data.viewState).toBe('error');
      respond(2 + deniedRead, null, statusCode); await flush();
      expect(page.data).toMatchObject({
        viewState: 'forbidden', formalArchive: true, readonly: true, applicationId: '', version: 0,
        form: { institutionName: '', contactPhone: '' }, identityLabel: '', reviewHistory: [],
      });
      expect(page.ownerKey).toBe('');
      expect(stored.accessToken).toBe('formal-token');
      expect(stored.partnerApplicantSession.token).toBe('applicant-token');
    },
  );
  it.each([0, 1].flatMap((deniedRead) => [401, 403].flatMap((statusCode) =>
    ['return', 'replacement'].map((boundary) => ({ deniedRead, statusCode, boundary })),
  )))('keeps a fresh formal archive after a failed pair and old read $deniedRead status $statusCode across $boundary',
    async ({ deniedRead, statusCode, boundary }) => {
      await open(); await finish(draft());
      const pending = page.loadDraft(); await flush();
      respond(2 + 1 - deniedRead, null, 503); await pending;
      expect(page.data.viewState).toBe('error');
      if (boundary === 'return') {
        page.onHide(); page.onShow();
      } else {
        stored.accessToken = 'replacement-formal-token';
        page.onRetry();
      }
      await flush();
      expect(calls).toHaveLength(6);
      const token = boundary === 'return' ? 'formal-token' : 'replacement-formal-token';
      expect(calls[4].header.Authorization).toBe(`Bearer ${token}`);
      expect(calls[5].header.Authorization).toBe(`Bearer ${token}`);
      respond(4, { ...profile(), displayName: '合成最新合作方' });
      respond(5, { ...draft(), version: 4 }); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', version: 4, identityLabel: '合成最新合作方' });
      const writes = page.setData.mock.calls.length;
      const credentials = JSON.stringify(stored);
      respond(2 + deniedRead, null, statusCode); await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.data).toMatchObject({ viewState: 'ready', version: 4, identityLabel: '合成最新合作方' });
      expect(JSON.stringify(stored)).toBe(credentials);
      expect(calls).toHaveLength(6);
    });

  it('prioritizes formal credentials over a coexisting applicant session and reads only formal routes', async () => {
    expect(runtime.formalArchive).toBe(true);
    await open();
    await finish(draft());
    expect(calls.every((call) => call.method === 'GET' &&
      call.header.Authorization === 'Bearer formal-token')).toBe(true);
    expect(page.data).toMatchObject({
      viewState: 'ready', formalArchive: true, readonly: true, archiveEmpty: false,
      identityLabel: '合成正式合作方', statusLabel: '草稿',
    });
    expect(stored.accessToken).toBe('formal-token');
    expect(stored.partnerApplicantSession.token).toBe('applicant-token');
    expect((global as any).wx.setStorageSync).not.toHaveBeenCalled();
  });

  it('reads a missing archive without applicant credentials and never sends a save or login', async () => {
    delete stored.partnerApplicantSession;
    await open();
    await finish(null);
    expect(page.data).toMatchObject({
      viewState: 'empty', archiveEmpty: true, readonly: true, formalArchive: true,
      statusLabel: '暂无档案',
    });
    page.onFieldInput({ currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: '不能新建' } });
    await page.onSave();
    await page.onApplicantLogin();
    await page.onApplicantLogout();
    expect(calls).toHaveLength(2);
    expect(stored.accessToken).toBe('formal-token');
    expect(page.data.form.institutionName).toBe('');
  });
  it('displays only the owned contact read-only and clears it on a forbidden refresh', async () => {
    await open();
    await finish({
      ...draft(), basicInformation: { ...draft().basicInformation, contactPhone: '0000-00000000' },
    });
    expect(page.data.form.contactPhone).toBe('0000-00000000');
    page.onFieldInput({ currentTarget: { dataset: { field: 'contactPhone' } }, detail: { value: '0000-00000001' } });
    await page.onSave();
    expect(page.data.form.contactPhone).toBe('0000-00000000');
    expect(calls).toHaveLength(2);
    page.onRetry();
    await flush();
    respond(2, profile());
    respond(3, null, 403);
    await flush();
    expect(page.data.form.contactPhone).toBe('');
    expect(page.data.viewState).toBe('forbidden');
  });

  it('denies formal draft writes even if called directly, without touching either credential', async () => {
    const before = JSON.stringify(stored);
    const pending = runtime.applications.saveBasics(0, {});
    expect(calls).toHaveLength(0);
    await expect(pending).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(stored)).toBe(before);
  });

  it.each([401, 403])('does not fall back to applicant login after formal read failure %s', async (status) => {
    await open();
    expect(calls).toHaveLength(2);
    respond(0, profile());
    respond(1, null, status);
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.formalArchive).toBe(true);
    await page.onApplicantLogin();
    await page.onApplicantLogout();
    expect(calls).toHaveLength(2);
    expect(stored.accessToken).toBe('formal-token');
    expect(stored.partnerApplicantSession.token).toBe('applicant-token');
  });

  it('starts fresh reads after hide/show and ignores old success and old 401', async () => {
    await open();
    page.onHide();
    page.onShow();
    await flush();
    expect(calls).toHaveLength(4);
    respond(2, profile());
    respond(3, { ...draft(), version: 2 });
    await flush();
    const writes = page.setData.mock.calls.length;
    respond(0, profile(), 401);
    respond(1, { ...draft(), version: 99 });
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data).toMatchObject({ viewState: 'ready', version: 2, readonly: true });
    expect(stored.accessToken).toBe('formal-token');
  });

  it('rejects an in-flight old account response and rereads under the new formal token', async () => {
    await open();
    stored.accessToken = 'new-formal-token';
    respond(0, profile());
    respond(1, draft());
    await flush();
    expect(page.data.form.institutionName).toBe('');
    page.onRetry();
    await flush();
    expect(calls).toHaveLength(4);
    expect(calls[2].header.Authorization).toBe('Bearer new-formal-token');
    expect(calls[3].header.Authorization).toBe('Bearer new-formal-token');
    respond(2, { ...profile(), displayName: '另一合成合作方' });
    respond(3, null);
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'empty', archiveEmpty: true, readonly: true, identityLabel: '另一合成合作方',
    });
  });

  it.each([
    ['mock', 200], ['mock', 401], ['mock', 403],
    ['address', 200], ['address', 401], ['address', 403],
    ['applicant', 200], ['applicant', 401], ['applicant', 403],
  ])('discards late responses after switching %s with status %s', async (change, status) => {
    await open();
    if (change === 'mock') stored.dataDriver = 'mock';
    if (change === 'address') stored.apiBaseUrl = 'http://127.0.0.1:3001';
    if (change === 'applicant') delete stored.accessToken;
    const credentials = JSON.stringify(stored);
    respond(0, profile(), Number(status));
    respond(1, draft(), Number(status));
    await flush();
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.identityLabel).toBe('');
    expect(page.data.version).toBe(0);
    expect(runtime.sessions.getSessionKey()).toBe('');
    expect(JSON.stringify(stored)).toBe(credentials);
    expect((global as any).wx.setStorageSync).not.toHaveBeenCalled();
  });

  it('clears an already loaded archive after a forbidden refresh without changing credentials', async () => {
    await open();
    await finish(draft());
    const credentials = JSON.stringify(stored);
    page.onRetry();
    await flush();
    respond(2, profile());
    respond(3, null, 403);
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', formalArchive: true, readonly: true,
      form: { institutionName: '', province: '', city: '', district: '', detailedAddress: '' },
      region: [], regionLabel: '', version: 0, identityLabel: '', statusLabel: '',
      dirty: false, archiveEmpty: false,
    });
    expect(page.ownerKey).toBe('');
    expect(JSON.stringify(stored)).toBe(credentials);
    expect((global as any).wx.setStorageSync).not.toHaveBeenCalled();
  });

  it.each(['token', 'address'].flatMap((change) =>
    ['back', 'fallback', 'direct'].map((stage) => ({ change, stage })),
  ))('clears a formal archive after $change changes before $stage return failure without touching credentials',
    async ({ change, stage }) => {
      await open(); await finish(draft());
      const native = (global as any).wx;
      if (stage === 'direct') (global as any).getCurrentPages = () => [page];
      page.onBack();
      if (stage === 'fallback') native.navigateBack.mock.calls[0][0].fail();
      if (change === 'token') stored.accessToken = 'synthetic-replacement-formal-token';
      else stored.apiBaseUrl = 'http://127.0.0.1:3001';
      const credentials = JSON.stringify(stored);
      if (stage === 'back') native.navigateBack.mock.calls[0][0].fail();
      else native.reLaunch.mock.calls[0][0].fail();
      await flush();
      expect(page.data).toMatchObject({
        viewState: 'forbidden', formalArchive: true, readonly: true, applicationId: '', version: 0,
        identityLabel: '', form: { institutionName: '', contactPhone: '' }, reviewHistory: [],
        errorMessage: '正式会话已更新，请返回重新登录',
      });
      expect(page.ownerKey).toBe('');
      expect(page.navigating).toBe(false);
      expect(calls).toHaveLength(2);
      expect(native.reLaunch).toHaveBeenCalledTimes(stage === 'back' ? 0 : 1);
      expect(JSON.stringify(stored)).toBe(credentials);
      expect(stored.partnerApplicantSession.token).toBe('applicant-token');
      expect(native.setStorageSync).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['formal', 200], ['formal', 401], ['formal', 403],
    ['address', 200], ['address', 401], ['address', 403],
    ['mock', 200], ['mock', 401], ['mock', 403],
  ])('isolates applicant reads when switching to %s with late status %s', async (change, status) => {
    delete stored.accessToken;
    runtime = require('../pages/partner/runtime/partner-application-runtime').getPartnerApplicationRuntime();
    await open();
    expect(calls.map((call) => call.url)).toEqual([
      'http://127.0.0.1:3000/partner-applicants/me',
      'http://127.0.0.1:3000/partner-applicants/me/application',
    ]);
    if (change === 'formal') stored.accessToken = 'new-formal-token';
    if (change === 'address') stored.apiBaseUrl = 'http://127.0.0.1:3001';
    if (change === 'mock') stored.dataDriver = 'mock';
    const credentials = JSON.stringify(stored);
    respond(0, {
      ...stored.partnerApplicantSession.me, displayName: '迟到申请人',
    }, Number(status));
    respond(1, draft(), Number(status));
    await flush();
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.identityLabel).toBe('');
    expect(page.data.version).toBe(0);
    expect(runtime.sessions.getSessionKey()).toBe('');
    expect(JSON.stringify(stored)).toBe(credentials);
    expect((global as any).wx.setStorageSync).not.toHaveBeenCalled();
    if (change === 'formal') {
      await expect(runtime.sessions.login()).rejects.toMatchObject({ statusCode: 409 });
      await expect(runtime.sessions.logout()).rejects.toMatchObject({ statusCode: 409 });
      expect(JSON.stringify(stored)).toBe(credentials);
      expect((global as any).wx.setStorageSync).not.toHaveBeenCalled();
      page.onRetry();
      await flush();
      expect(calls[2].url).toContain('/partners/me/profile');
      expect(calls[3].url).toContain('/partners/me/application');
      respond(2, profile());
      respond(3, draft());
      await flush();
      expect(page.data).toMatchObject({ formalArchive: true, readonly: true, viewState: 'ready' });
    }
  });

  it.each(['code', 'response'])('does not persist a superseded applicant login at the %s stage', async (stage) => {
    delete stored.accessToken;
    runtime = require('../pages/partner/runtime/partner-application-runtime').getPartnerApplicationRuntime();
    let loginOptions: any;
    (global as any).wx.login = jest.fn((options) => { loginOptions = options; });
    const pending = runtime.sessions.login();
    const rejected = expect(pending).rejects.toMatchObject({ statusCode: 409 });
    if (stage === 'response') {
      loginOptions.success({ code: 'synthetic-code' });
      await flush();
      expect(calls).toHaveLength(1);
    }
    stored.accessToken = 'new-formal-token';
    const credentials = JSON.stringify(stored);
    if (stage === 'code') loginOptions.success({ code: 'synthetic-code' });
    else respond(0, {
      token: 'late-applicant-token', expiresAt: new Date(Date.now() + 900_000).toISOString(),
      me: stored.partnerApplicantSession.me,
    });
    await rejected;
    expect(calls).toHaveLength(stage === 'code' ? 0 : 1);
    expect(JSON.stringify(stored)).toBe(credentials);
    expect((global as any).wx.setStorageSync).not.toHaveBeenCalled();
  });
});
