import { createPartnerRankingService } from '../runtime/partner-ranking.service';
import {
  PARTNER_RANKING_METRICS, currentRankingMonth,
  type PartnerRankingMetric, type PartnerRankingQuery, type PartnerRankingRow,
} from '../runtime/partner-ranking.types';
import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import { logoutPartnerCampaignSession } from '../runtime/campaign-session-runtime';
import { formatDateTimeLabel } from '../../../utils/format';

function presentRow(row: PartnerRankingRow) {
  const delta = row.rankDelta;
  return {
    ...row,
    deltaLabel: delta === null ? '无上月可比数据'
      : delta > 0 ? `上升${delta}名` : delta < 0 ? `下降${Math.abs(delta)}名` : '持平',
  };
}
function validMonth(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)
    && value <= currentRankingMonth();
}
function validMetric(value: unknown): value is PartnerRankingMetric {
  return PARTNER_RANKING_METRICS.some((item) => item.value === value);
}
const emptyContent = () => ({
  rows: [] as Array<ReturnType<typeof presentRow>>,
  ownCampus: null as ReturnType<typeof presentRow> | null,
  availability: null as 'LIVE' | 'SNAPSHOT' | 'UNAVAILABLE' | null,
  availabilityLabel: '', unavailableMessage: '', asOfLabel: '',
  revisionId: null as string | null, page: 0, total: 0, hasMore: false,
  errorMessage: '', refreshError: '', pageError: '', loadingMore: false, refreshing: false,
});

