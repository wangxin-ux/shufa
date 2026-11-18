export {};
import { partnerApplicationAcceptanceFixture } from './fixtures/partner-application-acceptance.fixture';
const accounts = jest.fn();
const campuses = jest.fn();
const unbind = jest.fn();
const status = jest.fn();
let owner = 'synthetic-reviewer';
jest.mock('../config/super-admin-env', () => ({ createSuperAdminRuntimeEnv: () => ({
  dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3000', accessToken: owner,
}) }));
jest.mock('../pages/super-admin/runtime/staff-account-runtime', () => ({
  staffAccountSessionKey: () => JSON.stringify(['api', 'http://127.0.0.1:3000', owner]),
  getStaffAccountRuntime: () => ({
  loadStaffAccounts: (...args: unknown[]) => accounts(...args),
  loadCampuses: (...args: unknown[]) => campuses(...args),
  unbindStaffWechat: (...args: unknown[]) => unbind(...args),
  updateStaffAccountStatus: (...args: unknown[]) => status(...args),
  }),
}));
const id = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const row = () => ({ id, displayName: '合成申请人', maskedPhone: '未绑定个人手机号',
  roleCode: 'PARTNER', campusId: id, campusName: '合成批准机构', bindingStatus: 'BOUND', status: 'ACTIVE', version: 2 });
