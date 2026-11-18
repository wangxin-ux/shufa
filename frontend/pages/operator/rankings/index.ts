import { OperatorPageContext } from '../runtime/operator-page-context';
import {
  currentOperatorRankingMonth, isOperatorRankingMetric, isOperatorRankingMonth, OPERATOR_RANKING_METRICS,
  type OperatorRankingMetric, type OperatorRankingQuery,
} from '../runtime/types/operator-ranking';
import {
  emptyOperatorRankings, operatorRankingSnapshotKey, presentOperatorRankingPage, presentOperatorRankingRow,
} from '../runtime/services/operator-ranking.presenter';
import { navigateOperatorBack } from '../runtime/utils/operator-navigation';
import { createSessionService } from '../../../services/session.service';

Page({
  context: undefined as OperatorPageContext | undefined,
  pending: undefined as { key: string; promise: Promise<void> } | undefined,
  snapshotKey: '',
  contentKey: '',
  initialShowPending: true,
  hidden: false,
  disposed: false,
  loginSequence: 0,
  pullSequence: 0,
  data: {
    ...emptyOperatorRankings(), viewState: 'loading',
    metric: 'STUDENTS' as OperatorRankingMetric, month: '', monthMax: '',
    metricOptions: OPERATOR_RANKING_METRICS,
  },

  onLoad(query: Record<string, string | undefined> = {}) {
    const month = currentOperatorRankingMonth();
    this.setData({
      metric: isOperatorRankingMetric(query.metric) ? query.metric : 'STUDENTS',
      month: isOperatorRankingMonth(query.month) ? query.month : month, monthMax: month,
    });
    this.context = new OperatorPageContext((errorMessage) => {
      this.pending = undefined;
      this.snapshotKey = '';
      this.contentKey = '';
      this.pullSequence += 1;
      this.setData({ ...emptyOperatorRankings(), viewState: 'forbidden', errorMessage });
    });
    void this.load(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.context?.show()) return;
    this.setData({ monthMax: currentOperatorRankingMonth() });
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.load(true);
  },

  onHide() {
    if (this.disposed) return;
    this.hidden = true;
    this.context?.hide();
    this.pending = undefined;
    this.snapshotKey = '';
    this.contentKey = '';
    this.initialShowPending = false;
    this.pullSequence += 1;
    this.loginSequence += 1;
    const forbidden = this.data.viewState === 'forbidden';
    const errorMessage = forbidden ? this.data.errorMessage : '';
    this.setData({ ...emptyOperatorRankings(), viewState: forbidden ? 'forbidden' : 'loading', errorMessage });
  },

  onUnload() {
    if (this.disposed) return;
    this.onHide();
    this.context?.dispose();
    this.disposed = true;
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.load(true).finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  load(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive()) return Promise.resolve();
    if (!reset && (this.pending || !this.data.hasMore || this.data.refreshError ||
      this.data.revisionMissing || this.data.viewState !== 'ready' || !this.data.revisionId)) return Promise.resolve();
    const query: OperatorRankingQuery = {
      metric: this.data.metric, month: this.data.month, page: reset ? 1 : this.data.page + 1, pageSize: 20,
      ...(!reset && this.data.revisionId ? { revisionId: this.data.revisionId } : {}),
    };
    const key = JSON.stringify(query);
    if (this.pending?.key === key) return this.pending.promise;
    const contentKey = JSON.stringify([query.metric, query.month]);
    const keepContent = this.contentKey === contentKey;
    const sequence = context.nextRead();
    const current = () => context.accepts(sequence);
    this.setData({
      ...(reset && !keepContent ? { ...emptyOperatorRankings(), viewState: 'loading' } : {}),
      errorMessage: '', refreshError: '', pageError: '', loadingMore: !reset, refreshing: reset,
    });
    const promise = Promise.resolve().then(async () => {
      if (!current()) return;
      const state = await context.service.loadRankings(query);
      if (!context.isCurrent()) return;
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        context.invalidate(state.message);
        return;
      }
      if (!current()) return;
      if (state.status === 'error') {
        const missing = state.statusCode === 404;
        const message = missing ? '月榜修订不可用，请刷新榜单' : '月榜加载失败，请重试';
        this.setData({
          loadingMore: false, refreshing: false,
          ...(missing ? { revisionId: null, hasMore: false, revisionMissing: true } : {}),
          ...(keepContent ? reset ? { refreshError: message } : { pageError: message } :
            { viewState: 'error', errorMessage: message }),
        });
        return;
      }
      if (state.status !== 'success' && state.status !== 'empty') return;
      const result = state.data;
      const snapshotKey = operatorRankingSnapshotKey(result);
      if (!reset && this.snapshotKey !== snapshotKey) {
        this.setData({ loadingMore: false, refreshing: false, pageError: '榜单分页内容不一致，请重试或刷新' });
        return;
      }
      const rows = reset ? [] : this.data.rows;
      const offset = rows.length;
      const nextRows = [...rows, ...result.data.map((row, index) => presentOperatorRankingRow(row, offset + index))];
      if (!reset && result.data.length && rows.length && result.data[0].rank < rows[rows.length - 1].rank) {
        this.setData({ loadingMore: false, refreshing: false, pageError: '榜单分页顺序不一致，请重试或刷新' });
        return;
      }
      this.contentKey = contentKey;
      this.snapshotKey = snapshotKey;
      this.setData({
        ...presentOperatorRankingPage(result), rows: nextRows,
        viewState: result.availability === 'UNAVAILABLE' ? 'unavailable' : nextRows.length ? 'ready' : 'empty',
      });
    }).catch(() => {
      if (!current()) return;
      this.setData({
        loadingMore: false, refreshing: false,
        ...(keepContent ? reset ? { refreshError: '月榜加载失败，请重试' } : { pageError: '月榜加载失败，请重试' } :
          { viewState: 'error', errorMessage: '月榜加载失败，请重试' }),
      });
    }).finally(() => {
      if (this.pending?.promise === promise) this.pending = undefined;
    });
    this.pending = { key, promise };
    return promise;
  },

  changeConditions() {
    this.context?.nextRead();
    this.pending = undefined;
    this.snapshotKey = '';
    this.contentKey = '';
    this.pullSequence += 1;
    this.setData({ ...emptyOperatorRankings(), viewState: 'loading' });
    void this.load(true);
  },
  onMetricTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive()) return;
    const metric: unknown = event.currentTarget.dataset.metric;
    if (!isOperatorRankingMetric(metric) || metric === this.data.metric) return;
    this.setData({ metric });
    this.changeConditions();
  },
  onMonthChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive()) return;
    const month: unknown = event.detail.value;
    if (!isOperatorRankingMonth(month) || month === this.data.month) return;
    this.setData({ month });
    this.changeConditions();
  },
  onCurrentMonth() {
    this.onMonthChange({ detail: { value: currentOperatorRankingMonth() } } as WechatMiniprogram.PickerChange);
  },
  onRefresh() { void this.load(true); },
  onRetry() { void this.load(true); },
  onLoadMore() { void this.load(false); },
  onReachBottom() { if (!this.data.pageError) void this.load(false); },
  onBack() {
    if (!this.hidden && !this.disposed) navigateOperatorBack(wx, getCurrentPages().length);
  },
  onLogin() {
    if (!this.context || this.hidden || this.disposed) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate('请重新登录');
    const sequence = ++this.loginSequence;
    wx.reLaunch({
      url: '/pages/bootstrap/index',
      fail: () => {
        if (!this.hidden && !this.disposed && sequence === this.loginSequence) {
          this.setData({ errorMessage: '登录页打开失败，请重试' });
        }
      },
    });
  },
});
