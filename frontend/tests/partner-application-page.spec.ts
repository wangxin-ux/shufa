import * as fs from 'fs';
import * as path from 'path';
import { APPLICATION_DISPLAY_CHARACTERS } from '../pages/partner/assets/fonts/application-display-font';

const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({
  getPartnerApplicationRuntime: () => getRuntime(),
}));

const draft = (version = 1, status = 'DRAFT') => ({
  applicationId: '55883f08-c9f5-4f26-927c-82ea07cb8a02', status, version,
  basicInformation: {
    institutionName: '合成机构', province: '浙江省', city: '杭州市',
    district: '西湖区', detailedAddress: '合成测试路一号',
  },
  createdAt: '2026-10-09T08:00:00.000Z', updatedAt: '2026-10-09T08:00:00.000Z',
});
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const failure = (statusCode: number) => Object.assign(new Error('合成请求失败'), { statusCode });

describe('restricted application page lifecycle and basic draft', () => {
  let page: any;
  let runtime: any;
  let sessionKey: string;
  const flush = async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  };
  const input = (field: string, value: unknown) =>
    page.onFieldInput({ currentTarget: { dataset: { field } }, detail: { value } });
  const ready = async () => { page.onLoad(); page.onShow(); await flush(); };
  beforeEach(() => {
    sessionKey = '1:applicant-token';
    runtime = {
      sessions: {
        getSessionKey: jest.fn(() => sessionKey),
        invalidateReads: jest.fn(),
        login: jest.fn().mockImplementation(() => {
          sessionKey = '2:applicant-token';
          return Promise.resolve({ applicantId: 'applicant', displayName: '申请人', formalAccountReady: false });
        }),
        loadMe: jest.fn().mockResolvedValue({
          applicantId: 'applicant', displayName: '申请人', formalAccountReady: false,
        }),
        logout: jest.fn().mockImplementation(() => { sessionKey = ''; return Promise.resolve(); }),
      },
      applications: { load: jest.fn().mockResolvedValue(draft()), saveBasics: jest.fn().mockResolvedValue(draft(2)) },
    };
    getRuntime.mockReset().mockReturnValue(runtime);
    (global as any).wx = {
      getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: 375 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, height: 32 }),
      navigateBack: jest.fn(), reLaunch: jest.fn(), showModal: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    (global as any).getCurrentPages = () => [page];
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data, form: { ...config.data.form } } };
      page.setData = jest.fn((values: object) => Object.assign(page.data, values));
    };
    jest.isolateModules(() => require('../pages/partner/application/index'));
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).wx;
    delete (global as any).getCurrentPages;
    delete (global as any).Page;
  });

  it('loads identity and the own draft once across initial load and show', async () => {
    await ready();
    expect(runtime.sessions.loadMe).toHaveBeenCalledTimes(1);
    expect(runtime.applications.load).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ viewState: 'ready', version: 1, dirty: false, readonly: false });
    expect(page.data.form.institutionName).toBe('合成机构');
  });
  it('restores, edits and saves the institution contact as text along with the current draft version', async () => {
    const phone = '0000-00000000';
    runtime.applications.load.mockResolvedValueOnce({
      ...draft(), basicInformation: { ...draft().basicInformation, contactPhone: phone },
    });
    await ready();
    expect(page.data.form.contactPhone).toBe(phone);
    input('contactPhone', '0000-00000001');
    expect(page.data.dirty).toBe(true);
    runtime.applications.saveBasics.mockResolvedValueOnce({
      ...draft(2), basicInformation: { ...draft().basicInformation, contactPhone: '0000-00000001' },
    });
    await page.onSave();
    expect(runtime.applications.saveBasics).toHaveBeenCalledWith(1,
      expect.objectContaining({ contactPhone: '0000-00000001' }));
    expect(page.data).toMatchObject({ version: 2, dirty: false, saving: false });
    expect(page.data.form.contactPhone).toBe('0000-00000001');
  });
  it('keeps an unsaved contact through save failure and an explicit conflict reread', async () => {
    await ready();
    input('contactPhone', '0000-00000000');
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(503));
    await page.onSave();
    expect(page.data.form.contactPhone).toBe('0000-00000000');
    expect(page.data.dirty).toBe(true);
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(409));
    await page.onSave();
    runtime.applications.load.mockResolvedValueOnce({
      ...draft(3), basicInformation: { ...draft().basicInformation, contactPhone: '0000-00000002' },
    });
    await page.onConflictReload();
    expect(page.data.form.contactPhone).toBe('0000-00000000');
    expect(page.data).toMatchObject({ version: 3, dirty: true, needsVersionRefresh: false });
  });
  it('ignores overlong contact input and clears a loaded contact after applicant authorization expires', async () => {
    await ready();
    input('contactPhone', '0000-00000000');
    const contactPhone = '0000-00000000-0000000000000000';
    input('contactPhone', contactPhone);
    expect(page.data.form.contactPhone).toBe(contactPhone);
    input('contactPhone', '0'.repeat(31));
    expect(page.data.form.contactPhone).toBe(contactPhone);
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(401));
    await page.onSave();
    expect(page.data.form.contactPhone).toBe('');
    expect(page.data.viewState).toBe('login');
  });
  it('uses a login state without sending a protected read if credentials are missing', async () => {
    sessionKey = '';
    await ready();
    expect(page.data.viewState).toBe('login');
    expect(runtime.sessions.loadMe).not.toHaveBeenCalled();
    expect(runtime.applications.load).not.toHaveBeenCalled();
  });
  it('requires explicit applicant login, deduplicates taps and then restores the draft', async () => {
    sessionKey = '';
    await ready();
    const login = deferred();
    runtime.sessions.login.mockReturnValueOnce(login.promise);
    const first = page.onApplicantLogin();
    page.onApplicantLogin();
    await flush();
    expect(runtime.sessions.login).toHaveBeenCalledTimes(1);
    sessionKey = '2:new-applicant-token';
    login.resolve({ formalAccountReady: false });
    await first;
    expect(page.data.viewState).toBe('ready');
  });
  it('renders an empty draft with version zero and saves only the basic fields', async () => {
    runtime.applications.load.mockResolvedValueOnce(null);
    await ready();
    expect(page.data).toMatchObject({ viewState: 'empty', version: 0 });
    input('institutionName', '新合成机构');
    await page.onSave();
    expect(runtime.applications.saveBasics).toHaveBeenCalledWith(0, {
      institutionName: '新合成机构', province: '', city: '', district: '', detailedAddress: '', contactPhone: '',
    });
  });
  it('renders an archive-empty state for a formal identity with no application and never offers a new draft', async () => {
    runtime.sessions.loadMe.mockResolvedValueOnce({
      applicantId: 'applicant', displayName: '已开通合作方', formalAccountReady: true,
    });
    runtime.applications.load.mockResolvedValueOnce(null);
    await ready();
    expect(page.data).toMatchObject({
      viewState: 'empty', archiveEmpty: true, readonly: true, statusLabel: '暂无档案', dirty: false,
    });
    input('institutionName', '不能重新建户');
    page.onRegionChange({ detail: { value: ['浙江省', '杭州市', '西湖区'] } });
    await page.onSave();
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.region).toEqual(['', '', '']);
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/application/index.wxml'), 'utf8');
    expect(markup).toContain('wx:if="{{archiveEmpty}}"');
    expect(markup).toContain('暂无入驻申请档案');
    expect(markup).toContain('wx:else class="application__form"');
  });
  it('keeps an applicant without a saved draft editable rather than treating it as a missing archive', async () => {
    runtime.applications.load.mockResolvedValueOnce(null);
    await ready();
    expect(page.data).toMatchObject({
      viewState: 'empty', archiveEmpty: false, readonly: false, statusLabel: '尚未保存',
    });
    input('institutionName', '正常新申请');
    await page.onSave();
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
  });
  it('replaces archive-empty with actual read-only archive information on an explicit reread', async () => {
    runtime.sessions.loadMe.mockResolvedValue({
      applicantId: 'applicant', displayName: '已开通合作方', formalAccountReady: true,
    });
    runtime.applications.load.mockResolvedValueOnce(null);
    await ready();
    runtime.applications.load.mockResolvedValueOnce(draft(2, 'APPROVED'));
    await page.loadDraft();
    expect(page.data).toMatchObject({
      viewState: 'ready', archiveEmpty: false, readonly: true, version: 2, statusLabel: '已通过',
    });
    expect(page.data.form.institutionName).toBe('合成机构');
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });
  it('clears archive-empty when leaving the applicant identity', async () => {
    runtime.sessions.loadMe.mockResolvedValueOnce({
      applicantId: 'applicant', displayName: '已开通合作方', formalAccountReady: true,
    });
    runtime.applications.load.mockResolvedValueOnce(null);
    await ready();
    await page.onApplicantLogout();
    expect(page.data).toMatchObject({ viewState: 'login', archiveEmpty: false, readonly: false });
  });
  it('coalesces saves and prevents editing while a save is pending', async () => {
    await ready();
    const save = deferred();
    runtime.applications.saveBasics.mockReturnValueOnce(save.promise);
    input('institutionName', '待保存机构');
    const first = page.onSave();
    page.onSave();
    input('institutionName', '不得覆盖发送中的输入');
    await flush();
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
    expect(page.data.form.institutionName).toBe('待保存机构');
    save.resolve(draft(2));
    await first;
    expect(page.data).toMatchObject({ saving: false, dirty: false, version: 2 });
  });
  it('keeps all input after a normal save failure without automatically retrying', async () => {
    await ready();
    input('institutionName', '保留本地机构');
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(503));
    await page.onSave();
    expect(page.data.form.institutionName).toBe('保留本地机构');
    expect(page.data).toMatchObject({ dirty: true, saving: false });
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
  });
  it('does not retry a conflict until explicitly reading the new version and preserves edits', async () => {
    await ready();
    input('institutionName', '本人编辑');
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(409));
    await page.onSave();
    expect(page.data.needsVersionRefresh).toBe(true);
    await page.onSave();
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
    runtime.applications.load.mockResolvedValueOnce(draft(4));
    await page.onConflictReload();
    expect(page.data.version).toBe(4);
    expect(page.data.form.institutionName).toBe('本人编辑');
    expect(page.data.needsVersionRefresh).toBe(false);
  });
  it.each(['SUBMITTED', 'REJECTED', 'APPROVED'])('keeps %s read-only', async (status) => {
    runtime.applications.load.mockResolvedValueOnce(draft(2, status));
    await ready();
    input('institutionName', '不得修改');
    await page.onSave();
    expect(page.data.readonly).toBe(true);
    expect(page.data.form.institutionName).toBe('合成机构');
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });
  it('keeps even a DRAFT read-only once the separate formal account exists', async () => {
    runtime.sessions.loadMe.mockResolvedValueOnce({ formalAccountReady: true, displayName: '申请人' });
    await ready();
    await page.onSave();
    expect(page.data.readonly).toBe(true);
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });
  it('clears private form contents on authentication failure', async () => {
    await ready();
    runtime.applications.load.mockRejectedValueOnce(failure(401));
    await page.loadDraft();
    expect(page.data).toMatchObject({ viewState: 'login', version: 0, dirty: false });
    expect(Object.values(page.data.form).every((value) => value === '')).toBe(true);
  });
  it('does not apply a successful read after a session change', async () => {
    const read = deferred();
    runtime.applications.load.mockReturnValueOnce(read.promise);
    page.onLoad();
    await flush();
    sessionKey = '2:another-session';
    read.resolve(draft());
    await flush();
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.viewState).toBe('login');
  });
  it('ignores old results and does not write to hidden or unloaded instances', async () => {
    const read = deferred();
    runtime.applications.load.mockReturnValueOnce(read.promise);
    page.onLoad();
    await flush();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    read.resolve(draft());
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onUnload();
    page.onApplicantLogin();
    page.onSave();
    expect(runtime.sessions.login).not.toHaveBeenCalled();
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });
  it('keeps an unsaved draft when returning from a native picker', async () => {
    await ready();
    input('institutionName', '未保存机构');
    page.onHide();
    page.onShow();
    await flush();
    expect(page.data.form.institutionName).toBe('未保存机构');
    expect(runtime.applications.load).toHaveBeenCalledTimes(1);
  });
  it('accepts an actual three-part region and ignores malformed picker events', async () => {
    await ready();
    page.onRegionChange({ detail: { value: ['江苏省', '苏州市', '姑苏区'] } });
    expect(page.data.form).toMatchObject({ province: '江苏省', city: '苏州市', district: '姑苏区' });
    page.onRegionChange({ detail: { value: ['不完整'] } });
    expect(page.data.form.city).toBe('苏州市');
    input('bankAccount', '不得收集');
    expect(page.data.form.bankAccount).toBeUndefined();
  });
  it('clears optional region fields deliberately', async () => {
    await ready();
    page.onClearRegion();
    expect(page.data.form).toMatchObject({ province: '', city: '', district: '' });
    expect(page.data.dirty).toBe(true);
  });
  it('requires a single confirmation before leaving an unsaved draft', async () => {
    await ready();
    input('institutionName', '未保存机构');
    page.onBack();
    page.onBack();
    const wx = (global as any).wx;
    expect(wx.showModal).toHaveBeenCalledTimes(1);
    expect(wx.reLaunch).not.toHaveBeenCalled();
    wx.showModal.mock.calls[0][0].success({ confirm: false });
    expect(page.data.form.institutionName).toBe('未保存机构');
    page.onBack();
    wx.showModal.mock.calls[1][0].success({ confirm: true });
    expect(wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
  });
  it('ignores a leave confirmation returned after hiding', async () => {
    await ready();
    input('institutionName', '未保存机构');
    page.onBack();
    const wx = (global as any).wx;
    page.onHide();
    wx.showModal.mock.calls[0][0].success({ confirm: true });
    expect(wx.reLaunch).not.toHaveBeenCalled();
  });
  it('uses navigateBack when a previous page exists and bootstrap on direct open', async () => {
    await ready();
    (global as any).getCurrentPages = () => [{}, page];
    page.onBack();
    expect((global as any).wx.navigateBack).toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
  });
  it('clears only the restricted page state when logging out', async () => {
    await ready();
    await page.onApplicantLogout();
    expect(runtime.sessions.logout).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe('login');
    expect(page.data.form.institutionName).toBe('');
  });
  it('shows a recoverable error if the configured API is absent', async () => {
    getRuntime.mockImplementationOnce(() => { throw new Error('入驻接口地址未配置'); });
    await ready();
    expect(page.data).toMatchObject({ viewState: 'error', errorMessage: '入驻接口地址未配置' });
    expect(runtime.applications.load).not.toHaveBeenCalled();
  });
  it('turns synchronous protected read errors into a recoverable page state', async () => {
    runtime.applications.load.mockImplementationOnce(() => { throw new Error('合成同步读取异常'); });
    await page.loadDraft();
    expect(page.data).toMatchObject({ viewState: 'error', errorMessage: '合成同步读取异常' });
  });
  it('does not send a queued login or save after the page hides', async () => {
    sessionKey = '';
    await ready();
    const login = page.onApplicantLogin();
    page.onHide();
    await login;
    expect(runtime.sessions.login).not.toHaveBeenCalled();
    sessionKey = '3:applicant-token';
    page.onShow();
    await flush();
    input('institutionName', '不会发送');
    const save = page.onSave();
    page.onHide();
    await save;
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });
  it('does not begin a queued read after hiding', async () => {
    page.onLoad();
    page.onHide();
    await flush();
    expect(runtime.sessions.loadMe).not.toHaveBeenCalled();
    expect(runtime.applications.load).not.toHaveBeenCalled();
  });
  it('restores a completed hidden save from the server without sending it twice', async () => {
    await ready();
    input('institutionName', '本次保存机构');
    const save = deferred();
    const updated = { ...draft(2), basicInformation: { ...draft().basicInformation, institutionName: '本次保存机构' } };
    runtime.applications.saveBasics.mockReturnValueOnce(save.promise);
    const pending = page.onSave();
    await flush();
    page.onHide();
    page.onShow();
    runtime.applications.load.mockResolvedValueOnce(updated);
    save.resolve(updated);
    await pending;
    await flush();
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ viewState: 'ready', version: 2, dirty: false, saving: false });
    expect(page.data.form.institutionName).toBe('本次保存机构');
  });
  it('invalidates leave confirmation if the applicant identity changes during the modal', async () => {
    await ready();
    input('institutionName', '旧身份草稿');
    page.onBack();
    sessionKey = '2:new-session';
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    expect(page.data.viewState).toBe('login');
    expect(page.data.form.institutionName).toBe('');
    expect(page.dialogPending).toBe(false);
  });
  it.each(['success', 'failure'])('recovers a save settled while hidden before returning: %s', async (result) => {
    await ready();
    input('institutionName', '保留本次输入');
    const save = deferred();
    runtime.applications.saveBasics.mockReturnValueOnce(save.promise);
    const pending = page.onSave();
    await flush();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    if (result === 'success') save.resolve(draft(2));
    else save.reject(failure(503));
    await pending;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    runtime.applications.load.mockResolvedValueOnce(draft(2));
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', saving: false, version: 2, dirty: true });
    expect(page.data.form.institutionName).toBe('保留本次输入');
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
    expect(runtime.applications.load).toHaveBeenCalledTimes(2);
  });
  it('recovers an interrupted conflict read without losing edits or applying its late result', async () => {
    await ready();
    input('institutionName', '保留冲突输入');
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(409));
    await page.onSave();
    const read = deferred();
    runtime.applications.load.mockReturnValueOnce(read.promise);
    const pending = page.onConflictReload();
    await flush();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    read.resolve(draft(3));
    await pending;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    runtime.applications.load.mockResolvedValueOnce(draft(4));
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', version: 4, dirty: true, needsVersionRefresh: false,
    });
    expect(page.data.form.institutionName).toBe('保留冲突输入');
    expect(runtime.applications.load).toHaveBeenCalledTimes(3);
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
  });
  it.each([403, 503])('releases a completed hidden save even if recovery fails with %s', async (status) => {
    await ready();
    input('institutionName', '恢复失败也保留');
    const save = deferred();
    runtime.applications.saveBasics.mockReturnValueOnce(save.promise);
    const pending = page.onSave();
    await flush();
    page.onHide();
    save.resolve(draft(2));
    await pending;
    runtime.applications.load.mockRejectedValueOnce(failure(status));
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({
      viewState: status === 403 ? 'login' : 'error', saving: false, dirty: status !== 403,
    });
    expect(page.data.form.institutionName).toBe(status === 403 ? '' : '恢复失败也保留');
    if (status === 403) expect(page.data.bankForm).toEqual({ bankName: '', accountHolder: '', accountNumber: '' });
    expect(runtime.applications.saveBasics).toHaveBeenCalledTimes(1);
    expect(page.pendingSave).toBeUndefined();
    expect(page.pendingLoad).toBeUndefined();
    page.onBack();
    expect((global as any).wx.showModal).toHaveBeenCalledTimes(status === 403 ? 0 : 1);
  });
  it('does not let a late failed logout overwrite a new applicant login', async () => {
    await ready();
    const logout = deferred();
    runtime.sessions.logout.mockImplementationOnce(() => { sessionKey = ''; return logout.promise; });
    const pending = page.onApplicantLogout();
    await page.onApplicantLogin();
    expect(page.data.viewState).toBe('ready');
    logout.reject(new Error('合成退出失败'));
    await pending;
    expect(page.data.errorMessage).toBe('');
  });
  it('does not revoke another session through a stale logout event', async () => {
    await ready();
    sessionKey = '2:new-session';
    await page.onApplicantLogout();
    expect(runtime.sessions.logout).not.toHaveBeenCalled();
    expect(page.data.viewState).toBe('login');
  });
  it('recovers a draft read settled during a failed return and preserves unsaved inputs', async () => {
    await ready();
    input('institutionName', '返回失败仍保留');
    const read = deferred();
    runtime.applications.load.mockReturnValueOnce(read.promise);
    const pending = page.loadDraft(true);
    await flush();
    (global as any).getCurrentPages = () => [{}, page];
    page.onBack();
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    (global as any).wx.navigateBack.mock.calls[0][0].fail();
    read.resolve(draft(3));
    await pending;
    (global as any).wx.reLaunch.mock.calls[0][0].fail();
    expect(page.data).toMatchObject({
      viewState: 'error', errorMessage: '返回失败，请重试', dirty: true,
    });
    expect(page.pendingLoad).toBeUndefined();
    expect(page.navigating).toBe(false);
    expect(page.data.form.institutionName).toBe('返回失败仍保留');
    page.onRetry();
    await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', dirty: true });
    expect(runtime.applications.load).toHaveBeenCalledTimes(3);
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });
  it.each(['success', 'failure'])('allows a fresh read after failed return without a late %s overwriting it', async (result) => {
    await ready();
    const read = deferred();
    runtime.applications.load.mockReturnValueOnce(read.promise);
    const pending = page.loadDraft();
    await flush();
    (global as any).getCurrentPages = () => [{}, page];
    page.onBack();
    (global as any).wx.navigateBack.mock.calls[0][0].fail();
    (global as any).wx.reLaunch.mock.calls[0][0].fail();
    expect(page.data.viewState).toBe('error');
    runtime.applications.load.mockResolvedValueOnce(draft(4));
    page.onRetry();
    await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4 });
    const writes = page.setData.mock.calls.length;
    if (result === 'success') read.resolve(draft(99));
    else read.reject(failure(403));
    await pending;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4 });
    expect(page.pendingLoad).toBeUndefined();
    expect(runtime.applications.load).toHaveBeenCalledTimes(3);
    expect(runtime.sessions.login).not.toHaveBeenCalled();
  });
  it('covers the visible display heading in the existing licensed font', () => {
    for (const character of '申请入驻') expect(APPLICATION_DISPLAY_CHARACTERS).toContain(character);
  });
  it('registers a real subpackage page with native region selection and a separate saved-version submission', () => {
    const root = path.resolve(__dirname, '..');
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    expect(app.pages).toEqual(['pages/bootstrap/index']);
    expect(app.subPackages.find((item: any) => item.root === 'pages/partner').pages).toContain('application/index');
    const markup = fs.readFileSync(path.join(root, 'pages/partner/application/index.wxml'), 'utf8');
    expect(markup).toContain('mode="region"');
    expect(markup).toContain('bindtap="onSave"');
    expect(markup).toContain('bindtap="onBack"');
    expect(markup).not.toMatch(/bankAccount|身份证|营业执照|chooseMedia/);
    expect(markup).toContain('bindtap="onSubmit"');
    expect(markup).toContain('id="application-submit"');
  });
});
