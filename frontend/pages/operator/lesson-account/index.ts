import { OperatorPageContext } from '../runtime/operator-page-context';
import { OPERATOR_ACCOUNT_CATEGORIES, type OperatorAccountQuery, type OperatorAccountSubject } from '../runtime/types/operator-account';
import { accountTime, emptyOperatorAccount, presentOperatorAccountRow, presentOperatorAccountSummary } from '../runtime/services/operator-account.presenter';
import { navigateOperatorBack } from '../runtime/utils/operator-navigation';
import { createSessionService } from '../../../services/session.service';
import { earningTime, presentEarningSummary } from '../runtime/services/operator-earning.presenter';
import { presentOperatorRankingRow } from '../runtime/services/operator-ranking.presenter';
import { currentOperatorRankingMonth, isOperatorRankingMonth, OPERATOR_RANKING_METRICS, type OperatorRankingMetric } from '../runtime/types/operator-ranking';

const emptyOverview = () => ({
  visualSummary: null as ReturnType<typeof presentEarningSummary> | null,
  visualSummaryState: 'loading', visualSummaryError: '', visualSummaryAsOf: '',
  visualRankRows: [] as Array<ReturnType<typeof presentOperatorRankingRow>>,
  visualRankState: 'loading', visualRankError: '', toolsOpen: false,
});

