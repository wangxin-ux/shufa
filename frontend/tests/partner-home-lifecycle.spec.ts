import { PARTNER_DASHBOARD_FIXTURE } from '../mock/fixtures/partner.fixture';

const loadDashboard = jest.fn();
const logout = jest.fn();
jest.mock('../services/session.service', () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));
jest.mock('../services/partner-runtime', () => ({
  partnerService: { loadDashboard: () => loadDashboard() },
  createPartnerService: () => ({ loadDashboard: () => loadDashboard() }),
}));
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => 'synthetic-home-owner' }),
}));

interface HomePage {
  data: Record<string, any>;
  setData(values: Record<string, unknown>): void;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onPullDownRefresh(): void;
  onLogin(): void;
  onRetry(): void;
  loadHome(silent?: boolean): Promise<void>;
}

describe('partner home request lifecycle', () => {
  let page: HomePage;
  let definition: HomePage;
  const success = { status: 'success', data: PARTNER_DASHBOARD_FIXTURE };
  function instantiate(config: HomePage): HomePage {
    const instance = { ...config, data: { ...config.data } };
    instance.setData = (values) => Object.assign(instance.data, values);
    return instance;
  }
  async function flush() {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  }
  async function initialize() {
    page.onLoad();
    await flush();
  }

  beforeEach(() => {
    loadDashboard.mockReset().mockResolvedValue(success);
    logout.mockReset();
    (global as any).wx = { stopPullDownRefresh: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: HomePage) => {
      definition = config;
      page = instantiate(config);
    };
    jest.isolateModules(() => require('../pages/partner/home/index'));
  });

  afterEach(() => {
    page.onUnload?.();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('does not fetch twice for the initial load/show pair', async () => {
    page.onLoad();
    page.onShow();
    await flush();
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe('ready');
  });

  it('deduplicates concurrent refreshes and stops the pull indicator', async () => {
    let resolve!: (value: unknown) => void;
    loadDashboard.mockImplementation(() => new Promise((done) => { resolve = done; }));
    page.onLoad();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalled();
  });

  it.each(['onHide', 'onUnload'] as const)(
    'ignores late responses after %s',
    async (lifecycle) => {
      let resolve!: (value: unknown) => void;
      loadDashboard.mockImplementation(() => new Promise((done) => { resolve = done; }));
      page.onLoad();
      await flush();
      page[lifecycle]();
      const update = jest.spyOn(page, 'setData');
      update.mockClear();
      resolve(success);
      await flush();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it('refreshes when returning and ignores an older hidden request', async () => {
    let resolveOld!: (value: unknown) => void;
    loadDashboard.mockImplementationOnce(() => new Promise((done) => { resolveOld = done; }));
    page.onLoad();
    page.onShow();
    await flush();
    page.onHide();
    page.onShow();
    await flush();
    expect(loadDashboard).toHaveBeenCalledTimes(2);
    expect(page.data.viewState).toBe('ready');
    resolveOld({ status: 'error', message: '旧请求失败', statusCode: 403 });
    await flush();
    expect(page.data.viewState).toBe('ready');
  });

  it('keeps content visible with a retryable foreground refresh failure', async () => {
    await initialize();
    loadDashboard.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.campusName).toBe(PARTNER_DASHBOARD_FIXTURE.campus.name);
    expect(page.data.refreshError).toBe('网络请求失败');
  });

  it('preserves the dashboard when retrying a foreground refresh also fails', async () => {
    await initialize();
    loadDashboard.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    page.onRetry();
    expect(page.data.viewState).toBe('ready');
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.campusName).toBe(PARTNER_DASHBOARD_FIXTURE.campus.name);
    expect(page.data.highlightCourses).not.toEqual([]);
    expect(page.data.refreshError).toBe('网络请求失败');
  });

  it.each([401, 403])('clears sensitive cached content for HTTP %s', async (statusCode) => {
    await initialize();
    loadDashboard.mockResolvedValue({ status: 'error', message: '无权限', statusCode });
    await page.loadHome(true);
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.campusName).toBe('');
    expect(page.data.partnerName).toBe('');
    expect(page.data.highlightStudent).toBe('');
    expect(page.data.highlightCourses).toEqual([]);
    expect(page.data.highlightAttendance).toBe('');
    expect(page.data.stats).toEqual([]);
  });

  it('removes stale personal summary when there is no longer a warning student', async () => {
    await initialize();
    loadDashboard.mockResolvedValue({
      status: 'success', data: { ...PARTNER_DASHBOARD_FIXTURE, highlight: null },
    });
    await page.loadHome(true);
    expect(page.data.highlightCourses).toEqual([]);
    expect(page.data.highlightAttendance).toBe('');
  });

  it('never requests again after unloading', async () => {
    page.onLoad();
    await flush();
    page.onUnload();
    page.onShow();
    await page.loadHome();
    expect(loadDashboard).toHaveBeenCalledTimes(1);
  });

  it('isolates two simultaneous instances of the same registered page definition', async () => {
    const first = page;
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    loadDashboard
      .mockImplementationOnce(() => new Promise((done) => { resolveFirst = done; }))
      .mockImplementationOnce(() => new Promise((done) => { resolveSecond = done; }));
    first.onLoad();
    page = instantiate(definition);
    const second = page;
    second.onLoad();
    const response = (name: string) => ({
      status: 'success',
      data: {
        ...PARTNER_DASHBOARD_FIXTURE,
        campus: { ...PARTNER_DASHBOARD_FIXTURE.campus, name },
      },
    });
    await flush();
    resolveSecond(response('第二校区'));
    await flush();
    resolveFirst(response('第一校区'));
    await flush();
    expect(first.data.viewState).toBe('ready');
    expect(first.data.campusName).toBe('第一校区');
    expect(second.data.viewState).toBe('ready');
    expect(second.data.campusName).toBe('第二校区');
    expect(loadDashboard).toHaveBeenCalledTimes(2);
    first.onUnload();
  });

  it('recovers an unexpected rejection and permits retry', async () => {
    loadDashboard.mockRejectedValueOnce(new Error('internal details'));
    await initialize();
    expect(page.data.viewState).toBe('error');
    expect(page.data.errorMessage).not.toContain('internal details');
    await initialize();
    expect(page.data.viewState).toBe('ready');
  });

  it('offers explicit re-login after access failure without silently changing identity', async () => {
    loadDashboard.mockResolvedValue({ status: 'error', message: '登录过期', statusCode: 401 });
    await page.loadHome();
    expect(logout).not.toHaveBeenCalled();
    page.onLogin();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
});
