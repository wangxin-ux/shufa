import type { SessionHttpRequestOptions, SessionView } from '../services/session.service';

const identity: SessionView = {
  userId: 'synthetic-runtime-partner',
  displayName: '合成合作方',
  roles: [{ code: 'PARTNER', campusId: 'synthetic-runtime-campus' }],
};
const apiA = 'https://formal-a.example.test';
const apiB = 'https://formal-b.example.test';
const runtimeKey = 'education.runtime';
const envelope = (token = 'synthetic-issued-token') => ({
  data: { accessToken: token, me: identity },
});
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

describe('formal login with actual runtime assembly and page', () => {
  let values: Map<string, unknown>;
  let requests: SessionHttpRequestOptions[];
  let nativeCodes: Array<{ success(result: { code: string }): void }>;
  let page: any;
  let shared: typeof import('../services/session.service').sessionService;
  let getRuntime: typeof import('../pages/partner/runtime/wechat-formal-login-runtime').getWechatFormalLoginRuntime;

  const setRuntime = (overrides: object = {}) => {
    values.set(runtimeKey, {
      dataDriver: 'api', apiBaseUrl: apiB, accessToken: '',
      enableTestAccountSwitcher: false,
      partnerApplicantSession: { token: 'synthetic-applicant-token' },
      ...overrides,
    });
  };
  const assemble = (initial: object) => {
    setRuntime(initial);
    jest.isolateModules(() => {
      const sessionModule = require('../services/session.service') as typeof import('../services/session.service');
      shared = sessionModule.sessionService;
      getRuntime = require('../pages/partner/runtime/wechat-formal-login-runtime').getWechatFormalLoginRuntime;
      require('../pages/partner/login/index');
    });
  };
  beforeEach(() => {
    values = new Map([['education.session.logged-out', true]]);
    requests = [];
    nativeCodes = [];
    (global as any).wx = {
      getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
      request: (options: SessionHttpRequestOptions) => { requests.push(options); },
      login: (options: typeof nativeCodes[number]) => { nativeCodes.push(options); },
      reLaunch: jest.fn(),
      navigateBack: jest.fn(),
    };
    (global as any).getCurrentPages = () => [page];
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: { ...definition.data } };
      page.setData = jest.fn((data: object) => Object.assign(page.data, data));
    };
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
    delete (global as any).getCurrentPages;
  });

  it.each([
    { dataDriver: 'mock' },
    { dataDriver: 'api', apiBaseUrl: apiA },
  ])('restores from the current API after modules were loaded in %j', async (initial) => {
    assemble(initial);
    setRuntime();
    const pending = page.onWechatLoginTap();
    await flush();
    nativeCodes[0].success({ code: 'synthetic-native-code' });
    await flush();
    expect(requests[0].url).toBe(`${apiB}/auth/wechat/login`);
    page.onHide();
    requests[0].success({ statusCode: 200, data: envelope() });
    await pending;
    page.onShow();
    await flush();
    expect(requests.map((request) => request.url)).toEqual([
      `${apiB}/auth/wechat/login`, `${apiB}/me`,
    ]);
    expect(requests[1].header).toMatchObject({ Authorization: 'Bearer synthetic-issued-token' });
    requests[1].success({ statusCode: 200, data: { data: identity } });
    await flush();
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/partner/home/index',
    }));
    expect(nativeCodes).toHaveLength(1);
  });

  it('does not send a native code to the previous API after configuration changes', async () => {
    assemble({});
    const service = getRuntime();
    const pending = service.loginWithWechat();
    const rejected = expect(pending).rejects.toThrow('登录状态已更新');
    await flush();
    setRuntime({ apiBaseUrl: apiA, accessToken: 'synthetic-current-token' });
    nativeCodes[0].success({ code: 'synthetic-stale-code' });
    await flush();
    requests[0]?.success({ statusCode: 200, data: envelope('synthetic-obsolete-token') });
    await rejected;
    expect(requests).toHaveLength(0);
    expect(values.get(runtimeKey)).toMatchObject({
      apiBaseUrl: apiA, accessToken: 'synthetic-current-token',
    });
  });

  it.each([
    { apiBaseUrl: apiA },
    { dataDriver: 'mock' },
    { enableTestAccountSwitcher: true },
    { accessToken: 'synthetic-newer-token' },
  ])('does not persist a held login response after runtime replacement %j', async (replacement) => {
    assemble({});
    const pending = getRuntime().loginWithWechat();
    const rejected = expect(pending).rejects.toThrow('登录状态已更新');
    await flush();
    nativeCodes[0].success({ code: 'synthetic-held-code' });
    await flush();
    setRuntime(replacement);
    requests[0].success({ statusCode: 200, data: envelope('synthetic-obsolete-token') });
    await rejected;
    expect(values.get(runtimeKey)).toMatchObject({
      accessToken: 'accessToken' in replacement ? replacement.accessToken : '',
      partnerApplicantSession: { token: 'synthetic-applicant-token' },
    });
    expect(values.get('education.session.logged-out')).toBe(true);
  });

  it('keeps shared logout cancellation after assembling the current API', async () => {
    assemble({ dataDriver: 'mock' });
    setRuntime();
    const pending = getRuntime().loginWithWechat();
    const rejected = expect(pending).rejects.toThrow('登录状态已更新');
    await flush();
    nativeCodes[0].success({ code: 'synthetic-held-code' });
    await flush();
    shared.logout();
    requests[0].success({ statusCode: 200, data: envelope() });
    await rejected;
    expect(values.get('education.session.logged-out')).toBe(true);
    expect(values.get(runtimeKey)).toMatchObject({ accessToken: '' });
  });

  it.each([
    { apiBaseUrl: apiA },
    { dataDriver: 'mock' },
    { enableTestAccountSwitcher: true },
    { accessToken: 'synthetic-replacement-token' },
  ])('rejects a held restoration without changing replacement credentials %j', async (replacement) => {
    assemble({ dataDriver: 'mock' });
    setRuntime({ accessToken: 'synthetic-current-token' });
    values.set('education.session.logged-out', false);
    const pending = getRuntime().load();
    const rejected = expect(pending).rejects.toThrow('登录状态已更新');
    await flush();
    expect(requests[0].url).toBe(`${apiB}/me`);
    setRuntime({ accessToken: 'synthetic-current-token', ...replacement });
    const before = values.get(runtimeKey);
    requests[0].success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    await rejected;
    expect(values.get(runtimeKey)).toBe(before);
    expect(nativeCodes).toHaveLength(0);
  });

  it('cancels a held successful restoration through the shared logout coordinator', async () => {
    assemble({ dataDriver: 'mock' });
    setRuntime({ accessToken: 'synthetic-current-token' });
    values.set('education.session.logged-out', false);
    const pending = getRuntime().load();
    const rejected = expect(pending).rejects.toThrow('登录状态已更新');
    shared.logout();
    requests[0].success({ statusCode: 200, data: { data: identity } });
    await rejected;
    expect(values.get('education.session.logged-out')).toBe(true);
    expect(nativeCodes).toHaveLength(0);
  });

  it('cancels a silent restoration code through the shared logout coordinator', async () => {
    assemble({ dataDriver: 'mock' });
    setRuntime();
    values.set('education.session.logged-out', false);
    const pending = getRuntime().load();
    const rejected = expect(pending).rejects.toThrow('登录状态已更新');
    await flush();
    expect(nativeCodes).toHaveLength(1);
    shared.logout();
    nativeCodes[0].success({ code: 'synthetic-cancelled-silent-code' });
    await rejected;
    expect(requests).toHaveLength(0);
  });

  it('releases a failed explicit attempt and uses the replacement configuration on retry', async () => {
    assemble({});
    const pending = page.onWechatLoginTap();
    await flush();
    setRuntime({ apiBaseUrl: apiA });
    nativeCodes[0].success({ code: 'synthetic-stale-code' });
    await pending;
    expect(page.data).toMatchObject({
      viewState: 'login', wechatLoggingIn: false, errorMessage: '登录状态已更新，请重新登录',
    });
    const retry = page.onWechatLoginTap();
    await flush();
    nativeCodes[1].success({ code: 'synthetic-retry-code' });
    await flush();
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${apiA}/auth/wechat/login`);
    requests[0].success({ statusCode: 200, data: envelope() });
    await retry;
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(1);
    expect(values.get(runtimeKey)).toMatchObject({
      apiBaseUrl: apiA, accessToken: 'synthetic-issued-token',
      partnerApplicantSession: { token: 'synthetic-applicant-token' },
    });
  });

  it('restores the current identity when credentials change while the login page is hidden', async () => {
    assemble({});
    const pending = page.onWechatLoginTap();
    await flush();
    nativeCodes[0].success({ code: 'synthetic-native-code' });
    await flush();
    page.onHide();
    requests[0].success({ statusCode: 200, data: envelope() });
    await pending;
    setRuntime({ apiBaseUrl: apiA, accessToken: 'synthetic-current-token' });
    page.onShow();
    await flush();
    expect(requests[1]).toMatchObject({
      url: `${apiA}/me`, header: { Authorization: 'Bearer synthetic-current-token' },
    });
    requests[1].success({ statusCode: 200, data: { data: identity } });
    await flush();
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(1);
    expect(nativeCodes).toHaveLength(1);
  });

  it('preserves current-API expired-token silent restoration and does not merge applicant credentials', async () => {
    assemble({ dataDriver: 'mock' });
    setRuntime({ accessToken: 'synthetic-expired-token' });
    values.set('education.session.logged-out', false);
    const pending = getRuntime().load();
    requests[0].success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    await flush();
    expect(values.get(runtimeKey)).toMatchObject({ accessToken: '' });
    nativeCodes[0].success({ code: 'synthetic-recovery-code' });
    await flush();
    expect(requests[1]).toMatchObject({
      url: `${apiB}/auth/wechat/login`, data: { code: 'synthetic-recovery-code' },
    });
    requests[1].success({ statusCode: 200, data: envelope() });
    await expect(pending).resolves.toEqual(identity);
    expect(values.get(runtimeKey)).toMatchObject({
      accessToken: 'synthetic-issued-token',
      partnerApplicantSession: { token: 'synthetic-applicant-token' },
    });
  });

  it('coalesces ordinary parallel restoration on the current runtime', async () => {
    assemble({ dataDriver: 'mock' });
    setRuntime();
    values.set('education.session.logged-out', false);
    const service = getRuntime();
    const pending = Promise.all([service.load(), service.load()]);
    await flush();
    expect(nativeCodes).toHaveLength(1);
    nativeCodes[0].success({ code: 'synthetic-shared-silent-code' });
    await flush();
    expect(requests).toHaveLength(1);
    requests[0].success({ statusCode: 200, data: envelope() });
    await expect(pending).resolves.toEqual([identity, identity]);
  });

  it('does not let a repeated load adopt replacement credentials for an older silent code', async () => {
    assemble({});
    values.set('education.session.logged-out', false);
    const service = getRuntime();
    const old = service.load();
    const result = old.then(
      () => ({ rejected: false }),
      () => ({ rejected: true }),
    );
    await flush();
    setRuntime({ accessToken: 'synthetic-newer-token' });
    const newer = service.load().catch(() => null);
    await flush();
    requests[0]?.success({ statusCode: 200, data: { data: identity } });
    nativeCodes[0].success({ code: 'synthetic-obsolete-silent-code' });
    await flush();
    requests.find((request) => request.method === 'POST')?.success({
      statusCode: 200, data: envelope('synthetic-obsolete-token'),
    });
    await expect(result).resolves.toEqual({ rejected: true });
    await newer;
    expect(values.get(runtimeKey)).toMatchObject({ accessToken: 'synthetic-newer-token' });
  });

  it('restores both parallel readers after an expired token without rejecting its own token refresh', async () => {
    assemble({});
    setRuntime({ accessToken: 'synthetic-expired-token' });
    values.set('education.session.logged-out', false);
    const service = getRuntime();
    const pending = Promise.allSettled([service.load(), service.load()]);
    for (const request of [...requests]) {
      request.success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    }
    await flush();
    expect(nativeCodes).toHaveLength(1);
    nativeCodes[0].success({ code: 'synthetic-shared-recovery-code' });
    await flush();
    requests.find((request) => request.method === 'POST')!.success({
      statusCode: 200, data: envelope(),
    });
    await expect(pending).resolves.toEqual([
      { status: 'fulfilled', value: identity }, { status: 'fulfilled', value: identity },
    ]);
  });

  it('restores after a second hide/show while the first expired-token recovery is still waiting for native code', async () => {
    assemble({ dataDriver: 'mock' });
    setRuntime();
    const pending = page.onWechatLoginTap();
    await flush();
    nativeCodes[0].success({ code: 'synthetic-explicit-code' });
    await flush();
    page.onHide();
    requests[0].success({ statusCode: 200, data: envelope() });
    await pending;
    page.onShow();
    await flush();
    requests[1].success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
    await flush();
    page.onHide();
    page.onShow();
    await flush();
    nativeCodes[1].success({ code: 'synthetic-recovery-code-a' });
    await flush();
    requests[2].success({ statusCode: 200, data: envelope('synthetic-recovered-token') });
    await flush();
    nativeCodes[2]?.success({ code: 'synthetic-recovery-code-b' });
    await flush();
    expect(page.data.errorMessage).toBe('');
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(1);
    expect(nativeCodes).toHaveLength(2);
    expect(values.get(runtimeKey)).toMatchObject({ accessToken: 'synthetic-recovered-token' });
  });
});
