import { PARTNER_DASHBOARD_FIXTURE } from '../mock/fixtures/partner.fixture';

const loadDashboard = jest.fn();
const logout = jest.fn();
let ownerKey = 'synthetic-home-owner';
jest.mock('../services/partner-runtime', () => ({
  partnerService: { loadDashboard: () => loadDashboard() },
  createPartnerService: () => ({ loadDashboard: () => loadDashboard() }),
}));
jest.mock('../services/session.service', () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
const success = { status: 'success', data: PARTNER_DASHBOARD_FIXTURE };
const deferred = () => {
  let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const tap = (page: any) => page.onActionTap({ currentTarget: { dataset: { key: 'students' } } });
describe('partner home owner and native callback protection', () => {
  let page: any;
  const flush = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
  };
  const open = async () => {
    page.onLoad(); page.onShow();
    await flush();
    expect(page.data.viewState).toBe('ready');
  };
  const cleared = () => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden', partnerName: '', campusName: '', highlightStudent: '',
      highlightClass: '', highlightCourses: [], highlightAttendance: '', stats: [],
      highlightEnrollment: null,
      menuExpanded: false, refreshError: '',
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.navigating).toBe(false);
  };
  beforeEach(() => {
    ownerKey = 'synthetic-home-owner';
    loadDashboard.mockReset().mockResolvedValue(success);
    logout.mockReset();
    (global as any).wx = {
      stopPullDownRefresh: jest.fn(), navigateTo: jest.fn(),
      showToast: jest.fn(), reLaunch: jest.fn(),
    };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
    jest.isolateModules(() => require('../pages/partner/home/index'));
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).Page;
    delete (global as any).wx;
  });
  it('shows received and refunded enrollment money for the selected highlight', async () => {
    loadDashboard.mockResolvedValueOnce({
      status: 'success',
      data: {
        ...PARTNER_DASHBOARD_FIXTURE,
        highlight: {
          ...PARTNER_DASHBOARD_FIXTURE.highlight!,
          enrollmentSummary: {
            receivedAmountFen: 188000, refundedAmountFen: 20000,
            initialMainUnits: 1000, initialGiftUnits: 200, pendingIssuanceCount: 1,
          },
        },
      },
    });
    await open();
    expect(page.data.highlightEnrollment).toMatchObject({
      receivedLabel: '¥1880.00', refundedLabel: '¥200.00',
    });
    loadDashboard.mockResolvedValueOnce({ status: 'error', statusCode: 403, message: '合成失权' });
    await page.loadHome(true);
    expect(page.data.highlightEnrollment).toBeNull();
  });
  it('keeps missing highlight enrollment unknown and clears it when the highlight disappears', async () => {
    await open();
    expect(page.data.highlightEnrollment).toMatchObject({
      receivedLabel: '待核对', refundedLabel: '待核对',
    });
    loadDashboard.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_DASHBOARD_FIXTURE, highlight: null },
    });
    await page.loadHome(true);
    expect(page.data.highlightEnrollment).toBeNull();
  });
  it.each(['onShow', 'onRetry', 'onMenuToggle', 'onCloseMenu', 'onActionTap'])(
    'clears private data when owner changes before %s', async (entry) => {
      await open();
      page.onMenuToggle();
      ownerKey = 'synthetic-other-owner';
      if (entry === 'onActionTap') tap(page); else page[entry]();
      await flush();
      cleared();
      expect(loadDashboard).toHaveBeenCalledTimes(1);
      expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    },
  );
  it('cancels an initial queued read after owner replacement', async () => {
    page.onLoad();
    ownerKey = 'synthetic-other-owner';
    await flush();
    cleared();
    expect(loadDashboard).not.toHaveBeenCalled();
  });
  it.each(['success', '401', '403', 'rejection'])(
    'ignores a held %s after owner changes without a lifecycle event', async (delivery) => {
      await open();
      const old = deferred();
      loadDashboard.mockReturnValueOnce(old.promise);
      const reading = page.loadHome(true);
      await flush();
      ownerKey = 'synthetic-other-owner';
      if (delivery === 'rejection') old.reject(Object.assign(Error('private'), { statusCode: 403 }));
      else old.resolve(delivery === 'success' ? success : {
        status: 'error', statusCode: Number(delivery), message: 'private denial',
      });
      await reading;
      cleared();
      expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
    },
  );
  it('checks the owner in a native navigation failure before releasing old state', async () => {
    await open();
    tap(page);
    const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    ownerKey = 'synthetic-other-owner';
    fail();
    cleared();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    tap(page);
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])('cancels navigation and ignores its callback on HTTP %s', async (statusCode) => {
    await open();
    tap(page);
    const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    loadDashboard.mockResolvedValueOnce({ status: 'error', statusCode, message: 'private denial' });
    await page.loadHome(true);
    cleared();
    const writes = page.setData.mock.calls.length;
    fail();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });
  it.each([401, 403].flatMap((statusCode) =>
    ['throw', 'reject'].map((delivery) => ({ statusCode, delivery })),
  ))('clears data when service $delivery carries HTTP $statusCode', async ({ statusCode, delivery }) => {
    await open();
    tap(page);
    const error = Object.assign(Error('private'), { statusCode });
    if (delivery === 'throw') loadDashboard.mockImplementationOnce(() => { throw error; });
    else loadDashboard.mockRejectedValueOnce(error);
    await expect(page.loadHome(true)).resolves.toBeUndefined();
    cleared();
    expect(logout).not.toHaveBeenCalled();
  });
  it.each([false, true])('stops the old page after logout with throwing navigation=%s', async (throws) => {
    await open();
    const old = deferred();
    loadDashboard.mockReturnValueOnce(old.promise);
    const reading = page.loadHome(true);
    await flush();
    if (throws) (global as any).wx.reLaunch.mockImplementationOnce(() => { throw Error('native failure'); });
    try { page.onLogin(); } catch { expect(throws).toBe(true); }
    cleared();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
    old.resolve(success);
    await reading;
    const reads = loadDashboard.mock.calls.length;
    page.onShow(); page.onRetry(); page.onMenuToggle(); tap(page);
    await flush();
    cleared();
    expect(loadDashboard).toHaveBeenCalledTimes(reads);
  });
  it.each(['onHide', 'onUnload'])('prevents an old pull from stopping refresh after %s', async (lifecycle) => {
    await open();
    const old = deferred(), fresh = deferred();
    loadDashboard.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    page.onPullDownRefresh();
    await flush();
    page[lifecycle]();
    if (lifecycle === 'onHide') {
      page.onShow(); page.onPullDownRefresh();
      await flush();
    }
    old.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    if (lifecycle === 'onHide') {
      fresh.resolve(success);
      await flush();
      expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    }
  });
  it('deduplicates a repeated pull and stops only the latest indicator callback', async () => {
    await open();
    const pending = deferred();
    loadDashboard.mockReturnValueOnce(pending.promise);
    page.onPullDownRefresh(); page.onPullDownRefresh();
    await flush();
    expect(loadDashboard).toHaveBeenCalledTimes(2);
    pending.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('contains a model conversion failure during refresh=%s and allows retry', async (refresh) => {
    if (refresh) await open();
    loadDashboard.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_DASHBOARD_FIXTURE, campus: null },
    });
    if (refresh) page.onRetry(); else page.onLoad();
    await expect(page.pendingRequest).resolves.toBeUndefined();
    if (refresh) {
      expect(page.data).toMatchObject({
        viewState: 'ready', campusName: PARTNER_DASHBOARD_FIXTURE.campus.name,
        refreshError: '经营数据刷新失败，请重试',
      });
    } else expect(page.data).toMatchObject({
      viewState: 'error', errorMessage: '经营数据加载失败，请重试',
    });
    page.onRetry();
    await page.pendingRequest;
    expect(page.data).toMatchObject({ viewState: 'ready', refreshError: '' });
  });
});
