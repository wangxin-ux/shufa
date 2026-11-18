import * as fs from 'fs';
import * as path from 'path';
import { PARTNER_TEACHERS_FIXTURE } from '../mock/fixtures/partner.fixture';

const loadTeachers = jest.fn();
const logout = jest.fn();
let ownerKey = 'synthetic-teachers-owner';
jest.mock('../services/partner-runtime', () => ({
  createPartnerService: () => ({ loadTeachers: (query: unknown) => loadTeachers(query) }),
  partnerService: { loadTeachers: (query: unknown) => loadTeachers(query) },
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
    data: ids.map((id) => ({ ...PARTNER_TEACHERS_FIXTURE[0], id })),
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
const toggle = (id?: unknown) => ({ currentTarget: { dataset: { id } } });

describe('partner teachers page lifecycle', () => {
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
    ownerKey = 'synthetic-teachers-owner';
    loadTeachers.mockReset().mockResolvedValue(success());
    logout.mockReset();
    (global as any).wx = { stopPullDownRefresh: jest.fn(), reLaunch: jest.fn() };
    (global as any).Page = (config: unknown) => { definition = config; };
    jest.isolateModules(() => require('../pages/partner/teachers/index'));
    page = instantiate();
  });
  afterEach(() => {
    instances.forEach((instance) => instance.onUnload?.());
    jest.useRealTimers();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('deduplicates initial load/show and identical pending refreshes', async () => {
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
    await open();
    const first = page.loadTeachers(true);
    expect(page.loadTeachers(true)).toBe(first);
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(1);
    pending.resolve(success());
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  const expectCleared = () => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden', query: '', items: [], expandedId: '',
      page: 0, total: 0, hasMore: false, loadingMore: false,
      errorMessage: expect.any(String), refreshError: '', paginationError: '',
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingKey).toBe('');
    expect(page.contentKey).toBe('');
    expect(page.searchTimer).toBeNull();
  };

  it.each(['show', 'search', 'clear', 'toggle', 'retry', 'more', 'retry-more', 'pull'])(
    'clears the old owner before %s and sends no replacement read',
    async (entry) => {
      await open();
      page.onTeacherToggle(toggle('first'));
      const reads = loadTeachers.mock.calls.length;
      ownerKey = 'synthetic-other-owner';
      if (entry === 'show') page.onShow();
      if (entry === 'search') page.onSearchInput(input('另一姓名'));
      if (entry === 'clear') page.onClearSearch();
      if (entry === 'toggle') page.onTeacherToggle(toggle('first'));
      if (entry === 'retry') page.onRetry();
      if (entry === 'more') page.onLoadMore();
      if (entry === 'retry-more') page.onRetryMore();
      if (entry === 'pull') page.onPullDownRefresh();
      jest.advanceTimersByTime(400);
      await flush();
      expectCleared();
      expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
      expect(loadTeachers).toHaveBeenCalledTimes(reads);
    },
  );

  it('checks a previously scheduled search before its new read starts', async () => {
    await open();
    page.onSearchInput(input('旧账号姓名'));
    ownerKey = 'synthetic-other-owner';
    jest.advanceTimersByTime(300);
    await flush();
    expectCleared();
    expect(loadTeachers).toHaveBeenCalledTimes(1);
  });

  it('cancels a queued initial request when the owner changes before it starts', async () => {
    page.onLoad();
    ownerKey = 'synthetic-other-owner';
    await flush();
    expectCleared();
    expect(loadTeachers).not.toHaveBeenCalled();
  });

  it.each([true, false].flatMap((reset) =>
    ['success', '401', '403', 'reject'].map((delivery) => ({ reset, delivery })),
  ))('discards reset=$reset $delivery after identity changes without a lifecycle event', async ({ reset, delivery }) => {
    await open();
    page.onTeacherToggle(toggle('first'));
    let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
    loadTeachers.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const reading = page.loadTeachers(reset);
    await flush();
    ownerKey = 'synthetic-other-owner';
    if (delivery === 'reject') reject(Object.assign(new Error('private'), { statusCode: 403 }));
    else resolve(delivery === 'success' ? success(['late'], reset ? 1 : 2) : failure(Number(delivery)));
    await reading;
    expectCleared();
    expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
  });

  it.each([false, true])('stops reads after logout even when native navigation throws=%s', async (throws) => {
    await open();
    page.onTeacherToggle(toggle('first'));
    const old = deferred();
    loadTeachers.mockReturnValueOnce(old.promise);
    const reading = page.loadTeachers(false);
    await flush();
    if (throws) (global as any).wx.reLaunch.mockImplementationOnce(() => { throw new Error('native failure'); });
    try { page.onLogin(); } catch { expect(throws).toBe(true); }
    expectCleared();
    expect(logout).toHaveBeenCalledTimes(1);
    old.resolve(success(['late'], 2));
    await reading;
    const reads = loadTeachers.mock.calls.length;
    page.onRetry(); page.onShow(); page.onSearchInput(input('旧事件')); page.onTeacherToggle(toggle('first'));
    jest.advanceTimersByTime(300);
    await flush();
    expectCleared();
    expect(loadTeachers).toHaveBeenCalledTimes(reads);
  });

  it.each(['onHide', 'onUnload'])('does not stop a new page pull when the old request completes after %s', async (lifecycle) => {
    await open();
    const old = deferred(), fresh = deferred();
    loadTeachers.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    page.onPullDownRefresh();
    await flush();
    page[lifecycle]();
    if (lifecycle === 'onHide') {
      page.onShow(); page.onPullDownRefresh();
      await flush();
    }
    old.resolve(success(['old']));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    if (lifecycle === 'onHide') {
      fresh.resolve(success(['fresh']));
      await flush();
      expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    }
  });

  it('clears a pending name search with one unfiltered first-page request', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    page.onSearchInput(input('林'));
    expect(page.data.expandedId).toBe('');
    page.onClearSearch();
    page.onClearSearch();
    expect(page.data.query).toBe('');
    jest.advanceTimersByTime(300);
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(2);
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(page.data.viewState).toBe('ready');
    expect(page.searchTimer).toBeNull();
  });

  it('can clear an empty-result name filter and recover the full teacher list', async () => {
    await open();
    loadTeachers.mockResolvedValueOnce(success([]));
    page.onSearchInput(input('不存在的姓名'));
    jest.advanceTimersByTime(300);
    await flush();
    expect(page.data.viewState).toBe('empty');
    page.onClearSearch();
    jest.advanceTimersByTime(300);
    await flush();
    expect(page.data.query).toBe('');
    expect(page.data.viewState).toBe('ready');
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  });

  it('does not send another request when an already empty search is cleared', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    page.onClearSearch();
    jest.advanceTimersByTime(300);
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(1);
    expect(page.data.expandedId).toBe('first');
    expect(page.searchTimer).toBeNull();
  });

  it.each(['onHide', 'onUnload'])('does not clear or request after %s', async (method) => {
    await open();
    page.onSearchInput(input('林'));
    page[method]();
    page.onClearSearch();
    jest.advanceTimersByTime(300);
    await flush();
    expect(page.data.query).toBe('林');
    expect(loadTeachers).toHaveBeenCalledTimes(1);
  });

  it('discards a filtered response arriving after clear and isolates its pending lock', async () => {
    await open();
    const old = deferred();
    loadTeachers.mockReturnValueOnce(old.promise);
    page.onSearchInput(input('林'));
    jest.advanceTimersByTime(300);
    await flush();
    page.onClearSearch();
    const current = deferred();
    loadTeachers.mockReturnValueOnce(current.promise);
    jest.advanceTimersByTime(300);
    await flush();
    const lock = page.pendingRequest;
    old.resolve(success(['filtered']));
    await flush();
    expect(page.pendingRequest).toBe(lock);
    expect(page.data.items.some((item: { id: string }) => item.id === 'filtered')).toBe(false);
    current.resolve(success(['all']));
    await flush();
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['all']);
    expect(page.pendingRequest).toBeUndefined();
  });

  it('refreshes a cleared search once and blocks pagination until the new first page finishes', async () => {
    await open();
    page.onSearchInput(input('林'));
    jest.advanceTimersByTime(300);
    await flush();
    page.onClearSearch();
    const current = deferred();
    loadTeachers.mockReturnValueOnce(current.promise);
    page.onPullDownRefresh();
    page.onLoadMore();
    jest.advanceTimersByTime(300);
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(3);
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(page.searchTimer).toBeNull();
    current.resolve(success(['all']));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    page.onLoadMore();
    await flush();
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
  });

  it.each([401, 403])('isolates old filtered pagination %i after clear from the current first page', async (statusCode) => {
    await open();
    page.onSearchInput(input('林'));
    jest.advanceTimersByTime(300);
    await flush();
    const old = deferred();
    loadTeachers.mockReturnValueOnce(old.promise);
    page.onLoadMore();
    await flush();
    page.onClearSearch();
    const current = deferred();
    loadTeachers.mockReturnValueOnce(current.promise);
    jest.advanceTimersByTime(300);
    await flush();
    const lock = page.pendingRequest;
    old.resolve(failure(statusCode));
    await flush();
    expect(page.pendingRequest).toBe(lock);
    expect(page.data.viewState).not.toBe('forbidden');
    current.resolve(success(['all']));
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['all']);
    expect(page.data.paginationError).toBe('');
    expect(page.pendingRequest).toBeUndefined();
  });

  it('starts collapsed and opens only one current teacher without extra reads', async () => {
    loadTeachers.mockResolvedValueOnce(success(['first', 'second']));
    await open();
    expect(page.data.expandedId).toBe('');
    page.onTeacherToggle(toggle('first'));
    expect(page.data.expandedId).toBe('first');
    page.onTeacherToggle(toggle('second'));
    expect(page.data.expandedId).toBe('second');
    page.onTeacherToggle(toggle('second'));
    expect(page.data.expandedId).toBe('');
    expect(loadTeachers).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: '林老师', size: 90 },
    { name: '林老师甲', size: 70 },
    { name: '林老师教授', size: 44 },
    { name: '林老师教授甲', size: 44 },
    { name: '林老师教授甲乙', size: 36 },
    { name: '𠮷𠮷𠮷𠮷', size: 70 },
    { name: '𠮷𠮷𠮷𠮷𠮷𠮷', size: 44 },
    { name: '长姓名教师ABCDEFGHIJKLMNOPQRSTUVWXYZ', size: 36 },
  ])('uses bounded reference heading sizes for $name without viewport-dependent text', async ({ name, size }) => {
    const state = success();
    state.data.data[0].displayName = name;
    loadTeachers.mockResolvedValueOnce(state);
    await open();
    expect(page.data.items[0].nameFontSize).toBe(size);
    expect(page.data.items[0].displayName).toBe(name);
  });

  it('recomputes heading size for a duplicate teacher updated by pagination while retaining expansion', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    const next = success(['first', 'second'], 2);
    next.data.data[0].displayName = '长姓名教师ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    loadTeachers.mockResolvedValueOnce(next);
    page.onLoadMore();
    await flush();
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['first', 'second']);
    expect(page.data.items[0].nameFontSize).toBe(36);
    expect(page.data.items[0].displayName).toBe(next.data.data[0].displayName);
    expect(page.data.items[1].nameFontSize).toBe(90);
    expect(page.data.expandedId).toBe('first');
  });

  it('ignores malformed, missing and no-longer-visible teacher IDs', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    for (const id of [undefined, null, 1, {}, '', 'missing']) {
      page.onTeacherToggle(toggle(id));
      expect(page.data.expandedId).toBe('first');
    }
  });

  it('isolates expansion between instances and ignores taps while hidden or unloaded', async () => {
    await open();
    const other = instantiate();
    other.onLoad();
    other.onShow();
    await flush();
    page.onTeacherToggle(toggle('first'));
    expect(other.data.expandedId).toBe('');
    page.onHide();
    page.onTeacherToggle(toggle('first'));
    expect(page.data.expandedId).toBe('first');
    page.onShow();
    await flush();
    expect(page.data.expandedId).toBe('first');
    page.onUnload();
    page.onTeacherToggle(toggle('first'));
    expect(page.data.expandedId).toBe('first');
  });

  it('preserves expansion during same-filter refresh, failure and successful retry', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
    const request = page.loadTeachers(true);
    expect(page.data.expandedId).toBe('first');
    pending.resolve(failure());
    await request;
    expect(page.data.expandedId).toBe('first');
    await page.loadTeachers(true);
    expect(page.data.expandedId).toBe('first');
  });

  it.each([{ ids: ['replacement'] }, { ids: [] }])('clears expansion when refreshed rows exclude its teacher: %j', async ({ ids }) => {
    await open();
    page.onTeacherToggle(toggle('first'));
    loadTeachers.mockResolvedValueOnce(success(ids));
    await page.loadTeachers(true);
    expect(page.data.expandedId).toBe('');
  });

  it('preserves expansion during pagination failure and deduplicated append', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    loadTeachers.mockResolvedValueOnce(failure());
    await page.loadTeachers(false);
    expect(page.data.expandedId).toBe('first');
    loadTeachers.mockResolvedValueOnce(success(['first', 'second'], 2));
    await page.loadTeachers(false);
    expect(page.data.expandedId).toBe('first');
  });

  it('clears expansion on a changed search and never revives it from late responses', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
    void page.loadTeachers(true);
    await flush();
    page.onSearchInput(input('新条件'));
    jest.advanceTimersByTime(300);
    await flush();
    expect(page.data.expandedId).toBe('');
    pending.resolve(success(['first']));
    await flush();
    expect(page.data.expandedId).toBe('');
  });

  it('preserves expansion when search changes only surrounding whitespace', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    page.onSearchInput(input('  '));
    expect(page.data.expandedId).toBe('first');
    jest.advanceTimersByTime(300);
    await flush();
    expect(page.data.expandedId).toBe('first');
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
  });

  it('clears expansion at changed input time and blocks old-row taps during debounce', async () => {
    await open();
    page.onTeacherToggle(toggle('first'));
    page.onSearchInput(input('新条件'));
    expect(page.data.expandedId).toBe('');
    page.onTeacherToggle(toggle('first'));
    expect(page.data.expandedId).toBe('');
    expect(loadTeachers).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(299);
    page.onTeacherToggle(toggle('first'));
    expect(page.data.expandedId).toBe('');
  });

  it.each([401, 403])('clears expansion together with protected rows on HTTP %s', async (code) => {
    await open();
    page.onTeacherToggle(toggle('first'));
    loadTeachers.mockResolvedValueOnce(failure(code));
    await page.loadTeachers(true);
    expect(page.data.expandedId).toBe('');
    expect(page.data.items).toEqual([]);
    page.onTeacherToggle(toggle('first'));
    expect(page.data.expandedId).toBe('');
  });

  it('keeps names and classes in accessible headers and conditionally renders details', () => {
    const root = path.resolve(__dirname, '../pages/partner/teachers');
    const markup = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    const header = markup.match(/<button\b[^>]*class="teacher-card__toggle"[\s\S]*?<\/button>/)?.[0];
    expect(header).toBeDefined();
    expect(header).toContain('bindtap="onTeacherToggle"');
    expect(header).toContain('data-id="{{item.id}}"');
    expect(header).toContain('aria-expanded="{{expandedId === item.id}}"');
    expect(header).toContain('{{item.displayName}}');
    expect(header).toContain('{{item.classLabel}}');
    expect(markup).toContain('wx:if="{{expandedId === item.id}}" class="teacher-card__details"');
    const styles = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
    expect(styles).toMatch(/\.teacher-card__identity[\s\S]*?min-width:\s*0;/);
    expect(styles).toMatch(/\.teacher-card__classes[\s\S]*?overflow-wrap:\s*anywhere;/);
  });

  it('isolates requests between instances of one registered page', async () => {
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
    await open();
    const other = instantiate();
    other.onLoad();
    other.onShow?.();
    await flush();
    pending.resolve(success(['independent']));
    await flush();
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['independent']);
    expect(other.data.items[0].id).toBe('first');
  });

  it('isolates debounce timers and unloading one instance does not cancel another', async () => {
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
    expect(loadTeachers).toHaveBeenCalledTimes(3);
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '乙' });
  });

  it('invalidates the old request at input time and debounces the latest trimmed input for 300ms', async () => {
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
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
    expect(loadTeachers).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(2);
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '林' });
  });

  it.each(['onHide', 'onUnload'])('cancels debounce and rejects late writes after %s', async (lifecycle) => {
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
    await open();
    page.onSearchInput(input('林'));
    page[lifecycle]?.();
    const writes = page.setData.mock.calls.length;
    pending.resolve(success(['hidden']));
    jest.advanceTimersByTime(400);
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(loadTeachers).toHaveBeenCalledTimes(1);
    await page.loadTeachers(true);
    await page.loadTeachers(false);
    page.onSearchInput(input('不应写入'));
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(loadTeachers).toHaveBeenCalledTimes(1);
  });

  it('reloads preserved pending input immediately on return without an extra timer request', async () => {
    await open();
    page.onSearchInput(input(' 林 '));
    page.onHide?.();
    jest.advanceTimersByTime(500);
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(1);
    page.onShow?.();
    await flush();
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '林' });
    jest.advanceTimersByTime(500);
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(2);
  });

  it('keeps same-filter content during refresh and on failure, then retries page one', async () => {
    await open();
    const previous = { items: page.data.items, page: page.data.page, total: page.data.total };
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
    page.onPullDownRefresh();
    expect(page.data).toMatchObject({ ...previous, viewState: 'ready' });
    pending.resolve(failure());
    await flush();
    expect(page.data).toMatchObject({ ...previous, viewState: 'ready', refreshError: '加载失败' });
    const calls = loadTeachers.mock.calls.length;
    page.onLoadMore();
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(calls);
    page.onRetry();
    await flush();
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20 });
    expect(page.data.refreshError).toBe('');
  });

  it('preserves a successfully loaded empty state on refresh failure', async () => {
    loadTeachers.mockResolvedValueOnce(success([], 1, 0));
    await open();
    loadTeachers.mockResolvedValueOnce(failure());
    await page.loadTeachers(true);
    expect(page.data).toMatchObject({ viewState: 'empty', items: [], total: 0, refreshError: '加载失败' });
  });

  it('clears old-filter rows and counts when a changed-filter request fails', async () => {
    await open();
    loadTeachers.mockResolvedValueOnce(failure());
    page.onSearchInput(input('新条件'));
    jest.advanceTimersByTime(300);
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'error', items: [], page: 0, total: 0, hasMore: false,
      refreshError: '', paginationError: '', errorMessage: '加载失败',
    });
  });

  it('retains list/page on pagination failure, retries the same page and deduplicates IDs', async () => {
    await open();
    const previous = page.data.items;
    const pending = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise);
    page.onLoadMore();
    page.onLoadMore();
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(2);
    pending.resolve(failure());
    await flush();
    expect(page.data).toMatchObject({
      items: previous, page: 1, viewState: 'ready', loadingMore: false, paginationError: '加载失败',
    });
    loadTeachers.mockResolvedValueOnce(success(['first', 'second', 'second'], 2));
    page.onRetryMore?.();
    await flush();
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['first', 'second']);
    expect(page.data.page).toBe(2);
    expect(page.data.paginationError).toBe('');
    page.onLoadMore();
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(3);
  });

  it('ignores late pagination after a refresh and blocks pages during refresh', async () => {
    await open();
    const pending = deferred();
    const refreshing = deferred();
    loadTeachers.mockReturnValueOnce(pending.promise).mockReturnValueOnce(refreshing.promise);
    page.onLoadMore();
    await flush();
    page.onPullDownRefresh();
    page.onLoadMore();
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(3);
    refreshing.resolve(success(['refreshed']));
    await flush();
    pending.resolve(success(['stale-page'], 2));
    await flush();
    expect(page.data.page).toBe(1);
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['refreshed']);
  });

  it('ignores an old search response and its cleanup while the new search is pending', async () => {
    await open();
    const old = deferred();
    const newer = deferred();
    loadTeachers.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
    page.onSearchInput(input('旧'));
    jest.advanceTimersByTime(300);
    await flush();
    page.onSearchInput(input('新'));
    jest.advanceTimersByTime(300);
    await flush();
    old.resolve(failure(403));
    await flush();
    const calls = loadTeachers.mock.calls.length;
    page.onRetry();
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(calls);
    newer.resolve(success(['newer']));
    await flush();
    expect(page.data.items[0].id).toBe('newer');
  });

  it.each([401, 403])('clears all business data on HTTP %s for refresh and pagination', async (statusCode) => {
    await open();
    loadTeachers.mockResolvedValueOnce(failure(statusCode));
    await page.loadTeachers(false);
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], page: 0, total: 0, hasMore: false,
      loadingMore: false, refreshError: '', paginationError: '',
    });
    expect(page.contentKey).toBe('');
    await page.loadTeachers(true);
    loadTeachers.mockResolvedValueOnce(failure(statusCode));
    await page.loadTeachers(true);
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], page: 0, total: 0, hasMore: false,
      loadingMore: false, refreshError: '', paginationError: '',
    });
    expect(logout).not.toHaveBeenCalled();
    page.onLogin?.();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it('catches rejected initial, refresh and pagination requests and recovers', async () => {
    loadTeachers.mockRejectedValueOnce(new Error('offline'));
    page.onLoad();
    await expect(page.pendingRequest).resolves.toBeUndefined();
    expect(page.data.viewState).toBe('error');
    await page.loadTeachers(true);
    loadTeachers.mockRejectedValueOnce(new Error('offline'));
    await page.loadTeachers(true);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshError).toBeTruthy();
    await page.loadTeachers(true);
    loadTeachers.mockRejectedValueOnce(new Error('offline'));
    await page.loadTeachers(false);
    expect(page.data).toMatchObject({ page: 1, viewState: 'ready', loadingMore: false });
    expect(page.data.paginationError).toBeTruthy();
    loadTeachers.mockResolvedValueOnce(success(['second'], 2));
    await page.loadTeachers(false);
    expect(page.data.page).toBe(2);
  });

  it('deduplicates IDs on the first page as well as subsequent pages', async () => {
    loadTeachers.mockResolvedValueOnce(success(['first', 'first']));
    await open();
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['first']);
  });

  it('refreshes pending input immediately and cancels its duplicate debounce request', async () => {
    await open();
    page.onSearchInput(input(' 林 '));
    page.onLoadMore();
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(1);
    page.onPullDownRefresh();
    await flush();
    expect(loadTeachers).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, query: '林' });
    jest.advanceTimersByTime(500);
    await flush();
    expect(loadTeachers).toHaveBeenCalledTimes(2);
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('also clears content when a rejected service request carries HTTP %s', async (statusCode) => {
    await open();
    loadTeachers.mockRejectedValueOnce(Object.assign(new Error('offline'), { statusCode }));
    await page.loadTeachers(true);
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], total: 0, page: 0, hasMore: false,
      refreshError: '', paginationError: '', loadingMore: false,
    });
  });

  it.each([true, false].flatMap((reset) =>
    [401, 403].map((statusCode) => ({ reset, statusCode })),
  ))('clears private rows and fold on synchronous HTTP $statusCode for reset=$reset', async ({ reset, statusCode }) => {
    await open();
    page.onTeacherToggle(toggle('first'));
    loadTeachers.mockImplementationOnce(() => {
      throw Object.assign(new Error('private denial'), { statusCode });
    });
    await expect(page.loadTeachers(reset)).resolves.toBeUndefined();
    expectCleared();
    expect(logout).not.toHaveBeenCalled();
  });

  it('uses compact alerts without partner-state height and exposes retries and login', () => {
    const root = path.resolve(__dirname, '../pages/partner/teachers');
    const markup = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
    expect(markup).toContain('wx:if="{{refreshError}}" class="teachers-refresh-error"');
    expect(markup).toContain('wx:if="{{paginationError}}" class="teachers-pagination-error"');
    expect(markup).toContain('bindtap="onRetryMore"');
    expect(markup).toContain('bindtap="onLogin"');
    expect(markup).not.toMatch(/class="[^"]*partner-state[^"]*teachers-(?:refresh|pagination)-error/);
    expect(styles).toMatch(/\.teachers-refresh-error[\s\S]*?min-height:\s*0;/);
    expect(styles).toMatch(/\.teachers-pagination-error[\s\S]*?min-height:\s*0;/);
  });
});
