import { createPartnerRankingService } from '../../runtime/partner-ranking.service';
import {
  PARTNER_RANKING_METRICS, currentRankingMonth,
  type PartnerRankingMetric, type PartnerRankingRow,
} from '../../runtime/partner-ranking.types';
import { loadPartnerPdfDisplayFont } from '../../runtime/partner-pdf-font';
import { formatDateTimeLabel } from '../../../../utils/format';

function presentRow(row: PartnerRankingRow) {
  const delta = row.rankDelta;
  return {
    ...row,
    deltaLabel: delta === null ? '无上月可比数据'
      : delta > 0 ? `上升${delta}名` : delta < 0 ? `下降${Math.abs(delta)}名` : '持平',
  };
}
const emptyContent = () => ({
  rows: [] as Array<ReturnType<typeof presentRow>>,
  ownCampus: null as ReturnType<typeof presentRow> | null,
  availability: null as 'LIVE' | 'SNAPSHOT' | 'UNAVAILABLE' | null,
  availabilityLabel: '', unavailableMessage: '', asOfLabel: '',
  errorMessage: '', refreshError: '', navigationError: '', refreshing: false,
});
type PreviewState = {
  attached: boolean;
  hidden: boolean;
  detached: boolean;
  initialShowPending: boolean;
  stopped: boolean;
  sequence: number;
  navigationSequence: number;
  navigationPending: boolean;
  ownerKey: string;
  contentKey: string;
  runtime?: ReturnType<typeof createPartnerRankingService>;
  pending?: { key: string; promise: Promise<void> };
};
const states = new WeakMap<object, PreviewState>();
function state(instance: object): PreviewState {
  let value = states.get(instance);
  if (!value) {
    value = {
      attached: false, hidden: true, detached: false, initialShowPending: false,
      stopped: false, sequence: 0, navigationSequence: 0, navigationPending: false,
      ownerKey: '', contentKey: '',
    };
    states.set(instance, value);
  }
  return value;
}

