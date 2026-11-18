import * as fs from 'fs';
import * as path from 'path';
import { PARTNER_LESSON_ACCOUNT_FIXTURE, PARTNER_PROFILE_FIXTURE } from '../mock/fixtures/partner.fixture';

const loadProfile = jest.fn();
const loadLessonAccount = jest.fn();
const logout = jest.fn();
let ownerKey = 'synthetic-lesson-owner';
jest.mock('../services/partner-runtime', () => ({
  createPartnerService: () => ({
    loadProfile: () => loadProfile(),
    loadEarnings: async () => ({ status: 'empty', data: { data: [], meta: { total: 0 } } }),
  }),
  partnerService: {
    loadProfile: () => loadProfile(),
    loadLessonAccount: (query: object) => loadLessonAccount(query),
  },
}));
jest.mock('../pages/partner/runtime/partner-lesson-runtime', () => ({
  PARTNER_LESSON_FILTERS: [
    { value: '', label: '全部类别' }, { value: 'GRANT', label: '课时发放' },
    { value: 'CONSUME', label: '完成扣课' }, { value: 'REVERSAL', label: '撤销返还' },
    { value: 'ADJUSTMENT', label: '课时调整' }, { value: 'REFUND', label: '退课扣回' },
    { value: 'CORRECTION', label: '收款纠错冲正' },
  ],
  createPartnerLessonService: () => ({ loadLessonAccount: (query: object) => loadLessonAccount(query) }),
  partnerLessonService: { loadLessonAccount: (query: object) => loadLessonAccount(query) },
}));
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
jest.mock('../services/session.service', () => ({
  createSessionService: () => ({ logout: () => logout() }),
  sessionService: { logout: () => logout() },
}));

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { resolve, promise };
}

