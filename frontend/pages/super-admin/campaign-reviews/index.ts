import { getFreeCampaignReviewRuntime, logoutFreeCampaignReviewer } from '../runtime/free-campaign-review-runtime';
import type { FreeCampaignReviewPort, FreeCampaignReviewSummary } from '../runtime/free-campaign-review.service';
import { freeCampaignReviewStatuses, freeCampaignStatusLabel, freeCampaignErrorStatus,
  freeCampaignTimeLabel } from '../runtime/free-campaign-review-presenter';
import { freeCampaignHeaderTopPx } from '../runtime/free-campaign-navigation';

Page({
  hidden: false, disposed: false, initial: true, generation: 0, owner: '',
  service: undefined as FreeCampaignReviewPort | undefined,
  pending: undefined as Promise<void> | undefined,
  navigationSequence: 0, navigationPending: false, pullSequence: 0,
  data: {
    viewState: 'loading', message: '', refreshError: '', paginationError: '',
    statuses: freeCampaignReviewStatuses, statusIndex: 0, loading: false, simulated: false,
    rows: [] as Array<FreeCampaignReviewSummary & { statusLabel: string; submittedLabel: string }>,
    page: 0, more: false, headerTopPx: 28,
  },
  onLoad() { this.setData({ headerTopPx: freeCampaignHeaderTopPx() }); this.initial = true; void this.load(true); },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    const service = getFreeCampaignReviewRuntime();
    if (this.owner && (service !== this.service || service.getSessionKey() !== this.owner)) {
      this.clear('登录已更新，请重新读取'); this.initial = false;
    }
    if (this.initial) { this.initial = false; return; }
    void this.load(true);
  },
  onHide() {
    this.hidden = true; this.initial = false; ++this.generation; ++this.navigationSequence; ++this.pullSequence;
    this.navigationPending = false; this.pending = undefined; this.service?.invalidateReads();
    this.setData({ rows: [], page: 0, more: false, loading: false, message: '', refreshError: '', paginationError: '' });
  },
  onUnload() { this.disposed = true; this.onHide(); },
  active() { return !this.hidden && !this.disposed; },
  clear(message: string) {
    ++this.generation; ++this.navigationSequence; this.pending = undefined; this.navigationPending = false;
    this.setData({ rows: [], page: 0, more: false, loading: false, viewState: 'forbidden',
      message, refreshError: '', paginationError: '' });
  },
  current(generation: number, owner: string) {
    if (!this.active() || generation !== this.generation || this.owner !== owner) return false;
    if (this.service?.getSessionKey() !== owner) { this.clear('登录已更新，请重新登录'); return false; }
    return true;
  },
  load(reset: boolean): Promise<void> {
    if (!this.active()) return Promise.resolve();
    const service = getFreeCampaignReviewRuntime(); const owner = service.getSessionKey();
    if (this.owner && (this.owner !== owner || this.service !== service)) this.clear('登录已更新，请重新读取');
    this.service = service; this.owner = owner;
    if (!owner) { this.clear('当前登录无活动审核权限，请重新登录'); return Promise.resolve(); }
    if (this.pending) return this.pending;
    if (!reset && (!this.data.more || this.data.viewState !== 'ready' || this.data.refreshError)) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1; const generation = ++this.generation;
    const status = this.data.statuses[this.data.statusIndex].value;
    service.invalidateReads();
    this.setData({ loading: true, message: '', refreshError: '', paginationError: '', simulated: service.isMock,
      ...(this.data.rows.length ? {} : { viewState: 'loading' }) });
    const pending = Promise.resolve().then(() => {
      if (this.current(generation, owner)) return service.list(page, status);
      return undefined;
    }).then((result) => {
      if (!result || !this.current(generation, owner)) return;
      const rows = [...(reset ? [] : this.data.rows), ...result.data.map((row) => ({
        ...row, statusLabel: freeCampaignStatusLabel(row.status),
        submittedLabel: freeCampaignTimeLabel(row.submittedAt, 'UTC'),
      }))];
      const unique = Array.from(new Map(rows.map((row) => [row.versionId, row])).values());
      this.setData({ rows: unique, page, more: page < result.meta.totalPages, viewState: unique.length ? 'ready' : 'empty' });
    }).catch((error: unknown) => {
      if (!this.current(generation, owner)) return;
      if ([401, 403].includes(freeCampaignErrorStatus(error))) { this.clear('当前登录无活动审核权限，请重新登录'); return; }
      this.setData(this.data.rows.length
        ? { viewState: 'ready', ...(reset ? { refreshError: '读取失败，请重试' } : { paginationError: '更多记录读取失败，请重试' }) }
        : { viewState: 'error', message: '活动审核记录读取失败，请重试' });
    }).finally(() => {
      if (this.pending === pending) this.pending = undefined;
      if (this.current(generation, owner)) this.setData({ loading: false });
    });
    this.pending = pending;
    return pending;
  },
  onStatus(event: WechatMiniprogram.PickerChange) {
    if (!this.active()) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !this.data.statuses[index] || index === this.data.statusIndex) return;
    ++this.generation; this.pending = undefined; this.service?.invalidateReads();
    this.setData({ statusIndex: index, rows: [], page: 0, more: false, loading: false });
    void this.load(true);
  },
  onMore() { return this.load(false); },
  onRetry() { return this.load(true); },
  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    const pending = this.load(true); const owner = this.owner;
    void pending.finally(() => {
      if (this.active() && sequence === this.pullSequence && this.owner === owner &&
        this.service?.getSessionKey() === owner) wx.stopPullDownRefresh();
    });
  },
  onReachBottom() { void this.load(false); },
  onOpen(event: WechatMiniprogram.TouchEvent) {
    if (!this.active()) return;
    const service = getFreeCampaignReviewRuntime();
    if (service !== this.service || service.getSessionKey() !== this.owner) { this.clear('登录已更新，请重新登录'); return; }
    if (this.navigationPending || this.data.loading || this.data.viewState !== 'ready') return;
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!this.data.rows.some((row) => row.versionId === id)) return;
    this.navigationPending = true; const sequence = ++this.navigationSequence;
    const fail = () => {
      if (!this.active() || sequence !== this.navigationSequence) return;
      this.navigationPending = false;
      if (service.getSessionKey() !== this.owner) { this.clear('登录已更新，请重新登录'); return; }
      this.setData({ refreshError: '详情打开失败，请重试' });
    };
    try { wx.navigateTo({ url: `/pages/super-admin/campaign-review-detail/index?id=${encodeURIComponent(id)}`, fail }); } catch { fail(); }
  },
  onLogin() {
    if (!this.active()) return;
    ++this.pullSequence;
    this.clear('请重新登录'); logoutFreeCampaignReviewer();
    const generation = this.generation; const owner = this.service?.getSessionKey();
    const fail = () => {
      if (this.active() && generation === this.generation && this.service?.getSessionKey() === owner)
        this.setData({ message: '登录页打开失败，请重试' });
    };
    try { wx.reLaunch({ url: '/pages/bootstrap/index', fail }); } catch { fail(); }
  },
});
