import { PARTNER_OPERATIONS_SUMMARY_FIXTURE } from '../mock/fixtures/partner.fixture';

const loadSummary = jest.fn();
const createRuntime = jest.fn();
const logout = jest.fn();
let ownerKey = 'synthetic-operations-owner';
jest.mock('../services/partner-runtime', () => ({
  partnerService: { loadOperationsSummary: (query: object) => loadSummary(query) },
  createPartnerService: () => createRuntime(),
}));
jest.mock('../services/session.service', () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
const success = { status: 'success', data: PARTNER_OPERATIONS_SUMMARY_FIXTURE };
const deferred = () => {
  let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

describe('partner operations ownership and callback protection', () => {
  let page: any, definition: any;
  const instances: any[] = [];
  const instantiate = () => {
    const instance = { ...definition, data: structuredClone(definition.data) };
    instance.setData = jest.fn((patch: object) => Object.assign(instance.data, patch));
    instances.push(instance);
    return instance;
  };
  const flush = async () => {
    for (let index = 0; index < 20; index++) await Promise.resolve();
  };
  const open = async () => {
    page.onLoad(); page.onShow();
    await page.pendingRequest;
    expect(page.data.viewState).toBe('ready');
  };
  const cleared = () => {
    expect(page.data).toMatchObject({ viewState: 'forbidden', summary: null, refreshError: '' });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingKey).toBe('');
    expect(page.contentKey).toBe('');
  };
  beforeEach(() => {
    instances.length = 0;
    ownerKey = 'synthetic-operations-owner';
    createRuntime.mockReset().mockImplementation(() => ({
      loadOperationsSummary: (query: object) => loadSummary(query),
    }));
    loadSummary.mockReset().mockResolvedValue(success);
    logout.mockReset();
    (global as any).wx = { stopPullDownRefresh: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: any) => { definition = config; };
    jest.isolateModules(() => require('../pages/partner/operations/index'));
    page = instantiate();
  });
  afterEach(() => {
    instances.forEach((instance) => instance.onUnload());
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it.each(['onShow', 'onRetry', 'loadOperations', 'onPeriodTap', 'onAnchorDateChange'])(
    'clears private statistics when ownership changes before %s', async (entry) => {
      await open();
      const selection = { periodIndex: page.data.periodIndex, anchorDate: page.data.anchorDate };
      ownerKey = 'synthetic-other-owner';
      await page[entry]({ currentTarget: { dataset: { period: 'DAY' } }, detail: { value: '2026-01-01' } });
      await flush();
      cleared();
      expect(page.data).toMatchObject(selection);
      page.onRetry(); page.onShow();
      await flush();
      expect(loadSummary).toHaveBeenCalledTimes(1);
    },
  );
  it('checks the owner before the queued initial read', async () => {
    page.onLoad();
    ownerKey = 'synthetic-other-owner';
    await flush();
    cleared();
    expect(loadSummary).not.toHaveBeenCalled();
  });
  it('checks the owner before sending a queued refresh', async () => {
    await open();
    const reading = page.loadOperations();
    ownerKey = 'synthetic-other-owner';
    await reading;
    cleared();
    expect(loadSummary).toHaveBeenCalledTimes(1);
  });
  it.each(['success', '401', '403', 'rejection'])(
    'ignores a held %s from the old owner without lifecycle events', async (delivery) => {
      await open();
      const held = deferred();
      loadSummary.mockReturnValueOnce(held.promise);
      const reading = page.loadOperations();
      await flush();
      ownerKey = 'synthetic-other-owner';
      if (delivery === 'rejection') held.reject({ statusCode: 403, message: 'private denial' });
      else held.resolve(delivery === 'success' ? success : {
        status: 'error', statusCode: Number(delivery), message: 'private denial',
      });
      await reading;
      cleared();
      expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
    },
  );
  it.each([401, 403].flatMap((statusCode) =>
    ['throw', 'reject'].map((delivery) => ({ statusCode, delivery })),
  ))('clears summary when $delivery carries HTTP $statusCode', async ({ statusCode, delivery }) => {
    await open();
    const error = { statusCode, message: 'private error' };
    loadSummary.mockImplementationOnce(() => {
      if (delivery === 'throw') throw error;
      return Promise.reject(error);
    });
    const previous = page.requestSequence;
    await expect(page.loadOperations()).resolves.toBeUndefined();
    cleared();
    expect(page.requestSequence).toBeGreaterThan(previous + 1);
    expect(page.data.errorMessage).not.toContain('private error');
    expect(logout).not.toHaveBeenCalled();
  });
  it('preserves statistics on ordinary sync and rejected failures', async () => {
    await open();
    const summary = page.data.summary;
    for (const sync of [true, false]) {
      loadSummary.mockImplementationOnce(() => {
        if (sync) throw Error('private error');
        return Promise.reject(Error('private error'));
      });
      await page.loadOperations();
      expect(page.data).toMatchObject({
        viewState: 'ready', summary, refreshError: '经营统计加载失败，请重试',
      });
    }
  });
  it.each([401, 403])('invalidates the pending generation on resolved HTTP %s', async (statusCode) => {
    await open();
    loadSummary.mockResolvedValueOnce({ status: 'error', statusCode, message: 'private denial' });
    const previous = page.requestSequence;
    await page.loadOperations();
    cleared();
    expect(page.requestSequence).toBeGreaterThan(previous + 1);
  });
  it.each(['fail', 'throw'])('keeps logout final after login navigation %s', async (delivery) => {
    await open();
    const held = deferred();
    loadSummary.mockReturnValueOnce(held.promise);
    const reading = page.loadOperations();
    await flush();
    logout.mockImplementationOnce(() => {
      cleared();
      expect(page.runtime).toBeUndefined();
    });
    (global as any).wx.reLaunch.mockImplementationOnce((options: { fail?: () => void }) => {
      if (delivery === 'throw') throw Error('private native error');
      options.fail?.();
    });
    expect(() => page.onLogin()).not.toThrow();
    held.resolve(success);
    await reading;
    page.onShow(); page.onRetry();
    await flush();
    cleared();
    expect(loadSummary).toHaveBeenCalledTimes(2);
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
  it.each(['onHide', 'onUnload'])('ignores a late pull completion after %s', async (lifecycle) => {
    await open();
    const held = deferred();
    loadSummary.mockReturnValueOnce(held.promise);
    page.onPullDownRefresh();
    await flush();
    page[lifecycle]();
    held.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
  });
  it.each([false, true])('does not stop a pull after logout with a further pull=%s', async (furtherPull) => {
    await open();
    const held = deferred();
    loadSummary.mockReturnValueOnce(held.promise);
    page.onPullDownRefresh();
    await flush();
    page.onLogin();
    if (furtherPull) page.onPullDownRefresh();
    held.resolve(success);
    await flush();
    cleared();
    expect(loadSummary).toHaveBeenCalledTimes(2);
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
  });
  it('does not stop the fresh pull from an old hidden request', async () => {
    await open();
    const old = deferred(), current = deferred();
    loadSummary.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    page.onPullDownRefresh();
    await flush();
    page.onHide(); page.onShow(); page.onPullDownRefresh();
    await flush();
    old.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    expect(page.pendingRequest).toBeDefined();
    current.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });
  it('deduplicates repeated pulls and stops the latest indicator once', async () => {
    await open();
    const held = deferred();
    loadSummary.mockReturnValueOnce(held.promise);
    page.onPullDownRefresh(); page.onPullDownRefresh();
    await flush();
    expect(loadSummary).toHaveBeenCalledTimes(2);
    held.resolve(success);
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('contains malformed statistics during refresh=%s and allows retry', async (refresh) => {
    if (refresh) await open();
    const summary = page.data.summary;
    loadSummary.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_OPERATIONS_SUMMARY_FIXTURE, teacherMetrics: null },
    });
    if (refresh) page.onRetry(); else page.onLoad();
    await expect(page.pendingRequest).resolves.toBeUndefined();
    expect(page.data).toMatchObject(refresh
      ? { viewState: 'ready', summary, refreshError: '经营统计加载失败，请重试' }
      : { viewState: 'error', summary: null, errorMessage: '经营统计加载失败，请重试' });
    page.onRetry();
    await page.pendingRequest;
    expect(page.data).toMatchObject({ viewState: 'ready', refreshError: '' });
  });
  it('creates the current service for each new instance', async () => {
    expect(createRuntime).not.toHaveBeenCalled();
    await open();
    const otherLoad = jest.fn().mockResolvedValue(success);
    createRuntime.mockReturnValueOnce({ loadOperationsSummary: otherLoad });
    const other = instantiate();
    other.onLoad(); other.onShow();
    await other.pendingRequest;
    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(otherLoad).toHaveBeenCalledTimes(1);
    expect(loadSummary).toHaveBeenCalledTimes(1);
  });
});