const accountPage = (data: object[] = [row()]) => ({ status: 'success', data: {
  data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 },
} });
describe('approved phone-less staff account controls', () => {
  let page: any;
  const event = () => ({ currentTarget: { dataset: { id, version: 2, status: 'ACTIVE' } } });
  beforeEach(() => {
    owner = 'synthetic-reviewer';
    accounts.mockReset().mockResolvedValue(accountPage());
    campuses.mockReset().mockResolvedValue({ status: 'success', data: {
      data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
    } });
    unbind.mockReset().mockResolvedValue({ status: 'success' });
    status.mockReset().mockResolvedValue({ status: 'success' });
    // The management context re-authorizes every read through GET /me before
    // touching the staff port, so the transport has to answer that call.
    const request = jest.fn((options: any) => {
      const url = String(options.url ?? '');
      if (url.endsWith('/me')) {
        options.success?.({ statusCode: 200, data: { data: {
          userId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
          roles: [{ code: 'SUPER_ADMIN', campusId: null }],
        } } });
        return;
      }
      options.fail?.({});
    });
    (global as any).wx = { showModal: jest.fn(), showToast: jest.fn(), request };
    (global as any).Page = (config: any) => {
      page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = (patch: object) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/super-admin/staff-accounts/index'));
    // Skip the campus read so each test exercises only the account list paths.
    page.campusesReady = true;
  });
  afterEach(() => { delete (global as any).Page; delete (global as any).wx; });
  // Each port call crosses the /me authorization round trip before the mock is
  // reached, so tests that capture a deferred resolver must drain first.
  const settle = async () => { for (let i = 0; i < 40; ++i) await Promise.resolve(); };
  it('lists the literal no-phone label and refuses both UI and direct unbind handlers', async () => {
    await page.loadAccounts();
    expect(page.data.accounts[0]).toMatchObject({ maskedPhone: '未绑定个人手机号', campusName: '合成批准机构', roleLabel: '合作方' });
    page.onUnbindAction(event()); await page.unbindWechat(id, 2);
    expect((global as any).wx.showModal).not.toHaveBeenCalled(); expect(unbind).not.toHaveBeenCalled();
  });
  it('preserves the complete approved institution and identity labels through status display', async () => {
    const fixture = partnerApplicationAcceptanceFixture('APPROVED');
    accounts.mockResolvedValueOnce(accountPage([
      fixture.account, { ...fixture.account, id: id, status: 'DISABLED' },
    ]));
    await page.loadAccounts();
    expect(page.data.accounts).toHaveLength(2);
    expect(page.data.accounts[0]).toMatchObject({
      displayName: fixture.identity.displayName, campusName: fixture.summary.institutionName,
      maskedPhone: '未绑定个人手机号', roleLabel: '合作方', bindingLabel: '微信已绑定', statusLabel: '已启用',
    });
    expect(page.data.accounts[1].statusLabel).toBe('已停用');
    page.onHide();
    expect(page.data.accounts).toEqual([]);
    expect(status).not.toHaveBeenCalled(); expect(unbind).not.toHaveBeenCalled();
  });
  it('retains controlled status update for approved accounts and uses institution search', async () => {
    page.data.keyword = '合成批准机构'; await page.loadAccounts();
    expect(accounts).toHaveBeenCalledWith({ page: 1, pageSize: 100, query: '合成批准机构' });
    page.onStatusAction(event()); (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    for (let i = 0; i < 20; ++i) await Promise.resolve();
    expect(status).toHaveBeenCalledWith(id, { expectedVersion: 2, status: 'DISABLED' }, expect.any(String));
  });
  it('rechecks the listed account after confirmation before a phone-backed unbind', async () => {
    accounts.mockResolvedValueOnce(accountPage([{ ...row(), maskedPhone: '+86****8000' }]));
    await page.loadAccounts(); page.onUnbindAction(event());
    const callback = (global as any).wx.showModal.mock.calls[0][0].success;
    page.data.accounts = [row()]; callback({ confirm: true }); await Promise.resolve();
    expect(unbind).not.toHaveBeenCalled();
  });
  it.each(['hide', 'unload', 'owner'])('ignores a delayed status confirmation after %s', async (cause) => {
    await page.loadAccounts(); page.onStatusAction(event());
    const callback = (global as any).wx.showModal.mock.calls[0][0].success;
    if (cause === 'hide') page.onHide?.();
    if (cause === 'unload') page.onUnload?.();
    if (cause === 'owner') owner = 'another-reviewer';
    callback({ confirm: true }); for (let i = 0; i < 20; ++i) await Promise.resolve();
    expect(status).not.toHaveBeenCalled();
  });
  it('does not reload a hidden page after an already sent status update completes', async () => {
    await page.loadAccounts(); let finish!: (v: unknown) => void;
    status.mockImplementationOnce(() => new Promise((yes) => { finish = yes; }));
    page.onStatusAction(event()); (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    await settle(); page.onHide?.(); finish({ status: 'success' });
    for (let i = 0; i < 20; ++i) await Promise.resolve();
    expect(accounts).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])('clears private accounts after a current status update receives %s', async (statusCode) => {
    await page.loadAccounts();
    status.mockResolvedValueOnce({ status: 'error', statusCode, message: '无权限' });
    page.onStatusAction(event()); (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    for (let i = 0; i < 20; ++i) await Promise.resolve();
    expect(page.data.accounts).toEqual([]); expect(page.data.viewState).toBe('forbidden');
  });
  it.each(['pending', 'error'])('clears the previous owner before a new owner campus read is %s', async (cause) => {
    await page.loadAccounts();
    owner = 'another-reviewer';
    let finish!: (value: unknown) => void;
    campuses.mockImplementationOnce(() => new Promise((yes) => { finish = yes; }));
    const loading = page.load();
    await settle();
    if (cause === 'error') {
      finish({ status: 'error', statusCode: 503, message: '校区读取失败' });
      await loading;
    }
    try {
      await page.updateStatus(id, 2, 'DISABLED');
      expect(page.data.accounts).toEqual([]);
      expect(status).not.toHaveBeenCalled();
    } finally {
      if (cause === 'pending') {
        finish({ status: 'success', data: {
          data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 },
        } });
        await loading;
      }
    }
  });
  it.each(['status', 'unbind'])('releases the %s button after a search supersedes its response', async (action) => {
    if (action === 'unbind') accounts.mockResolvedValue(accountPage([{ ...row(), maskedPhone: '+86****8000' }]));
    await page.loadAccounts();
    let finish!: (value: unknown) => void;
    const write = action === 'status' ? status : unbind;
    write.mockImplementationOnce(() => new Promise((yes) => { finish = yes; }));
    const pending = action === 'status'
      ? page.updateStatus(id, 2, 'DISABLED')
      : page.unbindWechat(id, 2);
    expect(page.data.submittingId).toBe(id);
    await settle();
    await page.loadAccounts();
    expect(page.data.accounts[0].id).toBe(id);
    expect(page.data.submittingId).toBe(id);
    finish({ status: 'success' });
    await pending;
    expect(page.mutationPending).toBeFalsy();
    expect(page.data.submittingId).toBe('');
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });
});
