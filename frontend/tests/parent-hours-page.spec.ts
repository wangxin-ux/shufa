export {};
import * as fs from 'node:fs';
import * as path from 'node:path';
import { privateNumberAdvance } from './support/parent-pdf-number-metrics';
const loadHoursView = jest.fn();
const logoutHours = jest.fn();
jest.mock('../services/parent-runtime', () => ({ parentService: { loadHoursView: (query: unknown) => loadHoursView(query) } }));
jest.mock('../services/session.service', () => ({ sessionService: { logout: () => logoutHours() } }));
describe('PDF parent hours interactions', () => {
  it('budgets label line boxes and padding within the PDF standard card heights', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxss'), 'utf8');
    expect(styles).toMatch(/\.balance-card\s*\{[^}]*padding:\s*34rpx 40rpx 28rpx/s);
    expect(styles).toMatch(/\.balance-card__label\s*\{[^}]*line-height:\s*28rpx/s);
    expect(styles).toMatch(/\.hour-card\s*\{[^}]*padding:\s*7rpx 28rpx/s);
    expect(styles).toMatch(/\.hour-card__label\s*\{[^}]*line-height:\s*24rpx/s);
    expect(styles).toMatch(/\.hour-card__value\s*\{[^}]*font-size:\s*139rpx/s);
    const cardRule = styles.match(/\.hour-card\s*\{([^}]+)\}/)?.[1];
    expect(cardRule).not.toMatch(/(?:^|;)\s*height:/);
  });
  it('reserves the same value lane for unknown grants without fabricating numbers or a unit', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxss'), 'utf8');
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxml'), 'utf8');
    expect(styles).toMatch(/\.hour-card__value-row\s*\{[^}]*min-height:\s*139rpx/s);
    expect(styles).toMatch(/\.hour-card__value-row--unknown\s*\{[^}]*align-items:\s*center/s);
    expect(markup).toContain("{{item.hasKnownGrant ? '' : 'hour-card__value-row--unknown'}}");
    expect(markup).toContain('wx:if="{{item.hasKnownGrant}}" class="hour-card__unit"');
  });
  it('fits source-sized grant text within the existing 212rpx card', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxss'), 'utf8');
    expect(styles).toMatch(/\.hour-card__value-row\s*\{[^}]*margin:\s*4rpx -14rpx 3rpx/s);
    expect(styles).toMatch(/\.hour-card__value\s*\{[^}]*max-width:\s*204rpx/s);
    expect(styles).toMatch(/\.hour-card__unit\s*\{[^}]*font-size:\s*53rpx/s);
    expect(styles).toMatch(/\.hour-card__unit\s*\{[^}]*margin-left:\s*0(?:rpx)?\s*;/s);
  });
  it('keeps pagination retry and error text above the intact ledger mascot', () => {
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxss'), 'utf8');
    for (const selector of ['ledger__load-more', 'ledger__page-error']) {
      const rule = styles.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`))?.[1];
      expect(rule).toMatch(/position:\s*relative/);
      expect(rule).toMatch(/z-index:\s*1/);
      expect(rule).toMatch(/background:\s*#ffffff/);
    }
  });
  it('keeps the intact ledger mascot below the expanded subject filters', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxss'), 'utf8');
    expect(markup).toContain("ledger__card {{showFilters ? 'ledger__card--filtered' : ''}}");
    expect(styles).toMatch(/\.ledger__card--filtered\s*\{[^}]*margin-top:\s*148rpx/s);
    expect(styles).toMatch(/\.ledger__mascot\s*\{[^}]*top:\s*-126rpx/s);
    expect(styles).toMatch(/\.ledger__card\s*\{[^}]*margin-top:\s*32rpx/s);
  });
  it('provides a stable native renewal target without changing the component contract', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/parent/hours/index.wxml'), 'utf8');
    expect(markup).toMatch(/<parent-primary-button[^>]*id="parent-hours-renew"/);
    expect(markup).toMatch(/id="parent-hours-renew"[^>]*bind:tap="onRenewTap"/);
  });
  let page: any;
  const view = {
    remainingTotal: 37, paidHours: 37, giftHours: 0, grantedPaidHours: 48, grantedGiftHours: 12,
    paidAmountFen: 480001, validUntil: '2027-08-23', courseNames: ['历史书法', '未分类'],
    entries: [{ id: 'one', title: '原始课包', delta: 48, occurredAtLabel: '2026-10-06', detailLabel: '发放' }],
    meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
  };
  beforeEach(() => {
    loadHoursView.mockReset().mockResolvedValue({ status: 'success', data: view });
    logoutHours.mockReset();
    (global as any).wx = { navigateTo: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn() };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (patch: unknown) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/parent/hours/index'));
  });
  afterEach(() => { delete (global as any).Page; delete (global as any).wx; });
  it('uses the source-standard balance size and leaves room for the unit beside long values', async () => {
    await page.loadHours();
    expect(page.data.balanceValueSize).toBe(155);
    loadHoursView.mockResolvedValue({ status: 'success', data: {
      ...view, remainingTotal: 888, paidAmountFen: 8888888888,
    } });
    await page.loadHours();
    expect(page.data.remainingTotal).toBe(888);
    expect(privateNumberAdvance('888', page.data.balanceValueSize)).toBeLessThanOrEqual(220);
    expect(page.data.paidAmountLabel).toBe('¥88888888.88');
  });
  it.each([444, 888, 444444, 888888, 4444.5])(
    'fits the actual private-font advance of the long balance %s', async (remainingTotal) => {
      loadHoursView.mockResolvedValue({ status: 'success', data: { ...view, remainingTotal } });
      await page.loadHours();
      expect(page.data.remainingTotal).toBe(remainingTotal);
      expect(privateNumberAdvance(String(remainingTotal), page.data.balanceValueSize))
        .toBeLessThanOrEqual(220);
    },
  );
  it.each([48, 44, 444444, 4444.5])(
    'reserves room for the unit in a single grant card for %s', async (grantedPaidHours) => {
      loadHoursView.mockResolvedValue({ status: 'success', data: {
        ...view, giftHours: null, grantedPaidHours,
      } });
      await page.loadHours();
      expect(page.data.hourCards).toHaveLength(1);
      const card = page.data.hourCards[0];
      expect(card.grantedLabel).toBe(String(grantedPaidHours));
      expect(privateNumberAdvance(card.grantedLabel, card.valueSize) + 53)
        .toBeLessThanOrEqual(248);
      if (grantedPaidHours === 48) expect(card.valueSize).toBe(135);
    },
  );
  it.each([48, 44, 88, 444444, 888888, 4444.5, 0])(
    'reserves the complete unit in both source-width grant cards for %s', async (grant) => {
      loadHoursView.mockResolvedValue({ status: 'success', data: {
        ...view, grantedPaidHours: grant, grantedGiftHours: grant,
      } });
      await page.loadHours();
      expect(page.data.hourCards).toHaveLength(2);
      for (const card of page.data.hourCards) {
        expect(card.grantedLabel).toBe(String(grant));
        expect(card.hasKnownGrant).toBe(true);
        expect(privateNumberAdvance(card.grantedLabel, card.valueSize) + 53)
          .toBeLessThanOrEqual(248);
        expect(card.valueSize).toBeLessThanOrEqual(139);
        if (grant === 0) expect(card.valueSize).toBe(139);
        if ([48, 44, 88].includes(grant)) expect(card.valueSize).toBe(135);
      }
      expect(page.data.remainingTotal).toBe(view.remainingTotal);
      expect(page.data.paidAmountLabel).toBe('¥4800.01');
    },
  );
  it.each([
    { giftHours: null, grantedPaidHours: null, grantedGiftHours: null },
    { giftHours: 0, grantedPaidHours: 44, grantedGiftHours: null },
    { giftHours: 0, grantedPaidHours: null, grantedGiftHours: 88 },
  ])('keeps unknown and known grants distinct after width fitting: %j', async (grants) => {
    loadHoursView.mockResolvedValue({ status: 'success', data: { ...view, ...grants } });
    await page.loadHours();
    expect(page.data.hourCards).toHaveLength(grants.giftHours === null ? 1 : 2);
    for (const card of page.data.hourCards) {
      const raw = card.key === 'paid' ? grants.grantedPaidHours : grants.grantedGiftHours;
      expect(card.hasKnownGrant).toBe(raw !== null);
      expect(card.grantedLabel).toBe(raw === null ? '待核对' : String(raw));
      if (raw === null) expect(card.valueSize).toBe(36);
      else expect(privateNumberAdvance(card.grantedLabel, card.valueSize) + 53)
        .toBeLessThanOrEqual(248);
    }
  });
  it('queries the backend for subjects/directions and appends subsequent pages', async () => {
    await page.loadHours();
    expect(loadHoursView).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, direction: 'all' });
    expect(page.data.subjectOptions).toEqual(['全部科目', '历史书法', '未分类']);
    page.onSubjectChange({ detail: { value: '1' } });
    await Promise.resolve();
    expect(loadHoursView).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, direction: 'all', courseName: '历史书法' });
    await page.loadHours();
    loadHoursView.mockResolvedValue({ status: 'success', data: {
      ...view, meta: { ...view.meta, page: 2 },
      entries: [{ ...view.entries[0], id: 'two' }],
    } });
    await page.loadMore();
    expect(page.data.entries.map((entry: any) => entry.id)).toEqual(['one', 'two']);
    expect(page.data.hasMore).toBe(false);
    page.onRenewTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/parent/courses/index' });
  });
  it('keeps current rows on pagination failure, supports retry and logs out only on 401', async () => {
    await page.loadHours();
    loadHoursView.mockResolvedValue({ status: 'error', message: '请求失败' });
    await page.loadMore();
    expect(page.data.entries).toHaveLength(1);
    expect(page.data.paginationError).toBe('请求失败');
    loadHoursView.mockResolvedValue({ status: 'error', message: '登录已失效', statusCode: 401 });
    await page.loadHours();
    expect(logoutHours).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
  it('ignores late responses after unload', async () => {
    let resolve!: (value: unknown) => void;
    loadHoursView.mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = page.loadHours();
    page.onUnload();
    resolve({ status: 'success', data: view });
    await pending;
    expect(page.data.viewState).toBe('loading');
  });
  it('discards an old direction response after a newer filter request', async () => {
    let resolveOld!: (value: unknown) => void;
    loadHoursView.mockReturnValueOnce(new Promise((done) => { resolveOld = done; }));
    const old = page.loadHours();
    page.onFilterTap({ currentTarget: { dataset: { filter: 'debit' } } });
    await Promise.resolve();
    resolveOld({ status: 'success', data: view });
    await old;
    expect(page.data.activeFilter).toBe('debit');
    expect(page.data.entries).toHaveLength(0);
    expect(loadHoursView).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, direction: 'debit' });
  });
});
