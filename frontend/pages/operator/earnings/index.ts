import { OperatorPageContext } from '../runtime/operator-page-context';
import { OPERATOR_EARNING_STATUSES, OPERATOR_EARNING_TYPES, type OperatorEarningQuery } from '../runtime/types/operator-earning';
import { earningTime, emptyEarnings, presentEarningRow, presentEarningSummary } from '../runtime/services/operator-earning.presenter';
import { navigateOperatorBack } from '../runtime/utils/operator-navigation';
import { createSessionService } from '../../../services/session.service';

Page({
  context: undefined as OperatorPageContext | undefined,
  summaryRequest: undefined as Promise<void> | undefined,
  detailRequest: undefined as { key: string; promise: Promise<void> } | undefined,
  summarySequence: 0, detailSequence: 0, loginSequence: 0, pullRefreshing: false,
  initialShowPending: true, hidden: false, disposed: false, retryReset: true,
  data: { ...emptyEarnings(), viewState: 'ready',
    statusOptions: OPERATOR_EARNING_STATUSES, typeOptions: OPERATOR_EARNING_TYPES },
  onLoad() {
    this.context = new OperatorPageContext(errorMessage => {
      this.cancelReads();
      this.stopPullRefresh();
      this.setData({ ...emptyEarnings(), viewState: 'forbidden', errorMessage });
    });
    void this.loadSummary(); void this.loadEntries(true);
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.reload();
  },
  cancelReads() {
    this.summarySequence += 1; this.detailSequence += 1;
    this.summaryRequest = undefined; this.detailRequest = undefined;
  },
  onHide() {
    if (this.disposed) return;
    this.hidden = true; this.context?.hide(); this.cancelReads();
    this.stopPullRefresh();
    this.initialShowPending = false; this.loginSequence += 1;
    const { status, statusIndex, statusLabel, entryType, typeIndex, typeLabel } = this.data;
    const forbidden = this.data.viewState === 'forbidden';
    this.setData({ ...emptyEarnings(), status, statusIndex, statusLabel, entryType, typeIndex, typeLabel,
      viewState: forbidden ? 'forbidden' : 'ready', errorMessage: forbidden ? this.data.errorMessage : '' });
  },
  onUnload() {
    if (this.disposed) return;
    this.onHide(); this.context?.dispose(); this.disposed = true;
  },
  denied(state: { status: string; statusCode?: number; message?: string }) {
    if (!this.context?.isCurrent()) return true;
    if (state.statusCode !== 401 && state.statusCode !== 403) return false;
    this.context.invalidate('当前账号无内部收益访问权限');
    return true;
  },
  loadSummary(): Promise<void> {
    const context = this.context;
    if (!context?.isActive()) return Promise.resolve();
    if (this.summaryRequest) return this.summaryRequest;
    const sequence = ++this.summarySequence;
    const current = () => context.isActive() && sequence === this.summarySequence;
    this.setData({ summary: null, summaryState: 'loading', summaryError: '', summaryAsOfLabel: '', timezone: '' });
    const request = Promise.resolve().then(async () => {
      if (!current()) return;
      const state = await context.service.loadEarningSummary();
      if (this.denied(state) || !current()) return;
      if (state.status !== 'success' && state.status !== 'empty') throw new Error('summary unavailable');
      this.setData({ summary: presentEarningSummary(state.data), summaryState: 'ready',
        summaryAsOfLabel: earningTime(state.data.serverTime, state.data.timezone), timezone: state.data.timezone });
    }).catch(() => {
      if (current()) this.setData({ summaryState: 'error', summaryError: '收益汇总加载失败，请重试' });
    }).finally(() => {
      if (this.summaryRequest === request) this.summaryRequest = undefined;
      this.finishPullRefresh();
    });
    this.summaryRequest = request;
    return request;
  },
  loadEntries(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || (!reset && (!this.data.hasMore || this.detailRequest || this.data.detailError ||
        this.data.detailState !== 'ready'))) return Promise.resolve();
    const query: OperatorEarningQuery = { page: reset ? 1 : this.data.page + 1, pageSize: 20,
      ...(this.data.status ? { status: this.data.status } : {}),
      ...(this.data.entryType ? { entryType: this.data.entryType } : {}) };
    const key = JSON.stringify(query);
    if (this.detailRequest?.key === key) return this.detailRequest.promise;
    const sequence = ++this.detailSequence;
    const current = () => context.isActive() && sequence === this.detailSequence;
    this.retryReset = reset;
    this.setData({ detailError: '', loadingMore: !reset,
      ...(reset ? { rows: [], page: 0, total: 0, hasMore: false, detailState: 'loading',
        detailAsOfLabel: '', detailTimezone: '' } : {}) });
    const request = Promise.resolve().then(async () => {
      if (!current()) return;
      const state = await context.service.loadEarningEntries(query);
      if (this.denied(state) || !current()) return;
      if (state.status !== 'success' && state.status !== 'empty') throw new Error('journal unavailable');
      const result = state.data, rows = reset ? [] : this.data.rows;
      const known = new Set(rows.map(row => row.id.toLowerCase()));
      const previous = rows[rows.length - 1], first = result.data[0];
      const outOfOrder = previous && first && (Date.parse(previous.createdAt) < Date.parse(first.createdAt) ||
        (Date.parse(previous.createdAt) === Date.parse(first.createdAt) && previous.id.toLowerCase() <= first.id.toLowerCase()));
      if (!reset && (result.meta.total !== this.data.total || result.timezone !== this.data.detailTimezone ||
          result.data.some(row => known.has(row.id.toLowerCase())) || outOfOrder)) {
        this.retryReset = true;
        this.setData({ loadingMore: false, detailError: '流水已更新，请刷新明细' }); return;
      }
      const next = [...rows, ...result.data.map(row => presentEarningRow(row, result.timezone))];
      this.setData({ rows: next, detailState: next.length ? 'ready' : 'empty', detailError: '', loadingMore: false,
        page: result.meta.page, total: result.meta.total, hasMore: result.meta.page < result.meta.totalPages,
        detailAsOfLabel: earningTime(result.serverTime, result.timezone), detailTimezone: result.timezone });
    }).catch(() => {
      if (current()) this.setData({ loadingMore: false, detailState: this.data.rows.length ? 'ready' : 'error',
        detailError: '收益流水加载失败，请重试' });
    }).finally(() => {
      if (this.detailRequest?.promise === request) this.detailRequest = undefined;
      this.finishPullRefresh();
    });
    this.detailRequest = { key, promise: request };
    return request;
  },
  reload(): Promise<void> {
    if (!this.context?.isActive()) return Promise.resolve();
    this.cancelReads();
    return Promise.all([this.loadSummary(), this.loadEntries(true)]).then(() => undefined);
  },
  changeFilter() {
    this.detailSequence += 1; this.detailRequest = undefined;
    void this.loadEntries(true);
  },
  onStatusChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || !/^(0|[1-9]\d*)$/.test(String(event.detail.value))) return;
    const index = Number(event.detail.value), option = OPERATOR_EARNING_STATUSES[index];
    if (!option || option.value === this.data.status) return;
    this.setData({ status: option.value, statusIndex: index, statusLabel: option.label }); this.changeFilter();
  },
  onTypeChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || !/^(0|[1-9]\d*)$/.test(String(event.detail.value))) return;
    const index = Number(event.detail.value), option = OPERATOR_EARNING_TYPES[index];
    if (!option || option.value === this.data.entryType) return;
    this.setData({ entryType: option.value, typeIndex: index, typeLabel: option.label }); this.changeFilter();
  },
  onRefresh() { void this.reload(); },
  onRetrySummary() { void this.loadSummary(); },
  onRetryDetail() {
    if (!this.context?.isActive()) return;
    this.setData({ detailError: '' });
    void this.loadEntries(this.retryReset);
  },
  onLoadMore() { void this.loadEntries(false); },
  onReachBottom() { void this.loadEntries(false); },
  stopPullRefresh() {
    if (!this.pullRefreshing) return;
    this.pullRefreshing = false; wx.stopPullDownRefresh();
  },
  finishPullRefresh() {
    if (!this.summaryRequest && !this.detailRequest && this.context?.isActive()) this.stopPullRefresh();
  },
  onPullDownRefresh() {
    if (!this.context?.isActive()) return;
    this.pullRefreshing = true; void this.reload();
  },
  onBack() { if (!this.hidden && !this.disposed) navigateOperatorBack(wx, getCurrentPages().length); },
  onLogin() {
    if (!this.context || this.hidden || this.disposed) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate('请重新登录');
    const sequence = ++this.loginSequence;
    wx.reLaunch({ url: '/pages/bootstrap/index', fail: () => {
      if (!this.hidden && !this.disposed && sequence === this.loginSequence) this.setData({ errorMessage: '登录页打开失败，请重试' });
    } });
  },
});