describe('partner lesson account lifecycle', () => {
  let page: any;
  let definition: any;
  const success = { status: 'success', data: PARTNER_LESSON_ACCOUNT_FIXTURE };
  const instantiate = (config: any) => {
    const instance = { ...config, data: { ...config.data } };
    instance.setData = (values: object) => Object.assign(instance.data, values);
    return instance;
  };
  const flush = async () => {
    for (let index = 0; index < 16; index += 1) await Promise.resolve();
  };
  const open = async () => { page.onLoad(); page.onShow?.(); await flush(); };

  beforeEach(() => {
    ownerKey = 'synthetic-lesson-owner';
    loadProfile.mockReset().mockResolvedValue({ status: 'success', data: PARTNER_PROFILE_FIXTURE });
    loadLessonAccount.mockReset().mockResolvedValue(success);
    logout.mockReset();
    (global as any).wx = {
      stopPullDownRefresh: jest.fn(), reLaunch: jest.fn(),
      navigateTo: jest.fn(), showToast: jest.fn(),
    };
    (global as any).Page = (config: any) => { definition = config; page = instantiate(config); };
    jest.isolateModules(() => require('../pages/partner/lesson-account/index'));
  });
  afterEach(() => {
    page.onUnload?.();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it.each([
    { paymentContext: { receivedOn: '2026-10-01' }, expected: '缴费日期 2026年10月1日' },
    { paymentContext: { paidAt: '2026-10-01T02:00:00Z' }, expected: '缴费时间 2026年9月30日 22:00' },
    { paymentContext: null, expected: '缴费日期待核对' },
    { paymentContext: undefined, expected: '缴费日期待核对' },
  ])('keeps payment context distinct from registration and lesson time: $expected', async ({ paymentContext, expected }) => {
    loadProfile.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, timezone: 'America/New_York' },
    } });
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      items: [{ ...PARTNER_LESSON_ACCOUNT_FIXTURE.items[0], paymentContext }],
    } });
    await open();
    expect(page.data.items[0].paymentLabel).toBe(expected);
    expect(page.data.items[0].timeLabel).toBe('8月31日 03:30');
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 403, message: '合成失权' });
    await page.loadLessonAccount(true);
    expect(page.data.items).toEqual([]);
  });

  it('places earning navigation below both balance cards and above the ledger to avoid the hero character', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/lesson-account/index.wxml'), 'utf8');
    const link = markup.indexOf('bindtap="onEarningsTap"');
    expect(link).toBeGreaterThan(markup.indexOf('summary.giftBalanceLabel'));
    expect(link).toBeLessThan(markup.indexOf('class="account-ledger-stage"'));
    expect(markup).toContain('bindtap="onEarningsTap"');
    expect(markup).toContain('aria-label="查看内部收益明细"');
  });

  it.each(['ready', 'empty'])('opens existing earning details from a %s account without rereading it', async (state) => {
    await open();
    page.data.viewState = state;
    const items = page.data.items;
    page.onEarningsTap();
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/partner/earnings/index',
    }));
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    expect(page.data.items).toBe(items);
    expect(logout).not.toHaveBeenCalled();
  });

  it.each(['loading', 'error', 'forbidden'])('does not open earning details from %s', (state) => {
    page.data.viewState = state;
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it.each(['onHide', 'onUnload'])('ignores earning navigation after %s', async (method) => {
    await open();
    page[method]();
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it.each(['callback', 'throw'])('keeps the account and permits retry after navigation %s failure', async (mode) => {
    await open();
    const items = page.data.items;
    if (mode === 'throw') {
      (global as any).wx.navigateTo.mockImplementationOnce(() => { throw new Error('private native error'); });
    }
    page.onEarningsTap();
    if (mode === 'callback') (global as any).wx.navigateTo.mock.calls[0][0].fail();
    expect((global as any).wx.showToast).toHaveBeenCalledWith({
      title: '页面打开失败，请重试', icon: 'none',
    });
    expect(page.data.items).toBe(items);
    expect(page.data.viewState).toBe('ready');
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });

  it('refreshes on return and isolates late navigation failure from the new navigation lock', async () => {
    await open();
    page.onEarningsTap();
    const oldFail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page.onHide();
    oldFail();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    page.onShow();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(2);
    page.onEarningsTap();
    oldFail();
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    (global as any).wx.navigateTo.mock.calls[1][0].fail();
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(3);
  });

  it('keeps navigation locks local to each page instance', async () => {
    await open();
    page.onEarningsTap();
    const other = instantiate(definition);
    other.onLoad(); other.onShow();
    await flush();
    other.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
    other.onUnload();
  });

  it.each([401, 403])('does not restore content or show stale navigation errors after %i', async (statusCode) => {
    await open();
    page.onEarningsTap();
    const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    loadLessonAccount.mockResolvedValueOnce({
      status: 'error', statusCode, message: '受保护读取已失效',
    });
    page.onRetry();
    await flush();
    fail();
    page.onEarningsTap();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.items).toEqual([]);
    expect(page.data.summary).toBeNull();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it('permits reading earning details while a normal account refresh error retains content', async () => {
    await open();
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '刷新失败' });
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe('刷新失败');
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });

  it('deduplicates initial load/show and simultaneous refreshes', async () => {
    const pending = deferred();
    loadLessonAccount.mockReturnValueOnce(pending.promise);
    await open();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    pending.resolve(success);
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(2);
  });

  it('loads one next page for repeated ledger-bottom events without rereading profile', async () => {
    page.data.entryType = 'CONSUME';
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      meta: { page: 1, pageSize: 20, total: 40, totalPages: 2 },
    } });
    await open();
    const next = deferred();
    loadLessonAccount.mockReturnValueOnce(next.promise);
    page.onLedgerReachBottom();
    page.onLedgerReachBottom();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(2);
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, entryType: 'CONSUME' });
    expect(loadProfile).toHaveBeenCalledTimes(1);
    next.resolve({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      meta: { page: 2, pageSize: 20, total: 40, totalPages: 2 },
    } });
    await flush();
    page.onLedgerReachBottom();
    await flush();
    expect(page.data.page).toBe(2);
    expect(loadLessonAccount).toHaveBeenCalledTimes(2);
  });

  it('does not automatically retry a failed next page but retains manual retry of that page', async () => {
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      meta: { page: 1, pageSize: 20, total: 40, totalPages: 2 },
    } });
    await open();
    const items = page.data.items;
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '分页失败' });
    page.onLedgerReachBottom();
    await flush();
    expect(page.data.pageError).toBe('分页失败');
    expect(page.data.items).toBe(items);
    page.onLedgerReachBottom();
    page.onLedgerReachBottom();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(2);
    const next = deferred();
    loadLessonAccount.mockReturnValueOnce(next.promise);
    page.onLoadMore();
    await flush();
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 2, pageSize: 20 });
    expect(loadLessonAccount).toHaveBeenCalledTimes(3);
    page.onLedgerReachBottom();
    page.onLedgerReachBottom();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(3);
    next.resolve({ status: 'error', statusCode: 500, message: '再次分页失败' });
    await flush();
    page.onLedgerReachBottom();
    page.onLedgerReachBottom();
    await flush();
    expect(page.data.pageError).toBe('再次分页失败');
    expect(loadLessonAccount).toHaveBeenCalledTimes(3);
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      meta: { page: 2, pageSize: 20, total: 40, totalPages: 2 },
    } });
    page.onLoadMore();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(4);
    expect(page.data.pageError).toBe('');
    expect(page.data.page).toBe(2);
  });

  it.each(['filter', 'refresh'])('isolates old automatic pagination from an in-flight %s and subsequent bottom events', async (action) => {
    const first = { status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      meta: { page: 1, pageSize: 20, total: 40, totalPages: 2 },
    } };
    loadLessonAccount.mockResolvedValueOnce(first);
    page.data.entryType = 'CONSUME';
    page.data.entryTypeIndex = 2;
    await open();
    const old = deferred();
    loadLessonAccount.mockReturnValueOnce(old.promise);
    page.onLedgerReachBottom();
    await flush();
    const current = deferred();
    loadLessonAccount.mockReturnValueOnce(current.promise);
    if (action === 'filter') page.onEntryTypeChange({ detail: { value: '5' } });
    else page.onRetry();
    await flush();
    const active = page.pendingRequest;
    const entryType = action === 'filter' ? 'REFUND' : 'CONSUME';
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, entryType });
    page.onLedgerReachBottom();
    old.resolve({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      items: [{ ...PARTNER_LESSON_ACCOUNT_FIXTURE.items[0], id: 'obsolete-next-page' }],
      meta: { page: 2, pageSize: 20, total: 40, totalPages: 2 },
    } });
    await flush();
    expect(page.pendingRequest).toBe(active);
    expect(page.pendingPage).toBe(1);
    expect(page.data.items.some((item: { id: string }) => item.id === 'obsolete-next-page')).toBe(false);
    expect(loadLessonAccount).toHaveBeenCalledTimes(3);
    current.resolve(first);
    await flush();
    const next = deferred();
    loadLessonAccount.mockReturnValueOnce(next.promise);
    page.onLedgerReachBottom();
    page.onLedgerReachBottom();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(4);
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, entryType });
    expect(loadProfile).toHaveBeenCalledTimes(2);
    next.resolve({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      meta: { page: 2, pageSize: 20, total: 40, totalPages: 2 },
    } });
    await flush();
    expect(page.data.pageError).toBe('');
    expect(page.data.page).toBe(2);
  });

  it.each([
    { viewState: 'loading' }, { viewState: 'empty' }, { viewState: 'forbidden' },
    { viewState: 'error' }, { refreshError: '刷新失败' }, { ledgerLoading: true },
    { loadingMore: true }, { hasMore: false },
  ])('ignores ledger-bottom events in blocked state %j', async (blocked) => {
    await open();
    Object.assign(page.data, { hasMore: true }, blocked);
    page.onLedgerReachBottom();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
  });

  it.each(['onHide', 'onUnload'])('ignores ledger-bottom events after %s', async (method) => {
    await open();
    page.data.hasMore = true;
    page[method]();
    page.onLedgerReachBottom();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
  });

  it('shows linked course and lesson teacher without replacing ledger time or balance', async () => {
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      items: [{
        ...PARTNER_LESSON_ACCOUNT_FIXTURE.items[0],
        teachingContext: {
          courseName: '课程名称很长也需要完整显示的硬笔书法课程',
          teacherName: '课次授课教师',
          lessonStartsAt: '2026-10-01T02:00:00Z',
        },
      }],
    } });
    await open();
    expect(page.data.items[0].teachingLabel).toBe('课程名称很长也需要完整显示的硬笔书法课程 · 课次授课教师');
    expect(page.data.items[0].lessonTimeLabel).toBe('授课时间 10月1日 10:00');
    expect(page.data.items[0].timeLabel).toBe('8月31日 15:30');
    expect(page.data.summary.totalBalanceLabel).toBe('49');
  });

  it.each([null, undefined])('shows unknown linkage for %s context without guessing package names', async (teachingContext) => {
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE,
      items: [{ ...PARTNER_LESSON_ACCOUNT_FIXTURE.items[0], teachingContext }],
    } });
    await open();
    expect(page.data.items[0].teachingLabel).toBe('未关联授课信息');
    expect(page.data.items[0].lessonTimeLabel).toBe('');
  });

  it('formats linked lesson and ledger times in the current campus timezone across days', async () => {
    loadProfile.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_PROFILE_FIXTURE,
      campus: { ...PARTNER_PROFILE_FIXTURE.campus, timezone: 'America/New_York' },
    } });
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, items: [{
        ...PARTNER_LESSON_ACCOUNT_FIXTURE.items[0],
        teachingContext: { courseName: '硬笔书法', teacherName: '李老师', lessonStartsAt: '2026-10-01T02:00:00Z' },
      }],
    } });
    await open();
    expect(page.data.items[0].lessonTimeLabel).toBe('授课时间 9月30日 22:00');
    expect(page.data.items[0].timeLabel).toBe('8月31日 03:30');
  });

  it('preserves teaching labels on paging and replaces the linkage for repeated ledger IDs', async () => {
    const first = PARTNER_LESSON_ACCOUNT_FIXTURE.items[0];
    const context = { courseName: '硬笔书法', teacherName: '原授课教师', lessonStartsAt: '2026-10-01T02:00:00Z' };
    const meta = { page: 1, pageSize: 20, total: 21, totalPages: 2 };
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, items: [{
        ...first, teachingContext: context, paymentContext: { receivedOn: '2026-09-01' },
      }], meta,
    } });
    page.data.entryType = 'CONSUME';
    await open();
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, items: [
        { ...first, teachingContext: { ...context, teacherName: '已更名授课教师' },
          paymentContext: { receivedOn: '2026-09-02' } },
        { ...PARTNER_LESSON_ACCOUNT_FIXTURE.items[1], teachingContext: null },
      ], meta: { ...meta, page: 2 },
    } });
    page.onLoadMore();
    await flush();
    expect(page.data.items).toHaveLength(2);
    expect(page.data.items[0].teachingLabel).toBe('硬笔书法 · 已更名授课教师');
    expect(page.data.items[0].lessonTimeLabel).toBe('授课时间 10月1日 10:00');
    expect(page.data.items[0].paymentLabel).toBe('缴费日期 2026年9月2日');
    expect(page.data.items[1].teachingLabel).toBe('未关联授课信息');
    expect(page.data.items[1].paymentLabel).toBe('缴费日期待核对');
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, entryType: 'CONSUME' });
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it('resets ledger paging and discards old-category content when the filter changes', async () => {
    await open();
    const next = deferred();
    loadLessonAccount.mockReturnValueOnce(next.promise);
    page.onEntryTypeChange({ detail: { value: '5' } });
    await flush();
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, entryType: 'REFUND' });
    expect(page.data.items).toEqual([]);
    expect(page.data.total).toBe(0);
    expect(page.data.summary).not.toBeNull();
    next.resolve({ status: 'empty', data: { ...PARTNER_LESSON_ACCOUNT_FIXTURE, items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } });
    await flush();
    expect(page.data.viewState).toBe('empty');
    expect(page.data.entryType).toBe('REFUND');
  });

  it('does not let an old category response overwrite a newer filter', async () => {
    await open();
    const old = deferred();
    loadLessonAccount.mockReturnValueOnce(old.promise);
    page.onEntryTypeChange({ detail: { value: '1' } });
    await flush();
    page.onEntryTypeChange({ detail: { value: '2' } });
    await flush();
    old.resolve({ status: 'empty', data: { ...PARTNER_LESSON_ACCOUNT_FIXTURE, items: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } } });
    await flush();
    expect(page.data.entryType).toBe('CONSUME');
    expect(page.data.items).toHaveLength(PARTNER_LESSON_ACCOUNT_FIXTURE.items.length);
  });

  it.each([
    { source: 'profile', code: 401 }, { source: 'profile', code: 403 },
    { source: 'ledger', code: 401 }, { source: 'ledger', code: 403 },
  ])('ignores late rejected $source HTTP $code without clearing a newer category or its request lock', async ({ source, code }) => {
    await open();
    let reject!: (value: unknown) => void;
    const reader = source === 'profile' ? loadProfile : loadLessonAccount;
    reader.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const old = page.loadLessonAccount(true);
    await flush();
    const next = deferred();
    loadLessonAccount.mockReturnValueOnce(next.promise);
    page.onEntryTypeChange({ detail: { value: '2' } });
    await flush();
    const active = page.pendingRequest;
    const calls = loadLessonAccount.mock.calls.length;
    reject(Object.assign(new Error('old request denied'), { statusCode: code }));
    await old;
    expect(page.pendingRequest).toBe(active);
    expect(page.data).toMatchObject({
      entryType: 'CONSUME', viewState: 'ready', ledgerLoading: true, refreshError: '', pageError: '',
    });
    expect(page.data.summary).not.toBeNull();
    page.onRetry();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(calls);
    next.resolve(success);
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.items.length).toBeGreaterThan(0);
    expect(page.data.ledgerLoading).toBe(false);
    expect(page.pendingRequest).toBeUndefined();
  });

  it.each(['onHide', 'onUnload'])('ignores category events after %s', async (method) => {
    await open();
    page[method]();
    const calls = loadLessonAccount.mock.calls.length;
    page.onEntryTypeChange({ detail: { value: '1' } });
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(calls);
  });

  it.each(['-1', '1.5', '100', 'invalid'])('ignores invalid category index %s', async (value) => {
    await open();
    page.onEntryTypeChange({ detail: { value } });
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
  });

  it('keeps the selected category when paginating and does not reload for the same selection', async () => {
    await open();
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
    } });
    page.onEntryTypeChange({ detail: { value: '2' } });
    await flush();
    page.onEntryTypeChange({ detail: { value: '2' } });
    page.onLoadMore();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(3);
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, entryType: 'CONSUME' });
  });

  it('keeps new-category rows cleared after a failed filter and retries that category', async () => {
    await open();
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '合成筛选读取失败' });
    page.onEntryTypeChange({ detail: { value: '3' } });
    await flush();
    expect(page.data.items).toEqual([]);
    expect(page.data.ledgerLoading).toBe(false);
    expect(page.data.refreshError).toBe('合成筛选读取失败');
    page.onRetry();
    await flush();
    expect(loadLessonAccount).toHaveBeenLastCalledWith({ page: 1, pageSize: 20, entryType: 'REVERSAL' });
  });

  it('does not claim an empty category after failure and shows loading until its retry succeeds', async () => {
    await open();
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '合成读取失败' });
    page.onEntryTypeChange({ detail: { value: '5' } });
    await flush();
    expect(page.data.viewState).not.toBe('empty');
    expect(page.data.refreshError).toBe('合成读取失败');
    const retry = deferred();
    loadLessonAccount.mockReturnValueOnce(retry.promise);
    page.onRetry();
    await flush();
    expect(page.data.ledgerLoading).toBe(true);
    expect(page.data.viewState).not.toBe('empty');
    retry.resolve({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    } });
    await flush();
    expect(page.data.viewState).toBe('empty');
    expect(page.data.ledgerLoading).toBe(false);
    expect(page.data.refreshError).toBe('');
  });

  it('keeps rows and summary on refresh failure, then retries page one', async () => {
    await open();
    const rows = page.data.items;
    const summary = page.data.summary;
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '暂时不可用' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.items).toEqual(rows);
    expect(page.data.summary).toEqual(summary);
    expect(page.data.refreshError).toBe('暂时不可用');
    page.onRetry();
    await flush();
    expect(loadLessonAccount.mock.calls[loadLessonAccount.mock.calls.length - 1][0].page).toBe(1);
    expect(page.data.refreshError).toBe('');
  });

  it('retries failed pagination without discarding rows or rereading profile', async () => {
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
    } });
    await open();
    const rows = page.data.items;
    const pending = deferred();
    loadLessonAccount.mockReturnValueOnce(pending.promise);
    page.onLoadMore();
    page.onLoadMore();
    await flush();
    expect(loadLessonAccount).toHaveBeenCalledTimes(2);
    pending.resolve({ status: 'error', statusCode: 500, message: '下一页失败' });
    await flush();
    expect(page.data.items).toEqual(rows);
    expect(page.data.pageError).toBe('下一页失败');
    page.onLoadMore();
    await flush();
    expect(loadLessonAccount.mock.calls[loadLessonAccount.mock.calls.length - 1][0].page).toBe(2);
    expect(loadProfile).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])('clears cached rows and summary on HTTP %s', async (statusCode) => {
    await open();
    loadLessonAccount.mockResolvedValueOnce({ status: 'error', statusCode, message: '权限失效' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.items).toEqual([]);
    expect(page.data.summary).toBeNull();
    expect(page.data.hasMore).toBe(false);
  });

  it.each([
    { source: 'profile', code: 401 }, { source: 'profile', code: 403 },
    { source: 'ledger', code: 401 }, { source: 'ledger', code: 403 },
  ])('clears cached lesson data on rejected $source HTTP $code rather than keeping a refresh error', async ({ source, code }) => {
    await open();
    const reader = source === 'profile' ? loadProfile : loadLessonAccount;
    const other = source === 'profile' ? loadLessonAccount : loadProfile;
    other.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '暂时不可用' });
    reader.mockRejectedValueOnce(Object.assign(new Error('request denied'), { statusCode: code }));
    await page.loadLessonAccount(true);
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summary: null, items: [], page: 0, total: 0,
      hasMore: false, loadingMore: false, ledgerLoading: false, refreshError: '', pageError: '',
    });
    expect(logout).not.toHaveBeenCalled();
  });

  it.each([401, 403])('clears cached lesson data on synchronous HTTP %s during pagination', async (code) => {
    loadLessonAccount.mockResolvedValueOnce({ status: 'success', data: {
      ...PARTNER_LESSON_ACCOUNT_FIXTURE, meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 },
    } });
    await open();
    loadLessonAccount.mockImplementationOnce(() => {
      throw Object.assign(new Error('request denied'), { statusCode: code });
    });
    await page.loadLessonAccount(false);
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summary: null, items: [], page: 0,
      hasMore: false, loadingMore: false, ledgerLoading: false, refreshError: '', pageError: '',
    });
  });

  it('does not show ledger data when identity loading fails', async () => {
    loadProfile.mockResolvedValueOnce({ status: 'error', statusCode: 403, message: '身份不可用' });
    await open();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.items).toEqual([]);
    expect(page.data.summary).toBeNull();
  });

  it('ignores hidden responses and refreshes on return', async () => {
    const pending = deferred();
    loadLessonAccount.mockReturnValueOnce(pending.promise);
    await open();
    page.onHide();
    pending.resolve(success);
    await flush();
    expect(page.data.items).toEqual([]);
    page.onShow();
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(loadLessonAccount).toHaveBeenCalledTimes(2);
  });

  it('isolates concurrent page instances', async () => {
    const first = deferred();
    loadLessonAccount.mockReturnValueOnce(first.promise);
    await open();
    const firstPage = page;
    page = instantiate(definition);
    await open();
    first.resolve(success);
    await flush();
    expect(firstPage.data.viewState).toBe('ready');
    expect(page.data.viewState).toBe('ready');
  });

  it('handles rejected requests and permits retry', async () => {
    loadLessonAccount.mockRejectedValueOnce(new Error('offline'));
    await open();
    expect(page.data.viewState).toBe('error');
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe('ready');
  });

  it('returns to the real login entry explicitly', () => {
    page.onLogin();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it.each(['account', 'address', 'driver'])('clears private account data on return after a %s change', async (change) => {
    await open();
    ownerKey = `synthetic-changed-${change}`;
    const calls = loadLessonAccount.mock.calls.length;
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summary: null, items: [], page: 0, total: 0,
      hasMore: false, loadingMore: false, ledgerLoading: false, refreshError: '', pageError: '',
      errorMessage: '登录已更新，请重新登录',
    });
    expect(page.pendingRequest).toBeUndefined();
    expect(page.pendingPage).toBe(0);
    expect(loadLessonAccount).toHaveBeenCalledTimes(calls);
    const fresh = instantiate(definition);
    fresh.onLoad(); fresh.onShow();
    await flush();
    expect(fresh.data.viewState).toBe('ready');
    fresh.onUnload();
  });

  it.each(['retry', 'filter', 'more', 'bottom', 'earnings'])('checks the current owner before %s without a lifecycle event', async (action) => {
    await open();
    page.data.hasMore = true;
    ownerKey = 'synthetic-replacement-owner';
    if (action === 'retry') page.onRetry();
    if (action === 'filter') page.onEntryTypeChange({ detail: { value: '2' } });
    if (action === 'more') page.onLoadMore();
    if (action === 'bottom') {
      page.data.pageError = '分页失败';
      page.onLedgerReachBottom();
    }
    if (action === 'earnings') page.onEarningsTap();
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.summary).toBeNull();
    expect(page.data.items).toEqual([]);
    expect(loadProfile).toHaveBeenCalledTimes(1);
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it.each([0, 1])('cancels queued readers when the owner changes after %i queued stages', async (stage) => {
    page.onLoad();
    if (stage === 1) await Promise.resolve();
    ownerKey = 'synthetic-replacement-owner';
    await flush();
    expect(loadProfile).not.toHaveBeenCalled();
    expect(loadLessonAccount).not.toHaveBeenCalled();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.pendingRequest).toBeUndefined();
  });

  it.each(['profile', 'ledger'])('discards a late successful %s reply after the owner changes', async (source) => {
    await open();
    const pending = deferred();
    const reader = source === 'profile' ? loadProfile : loadLessonAccount;
    reader.mockReturnValueOnce(pending.promise);
    const reading = page.loadLessonAccount(true);
    await flush();
    ownerKey = 'synthetic-replacement-owner';
    pending.resolve(source === 'profile'
      ? { status: 'success', data: PARTNER_PROFILE_FIXTURE } : success);
    await reading;
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.summary).toBeNull();
    expect(page.data.items).toEqual([]);
    expect(page.pendingRequest).toBeUndefined();
  });

  it('clears old account data instead of showing a navigation failure after identity replacement', async () => {
    await open();
    page.onEarningsTap();
    ownerKey = 'synthetic-replacement-owner';
    (global as any).wx.navigateTo.mock.calls[0][0].fail();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.summary).toBeNull();
    expect(page.data.items).toEqual([]);
    expect(page.navigating).toBe(false);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it.each([
    { source: 'profile', code: 401 }, { source: 'profile', code: 403 },
    { source: 'ledger', code: 401 }, { source: 'ledger', code: 403 },
  ])('clears private data as soon as $source HTTP $code arrives while the sibling remains pending', async ({ source, code }) => {
    await open();
    const sibling = deferred();
    const denied = source === 'profile' ? loadProfile : loadLessonAccount;
    const other = source === 'profile' ? loadLessonAccount : loadProfile;
    denied.mockResolvedValueOnce({ status: 'error', statusCode: code, message: '受权读取拒绝' });
    other.mockReturnValueOnce(sibling.promise);
    const reading = page.loadLessonAccount(true);
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summary: null, items: [], page: 0, total: 0,
      hasMore: false, loadingMore: false, ledgerLoading: false,
    });
    expect(page.pendingRequest).toBeUndefined();
    page.onEarningsTap();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    const writes = { ...page.data };
    sibling.resolve(source === 'profile' ? success : { status: 'success', data: PARTNER_PROFILE_FIXTURE });
    await reading;
    expect(page.data).toEqual(writes);
  });

  it.each(['onHide', 'onUnload'])('does not start queued reads after immediate %s', async (method) => {
    page.onLoad();
    page[method]();
    await flush();
    expect(loadProfile).not.toHaveBeenCalled();
    expect(loadLessonAccount).not.toHaveBeenCalled();
    expect(page.pendingRequest).toBeUndefined();
  });

  it('only starts the current queued refresh after a hide/show cycle', async () => {
    page.onLoad();
    page.onHide();
    page.onShow();
    await flush();
    expect(loadProfile).toHaveBeenCalledTimes(1);
    expect(loadLessonAccount).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe('ready');
  });

  it.each(['onHide', 'onUnload'])('does not start readers when %s occurs between queued stages', async (method) => {
    page.onLoad();
    await Promise.resolve();
    page[method]();
    await flush();
    expect(loadProfile).not.toHaveBeenCalled();
    expect(loadLessonAccount).not.toHaveBeenCalled();
  });

  it.each(['profile', 'ledger'])('handles a synchronous %s reader exception and permits retry', async (source) => {
    const reader = source === 'profile' ? loadProfile : loadLessonAccount;
    reader.mockImplementationOnce(() => { throw new Error('offline'); });
    page.onLoad(); page.onShow();
    await expect(page.pendingRequest).resolves.toBeUndefined();
    expect(page.data.viewState).toBe('error');
    expect(page.data.errorMessage).toBe('课时流水加载失败，请重试');
    expect(page.pendingRequest).toBeUndefined();
    await page.loadLessonAccount(true);
    expect(page.data.viewState).toBe('ready');
  });
});
