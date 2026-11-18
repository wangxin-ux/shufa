import * as fs from 'fs';
import * as path from 'path';

const login = jest.fn();
const load = jest.fn();
const bindPhone = jest.fn();
jest.mock('../services/session.service', () => ({
  resolveRoleBootstrap: (session: any) => session
    ? { kind: 'navigate', url: '/pages/partner/home/index' } : { kind: 'login' },
  sessionService: {
    canSwitchTestAccount: () => false,
    sessionGuard: () => () => true,
    loginWithWechat: () => login(), load: () => load(),
    bindWechatStaffPhone: (code: string) => bindPhone(code),
  },
}));
jest.mock('../pages/partner/runtime/wechat-formal-login-runtime', () => ({
  getWechatFormalLoginRuntime: () => ({
    loginWithWechat: () => login(), load: () => load(),
  }),
}));
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('subpackage explicit formal WeChat login lifecycle and bootstrap entry', () => {
  let page: any;
  const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
  beforeEach(() => {
    login.mockReset().mockResolvedValue({ roles: [{ code: 'PARTNER' }] });
    load.mockReset().mockResolvedValue(null);
    bindPhone.mockReset().mockResolvedValue({ roles: [{ code: 'PARTNER' }] });
    (global as any).wx = { reLaunch: jest.fn(), navigateTo: jest.fn() };
    (global as any).getCurrentPages = () => [page];
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data, viewState: 'login' } };
      page.setData = jest.fn((value: object) => Object.assign(page.data, value));
    };
    jest.isolateModules(() => require('../pages/partner/login/index'));
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
    delete (global as any).getCurrentPages;
  });
  it('places the header below the notch using native capsule metrics without logging in', () => {
    (global as any).wx.getWindowInfo = () => ({ statusBarHeight: 47, windowWidth: 375 });
    (global as any).wx.getMenuButtonBoundingClientRect = () => ({ top: 55, left: 278, height: 32 });
    page.onLoad();
    expect(page.data).toMatchObject({ headerTopPx: 55, headerRightPx: 105 });
    expect(login).not.toHaveBeenCalled();
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/login/index.wxml'), 'utf8');
    expect(markup).toContain('padding-top: {{headerTopPx}}px');
    expect(markup).toContain('padding-right: {{headerRightPx}}px');
  });
  it('falls back to status bar metrics when capsule metrics are unavailable', () => {
    (global as any).wx.getWindowInfo = () => ({ statusBarHeight: 47, windowWidth: 375 });
    (global as any).wx.getMenuButtonBoundingClientRect = () => ({ height: 0 });
    page.onLoad();
    expect(page.data).toMatchObject({ headerTopPx: 55, headerRightPx: 100 });
  });
  it('keeps a safe header fallback if native measurement throws', () => {
    (global as any).wx.getWindowInfo = () => { throw new Error('native metrics unavailable'); };
    expect(() => page.onLoad()).not.toThrow();
    expect(page.data).toMatchObject({ headerTopPx: 32, headerRightPx: 100 });
    expect(login).not.toHaveBeenCalled();
  });
  it('requires an explicit click, routes the single formal role and deduplicates clicks', async () => {
    const result = deferred();
    login.mockReturnValueOnce(result.promise);
    const pending = page.onWechatLoginTap();
    page.onWechatLoginTap();
    await flush();
    expect(login).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe('submitting');
    page.onBack();
    expect(bindPhone).not.toHaveBeenCalled();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    result.resolve({ roles: [{ code: 'PARTNER' }] });
    await pending;
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/partner/home/index' }));
  });
  it('keeps a binding-required error on the login view without calling phone authorization automatically', async () => {
    login.mockRejectedValueOnce(new Error('请授权微信手机号完成工作人员账号绑定'));
    await page.onWechatLoginTap();
    expect(page.data).toMatchObject({ viewState: 'login', wechatLoggingIn: false, errorMessage: '请授权微信手机号完成工作人员账号绑定' });
    expect(bindPhone).not.toHaveBeenCalled();
    await page.onWechatLoginTap();
    expect(login).toHaveBeenCalledTimes(2);
  });
  it('ignores successful completion while hidden and restores the issued formal session on returning', async () => {
    const result = deferred();
    login.mockReturnValueOnce(result.promise);
    const pending = page.onWechatLoginTap();
    await flush();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    result.resolve({ roles: [{ code: 'PARTNER' }] });
    await pending;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    load.mockResolvedValueOnce({ roles: [{ code: 'PARTNER' }] });
    page.onShow();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(1);
    expect(page.data.wechatLoggingIn).toBe(false);
  });
  it('recovers if returning before the native login settles without sending a second login', async () => {
    const result = deferred();
    login.mockReturnValueOnce(result.promise);
    const pending = page.onWechatLoginTap();
    await flush();
    page.onHide();
    page.onShow();
    await flush();
    expect(load).not.toHaveBeenCalled();
    result.reject(new Error('合成网络失败'));
    await pending;
    await flush();
    expect(page.data).toMatchObject({ viewState: 'login', wechatLoggingIn: false });
    expect(login).toHaveBeenCalledTimes(1);
  });
  it('does not start a queued login after hiding or act on an unloaded page', async () => {
    const pending = page.onWechatLoginTap();
    page.onHide();
    await pending;
    expect(login).not.toHaveBeenCalled();
    page.onUnload();
    await page.onWechatLoginTap();
    expect(login).not.toHaveBeenCalled();
  });
  it.each(['loading', 'submitting', 'forbidden', 'error'])('rejects stale taps in %s', async (state) => {
    page.data.viewState = state;
    await page.onWechatLoginTap();
    expect(login).not.toHaveBeenCalled();
  });
  it('keeps development phone login separate from the formal WeChat action', async () => {
    jest.isolateModules(() => require('../pages/bootstrap/index'));
    page.data.isTestAccountLogin = true;
    await page.onWechatLoginTap();
    expect(login).not.toHaveBeenCalled();
  });
  it('only navigates from bootstrap and keeps login implementation in the ordinary subpackage', () => {
    jest.isolateModules(() => require('../pages/bootstrap/index'));
    page.onWechatLoginTap();
    page.onWechatLoginTap();
    expect(login).not.toHaveBeenCalled();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/partner/login/index' }));
  });
  it('does not bind through a phone authorization event arriving after navigation starts', async () => {
    jest.isolateModules(() => require('../pages/bootstrap/index'));
    page.onWechatLoginTap();
    await page.onWechatPhoneTap({ detail: { code: 'synthetic-late-phone-code' } });
    expect(bindPhone).not.toHaveBeenCalled();
  });
  it('recovers a restoration read interrupted by a second hide and ignores its late response', async () => {
    const result = deferred();
    login.mockReturnValueOnce(result.promise);
    const pending = page.onWechatLoginTap();
    await flush();
    page.onHide();
    result.resolve({ roles: [{ code: 'PARTNER' }] });
    await pending;
    const read = deferred();
    load.mockReturnValueOnce(read.promise);
    page.onShow();
    await flush();
    expect(page.data.viewState).toBe('loading');
    page.onHide();
    const writes = page.setData.mock.calls.length;
    read.resolve({ roles: [{ code: 'PARTNER' }] });
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    page.onShow();
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(page.data.viewState).toBe('login');
    expect(login).toHaveBeenCalledTimes(1);
  });
  it.each(['before', 'after'])('restores a usable login view when return fails %s a restoration read settles', async (timing) => {
    const read = deferred();
    load.mockReturnValueOnce(read.promise);
    page.data.wechatLoggingIn = true;
    page.onShow();
    await flush();
    expect(page.data.viewState).toBe('loading');
    (global as any).getCurrentPages = () => [{}, page];
    (global as any).wx.navigateBack = jest.fn();
    page.onBack();
    (global as any).wx.navigateBack.mock.calls[0][0].fail();
    const failReturn = (global as any).wx.reLaunch.mock.calls[0][0].fail;
    if (timing === 'before') failReturn();
    read.resolve({ roles: [{ code: 'PARTNER' }] });
    await flush();
    if (timing === 'after') failReturn();
    expect(page.data).toMatchObject({
      viewState: 'login', wechatLoggingIn: false, errorMessage: '返回失败，请重试',
    });
    expect(page.navigating).toBe(false);
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(1);
    expect(login).not.toHaveBeenCalled();
    login.mockRejectedValueOnce(new Error('合成可重试登录失败'));
    await page.onWechatLoginTap();
    expect(login).toHaveBeenCalledTimes(1);
  });
  it('offers separate native identity login and explicit phone binding without applicant service imports', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(path.join(root, 'pages/bootstrap/index.wxml'), 'utf8');
    expect(markup).toContain('bindtap="onWechatLoginTap"');
    expect(markup).toContain('open-type="getPhoneNumber"');
    expect(markup).not.toContain('使用已绑定的微信手机号继续');
    expect(fs.readFileSync(path.join(root, 'pages/bootstrap/index.ts'), 'utf8')).not.toMatch(/from.*partner\/runtime/);
  });
});