Component({
  properties: {
    blocked: {
      type: Boolean,
      value: false,
      observer(blocked: boolean) {
        const current = state(this);
        if (blocked) this.clearPrivate();
        else if (current.attached && !current.hidden && !current.detached && !current.stopped)
          void this.load();
      },
    },
  },
  data: {
    ...emptyContent(),
    viewState: 'loading',
    metricOptions: PARTNER_RANKING_METRICS,
    metric: 'STUDENTS' as PartnerRankingMetric,
    month: currentRankingMonth(),
  },
  lifetimes: {
    attached() {
      const current = state(this);
      current.attached = true;
      current.hidden = false;
      current.detached = false;
      current.initialShowPending = true;
      void loadPartnerPdfDisplayFont();
      this.setData({ month: currentRankingMonth() });
      void this.load();
    },
    detached() {
      this.clearPrivate();
      const current = state(this);
      current.hidden = true;
      current.detached = true;
      current.attached = false;
      current.runtime = undefined;
    },
  },
  pageLifetimes: {
    show() {
      const current = state(this);
      if (!current.attached || current.detached) return;
      current.hidden = false;
      current.navigationPending = false;
      if (this.data.blocked || !this.validateOwner()) return;
      if (current.initialShowPending) {
        current.initialShowPending = false;
        return;
      }
      this.setData({ month: currentRankingMonth() });
      void this.load();
    },
    hide() {
      const current = state(this);
      current.hidden = true;
      current.initialShowPending = false;
      this.clearPrivate();
    },
  },
  methods: {
    clearPrivate(message?: string) {
      const current = state(this);
      current.sequence += 1;
      current.navigationSequence += 1;
      current.navigationPending = false;
      current.pending = undefined;
      current.contentKey = '';
      if (!current.detached)
        this.setData({ ...emptyContent(), viewState: message || current.stopped ? 'forbidden' : 'loading', errorMessage: message ?? '' });
    },
    forbid(message: string) {
      const current = state(this);
      if (current.stopped) return;
      current.stopped = true;
      this.clearPrivate(message);
      this.triggerEvent('forbidden', { message });
    },
    validateOwner(): boolean {
      const current = state(this);
      if (current.stopped) return false;
      try {
        const runtime = createPartnerRankingService();
        const key = runtime.getSessionKey();
        if (!key || (current.ownerKey && current.ownerKey !== key) ||
          (current.runtime && current.runtime.getSessionKey() !== key)) {
          this.forbid('登录已更新，请重新登录');
          return false;
        }
        if (!current.runtime) {
          current.runtime = runtime;
          current.ownerKey = key;
        }
        return true;
      } catch {
        this.forbid('登录状态不可用，请重新登录');
        return false;
      }
    },
    load(): Promise<void> {
      const instance = state(this);
      if (!instance.attached || instance.hidden || instance.detached || this.data.blocked ||
        !this.validateOwner() || !instance.runtime) return Promise.resolve();
      const metric = this.data.metric;
      const month = this.data.month;
      const key = JSON.stringify([metric, month]);
      if (instance.pending?.key === key) return instance.pending.promise;
      const sequence = ++instance.sequence;
      const runtime = instance.runtime;
      const keepContent = instance.contentKey === key;
      const active = () => instance.attached && !instance.hidden && !instance.detached &&
        !this.data.blocked && sequence === instance.sequence && this.validateOwner();
      this.setData({
        ...(!keepContent ? { ...emptyContent(), viewState: 'loading' } : {}),
        errorMessage: '', refreshError: '', refreshing: true,
      });
      const promise = Promise.resolve().then(async () => {
        if (!active()) return;
        const response = await runtime.list({ metric, month, page: 1, pageSize: 3 });
        if (!active()) return;
        if (response.metric !== metric || response.month !== month) throw new Error('Ranking response mismatch');
        const available = response.availability !== 'UNAVAILABLE';
        const rows = available ? response.data.map(presentRow) : [];
        instance.contentKey = key;
        this.setData({
          rows, ownCampus: available && response.ownCampus ? presentRow(response.ownCampus) : null,
          availability: response.availability,
          availabilityLabel: response.availability === 'LIVE' ? '本月实时榜'
            : response.availability === 'SNAPSHOT' ? '历史月榜' : '暂无可用榜单',
          unavailableMessage: response.unavailableReason === 'HISTORY_UNAVAILABLE'
            ? '该月历史数据不足，暂无法排名' : '该月数据待核对，暂无法排名',
          asOfLabel: formatDateTimeLabel(response.asOf, response.timezone),
          viewState: !available ? 'unavailable' : rows.length ? 'ready' : 'empty',
          errorMessage: '', refreshError: '', refreshing: false,
        });
      }).catch((error: unknown) => {
        if (!active()) return;
        const statusCode = (error as { statusCode?: number } | null)?.statusCode;
        if (statusCode === 401 || statusCode === 403) {
          this.forbid(statusCode === 401 ? '登录已失效，请重新登录' : '当前账号无权查看月榜');
          return;
        }
        const message = '月榜加载失败，请重试';
        this.setData({
          refreshing: false,
          ...(keepContent ? { refreshError: message } : { viewState: 'error', errorMessage: message }),
        });
      }).finally(() => {
        if (instance.sequence === sequence) instance.pending = undefined;
      });
      instance.pending = { key, promise };
      return promise;
    },
    onRetry() { void this.load(); },
    onMetricTap(event: WechatMiniprogram.TouchEvent) {
      const current = state(this);
      if (!current.attached || current.hidden || current.detached || this.data.blocked || !this.validateOwner()) return;
      const metric = PARTNER_RANKING_METRICS.find((item) => item.value === event.currentTarget.dataset.metric)?.value;
      if (!metric || metric === this.data.metric) return;
      this.clearPrivate();
      this.setData({ metric });
      void this.load();
    },
    onAllTap() {
      const current = state(this);
      if (!current.attached || current.hidden || current.detached || this.data.blocked ||
        !this.validateOwner() || current.navigationPending) return;
      current.navigationPending = true;
      const sequence = ++current.navigationSequence;
      this.setData({ navigationError: '' });
      const fail = () => {
        if (current.hidden || current.detached || this.data.blocked ||
          sequence !== current.navigationSequence || !this.validateOwner()) return;
        current.navigationPending = false;
        this.setData({ navigationError: '月榜页面打开失败，请重试' });
      };
      try {
        wx.navigateTo({
          url: `/pages/partner/rankings/index?metric=${this.data.metric}&month=${this.data.month}`,
          fail,
        });
      } catch { fail(); }
    },
  },
});