Page({
  runtime: undefined as ReturnType<typeof createPartnerRankingService> | undefined,
  ownerKey: '',
  stopped: false,
  hidden: false,
  disposed: false,
  initialShowPending: false,
  sequence: 0,
  pullSequence: 0,
  loginSequence: 0,
  contentKey: '',
  pending: undefined as { key: string; promise: Promise<void> } | undefined,

  data: {
    ...emptyContent(),
    viewState: 'loading',
    metricOptions: PARTNER_RANKING_METRICS,
    metric: 'STUDENTS' as PartnerRankingMetric,
    month: currentRankingMonth(),
    monthMax: currentRankingMonth(),
  },

  onLoad(query: Record<string, string | undefined> = {}) {
    void loadPartnerPdfDisplayFont();
    this.setData({
      metric: validMetric(query.metric) ? query.metric : 'STUDENTS',
      month: validMonth(query.month) ? query.month : currentRankingMonth(),
      monthMax: currentRankingMonth(),
    });
    this.initialShowPending = true;
    void this.load(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.setData({ monthMax: currentRankingMonth() });
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.load(true);
  },

  onHide() {
    if (this.disposed) return;
    this.hidden = true;
    this.initialShowPending = false;
    this.pullSequence += 1;
    this.loginSequence += 1;
    this.sequence += 1;
    this.pending = undefined;
    this.contentKey = '';
    this.setData({
      ...emptyContent(), viewState: this.stopped ? 'forbidden' : 'loading',
      errorMessage: this.stopped ? this.data.errorMessage : '',
    });
  },

  onUnload() {
    if (this.disposed) return;
    this.onHide();
    this.disposed = true;
    this.runtime = undefined;
  },

  clearPrivate(message: string) {
    this.stopped = true;
    this.sequence += 1;
    this.pullSequence += 1;
    this.pending = undefined;
    this.contentKey = '';
    this.setData({ ...emptyContent(), viewState: 'forbidden', errorMessage: message });
  },

  validateOwner(): boolean {
    if (this.stopped) return false;
    try {
      const runtime = createPartnerRankingService();
      const key = runtime.getSessionKey();
      if (!key || (this.ownerKey && this.ownerKey !== key) ||
        (this.runtime && this.runtime.getSessionKey() !== key)) {
        this.clearPrivate('登录已更新，请重新登录');
        return false;
      }
      if (!this.runtime) {
        this.runtime = runtime;
        this.ownerKey = key;
      }
      return true;
    } catch {
      this.clearPrivate('登录状态不可用，请重新登录');
      return false;
    }
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const pull = ++this.pullSequence;
    void this.load(true).finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence && this.validateOwner())
        wx.stopPullDownRefresh();
    });
  },

  onMetricTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const metric: unknown = event.currentTarget.dataset.metric;
    if (!validMetric(metric) || metric === this.data.metric) return;
    this.setData({ metric });
    this.changeConditions();
  },

  onMonthChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const month: unknown = event.detail.value;
    if (!validMonth(month) || month === this.data.month) return;
    this.setData({ month });
    this.changeConditions();
  },

  onCurrentMonth() {
    this.onMonthChange({ detail: { value: currentRankingMonth() } } as WechatMiniprogram.PickerChange);
  },

  changeConditions() {
    this.sequence += 1;
    this.pullSequence += 1;
    this.pending = undefined;
    this.contentKey = '';
    this.setData({ ...emptyContent(), viewState: 'loading' });
    void this.load(true);
  },

  load(reset: boolean): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    if (!reset && (this.pending || !this.data.hasMore || this.data.refreshError ||
      this.data.viewState !== 'ready' || !this.data.revisionId)) return Promise.resolve();
    const metric = this.data.metric;
    const month = this.data.month;
    const page = reset ? 1 : this.data.page + 1;
    const contentKey = JSON.stringify([metric, month]);
    const key = JSON.stringify([contentKey, page]);
    if (this.pending?.key === key) return this.pending.promise;
    const query: PartnerRankingQuery = { metric, month, page, pageSize: 20 };
    if (!reset && this.data.revisionId) query.revisionId = this.data.revisionId;
    const sequence = ++this.sequence;
    const runtime = this.runtime;
    const keepContent = this.contentKey === contentKey;
    const current = () => !this.hidden && !this.disposed &&
      sequence === this.sequence && this.validateOwner();
    this.setData({
      ...(reset && !keepContent ? { ...emptyContent(), viewState: 'loading' } : {}),
      errorMessage: '', refreshError: '', pageError: '',
      loadingMore: !reset, refreshing: reset,
    });
    const promise = Promise.resolve().then(async () => {
      if (!current()) return;
      const response = await runtime.list(query);
      if (!current()) return;
      if (response.metric !== metric || response.month !== month ||
        (!reset && response.revisionId !== query.revisionId)) throw new Error('Ranking response mismatch');
      const available = response.availability !== 'UNAVAILABLE';
      const rows = available
        ? reset ? response.data.map(presentRow) : [...this.data.rows, ...response.data.map(presentRow)]
        : [];
      this.contentKey = contentKey;
      this.setData({
        rows, ownCampus: available && response.ownCampus ? presentRow(response.ownCampus) : null,
        revisionId: available ? response.revisionId : null,
        availability: response.availability,
        availabilityLabel: response.availability === 'LIVE' ? '本月实时榜'
          : response.availability === 'SNAPSHOT' ? '历史月榜' : '暂无可用榜单',
        unavailableMessage: response.unavailableReason === 'HISTORY_UNAVAILABLE'
          ? '该月历史数据不足，暂无法排名' : '该月数据待核对，暂无法排名',
        asOfLabel: formatDateTimeLabel(response.asOf, response.timezone),
        page: response.meta.page, total: available ? response.meta.total : 0,
        hasMore: available && !!response.revisionId && response.meta.page < response.meta.totalPages,
        viewState: !available ? 'unavailable' : rows.length ? 'ready' : 'empty',
        errorMessage: '', refreshError: '', pageError: '', loadingMore: false, refreshing: false,
      });
    }).catch((error: unknown) => {
      if (!current()) return;
      const statusCode = (error as { statusCode?: number } | null)?.statusCode;
      if (statusCode === 401 || statusCode === 403) {
        this.clearPrivate(statusCode === 401 ? '登录已失效，请重新登录' : '当前账号无权查看月榜');
        return;
      }
      const message = '月榜加载失败，请重试';
      this.setData({
        loadingMore: false, refreshing: false,
        ...(keepContent
          ? reset ? { refreshError: message } : { pageError: message }
          : { viewState: 'error', errorMessage: message }),
      });
    }).finally(() => {
      if (sequence === this.sequence) this.pending = undefined;
    });
    this.pending = { key, promise };
    return promise;
  },

  onRetry() { void this.load(true); },
  onLoadMore() { void this.load(false); },
  onReachBottom() {
    if (!this.data.pageError) void this.load(false);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.clearPrivate('登录已失效，请重新登录');
    const sequence = ++this.loginSequence;
    let navigationKey: string | undefined;
    const fail = () => {
      if (this.hidden || this.disposed || sequence !== this.loginSequence) return;
      try {
        if (navigationKey !== undefined && createPartnerRankingService().getSessionKey() !== navigationKey) return;
      } catch { return; }
      this.setData({ errorMessage: '登录页打开失败，请重试' });
    };
    try {
      logoutPartnerCampaignSession();
      this.runtime = undefined;
      navigationKey = createPartnerRankingService().getSessionKey();
      wx.reLaunch({ url: '/pages/bootstrap/index', fail });
    } catch { fail(); }
  },
});