Page({
  context: undefined as OperatorPageContext | undefined,
  accountRequest: undefined as { key: string; promise: Promise<void> } | undefined,
  subjectsRequest: undefined as Promise<void> | undefined,
  accountSequence: 0, subjectsSequence: 0, pullSequence: 0, loginSequence: 0,
  initialShowPending: true, hidden: false, disposed: false,
  retryReset: true, retrySummary: true,
  earningsSequence: 0,
  visualSequence: 0, visualReady: false,
  data: { ...emptyOperatorAccount(), ...emptyOverview(), visualMonth: '', visualMetric: 'PARTNER_EARNINGS' as OperatorRankingMetric,
    visualMetricIndex: 1, visualMetricOptions: OPERATOR_RANKING_METRICS,
    viewState: 'loading', categoryOptions: OPERATOR_ACCOUNT_CATEGORIES, earningsOpening: false },

  onLoad() {
    this.context = new OperatorPageContext((errorMessage) => {
      this.cancelReads();
      this.earningsSequence += 1;
      this.visualSequence += 1;
      this.setData({ ...emptyOperatorAccount(), ...emptyOverview(), viewState: 'forbidden', errorMessage, earningsOpening: false });
    });
    void this.loadAccount(true, true);
    void this.loadSubjects();
  },
  onReady() {
    if (this.disposed) return;
    this.visualReady = true;
    this.setData({ visualMonth: currentOperatorRankingMonth() });
    void this.loadVisualOverview();
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    if (this.visualReady) void this.loadVisualOverview();
    void this.loadAccount(true, true);
    void this.loadSubjects();
  },
  cancelReads() {
    this.accountSequence += 1; this.subjectsSequence += 1; this.pullSequence += 1;
    this.accountRequest = undefined; this.subjectsRequest = undefined;
  },
  onHide() {
    if (this.disposed) return;
    this.hidden = true; this.context?.hide(); this.cancelReads();
    this.initialShowPending = false; this.loginSequence += 1;
    this.earningsSequence += 1;
    this.visualSequence += 1;
    const forbidden = this.data.viewState === 'forbidden';
    const errorMessage = forbidden ? this.data.errorMessage : '';
    this.setData({ ...emptyOperatorAccount(), ...emptyOverview(), viewState: forbidden ? 'forbidden' : 'loading', errorMessage, earningsOpening: false });
  },
  onUnload() {
    if (this.disposed) return;
    this.onHide(); this.context?.dispose(); this.disposed = true;
  },
  denied(state: { status: string; statusCode?: number; message?: string }): boolean {
    if (!this.context?.isCurrent()) return true;
    if (state.statusCode !== 401 && state.statusCode !== 403) return false;
    this.context.invalidate(state.message ?? '当前账号无课时账户访问权限');
    return true;
  },
  async loadVisualOverview() {
    const context = this.context;
    if (!context?.isActive()) return;
    const sequence = ++this.visualSequence;
    const current = () => context.isActive() && sequence === this.visualSequence;
    const month = this.data.visualMonth || currentOperatorRankingMonth();
    this.setData({ ...emptyOverview(), visualMonth: month, toolsOpen: this.data.toolsOpen });
    await Promise.all([
      context.service.loadEarningSummary().then(summary => {
        if (this.denied(summary) || !current()) return;
        if (summary.status === 'success' || summary.status === 'empty') {
          this.setData({ visualSummary: presentEarningSummary(summary.data), visualSummaryState: 'ready',
            visualSummaryAsOf: earningTime(summary.data.serverTime, summary.data.timezone) });
        } else this.setData({ visualSummaryState: 'error', visualSummaryError: '收益汇总暂不可用，请重试' });
      }).catch(() => {
        if (current()) this.setData({ visualSummaryState: 'error', visualSummaryError: '收益汇总暂不可用，请重试' });
      }),
      context.service.loadRankings({ metric: this.data.visualMetric, month, page: 1, pageSize: 20 }).then(ranking => {
        if (this.denied(ranking) || !current()) return;
        if (ranking.status === 'success' || ranking.status === 'empty') {
          const unavailable = ranking.data.availability === 'UNAVAILABLE';
          this.setData({ visualRankRows: unavailable ? [] : ranking.data.data.slice(0, 6).map(presentOperatorRankingRow),
            visualRankState: unavailable ? 'unavailable' : ranking.data.data.length ? 'ready' : 'empty',
            visualRankError: unavailable ? '该月数据不足，暂无法排名' : '' });
        } else this.setData({ visualRankState: 'error', visualRankError: '月榜暂不可用，请重试' });
      }).catch(() => {
        if (current()) this.setData({ visualRankState: 'error', visualRankError: '月榜暂不可用，请重试' });
      }),
    ]);
  },
  onVisualRetry() { void this.loadVisualOverview(); },
  onOpenTools() { if (this.context?.isActive()) this.setData({ toolsOpen: true }); },
  onCloseTools() { this.setData({ toolsOpen: false }); },
  onVisualMonthChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || !isOperatorRankingMonth(event.detail.value)) return;
    this.setData({ visualMonth: String(event.detail.value) });
    void this.loadVisualOverview();
  },
  onVisualMetricChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || !/^(0|[1-9]\d*)$/.test(String(event.detail.value))) return;
    const index = Number(event.detail.value), option = OPERATOR_RANKING_METRICS[index];
    if (!option) return;
    this.setData({ visualMetric: option.value, visualMetricIndex: index });
    void this.loadVisualOverview();
  },
  onVisualRankings() {
    if (!this.context?.isActive()) return;
    wx.navigateTo({ url: `/pages/operator/rankings/index?metric=${this.data.visualMetric}&month=${this.data.visualMonth}`,
      fail: () => { if (this.context?.isActive()) wx.showToast({ title: '月榜打开失败，请重试', icon: 'none' }); } });
  },
  loadAccount(reset: boolean, updateSummary = false): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || (!reset && (!this.data.hasMore || this.accountRequest ||
      this.data.refreshError || this.data.detailState !== 'ready'))) return Promise.resolve();
    const query: OperatorAccountQuery = {
      page: reset ? 1 : this.data.page + 1, pageSize: 20,
      ...(this.data.subjectId ? { subjectId: this.data.subjectId } : {}),
      ...(this.data.entryType ? { entryType: this.data.entryType } : {}),
    };
    const key = JSON.stringify([query, updateSummary]);
    if (this.accountRequest?.key === key) return this.accountRequest.promise;
    const sequence = ++this.accountSequence;
    const current = () => context.isActive() && sequence === this.accountSequence;
    this.retryReset = reset; this.retrySummary = updateSummary;
    this.setData({
      ...(this.data.summary ? {} : { viewState: 'loading' }),
      errorMessage: '', refreshError: '', detailError: '',
      refreshing: reset && updateSummary, loadingMore: !reset,
    });
    const request = Promise.resolve().then(async () => {
      if (!current()) return;
      const state = await context.service.loadLessonAccount(query);
      if (this.denied(state)) return;
      if (!current()) return;
      if (state.status === 'error') { this.accountFailure(updateSummary); return; }
      if (state.status !== 'success' && state.status !== 'empty') return;
      const result = state.data;
      const rows = reset ? [] : this.data.rows;
      const known = new Set(rows.map(row => row.id.toLowerCase()));
      if (result.items.some(row => known.has(row.id.toLowerCase()))) {
        this.accountFailure(false, '流水已更新，请刷新明细'); return;
      }
      const next = [...rows, ...result.items.map(row => presentOperatorAccountRow(row, result.timezone))];
      this.setData({
        ...(updateSummary || !this.data.summary ? {
          summary: presentOperatorAccountSummary(result),
          summaryAsOfLabel: accountTime(result.serverTime, result.timezone), timezone: result.timezone,
        } : {}),
        rows: next, viewState: 'ready', detailState: next.length ? 'ready' : 'empty',
        page: result.meta.page, total: result.meta.total, hasMore: result.meta.page < result.meta.totalPages,
        detailAsOfLabel: accountTime(result.serverTime, result.timezone),
        loadingMore: false, refreshing: false, detailError: '', refreshError: '', errorMessage: '',
      });
    }).catch(() => {
      if (current()) this.accountFailure(updateSummary);
    }).finally(() => { if (this.accountRequest?.promise === request) this.accountRequest = undefined; });
    this.accountRequest = { key, promise: request };
    return request;
  },
  accountFailure(summary: boolean, message = '课时账户加载失败，请重试') {
    this.setData({
      loadingMore: false, refreshing: false,
      ...(!this.data.summary ? { viewState: 'error', errorMessage: message } :
        summary ? { refreshError: message } :
          { detailError: message, detailState: this.data.rows.length ? 'ready' : 'error' }),
    });
  },
  loadSubjects(): Promise<void> {
    const context = this.context;
    if (!context?.isActive()) return Promise.resolve();
    if (this.subjectsRequest) return this.subjectsRequest;
    const sequence = ++this.subjectsSequence;
    const current = () => context.isActive() && sequence === this.subjectsSequence;
    this.setData({ subjectsState: 'loading', subjectsError: '' });
    const request = Promise.resolve().then(async () => {
      const records: OperatorAccountSubject[] = [];
      const known = new Set<string>();
      let page = 1, total: number | undefined, totalPages: number | undefined;
      while (current()) {
        const state = await context.service.loadAccountSubjects({ page, pageSize: 100 });
        if (this.denied(state)) return;
        if (!current()) return;
        if (state.status === 'error') throw new Error('directory unavailable');
        if (state.status !== 'success' && state.status !== 'empty') return;
        const result = state.data;
        if (total !== undefined && (total !== result.meta.total || totalPages !== result.meta.totalPages)) {
          throw new Error('directory changed');
        }
        total = result.meta.total; totalPages = result.meta.totalPages;
        for (const item of result.data) {
          if (known.has(item.id.toLowerCase())) throw new Error('duplicate directory id');
          known.add(item.id.toLowerCase()); records.push(item);
        }
        if (page >= result.meta.totalPages) break;
        page += 1;
      }
      if (!current()) return;
      const subjectOptions = [
        { value: '', label: '全部科目' }, { value: 'UNCLASSIFIED', label: '未归类' },
        ...records.map(item => ({ value: item.id, label: `${item.name}${item.isActive ? '' : '（已归档）'}` })),
      ];
      const subjectIndex = subjectOptions.findIndex(item => item.value === this.data.subjectId);
      // Preserve an active historical filter when a refreshed directory no longer contains it.
      if (subjectIndex < 0) subjectOptions.push({ value: this.data.subjectId, label: this.data.subjectLabel });
      this.setData({ subjectsState: 'ready', subjectsError: '', subjectOptions,
        subjectIndex: subjectIndex < 0 ? subjectOptions.length - 1 : subjectIndex });
    }).catch(() => {
      if (current()) this.setData({ subjectsState: 'error', subjectsError: '科目加载失败，请重试' });
    }).finally(() => { if (this.subjectsRequest === request) this.subjectsRequest = undefined; });
    this.subjectsRequest = request;
    return request;
  },
  changeDetail() {
    this.accountSequence += 1; this.accountRequest = undefined; this.pullSequence += 1;
    this.setData({ rows: [], page: 0, total: 0, hasMore: false, detailState: 'loading',
      detailError: '', refreshError: '', detailAsOfLabel: '', loadingMore: false, refreshing: false });
    void this.loadAccount(true);
  },
  onSubjectChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || this.data.viewState !== 'ready' || this.data.subjectsState !== 'ready') return;
    const value = event.detail.value;
    if (!/^(0|[1-9]\d*)$/.test(String(value))) return;
    const index = Number(value), option = this.data.subjectOptions[index];
    if (!option || option.value === this.data.subjectId) return;
    this.setData({ subjectId: option.value, subjectLabel: option.label, subjectIndex: index });
    this.changeDetail();
  },
  onCategoryChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || this.data.viewState !== 'ready') return;
    const value = event.detail.value;
    if (!/^(0|[1-9]\d*)$/.test(String(value))) return;
    const index = Number(value), option = OPERATOR_ACCOUNT_CATEGORIES[index];
    if (!option || option.value === this.data.entryType) return;
    this.setData({ entryType: option.value, categoryLabel: option.label, categoryIndex: index });
    this.changeDetail();
  },
  onRefresh() { void this.loadAccount(true, true); if (this.visualReady) void this.loadVisualOverview(); },
  onRetry() { void this.loadAccount(true, true); },
  onRetrySubjects() { void this.loadSubjects(); },
  onRetryDetail() { void this.loadAccount(this.retryReset, this.retrySummary); },
  onLoadMore() { void this.loadAccount(false); },
  onReachBottom() { if (!this.data.detailError) void this.loadAccount(false); },
  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void Promise.all([this.loadAccount(true, true), this.loadSubjects(), ...(this.visualReady ? [this.loadVisualOverview()] : [])]).finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },
  onEarnings() {
    if (!this.context?.isActive() || this.data.viewState !== 'ready' || this.data.earningsOpening) return;
    const sequence = ++this.earningsSequence;
    this.setData({ earningsOpening: true });
    wx.navigateTo({ url: '/pages/operator/earnings/index', fail: () => {
      if (sequence !== this.earningsSequence || !this.context?.isActive()) return;
      this.setData({ earningsOpening: false });
      wx.showToast({ title: '内部收益打开失败，请重试', icon: 'none' });
    } });
  },
  onBack() { if (!this.hidden && !this.disposed) navigateOperatorBack(wx, getCurrentPages().length); },
  onLogin() {
    if (!this.context || this.hidden || this.disposed) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate('请重新登录');
    const sequence = ++this.loginSequence;
    wx.reLaunch({ url: '/pages/bootstrap/index', fail: () => {
      if (!this.hidden && !this.disposed && sequence === this.loginSequence) {
        this.setData({ errorMessage: '登录页打开失败，请重试' });
      }
    } });
  },
});
