import * as fs from 'fs';
import * as path from 'path';
import { currentRankingMonth, type PartnerRankingPage } from '../pages/partner/runtime/partner-ranking.types';

const list = jest.fn();
let owner = 'synthetic-owner-a';
let environment = 'environment-a';
jest.mock('../pages/partner/runtime/partner-ranking.service', () => ({
  createPartnerRankingService: () => {
    const createdIn = environment;
    return { getSessionKey: () => createdIn === environment ? owner : '', list };
  },
}), { virtual: true });
jest.mock('../pages/partner/runtime/partner-pdf-font', () => ({
  loadPartnerPdfDisplayFont: jest.fn().mockResolvedValue(true),
}));
const root = path.resolve(__dirname, '..');
const componentFile = path.join(root, 'pages/partner/components/partner-ranking-preview/index.ts');
const result = (patch: Partial<PartnerRankingPage> = {}): PartnerRankingPage => ({
  metric: 'STUDENTS', month: currentRankingMonth(), timezone: 'Asia/Shanghai',
  asOf: '2026-10-15T02:00:00Z', calculationVersion: 'synthetic-v1',
  availability: 'LIVE', unavailableReason: null, revisionId: 'synthetic-revision-a',
  data: [{ campusId: 'synthetic-a', campusName: '合成校区', rank: 7, previousRank: null, rankDelta: null, isOwnCampus: false }],
  ownCampus: { campusId: 'own', campusName: '合成本校区', rank: 90, previousRank: 87, rankDelta: -3, isOwnCampus: true },
  meta: { page: 1, pageSize: 3, total: 30, totalPages: 10 }, ...patch,
});
function deferred() {
  let resolve!: (value: PartnerRankingPage) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<PartnerRankingPage>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const tap = (metric: string) => ({ currentTarget: { dataset: { metric } } });

describe('partner account ranking preview', () => {
  let component: any;
  let definition: any;
  const open = async () => {
    definition.lifetimes.attached.call(component);
    definition.pageLifetimes.show.call(component);
    await flush();
  };
  const block = (value: boolean) => {
    component.data.blocked = value;
    definition.properties.blocked.observer.call(component, value);
  };
  beforeEach(() => {
    owner = 'synthetic-owner-a';
    environment = 'environment-a';
    list.mockReset().mockImplementation(async (query) => result({ metric: query.metric, month: query.month }));
    (global as any).wx = { navigateTo: jest.fn() };
    (global as any).Component = (config: any) => {
      definition = config;
      component = { ...config.methods, data: { ...structuredClone(config.data), blocked: false }, triggerEvent: jest.fn() };
      component.setData = jest.fn((patch: object) => Object.assign(component.data, patch));
    };
    expect(fs.existsSync(componentFile)).toBe(true);
    jest.isolateModules(() => require(componentFile));
  });
  afterEach(() => {
    if (definition) definition.lifetimes.detached.call(component);
    definition = undefined;
    delete (global as any).wx;
    delete (global as any).Component;
  });

  it('loads one three-row preview on attached/show and merges duplicate requests', async () => {
    const held = deferred();
    list.mockReturnValueOnce(held.promise);
    await open();
    const request = component.load();
    expect(component.load()).toBe(request);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ metric: 'STUDENTS', month: currentRankingMonth(), page: 1, pageSize: 3 });
    held.resolve(result());
    await request;
    expect(component.data.viewState).toBe('ready');
    expect(component.data.rows[0]).toMatchObject({ rank: 7, deltaLabel: '无上月可比数据' });
    expect(component.data.ownCampus).toMatchObject({ rank: 90, deltaLabel: '下降3名' });
  });

  it('switches among all three metrics without computing a ranking and ignores stale replies', async () => {
    await open();
    const old = deferred();
    list.mockReturnValueOnce(old.promise);
    component.onMetricTap(tap('PARTNER_EARNINGS'));
    expect(component.data.rows).toEqual([]);
    await flush();
    component.onMetricTap(tap('HEADQUARTERS_EARNINGS'));
    await flush();
    old.resolve(result({ metric: 'PARTNER_EARNINGS' }));
    await flush();
    expect(component.data.metric).toBe('HEADQUARTERS_EARNINGS');
    expect(list.mock.calls.map(([query]) => query.metric)).toEqual(['STUDENTS', 'PARTNER_EARNINGS', 'HEADQUARTERS_EARNINGS']);
    component.onMetricTap(tap('invalid'));
    component.onMetricTap(tap('HEADQUARTERS_EARNINGS'));
    await flush();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('does not send a queued read after a parent block or hide', async () => {
    definition.lifetimes.attached.call(component);
    block(true);
    await flush();
    expect(list).not.toHaveBeenCalled();
    block(false);
    definition.pageLifetimes.hide.call(component);
    await flush();
    expect(list).not.toHaveBeenCalled();
  });

  it('ignores a stale denial after a metric change and keeps the current request merged', async () => {
    const old = deferred();
    list.mockReturnValueOnce(old.promise);
    await open();
    const fresh = deferred();
    list.mockReturnValueOnce(fresh.promise);
    component.onMetricTap(tap('PARTNER_EARNINGS'));
    await flush();
    old.reject(Object.assign(new Error('stale denial'), { statusCode: 401 }));
    await flush();
    const request = component.load();
    expect(list).toHaveBeenCalledTimes(2);
    fresh.resolve(result({ metric: 'PARTNER_EARNINGS' }));
    await request;
    expect(component.data.viewState).toBe('ready');
    expect(component.triggerEvent).not.toHaveBeenCalled();
  });

  it('shows an unambiguous cutoff year in Shanghai time', async () => {
    list.mockResolvedValueOnce(result({ asOf: '2025-12-31T16:01:00.000Z' }));
    await open();
    expect(component.data.asOfLabel).toBe('2026-01-01 00:01');
  });

  it('passes the selected metric and month to the full rankings route', async () => {
    await open();
    component.onMetricTap(tap('PARTNER_EARNINGS'));
    await flush();
    component.onAllTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: `/pages/partner/rankings/index?metric=PARTNER_EARNINGS&month=${currentRankingMonth()}`,
    }));
  });

  it('clears and stops all reads and navigation when the parent blocks the component', async () => {
    await open();
    const held = deferred();
    list.mockReturnValueOnce(held.promise);
    const request = component.load();
    await flush();
    block(true);
    expect(component.data).toMatchObject({ rows: [], ownCampus: null, availability: null, asOfLabel: '' });
    held.resolve(result());
    await request;
    component.onRetry();
    component.onMetricTap(tap('PARTNER_EARNINGS'));
    component.onAllTap();
    definition.pageLifetimes.show.call(component);
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    expect(component.triggerEvent).not.toHaveBeenCalled();
  });

  it('does not read before attachment, while initially blocked, or after detach', async () => {
    block(false);
    block(true);
    await open();
    expect(list).not.toHaveBeenCalled();
    definition.lifetimes.detached.call(component);
    block(false);
    await component.load();
    expect(list).not.toHaveBeenCalled();
  });

  it('can resume after a parent block is lifted for the same owner, without duplicate initial show reads', async () => {
    block(true);
    await open();
    block(false);
    await flush();
    expect(list).toHaveBeenCalledTimes(1);
    expect(component.data.viewState).toBe('ready');
  });

  it.each([401, 403])('clears its content and signals the parent once after %s', async (statusCode) => {
    await open();
    list.mockRejectedValueOnce(Object.assign(new Error('private denial'), { statusCode, code: 'FORBIDDEN' }));
    await component.load();
    expect(component.data).toMatchObject({ viewState: 'forbidden', rows: [], ownCampus: null });
    expect(component.triggerEvent).toHaveBeenCalledTimes(1);
    expect(component.triggerEvent).toHaveBeenCalledWith('forbidden', { message: expect.any(String) });
    component.onRetry();
    component.onAllTap();
    definition.pageLifetimes.show.call(component);
    await flush();
    expect(list).toHaveBeenCalledTimes(2);
    expect(component.triggerEvent).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'environment', 'empty'])('signals the parent and never restores the old preview after %s changes', async (change) => {
    await open();
    const held = deferred();
    list.mockReturnValueOnce(held.promise);
    const request = component.load();
    await flush();
    if (change === 'owner') owner = 'synthetic-owner-b';
    if (change === 'environment') environment = 'environment-b';
    if (change === 'empty') owner = '';
    held.resolve(result());
    await request;
    expect(component.data.rows).toEqual([]);
    expect(component.data.ownCampus).toBeNull();
    expect(component.triggerEvent).toHaveBeenCalledWith('forbidden', { message: expect.any(String) });
    await component.load();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not read with an empty owner key and signals the parent', async () => {
    owner = '';
    await open();
    expect(list).not.toHaveBeenCalled();
    expect(component.triggerEvent).toHaveBeenCalledTimes(1);
  });

  it.each(['hide', 'detached'])('clears private state and discards late responses after %s', async (action) => {
    await open();
    const held = deferred();
    list.mockReturnValueOnce(held.promise);
    const request = component.load();
    await flush();
    if (action === 'hide') definition.pageLifetimes.hide.call(component);
    else definition.lifetimes.detached.call(component);
    expect(component.data.rows).toEqual([]);
    component.setData.mockClear();
    held.reject(Object.assign(new Error('old denial'), { statusCode: 403 }));
    await request;
    expect(component.setData).not.toHaveBeenCalled();
    expect(component.triggerEvent).not.toHaveBeenCalled();
    if (action === 'hide') {
      definition.pageLifetimes.show.call(component);
      await flush();
      expect(component.data.viewState).toBe('ready');
    }
  });

  it('isolates a success from before hide even when it arrives after the new show result', async () => {
    const old = deferred();
    list.mockReturnValueOnce(old.promise);
    await open();
    definition.pageLifetimes.hide.call(component);
    list.mockResolvedValueOnce(result({ ownCampus: null, data: [] }));
    definition.pageLifetimes.show.call(component);
    await flush();
    old.resolve(result());
    await flush();
    expect(component.data.viewState).toBe('empty');
    expect(component.data.ownCampus).toBeNull();
  });

  it('retains the old preview on a normal error and offers an independent retry', async () => {
    await open();
    const rows = component.data.rows;
    list.mockImplementationOnce(() => { throw new Error('private detail'); });
    await component.load();
    expect(component.data.rows).toBe(rows);
    expect(component.data.refreshError).toBe('月榜加载失败，请重试');
    expect(component.triggerEvent).not.toHaveBeenCalled();
    component.onRetry();
    await flush();
    expect(component.data.refreshError).toBe('');
  });

  it.each(['LIVE', 'SNAPSHOT', 'UNAVAILABLE'] as const)('distinguishes %s from a transport failure', async (availability) => {
    list.mockResolvedValueOnce(result({ availability, data: [], ownCampus: null,
      unavailableReason: availability === 'UNAVAILABLE' ? 'SOURCE_DATA_INVALID' : null }));
    await open();
    expect(component.data.viewState).toBe(availability === 'UNAVAILABLE' ? 'unavailable' : 'empty');
    expect(component.data.availability).toBe(availability);
    expect(component.data.errorMessage).toBe('');
  });

  it('renders initial error retry and recovers from a navigation exception without leaking transport details', async () => {
    list.mockRejectedValueOnce(new Error('private'));
    await open();
    expect(component.data.viewState).toBe('error');
    expect(component.data.errorMessage).toBe('月榜加载失败，请重试');
    component.onRetry();
    await flush();
    (global as any).wx.navigateTo.mockImplementationOnce(() => { throw new Error('private route'); });
    expect(() => component.onAllTap()).not.toThrow();
    expect(component.data.navigationError).toBe('月榜页面打开失败，请重试');
    component.onAllTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });

  it('declares a private native component, metric segments, independent own row and full-list command', () => {
    const directory = path.dirname(componentFile);
    const template = fs.readFileSync(path.join(directory, 'index.wxml'), 'utf8');
    const css = fs.readFileSync(path.join(directory, 'index.wxss'), 'utf8');
    const json = JSON.parse(fs.readFileSync(path.join(directory, 'index.json'), 'utf8'));
    expect(json.component).toBe(true);
    expect(template).toContain('onMetricTap');
    expect(template).toContain('onAllTap');
    expect(template).toContain('ownCampus');
    expect(template).toContain('isOwnCampus');
    expect(template).not.toMatch(/amountFen|studentCount/);
    expect(css).toContain('--partner-font-display');
    const content = css.match(/\.ranking-preview__content\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(content).toMatch(/background:\s*#f6d468/);
    expect(content).not.toMatch(/(?:^|;)\s*opacity:/);
  });
});
