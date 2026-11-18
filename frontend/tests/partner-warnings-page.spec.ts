import * as fs from 'fs';
import * as path from 'path';

const loadWarnings = jest.fn();
const logout = jest.fn();
let ownerKey = 'synthetic-warnings-owner';
jest.mock('../services/partner-runtime', () => ({
  createPartnerService: () => ({ loadWarnings: (query: unknown) => loadWarnings(query) }),
  partnerService: { loadWarnings: (query: unknown) => loadWarnings(query) },
}));
jest.mock('../services/session.service', () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));

const success = (ids = ['first'], page = 1, totalPages = 2) => ({
  status: ids.length ? 'success' : 'empty',
  data: {
    data: ids.map((studentId) => ({
      studentId, studentName: '林同学', classNames: ['美术班'],
      mainBalanceUnits: 300, giftBalanceUnits: 100,
      totalBalanceUnits: 400, thresholdUnits: 500,
    })),
    meta: { page, pageSize: 20, total: ids.length ? 40 : 0, totalPages },
  },
});
const failure = (statusCode = 500) => ({
  status: 'error', statusCode, message: '加载失败',
});
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const input = (value: string) => ({ detail: { value } });
const ids = (page: any) => page.data.items.map((item: { studentId: string }) => item.studentId);

describe('partner warnings page lifecycle', () => {
  let page: any;
  let definition: any;
  let instances: any[];
  const instantiate = () => {
    const instance = { ...definition, data: { ...definition.data, items: [] } };
    instance.setData = jest.fn((values: object) => Object.assign(instance.data, values));
    instances.push(instance);
    return instance;
  };
  const flush = async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  };
  const open = async () => {
    page.onLoad();
    page.onShow?.();
    await flush();
  };
  beforeEach(() => {
    jest.useFakeTimers();
    instances = [];
    ownerKey = 'synthetic-warnings-owner';
    loadWarnings.mockReset().mockResolvedValue(success());
    logout.mockReset();
    (global as any).wx = { stopPullDownRefresh: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: unknown) => { definition = config; };
    jest.isolateModules(() => require('../pages/partner/warnings/index'));
    page = instantiate();
  });
  afterEach(() => {
    instances.forEach((instance) => instance.onUnload?.());
    jest.useRealTimers();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('deduplicates load/show and identical pending refreshes', async () => {
    const pending = deferred();
    loadWarnings.mockReturnValueOnce(pending.promise);
    await open();
    const request = page.loadWarnings(true);
    expect(page.loadWarnings(true)).toBe(request);
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(1);
    pending.resolve(success());
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  const expectCleared = () => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden', query: '', items: [], page: 0, total: 0,
      hasMore: false, loadingMore: false, refreshError: '', paginationError: '',
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingKey).toBe('');
    expect(page.contentKey).toBe('');
    expect(page.searchTimer).toBeNull();
  };

  it.each(['show', 'search', 'retry', 'more', 'retry-more', 'pull', 'direct'])(
    'clears private state before %s after an owner change without replacement reads',
    async (entry) => {
      await open();
      page.onSearchInput(input('旧姓名'));
      ownerKey = 'synthetic-other-owner';
      if (entry === 'show') page.onShow();
      if (entry === 'search') page.onSearchInput(input('新姓名'));
      if (entry === 'retry') page.onRetry();
      if (entry === 'more') page.onLoadMore();
      if (entry === 'retry-more') page.onRetryMore();
      if (entry === 'pull') page.onPullDownRefresh();
      if (entry === 'direct') await page.loadWarnings(true);
      jest.advanceTimersByTime(400);
      await flush();
      expectCleared();
      expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
      expect(loadWarnings).toHaveBeenCalledTimes(1);
    },
  );

  it('checks the owner before a scheduled search fires', async () => {
    await open();
    page.onSearchInput(input('旧姓名'));
    ownerKey = 'synthetic-other-owner';
    jest.advanceTimersByTime(300);
    await flush();
    expectCleared();
    expect(loadWarnings).toHaveBeenCalledTimes(1);
  });

  it('cancels the queued initial request when ownership changes before dispatch', async () => {
    page.onLoad();
    ownerKey = 'synthetic-other-owner';
    await flush();
    expectCleared();
    expect(loadWarnings).not.toHaveBeenCalled();
  });

  it.each([true, false])('cancels a queued reset=%s request before dispatch after ownership changes', async (reset) => {
    await open();
    const reading = page.loadWarnings(reset);
    ownerKey = 'synthetic-other-owner';
    await reading;
    expectCleared();
    expect(loadWarnings).toHaveBeenCalledTimes(1);
  });

  it.each([true, false].flatMap((reset) =>
    ['success', '500', '401', '403', 'reject'].map((delivery) => ({ reset, delivery })),
  ))('checks ownership on held reset=$reset $delivery without a lifecycle event', async ({ reset, delivery }) => {
    await open();
    let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
    loadWarnings.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const reading = page.loadWarnings(reset);
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(2);
    ownerKey = 'synthetic-other-owner';
    if (delivery === 'reject') reject(Object.assign(new Error('synthetic private detail'), { statusCode: 403 }));
    else resolve(delivery === 'success' ? success(['late'], reset ? 1 : 2) : failure(Number(delivery)));
    await reading;
    expectCleared();
    expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
    expect(logout).not.toHaveBeenCalled();
  });

  it('clears queued input and invalidates a held reply when onShow detects an owner change', async () => {
    await open();
    const old = deferred();
    loadWarnings.mockReturnValueOnce(old.promise);
    const reading = page.loadWarnings(false);
    await flush();
    page.onSearchInput(input('旧姓名'));
    ownerKey = 'synthetic-other-owner';
    page.onShow();
    const writes = page.setData.mock.calls.length;
    old.resolve(success(['late'], 2));
    await reading;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expectCleared();
  });

  it.each([true, false].flatMap((reset) =>
    [401, 403].flatMap((statusCode) => ['throw', 'reject', 'state'].map((delivery) => ({ reset, statusCode, delivery }))),
  ))('clears filtered fields for $delivery HTTP $statusCode reset=$reset', async ({ reset, statusCode, delivery }) => {
    await open();
    page.onSearchInput(input(' 林 '));
    jest.advanceTimersByTime(300);
    await flush();
    if (delivery === 'throw') loadWarnings.mockImplementationOnce(() => {
      throw Object.assign(new Error('synthetic private detail'), { statusCode });
    });
    if (delivery === 'reject') loadWarnings.mockRejectedValueOnce(Object.assign(new Error('synthetic private detail'), { statusCode }));
    if (delivery === 'state') loadWarnings.mockResolvedValueOnce(failure(statusCode));
    await expect(page.loadWarnings(reset)).resolves.toBeUndefined();
    expectCleared();
    expect(page.data.errorMessage).toBe(statusCode === 401
      ? '登录已失效，请重新登录' : '当前账号无权查看本校区课时预警');
    expect(logout).not.toHaveBeenCalled();
  });

  it.each(['fail', 'throw'])('clears and stops the page before logout despite navigation %s', async (delivery) => {
    await open();
    const old = deferred();
    loadWarnings.mockReturnValueOnce(old.promise);
    const reading = page.loadWarnings(false);
    await flush();
    page.onSearchInput(input('旧姓名'));
    logout.mockImplementationOnce(() => {
      expectCleared();
      expect(page.runtime).toBeUndefined();
    });
    (global as any).wx.reLaunch.mockImplementationOnce((options: { fail?: () => void }) => {
      if (delivery === 'throw') throw new Error('synthetic native failure');
      options.fail?.();
    });
    expect(() => page.onLogin()).not.toThrow();
    expect(logout).toHaveBeenCalledTimes(1);
    old.resolve(success(['late'], 2));
    await reading;
    const reads = loadWarnings.mock.calls.length;
    page.onShow(); page.onRetry(); page.onLoadMore(); page.onRetryMore();
    page.onSearchInput(input('旧事件')); page.onPullDownRefresh();
    jest.advanceTimersByTime(400);
    await flush();
    expectCleared();
    expect(loadWarnings).toHaveBeenCalledTimes(reads);
  });

  it.each(['onHide', 'onUnload'])('suppresses the old pull callback while %s', async (lifecycle) => {
    await open();
    const old = deferred();
    loadWarnings.mockReturnValueOnce(old.promise);
    page.onPullDownRefresh();
    await flush();
    page[lifecycle]();
    old.resolve(success(['old']));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
  });

  it('suppresses a pre-hide pull callback after return even without a new pull', async () => {
    await open();
    const old = deferred(), fresh = deferred();
    loadWarnings.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    page.onPullDownRefresh();
    await flush();
    page.onHide(); page.onShow();
    await flush();
    old.resolve(success(['old']));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    fresh.resolve(success(['fresh']));
    await flush();
    expect(ids(page)).toEqual(['fresh']);
  });
  it.each([false, true])('does not stop a pull after logout with a further pull=%s', async (furtherPull) => {
    await open();
    const held = deferred();
    loadWarnings.mockReturnValueOnce(held.promise);
    page.onPullDownRefresh();
    await flush();
    page.onLogin();
    if (furtherPull) page.onPullDownRefresh();
    held.resolve(success());
    await flush();
    expectCleared();
    expect(loadWarnings).toHaveBeenCalledTimes(2);
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
  });

  it('lets only the new pull stop its indicator after return', async () => {
    await open();
    const old = deferred(), fresh = deferred();
    loadWarnings.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    page.onPullDownRefresh();
    await flush();
    page.onHide(); page.onShow(); page.onPullDownRefresh(); page.onPullDownRefresh();
    await flush();
    old.resolve(success(['old']));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    fresh.resolve(success(['fresh']));
    await flush();
    expect(ids(page)).toEqual(['fresh']);
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it.each(['initial', 'refresh', 'pagination'])('handles model conversion errors for %s with a fixed private-safe message and retry', async (phase) => {
    if (phase !== 'initial') await open();
    const previous = page.data.items;
    const state = success(['malformed'], phase === 'pagination' ? 2 : 1);
    Object.defineProperty(state.data.data[0], 'classNames', {
      get: () => { throw new Error('synthetic private detail'); },
    });
    loadWarnings.mockResolvedValueOnce(state);
    let reading: Promise<void>;
    if (phase === 'initial') {
      page.onLoad(); page.onShow();
      reading = page.pendingRequest;
    } else reading = page.loadWarnings(phase !== 'pagination');
    await expect(reading).resolves.toBeUndefined();
    expect(page.data.loadingMore).toBe(false);
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingKey).toBe('');
    if (phase === 'initial') expect(page.data).toMatchObject({
      viewState: 'error', items: [], page: 0, total: 0, errorMessage: '课时预警加载失败，请稍后重试',
    });
    else expect(page.data).toMatchObject({
      viewState: 'ready', items: previous, page: 1,
      [phase === 'refresh' ? 'refreshError' : 'paginationError']: '课时预警加载失败，请稍后重试',
    });
    await page.loadWarnings(phase !== 'pagination');
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshError).toBe('');
    expect(page.data.paginationError).toBe('');
  });

  it('isolates request sequences between instances', async () => {
    const pending = deferred();
    loadWarnings.mockReturnValueOnce(pending.promise);
    await open();
    const other = instantiate();
    other.onLoad();
    other.onShow?.();
    await flush();
    pending.resolve(success(['independent']));
    await flush();
    expect(ids(page)).toEqual(['independent']);
    expect(ids(other)).toEqual(['first']);
  });

  it('isolates timers when another instance unloads', async () => {
    await open();
    const other = instantiate();
    other.onLoad();
    other.onShow?.();
    await flush();
    page.onSearchInput(input('甲'));
    other.onSearchInput(input('乙'));
    page.onUnload();
    jest.advanceTimersByTime(300);
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(3);
    expect(loadWarnings).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '乙' });
  });

  it('invalidates immediately and debounces latest trimmed input for 300ms', async () => {
    const pending = deferred();
    loadWarnings.mockReturnValueOnce(pending.promise);
    await open();
    page.onSearchInput(input('旧'));
    jest.advanceTimersByTime(200);
    page.onSearchInput(input(' 林 '));
    const writes = page.setData.mock.calls.length;
    pending.resolve(success(['stale']));
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    jest.advanceTimersByTime(299);
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(loadWarnings).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '林' });
    expect(loadWarnings).toHaveBeenCalledTimes(2);
  });

  it.each(['onHide', 'onUnload'])('cancels debounce and ignores late writes after %s', async (lifecycle) => {
    const pending = deferred();
    loadWarnings.mockReturnValueOnce(pending.promise);
    await open();
    page.onSearchInput(input('林'));
    page[lifecycle]?.();
    const writes = page.setData.mock.calls.length;
    pending.resolve(success(['hidden']));
    jest.advanceTimersByTime(500);
    await flush();
    await page.loadWarnings(true);
    await page.loadWarnings(false);
    page.onSearchInput(input('不应写入'));
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(loadWarnings).toHaveBeenCalledTimes(1);
  });

  it('reloads pending input on return without a duplicate timer request', async () => {
    await open();
    page.onSearchInput(input(' 林 '));
    page.onHide?.();
    jest.advanceTimersByTime(500);
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(1);
    page.onShow?.();
    await flush();
    expect(loadWarnings).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '林' });
    jest.advanceTimersByTime(500);
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(2);
  });

  it('preserves same-filter rows/counts on refresh failure and retries page one', async () => {
    await open();
    const previous = { items: page.data.items, page: page.data.page, total: page.data.total };
    const pending = deferred();
    loadWarnings.mockReturnValueOnce(pending.promise);
    page.onPullDownRefresh();
    expect(page.data).toMatchObject({ ...previous, viewState: 'ready' });
    pending.resolve(failure());
    await flush();
    expect(page.data).toMatchObject({ ...previous, viewState: 'ready', refreshError: '加载失败' });
    page.onLoadMore();
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(2);
    page.onRetry();
    await flush();
    expect(loadWarnings).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(page.data.refreshError).toBe('');
  });

  it('preserves a loaded empty state on refresh failure', async () => {
    loadWarnings.mockResolvedValueOnce(success([], 1, 0));
    await open();
    loadWarnings.mockResolvedValueOnce(failure());
    await page.loadWarnings(true);
    expect(page.data).toMatchObject({ viewState: 'empty', items: [], total: 0, refreshError: '加载失败' });
  });

  it('clears changed-filter rows/counts on failure', async () => {
    await open();
    loadWarnings.mockResolvedValueOnce(failure());
    page.onSearchInput(input('新条件'));
    jest.advanceTimersByTime(300);
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'error', items: [], page: 0, total: 0, hasMore: false,
      refreshError: '', paginationError: '', errorMessage: '加载失败',
    });
  });

  it('preserves failed pagination and retries the same page with ID deduplication', async () => {
    await open();
    const previous = page.data.items;
    const pending = deferred();
    loadWarnings.mockReturnValueOnce(pending.promise);
    page.onLoadMore();
    page.onLoadMore();
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(2);
    pending.resolve(failure());
    await flush();
    expect(page.data).toMatchObject({
      items: previous, page: 1, viewState: 'ready', loadingMore: false, paginationError: '加载失败',
    });
    loadWarnings.mockResolvedValueOnce(success(['first', 'second', 'second'], 2));
    page.onRetryMore?.();
    await flush();
    expect(loadWarnings).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(ids(page)).toEqual(['first', 'second']);
    expect(page.data).toMatchObject({ page: 2, paginationError: '', hasMore: false });
    page.onLoadMore();
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(3);
  });

  it('ignores stale pagination and blocks more pages during refresh', async () => {
    await open();
    const pending = deferred();
    const refreshing = deferred();
    loadWarnings.mockReturnValueOnce(pending.promise).mockReturnValueOnce(refreshing.promise);
    page.onLoadMore();
    await flush();
    page.onPullDownRefresh();
    page.onLoadMore();
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(3);
    refreshing.resolve(success(['refreshed']));
    await flush();
    pending.resolve(success(['stale'], 2));
    await flush();
    expect(ids(page)).toEqual(['refreshed']);
    expect(page.data.page).toBe(1);
  });

  it('does not let an old search response or cleanup overwrite the new request', async () => {
    await open();
    const old = deferred();
    const newer = deferred();
    loadWarnings.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    page.onSearchInput(input('旧'));
    jest.advanceTimersByTime(300);
    await flush();
    page.onSearchInput(input('新'));
    jest.advanceTimersByTime(300);
    await flush();
    old.resolve(failure(403));
    await flush();
    page.onRetry();
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(3);
    newer.resolve(success(['newer']));
    await flush();
    expect(ids(page)).toEqual(['newer']);
  });

  it.each([401, 403])('clears cached business fields for HTTP %s and explicitly logs out', async (statusCode) => {
    await open();
    loadWarnings.mockResolvedValueOnce(failure(statusCode));
    await page.loadWarnings(false);
    const cleared = {
      viewState: 'forbidden', items: [], page: 0, total: 0, hasMore: false,
      loadingMore: false, refreshError: '', paginationError: '',
    };
    expect(page.data).toMatchObject(cleared);
    expect(page.contentKey).toBe('');
    await page.loadWarnings(true);
    loadWarnings.mockResolvedValueOnce(failure(statusCode));
    await page.loadWarnings(true);
    expect(page.data).toMatchObject(cleared);
    expect(logout).not.toHaveBeenCalled();
    page.onLogin?.();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it('catches rejected initial/refresh/pagination requests and recovers', async () => {
    loadWarnings.mockRejectedValueOnce(new Error('offline'));
    page.onLoad();
    await expect(page.pendingRequest).resolves.toBeUndefined();
    expect(page.data.viewState).toBe('error');
    await page.loadWarnings(true);
    loadWarnings.mockRejectedValueOnce(new Error('offline'));
    await page.loadWarnings(true);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshError).toBeTruthy();
    await page.loadWarnings(true);
    loadWarnings.mockRejectedValueOnce(new Error('offline'));
    await page.loadWarnings(false);
    expect(page.data).toMatchObject({ page: 1, viewState: 'ready', loadingMore: false });
    expect(page.data.paginationError).toBeTruthy();
    loadWarnings.mockResolvedValueOnce(success(['second'], 2));
    await page.loadWarnings(false);
    expect(page.data.page).toBe(2);
  });

  it.each([401, 403])('preserves structured HTTP %s on rejected requests', async (statusCode) => {
    await open();
    loadWarnings.mockRejectedValueOnce(Object.assign(new Error('offline'), { statusCode }));
    await expect(page.loadWarnings(true)).resolves.toBeUndefined();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], total: 0, page: 0, hasMore: false,
      refreshError: '', paginationError: '', loadingMore: false,
    });
  });

  it('deduplicates IDs on the first page', async () => {
    loadWarnings.mockResolvedValueOnce(success(['first', 'first']));
    await open();
    expect(ids(page)).toEqual(['first']);
  });

  it('refreshes pending input immediately and cancels its debounce', async () => {
    await open();
    page.onSearchInput(input(' 林 '));
    page.onLoadMore();
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(1);
    page.onPullDownRefresh();
    await flush();
    expect(loadWarnings).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '林' });
    jest.advanceTimersByTime(500);
    await flush();
    expect(loadWarnings).toHaveBeenCalledTimes(2);
  });

  it('exposes compact refresh/pagination alerts, retry and login', () => {
    const root = path.resolve(__dirname, '../pages/partner/warnings');
    const markup = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
    expect(markup).toContain('wx:if="{{refreshError}}" class="warnings-refresh-error"');
    expect(markup).toContain('wx:if="{{paginationError}}" class="warnings-pagination-error"');
    expect(markup).toContain('bindtap="onRetryMore"');
    expect(markup).toContain('bindtap="onLogin"');
    expect(markup).not.toMatch(/class="[^"]*partner-state[^"]*warnings-(?:refresh|pagination)-error/);
    expect(styles).toMatch(/\.warnings-refresh-error[\s\S]*?min-height:\s*0;/);
    expect(styles).toMatch(/\.warnings-pagination-error[\s\S]*?min-height:\s*0;/);
  });
});
