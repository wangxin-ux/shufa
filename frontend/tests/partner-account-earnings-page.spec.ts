import * as fs from 'fs';
import * as path from 'path';
import {
  PARTNER_EARNINGS_FIXTURE,
  PARTNER_LESSON_ACCOUNT_FIXTURE,
  PARTNER_PROFILE_FIXTURE,
} from '../mock/fixtures/partner.fixture';

const loadProfile = jest.fn();
const loadLessonAccount = jest.fn();
const loadSubjects = jest.fn();
const loadEarnings = jest.fn();
const loadEarningSummary = jest.fn();
const logout = jest.fn();
let ownerKey = 'synthetic-preview-owner';
jest.mock('../services/partner-runtime', () => ({
  createPartnerService: () => ({
    loadProfile: () => loadProfile(),
    loadEarnings: (query: object) => loadEarnings(query),
    loadEarningSummary: (...args: unknown[]) => loadEarningSummary(...args),
  }),
}));
jest.mock('../pages/partner/runtime/partner-lesson-runtime', () => ({
  PARTNER_LESSON_FILTERS: [
    { value: '', label: '全部类别' }, { value: 'CONSUME', label: '完成扣课' },
  ],
  createPartnerLessonService: () => ({
    loadLessonAccount: (query: object) => loadLessonAccount(query),
    loadSubjects: () => loadSubjects(),
  }),
}));
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
jest.mock('../services/session.service', () => ({
  createSessionService: () => ({ logout }),
  sessionService: { logout },
}));

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe('partner account recent internal earnings', () => {
  let page: any;
  const entry = PARTNER_EARNINGS_FIXTURE[0];
  const earnings = (rows = [entry]) => ({
    status: rows.length ? 'success' : 'empty',
    data: { data: rows, meta: { page: 1, pageSize: 3, total: rows.length, totalPages: rows.length ? 1 : 0 } },
  });
  const account = { status: 'success', data: PARTNER_LESSON_ACCOUNT_FIXTURE };
  const flush = async () => {
    for (let count = 0; count < 40; count++) await Promise.resolve();
  };
  const open = async () => { page.onLoad(); page.onShow(); await flush(); };
  beforeEach(() => {
    ownerKey = 'synthetic-preview-owner';
    loadProfile.mockReset().mockResolvedValue({ status: 'success', data: PARTNER_PROFILE_FIXTURE });
    loadLessonAccount.mockReset().mockResolvedValue(account);
    loadSubjects.mockReset().mockResolvedValue({ status: 'success', data: [
      { id: '00000000-0000-4000-8000-000000000001', name: '硬笔书法', isActive: true, version: 1 },
    ] });
    loadEarnings.mockReset().mockResolvedValue(earnings());
    loadEarningSummary.mockReset().mockResolvedValue({ status: 'success', data: {
      estimatedTotalFen: 7600, pendingReviewFen: 1200, availableFen: 6400, reversedNetFen: -400,
    } });
    logout.mockReset();
    (global as any).wx = {
      reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
      navigateTo: jest.fn(), showToast: jest.fn(),
    };
    (global as any).Page = (config: any) => {
      page = { ...config, data: structuredClone(config.data) };
      page.setData = (patch: object) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/partner/lesson-account/index'));
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('shows all-history net earnings and pending review separately without summing recent rows', async () => {
    await open();
    expect(loadEarningSummary.mock.calls).toEqual([[]]);
    expect(page.data.earningAccountState).toBe('ready');
    expect(page.data.earningAccount).toMatchObject({
      estimatedTotalLabel: '¥76.00', pendingReviewLabel: '¥12.00',
    });
    page.onEntryTypeChange({ detail: { value: '1' } });
    await flush();
    expect(loadEarningSummary).toHaveBeenCalledTimes(1);
    expect(page.data.earningAccount.estimatedTotalLabel).toBe('¥76.00');
  });

  it('keeps a negative net total and a known zero distinguishable from failure', async () => {
    loadEarningSummary.mockResolvedValueOnce({ status: 'success', data: {
      estimatedTotalFen: -400, pendingReviewFen: 0, availableFen: 0, reversedNetFen: -400,
    } });
    await open();
    expect(page.data.earningAccount).toMatchObject({
      estimatedTotalLabel: '-¥4.00', pendingReviewLabel: '¥0.00',
    });
  });

  it('retries the cumulative account independently and preserves stale amounts with an error', async () => {
    loadEarningSummary.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '合成失败' });
    await open();
    expect(page.data.earningAccount).toBeNull();
    expect(page.data.earningAccountState).toBe('error');
    page.onEarningAccountRetry();
    await flush();
    const value = page.data.earningAccount;
    loadEarningSummary.mockRejectedValueOnce(new Error('private diagnostics'));
    page.onEarningAccountRetry();
    await flush();
    expect(page.data.earningAccount).toBe(value);
    expect(page.data.earningAccountError).toBe('累计收益加载失败，请重试');
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    expect(loadEarnings).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('clears every account section when the summary returns %s', async (statusCode) => {
    await open();
    loadEarningSummary.mockResolvedValueOnce({ status: 'error', statusCode, message: '合成失权' });
    page.onEarningAccountRetry();
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summary: null, items: [], earningAccount: null, earningPreviewItems: [],
    });
    page.onEarningAccountRetry();
    expect(loadEarningSummary).toHaveBeenCalledTimes(2);
  });

  it.each(['hide', 'owner'])('discards a delayed cumulative amount after %s changes', async (change) => {
    const held = deferred();
    loadEarningSummary.mockReturnValueOnce(held.promise);
    await open();
    if (change === 'hide') page.onHide();
    else ownerKey = 'replacement-owner';
    held.resolve({ status: 'success', data: {
      estimatedTotalFen: 9999, pendingReviewFen: 0, availableFen: 9999, reversedNetFen: 0,
    } });
    await flush();
    expect(page.data.earningAccount).toBeNull();
    if (change === 'owner') expect(page.data.viewState).toBe('forbidden');
  });

  it('combines subject and ledger category without reloading either earning section', async () => {
    await open();
    expect(page.data.subjectOptions.map((row: { label: string }) => row.label))
      .toEqual(['全部科目', '未归类', '硬笔书法']);
    page.onSubjectChange({ detail: { value: '2' } });
    await flush();
    page.onEntryTypeChange({ detail: { value: '1' } });
    await flush();
    expect(loadLessonAccount).toHaveBeenLastCalledWith({
      page: 1, pageSize: 20, subjectId: '00000000-0000-4000-8000-000000000001', entryType: 'CONSUME',
    });
    expect(loadEarnings).toHaveBeenCalledTimes(1);
    expect(loadEarningSummary).toHaveBeenCalledTimes(1);
    expect(page.data.summary.totalBalanceLabel).toBe('49');
    expect(page.data.items[0].subjectLabel).toBe('未归类');
  });

  it('can select unclassified history and retry a catalog failure without rereading the account', async () => {
    loadSubjects.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '合成失败' });
    await open();
    expect(page.data.subjectError).toBe('科目加载失败，请重试');
    page.onSubjectChange({ detail: { value: '1' } });
    await flush();
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, subjectId: 'UNCLASSIFIED' });
    page.onSubjectsRetry();
    await flush();
    expect(page.data.subjectError).toBe('');
    expect(page.data.subjectId).toBe('UNCLASSIFIED');
    expect(loadLessonAccount).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('clears amounts and catalog options after a subject directory %s', async (statusCode) => {
    loadSubjects.mockResolvedValueOnce({ status: 'error', statusCode, message: '合成失权' });
    await open();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summary: null, earningAccount: null, items: [], subjectOptions: [],
    });
  });

  it('reads only three latest entries, retaining negative and rejected facts without computing a cash balance', async () => {
    loadEarnings.mockResolvedValueOnce(earnings([
      { ...entry, id: 'reversal', entryType: 'REVERSAL', status: 'REVERSED', amountFen: -4000 },
      { ...entry, id: 'rejected', status: 'REJECTED' },
      entry,
    ]));
    await open();
    expect(loadEarnings).toHaveBeenCalledTimes(1);
    expect(loadEarnings).toHaveBeenCalledWith({ page: 1, pageSize: 3 });
    expect(page.data.earningPreviewState).toBe('ready');
    expect(page.data.earningPreviewItems).toMatchObject([
      { id: 'reversal', amountLabel: '-¥40.00', typeLabel: '收益冲正', statusLabel: '已冲正' },
      { id: 'rejected', amountLabel: '¥40.00', typeLabel: '合作收益', statusLabel: '已驳回' },
      { id: entry.id, statusLabel: '待审核' },
    ]);
    expect(page.data.summary.totalBalanceLabel).toBe('49');
  });

  it('uses the current campus timezone for registration and original completion independently', async () => {
    const profile = deferred();
    loadProfile.mockReturnValueOnce(profile.promise);
    loadEarnings.mockResolvedValueOnce(earnings([{
      ...entry, createdAt: '2026-10-02T02:00:00Z', completedAt: '2026-09-01T02:00:00Z',
    }]));
    await open();
    expect(page.data.earningPreviewItems).toEqual([]);
    profile.resolve({ status: 'success', data: {
      ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, timezone: 'America/New_York' },
    } });
    await flush();
    expect(page.data.earningPreviewItems[0]).toMatchObject({
      registeredAtLabel: '2026年10月1日 22:00', completedAtLabel: '2026年8月31日 22:00',
    });
  });

  it('keeps lessons usable while the independent earning read is pending', async () => {
    const pending = deferred();
    loadEarnings.mockReturnValueOnce(pending.promise);
    await open();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.earningPreviewState).toBe('loading');
    pending.resolve(earnings());
    await flush();
    expect(page.data.earningPreviewItems).toHaveLength(1);
  });

  it.each(['pending', 'failed'])('keeps earnings navigation and retry usable when the initial lesson read is %s', async (result) => {
    const held = deferred();
    loadLessonAccount.mockReturnValueOnce(result === 'pending'
      ? held.promise : Promise.resolve({ status: 'error', statusCode: 500, message: '合成课时失败' }));
    await open();
    expect(page.data.viewState).toBe(result === 'pending' ? 'loading' : 'error');
    expect(page.data.summary).toBeNull();
    expect(page.data.earningPreviewState).toBe('ready');
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/partner/earnings/index',
    }));
    page.onEarningsRetry();
    await flush();
    expect(loadEarnings).toHaveBeenCalledTimes(2);
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    held.resolve(account);
    await flush();
  });

  it('retries only lessons after a lesson category read fails', async () => {
    await open();
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '合成筛选失败' });
    page.onEntryTypeChange({ detail: { value: '1' } });
    await flush();
    expect(page.data.refreshError).toBe('合成筛选失败');
    const rows = page.data.earningPreviewItems;
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe('');
    expect(loadLessonAccount).toHaveBeenCalledTimes(3);
    expect(loadEarnings).toHaveBeenCalledTimes(1);
    expect(page.data.earningPreviewItems).toBe(rows);
  });

  it('updates earnings during a held lesson refresh once the campus profile is ready', async () => {
    await open();
    const held = deferred();
    loadLessonAccount.mockReturnValueOnce(held.promise);
    loadEarnings.mockResolvedValueOnce(earnings([{ ...entry, id: 'new-earning' }]));
    page.onPullDownRefresh();
    await flush();
    expect(page.data.earningPreviewItems[0].id).toBe('new-earning');
    held.resolve(account);
    await flush();
  });

  it('shows earnings even if there are no lesson rows', async () => {
    loadLessonAccount.mockResolvedValueOnce({ status: 'empty', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } });
    await open();
    expect(page.data.viewState).toBe('empty');
    expect(page.data.earningPreviewItems).toHaveLength(1);
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/partner/earnings/index',
    }));
  });

  it('distinguishes an empty earning ledger from a failed read and retries only that section', async () => {
    loadEarnings.mockResolvedValueOnce({ status: 'error', message: '合成网络失败' });
    await open();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.earningPreviewState).toBe('error');
    page.onEarningsRetry();
    await flush();
    expect(page.data.earningPreviewState).toBe('ready');
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    loadEarnings.mockResolvedValueOnce(earnings([]));
    page.onEarningsRetry();
    await flush();
    expect(page.data.earningPreviewState).toBe('empty');
    expect(page.data.earningPreviewItems).toEqual([]);
  });

  it('preserves prior earnings on a normal refresh failure without pretending they are current', async () => {
    await open();
    const rows = page.data.earningPreviewItems;
    loadEarnings.mockImplementationOnce(() => { throw new Error('private network detail'); });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.earningPreviewItems).toBe(rows);
    expect(page.data.earningPreviewError).toBe('收益流水加载失败，请重试');
    expect(page.data.earningPreviewState).toBe('ready');
  });

  it('does not refetch earnings when filtering or paging lessons', async () => {
    await open();
    page.onEntryTypeChange({ detail: { value: '1' } });
    await flush();
    page.data.hasMore = true;
    page.onLoadMore();
    await flush();
    expect(loadEarnings).toHaveBeenCalledTimes(1);
    expect(loadLessonAccount).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])('clears both sections on earning %s before another account reply completes', async (statusCode) => {
    await open();
    const held = deferred();
    loadLessonAccount.mockReturnValueOnce(held.promise);
    loadEarnings.mockResolvedValueOnce({ status: 'error', statusCode, message: '合成失权' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], summary: null, earningPreviewItems: [] });
    held.resolve(account);
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.earningPreviewItems).toEqual([]);
  });

  it('does not restore an earning success after a lesson denial', async () => {
    await open();
    const held = deferred();
    loadEarnings.mockReturnValueOnce(held.promise);
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 403, message: '合成失权' });
    page.onPullDownRefresh();
    await flush();
    held.resolve(earnings());
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', earningPreviewItems: [], summary: null });
  });

  it('discards a hidden reply and refreshes earnings once on return', async () => {
    const pending = deferred();
    loadEarnings.mockReturnValueOnce(pending.promise);
    await open();
    page.onHide();
    pending.resolve(earnings());
    await flush();
    expect(page.data.earningPreviewItems).toEqual([]);
    page.onShow();
    await flush();
    expect(page.data.earningPreviewItems).toHaveLength(1);
    expect(loadEarnings).toHaveBeenCalledTimes(2);
  });

  it('clears prior earnings when the owner changes before retry', async () => {
    await open();
    ownerKey = 'synthetic-replacement';
    page.onEarningsRetry();
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', earningPreviewItems: [], summary: null });
    expect(loadEarnings).toHaveBeenCalledTimes(1);
  });

  it('clears and stops both sections on explicit logout even if navigation never succeeds', async () => {
    await open();
    page.onLogin();
    page.onRetry();
    page.onEarningsRetry();
    page.onShow();
    await flush();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ viewState: 'forbidden', earningPreviewItems: [], summary: null });
    expect(loadEarnings).toHaveBeenCalledTimes(1);
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
  });

  it('keeps the recent earnings block below balances with a distinct error and empty state', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/lesson-account/index.wxml'), 'utf8');
    expect(markup.indexOf('class="account-earning-preview"')).toBeGreaterThan(markup.indexOf('summary.giftBalanceLabel'));
    expect(markup).toContain('近期内部收益');
    expect(markup).toContain('earningPreviewError');
    expect(markup).toContain('暂无内部收益记录');
    expect(markup).toContain('bindtap="onEarningsRetry"');
    expect(markup).toContain('{{item.registeredAtLabel}}');
    expect(markup).toContain('{{item.completedAtLabel}}');
    expect(markup).toMatch(/<view wx:if="\{\{viewState === 'forbidden'\}\}"[\s\S]*?<\/view>\s*<block wx:else>/);
    expect(markup.indexOf('class="account-earning-preview"')).toBeLessThan(markup.indexOf('class="account-ledger-stage"'));
    expect(markup.indexOf('class="account-ledger-stage"')).toBeLessThan(markup.indexOf('<partner-ranking-preview'));
    expect(markup).toContain('bindchange="onSubjectChange"');
    expect(markup).toContain('aria-label="查看提现申请与记录"');
    expect(markup).toContain('bindtap="onWithdrawalTap"');
  });

  it('clears the entire account when the ranking component loses permission', async () => {
    await open();
    page.onRankingForbidden({ detail: { message: '当前账号无权查看月榜' } });
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summary: null, items: [], earningPreviewItems: [],
      errorMessage: '当前账号无权查看月榜',
    });
    expect(page.pendingRequest).toBeUndefined();
    page.onRetry();
    page.onEarningsRetry();
    page.onShow();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    expect(loadEarnings).toHaveBeenCalledTimes(1);
  });

  it('binds the ranking block to account permission and ignores hidden component events', async () => {
    await open();
    page.onHide();
    page.onRankingForbidden({ detail: { message: '旧组件失权' } });
    expect(page.data.viewState).not.toBe('forbidden');
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/lesson-account/index.wxml'), 'utf8');
    expect(markup).toMatch(/<partner-ranking-preview\b[^>]*blocked="\{\{viewState === 'forbidden'\}\}"[^>]*bindforbidden="onRankingForbidden"\s*\/>/);
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../pages/partner/lesson-account/index.json'), 'utf8'));
    expect(config.usingComponents['partner-ranking-preview']).toBe('/pages/partner/components/partner-ranking-preview/index');
  });
});
