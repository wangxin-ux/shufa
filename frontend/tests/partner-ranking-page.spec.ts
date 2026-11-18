import * as fs from 'fs';
import * as path from 'path';
import { currentRankingMonth, type PartnerRankingPage, type PartnerRankingRow } from '../pages/partner/runtime/partner-ranking.types';

const list = jest.fn();
let owner = 'synthetic-owner-a';
let environment = 'environment-a';
const createService = jest.fn(() => {
  const createdIn = environment;
  return { getSessionKey: () => createdIn === environment ? owner : '', list };
});
jest.mock('../pages/partner/runtime/partner-ranking.service', () => ({
  createPartnerRankingService: () => createService(),
}), { virtual: true });
jest.mock('../pages/partner/runtime/partner-pdf-font', () => ({
  loadPartnerPdfDisplayFont: jest.fn().mockResolvedValue(true),
}));

const root = path.resolve(__dirname, '..');
const pageFile = path.join(root, 'pages/partner/rankings/index.ts');
function deferred() {
  let resolve!: (value: PartnerRankingPage) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<PartnerRankingPage>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (patch: Partial<PartnerRankingRow> = {}): PartnerRankingRow => ({
  campusId: 'synthetic-campus-a', campusName: '合成校区甲', rank: 8,
  previousRank: 2, rankDelta: -6, isOwnCampus: false, ...patch,
});
const result = (patch: Partial<PartnerRankingPage> = {}): PartnerRankingPage => ({
  metric: 'STUDENTS', month: currentRankingMonth(), timezone: 'Asia/Shanghai',
  asOf: '2026-10-15T02:00:00Z', calculationVersion: 'synthetic-v1',
  availability: 'LIVE', unavailableReason: null, revisionId: 'synthetic-revision-a',
  data: [row()], ownCampus: row({ campusId: 'own', campusName: '合成本校区', rank: 99, isOwnCampus: true }),
  meta: { page: 1, pageSize: 20, total: 40, totalPages: 2 }, ...patch,
});
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const metricEvent = (metric: string) => ({ currentTarget: { dataset: { metric } } });
const monthEvent = (month: string) => ({ detail: { value: month } });

describe('partner monthly ranking page', () => {
  let page: any;
  let session: any;
  let stored: Map<string, unknown>;
  const open = async (query: object = {}) => { page.onLoad(query); page.onShow(); await flush(); };
  beforeEach(() => {
    owner = 'synthetic-owner-a';
    environment = 'environment-a';
    createService.mockClear();
    stored = new Map([['education.runtime', { dataDriver: 'mock' }]]);
    list.mockReset().mockImplementation(async (query) => result({ metric: query.metric, month: query.month }));
    (global as any).wx = {
      navigateTo: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
      getStorageSync: (key: string) => stored.get(key),
      setStorageSync: (key: string, value: unknown) => stored.set(key, value),
    };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
    expect(fs.existsSync(pageFile)).toBe(true);
    jest.isolateModules(() => {
      require(pageFile);
      session = require('../services/session.service').sessionService;
    });
  });
  afterEach(() => {
    page?.onUnload();
    page = undefined;
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('reads once on load/show and merges repeated requests for the same query', async () => {
    const pending = deferred();
    list.mockReturnValueOnce(pending.promise);
    await open();
    const first = page.load(true);
    expect(page.load(true)).toBe(first);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ metric: 'STUDENTS', month: currentRankingMonth(), page: 1, pageSize: 20 });
    pending.resolve(result());
    await first;
    expect(page.data.viewState).toBe('ready');
  });

  it('validates route values and supports valid historical metric and month deep links', async () => {
    await open({ metric: 'HEADQUARTERS_EARNINGS', month: '2026-09' });
    expect(list).toHaveBeenLastCalledWith({ metric: 'HEADQUARTERS_EARNINGS', month: '2026-09', page: 1, pageSize: 20 });
    page.onUnload();
    jest.isolateModules(() => require(pageFile));
    await open({ metric: 'CASH', month: '9999-12', campusId: 'ignored' });
    expect(list).toHaveBeenLastCalledWith({ metric: 'STUDENTS', month: currentRankingMonth(), page: 1, pageSize: 20 });
  });

  it.each(['2026-00', '2026-13', '2026-1', '0000-01', '0001-01', '0999-12', '2026-09-01', '../2026-09'])('rejects invalid month %s', async (month) => {
    await open({ month });
    expect(page.data.month).toBe(currentRankingMonth());
    page.onMonthChange(monthEvent(month));
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('keeps server row order, dense ranks, signed deltas, and the independent own campus', async () => {
    list.mockResolvedValueOnce(result({ data: [
      row({ rank: 8, rankDelta: null, previousRank: null }),
      row({ campusId: 'second', rank: 8, rankDelta: 3, previousRank: 11, isOwnCampus: true }),
      row({ campusId: 'third', rank: 9, rankDelta: 0, previousRank: 9 }),
    ] }));
    await open();
    expect(page.data.rows.map((item: any) => item.rank)).toEqual([8, 8, 9]);
    expect(page.data.rows.map((item: any) => item.deltaLabel)).toEqual(['无上月可比数据', '上升3名', '持平']);
    expect(page.data.ownCampus).toMatchObject({ campusId: 'own', rank: 99, deltaLabel: '下降6名' });
    expect(page.data.rows[1].isOwnCampus).toBe(true);
  });

  it('pins every later page to the first revision and retries the failed page unchanged', async () => {
    await open();
    list.mockRejectedValueOnce(new Error('private transport details'));
    page.onLoadMore();
    page.onLoadMore();
    await flush();
    expect(page.data.rows).toHaveLength(1);
    expect(page.data.page).toBe(1);
    expect(page.data.pageError).toBe('月榜加载失败，请重试');
    const query = { metric: 'STUDENTS', month: currentRankingMonth(), page: 2, pageSize: 20, revisionId: 'synthetic-revision-a' };
    expect(list).toHaveBeenLastCalledWith(query);
    list.mockResolvedValueOnce(result({
      data: [row({ campusId: 'next', rank: 9 })],
      meta: { page: 2, pageSize: 20, total: 40, totalPages: 2 },
    }));
    page.onLoadMore();
    await flush();
    expect(list).toHaveBeenLastCalledWith(query);
    expect(page.data.rows.map((item: any) => item.campusId)).toEqual(['synthetic-campus-a', 'next']);
    expect(page.data.hasMore).toBe(false);
    page.onLoadMore();
    await flush();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('preserves content and revision on refresh failure, then replaces both on successful refresh', async () => {
    await open();
    const rows = page.data.rows;
    list.mockRejectedValueOnce(new Error('secret'));
    await page.load(true);
    expect(page.data.rows).toBe(rows);
    expect(page.data.revisionId).toBe('synthetic-revision-a');
    expect(page.data.refreshError).toBe('月榜加载失败，请重试');
    page.onLoadMore();
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    list.mockResolvedValueOnce(result({ revisionId: 'synthetic-revision-b', data: [row({ campusId: 'refreshed' })] }));
    page.onRetry();
    await flush();
    expect(page.data.revisionId).toBe('synthetic-revision-b');
    expect(page.data.rows[0].campusId).toBe('refreshed');
    expect(page.data.refreshError).toBe('');
    expect(list.mock.calls[2][0]).not.toHaveProperty('revisionId');
  });

  it('clears old rows and revision when switching metric or month, ignoring old page replies', async () => {
    await open();
    const old = deferred();
    list.mockReturnValueOnce(old.promise);
    page.onLoadMore();
    await flush();
    page.onMetricTap(metricEvent('PARTNER_EARNINGS'));
    expect(page.data.rows).toEqual([]);
    expect(page.data.ownCampus).toBeNull();
    expect(page.data.revisionId).toBeNull();
    await flush();
    old.resolve(result({ data: [row({ campusId: 'stale' })] }));
    await flush();
    expect(page.data.metric).toBe('PARTNER_EARNINGS');
    expect(page.data.rows[0].campusId).not.toBe('stale');
    page.onMonthChange(monthEvent('2026-09'));
    await flush();
    expect(list).toHaveBeenLastCalledWith({ metric: 'PARTNER_EARNINGS', month: '2026-09', page: 1, pageSize: 20 });
    page.onCurrentMonth();
    await flush();
    expect(page.data.month).toBe(currentRankingMonth());
  });

  it('does not dispatch a superseded queued read or react to invalid metric controls', async () => {
    page.onLoad({});
    page.onMetricTap(metricEvent('HEADQUARTERS_EARNINGS'));
    page.onMetricTap(metricEvent('invalid'));
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(list.mock.calls[0][0].metric).toBe('HEADQUARTERS_EARNINGS');
  });

  it.each(['hide', 'owner'])('cancels a queued read before it reaches the service after %s', async (change) => {
    page.onLoad({});
    if (change === 'hide') page.onHide();
    else owner = 'synthetic-owner-b';
    await flush();
    expect(list).not.toHaveBeenCalled();
    expect(page.data.rows).toEqual([]);
  });

  it('ignores a denial from a superseded condition without releasing the new request lock', async () => {
    const old = deferred();
    list.mockReturnValueOnce(old.promise);
    await open();
    const fresh = deferred();
    list.mockReturnValueOnce(fresh.promise);
    page.onMetricTap(metricEvent('PARTNER_EARNINGS'));
    await flush();
    old.reject(Object.assign(new Error('stale denial'), { statusCode: 403 }));
    await flush();
    const request = page.load(true);
    expect(list).toHaveBeenCalledTimes(2);
    fresh.resolve(result({ metric: 'PARTNER_EARNINGS' }));
    await request;
    expect(page.data.viewState).toBe('ready');
  });

  it('rejects a mismatched revision response without mixing it into the pinned list', async () => {
    await open();
    const rows = page.data.rows;
    list.mockResolvedValueOnce(result({ revisionId: 'unexpected-revision' }));
    await page.load(false);
    expect(page.data.rows).toBe(rows);
    expect(page.data.revisionId).toBe('synthetic-revision-a');
    expect(page.data.pageError).toBeTruthy();
  });

  it('shows the server cutoff with its year in Shanghai time', async () => {
    list.mockResolvedValueOnce(result({ asOf: '2025-12-31T16:01:00.000Z' }));
    await open();
    expect(page.data.asOfLabel).toBe('2026-01-01 00:01');
  });

  it.each(['LIVE', 'SNAPSHOT', 'UNAVAILABLE'] as const)('displays availability %s and separates unavailable from empty', async (availability) => {
    list.mockResolvedValueOnce(result({
      availability, data: [], ownCampus: null, revisionId: availability === 'UNAVAILABLE' ? null : 'empty-revision',
      unavailableReason: availability === 'UNAVAILABLE' ? 'HISTORY_UNAVAILABLE' : null,
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    }));
    await open();
    expect(page.data.availability).toBe(availability);
    expect(page.data.viewState).toBe(availability === 'UNAVAILABLE' ? 'unavailable' : 'empty');
    expect(page.data.hasMore).toBe(false);
    expect(page.data.ownCampus).toBeNull();
  });

  it('allows retry of an initial failure and retains a known empty response on refresh failure', async () => {
    list.mockRejectedValueOnce(new Error('secret'));
    await open();
    expect(page.data.viewState).toBe('error');
    list.mockResolvedValueOnce(result({ data: [], ownCampus: null, meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }));
    page.onRetry();
    await flush();
    list.mockRejectedValueOnce(new Error('secret'));
    await page.load(true);
    expect(page.data.viewState).toBe('empty');
    expect(page.data.refreshError).toBeTruthy();
  });

  it.each([401, 403])('clears all private fields and stops reads after %s', async (statusCode) => {
    await open();
    list.mockRejectedValueOnce(Object.assign(new Error('private denial'), { statusCode, code: 'FORBIDDEN' }));
    await page.load(true);
    expect(page.data).toMatchObject({ viewState: 'forbidden', rows: [], ownCampus: null, revisionId: null, asOfLabel: '', total: 0 });
    page.onRetry();
    page.onLoadMore();
    page.onMetricTap(metricEvent('PARTNER_EARNINGS'));
    page.onShow();
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps the denial message usable after hiding and returning to a stopped page', async () => {
    list.mockRejectedValueOnce(Object.assign(new Error('denied'), { statusCode: 403 }));
    await open();
    const message = page.data.errorMessage;
    expect(message).toBeTruthy();
    page.onHide();
    page.onShow();
    expect(page.data.errorMessage).toBe(message);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'environment', 'empty'])('clears and stops when %s changes while a read is pending', async (change) => {
    await open();
    const held = deferred();
    list.mockReturnValueOnce(held.promise);
    const request = page.load(true);
    await flush();
    if (change === 'owner') owner = 'synthetic-owner-b';
    if (change === 'environment') environment = 'environment-b';
    if (change === 'empty') owner = '';
    held.resolve(result());
    await request;
    expect(page.data).toMatchObject({ viewState: 'forbidden', rows: [], ownCampus: null, revisionId: null });
    page.onShow();
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('never reads with an initially empty session key', async () => {
    owner = '';
    await open();
    expect(page.data.viewState).toBe('forbidden');
    expect(list).not.toHaveBeenCalled();
  });

  it.each(['onHide', 'onUnload'])('clears content and discards old responses after %s', async (action) => {
    await open();
    const old = deferred();
    list.mockReturnValueOnce(old.promise);
    const request = page.load(true);
    await flush();
    page[action]();
    expect(page.data.rows).toEqual([]);
    page.setData.mockClear();
    old.reject(Object.assign(new Error('old denial'), { statusCode: 403 }));
    await request;
    expect(page.setData).not.toHaveBeenCalled();
    if (action === 'onHide') {
      page.onShow();
      await flush();
      expect(page.data.viewState).toBe('ready');
      expect(list).toHaveBeenCalledTimes(3);
    }
  });

  it('ignores an old pull refresh completion after hide and a new pull refresh', async () => {
    await open();
    const old = deferred();
    list.mockReturnValueOnce(old.promise);
    page.onPullDownRefresh();
    await flush();
    page.onHide();
    const fresh = deferred();
    list.mockReturnValueOnce(fresh.promise);
    page.onShow();
    page.onPullDownRefresh();
    await flush();
    old.resolve(result());
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    fresh.resolve(result());
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it('recreates the current environment session for login and keeps a failed navigation retryable', async () => {
    await open();
    environment = 'environment-b';
    stored.set('education.runtime', {
      dataDriver: 'api', apiBaseUrl: 'https://ranking.example.test', accessToken: 'synthetic-current-token',
      enableTestAccountSwitcher: false,
    });
    const currentLogin = session.beginExplicitLogin();
    (global as any).wx.reLaunch.mockImplementationOnce((options: any) => options.fail({}));
    page.onLogin();
    expect(stored.get('education.runtime')).toMatchObject({ dataDriver: 'api', accessToken: '' });
    expect(stored.get('education.session.logged-out')).toBe(true);
    expect(currentLogin()).toBe(false);
    expect(page.data.rows).toEqual([]);
    expect(page.data.errorMessage).toBe('登录页打开失败，请重试');
    page.onLogin();
    expect((global as any).wx.reLaunch).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    page.onHide();
    page.onLogin();
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(2);
  });

  it('does not let an old login navigation failure replace a new owner message', async () => {
    await open();
    page.onLogin();
    const oldNavigation = (global as any).wx.reLaunch.mock.calls[0][0];
    owner = 'synthetic-owner-b';
    page.setData({ errorMessage: '当前状态' });
    oldNavigation.fail({});
    expect(page.data.errorMessage).toBe('当前状态');
  });

  it('declares the native shell, role font, month picker and separate own row without showing raw values', () => {
    const template = fs.readFileSync(path.join(root, 'pages/partner/rankings/index.wxml'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'pages/partner/rankings/index.wxss'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(root, 'pages/partner/rankings/index.json'), 'utf8'));
    expect(json.usingComponents['partner-page-shell']).toBe('/components/partner-page-shell/partner-page-shell');
    expect(json.enablePullDownRefresh).toBe(true);
    expect(template).toContain('<partner-page-shell');
    expect(template).toMatch(/mode="date"[^>]*fields="month"/);
    expect(template).toContain('ownCampus');
    expect(template).toContain('isOwnCampus');
    expect(template).toContain('onLoadMore');
    expect(template).not.toMatch(/amountFen|studentCount|headquartersRetainedFen/);
    expect(css).toContain('@import "../styles/pdf-typography.wxss"');
    expect(css).toContain('@import "../../../styles/partner-workspace.wxss"');
  });
});
