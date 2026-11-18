import { HeadquartersContext } from './context';
import { HeadquartersError } from './codec';
import { emptyPrivate, presentSummary } from './presenter';
import { createSessionService } from '../../../services/session.service';

Page({
  context: undefined as HeadquartersContext | undefined,
  directorySequence: 0, totalSequence: 0, campusSequence: 0, navigationSequence: 0, pullSequence: 0,
  directoryPending: false, totalPending: false, campusPending: false,
  retryPage: 1, initialShowPending: true, hidden: false, disposed: false,
  authorizedCampusCount: undefined as number | undefined,
  searchTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  data: { ...emptyPrivate(), viewState: 'loading' },

  onLoad() {
    this.context = new HeadquartersContext(errorMessage => {
      this.cancelReads();
      this.authorizedCampusCount = undefined;
      this.setData({ ...emptyPrivate(), viewState: 'forbidden', errorMessage });
    });
    void this.loadDirectory(1);
    void this.loadTotal();
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadDirectory(1); void this.loadTotal();
  },
  cancelReads() {
    this.directorySequence++; this.totalSequence++; this.campusSequence++; this.navigationSequence++; this.pullSequence++;
    this.directoryPending = false; this.totalPending = false; this.campusPending = false;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
  },
  onHide() {
    if (this.disposed) return;
    this.hidden = true; this.initialShowPending = false; this.context?.hide(); this.cancelReads();
    this.authorizedCampusCount = undefined;
    const forbidden = this.data.viewState === 'forbidden';
    this.setData({ ...emptyPrivate(), viewState: forbidden ? 'forbidden' : 'loading',
      errorMessage: forbidden ? this.data.errorMessage : '' });
  },
  onUnload() {
    if (this.disposed) return;
    this.onHide(); this.context?.dispose(); this.disposed = true;
  },
  clearCampus() {
    this.campusSequence++; this.campusPending = false;
    this.setData({ selectedCampusId: '', selectedCampusName: '', campusSummary: null, campusPresentation: null,
      campusState: 'empty', campusError: '' });
  },
  loadDirectory(page: number): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || this.directoryPending) return Promise.resolve();
    const query = this.data.query.trim();
    if (Array.from(query).length > 100) {
      this.setData({ viewState: 'ready', directoryState: 'error', directoryError: '校区名称最多输入100个字' });
      return Promise.resolve();
    }
    this.retryPage = page;
    if (page === 1) {
      this.clearCampus();
      this.setData({ campuses: [], directoryPage: 0, directoryTotal: 0, hasMore: false });
    }
    const sequence = ++this.directorySequence;
    const current = () => context.isActive() && sequence === this.directorySequence;
    this.directoryPending = true;
    this.setData({ directoryError: '', directoryState: page === 1 ? 'loading' : 'ready', loadingMore: page > 1, appliedQuery: query });
    return context.service.listCampuses({ page, pageSize: 20, query }).then(result => {
      if (!current()) return;
      const previous = page === 1 ? [] : this.data.campuses;
      const known = new Set(previous.map(row => row.id.toLowerCase()));
      const resyncTotals = !query && (result.meta.total === 0 ||
        (this.authorizedCampusCount !== undefined && this.authorizedCampusCount !== result.meta.total) ||
        (this.data.totalSummary !== null && this.data.totalSummary.campusCount !== result.meta.total));
      if (!query) this.authorizedCampusCount = result.meta.total;
      if (page > 1 && (result.meta.total !== this.data.directoryTotal ||
        result.data.some(row => known.has(row.id.toLowerCase())))) {
        this.clearCampus(); this.retryPage = 1;
        this.setData({ campuses: [], directoryPage: 0, directoryTotal: 0, hasMore: false, directoryState: 'error',
          directoryError: '授权目录已更新，请重新读取', loadingMore: false, viewState: 'ready' });
        if (!query) this.restartTotal();
        return;
      }
      const campuses = [...previous, ...result.data];
      this.setData({ campuses, directoryPage: page, directoryTotal: result.meta.total,
        hasMore: page < result.meta.totalPages, directoryState: campuses.length ? 'ready' : 'empty',
        directoryError: '', loadingMore: false, viewState: 'ready' });
      if (resyncTotals) this.restartTotal();
    }).catch(error => {
      if (!current()) return;
      if (error instanceof HeadquartersError && error.code === 'HEADQUARTERS_RESPONSE_INVALID') {
        this.clearCampus(); this.retryPage = 1;
        this.setData({ campuses: [], directoryPage: 0, directoryTotal: 0, hasMore: false });
      }
      this.setData({ viewState: 'ready', directoryState: 'error', loadingMore: false, directoryError: '校区目录读取失败，请重试' });
    }).finally(() => { if (sequence === this.directorySequence) this.directoryPending = false; });
  },
  restartTotal() {
    // Scope transitions discard every older total, including a pending first read.
    this.totalSequence++; this.totalPending = false;
    void this.loadTotal();
  },
  loadTotal(): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || this.totalPending) return Promise.resolve();
    const sequence = ++this.totalSequence, current = () => context.isActive() && sequence === this.totalSequence;
    this.totalPending = true;
    this.setData({ totalState: 'loading', totalError: '', totalSummary: null, totalPresentation: null });
    return context.service.totalSummary().then(result => {
      if (!current()) return;
      if (this.authorizedCampusCount !== undefined && result.campusCount !== this.authorizedCampusCount)
        throw new HeadquartersError(502, 'HEADQUARTERS_AUTHORIZATION_CHANGED');
      this.setData({ viewState: 'ready', totalSummary: result, totalPresentation: presentSummary(result), totalState: 'ready' });
    }).catch(() => {
      if (current()) this.setData({ viewState: 'ready', totalState: 'error', totalError: '全部授权汇总读取失败，请重试' });
    }).finally(() => { if (sequence === this.totalSequence) this.totalPending = false; });
  },
  loadCampus(): Promise<void> {
    const context = this.context, id = this.data.selectedCampusId;
    if (!context?.isActive() || !id || this.campusPending || !this.data.campuses.some(row => row.id === id)) return Promise.resolve();
    const sequence = ++this.campusSequence, current = () => context.isActive() && sequence === this.campusSequence;
    this.campusPending = true;
    this.setData({ campusState: 'loading', campusError: '', campusSummary: null, campusPresentation: null });
    return context.service.campusSummary(id).then(result => {
      if (!current()) return;
      this.setData({ campusSummary: result, campusPresentation: presentSummary(result), campusState: 'ready' });
    }).catch(() => {
      if (current()) this.setData({ campusState: 'error', campusError: '校区汇总读取失败，请重试' });
    }).finally(() => { if (sequence === this.campusSequence) this.campusPending = false; });
  },
  onCampusTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive()) return;
    const row = this.data.campuses.find(item => item.id === event.currentTarget.dataset.id);
    if (!row) return;
    this.clearCampus(); this.setData({ selectedCampusId: row.id, selectedCampusName: row.name });
    void this.loadCampus();
  },
  onQueryInput(event: WechatMiniprogram.Input) {
    if (!this.context?.isActive()) return;
    this.directorySequence++; this.directoryPending = false; this.clearCampus();
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ query: String(event.detail.value), campuses: [], directoryPage: 0, directoryTotal: 0, hasMore: false,
      directoryState: 'loading', directoryError: '', loadingMore: false });
    this.searchTimer = setTimeout(() => { this.searchTimer = undefined; void this.loadDirectory(1); }, 300);
  },
  onSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = undefined; void this.loadDirectory(1);
  },
  onTab(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive()) return;
    const tab = event.currentTarget.dataset.tab;
    if (tab === 'all' || tab === 'campuses') this.setData({ tab });
  },
  onRetryDirectory() { void this.loadDirectory(this.retryPage); },
  onRetryTotal() { void this.loadTotal(); },
  onRetryCampus() { void this.loadCampus(); },
  onLoadMore() {
    if (this.data.hasMore && !this.data.directoryError) void this.loadDirectory(this.data.directoryPage + 1);
  },
  onRefresh() {
    if (!this.context?.isActive()) return Promise.resolve();
    this.cancelReads(); this.clearCampus();
    this.setData({ campuses: [], directoryPage: 0, directoryTotal: 0, hasMore: false });
    return Promise.all([this.loadDirectory(1), this.loadTotal()]);
  },
  onPullDownRefresh() {
    const pending = this.onRefresh(), sequence = ++this.pullSequence;
    void pending.finally(() => { if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh(); });
  },
  onBack() {
    if (this.disposed || this.data.navigating || !this.context) return;
    const sameOwner = this.context.ownsRuntime(), unchanged = this.context.navigationGuard();
    const sequence = ++this.navigationSequence;
    this.setData({ navigating: true });
    const current = () => !this.disposed && sequence === this.navigationSequence && unchanged();
    const home = () => {
      if (!current()) return;
      wx.reLaunch({ url: '/pages/bootstrap/index', fail: () => {
        if (current()) { this.setData({ navigating: false }); wx.showToast({ title: '返回失败，请重试', icon: 'none' }); }
      } });
    };
    const pages = getCurrentPages(), previous = pages[pages.length - 2]?.route;
    if (sameOwner && pages.length > 1 && ['pages/bootstrap/index', 'pages/operator/headquarters/index'].includes(previous))
      wx.navigateBack({ delta: 1, fail: home });
    else home();
  },
  onLogin() {
    if (this.disposed || this.data.navigating || !this.context) return;
    if (this.context.ownsRuntime()) {
      this.context.invalidate('请重新登录');
      createSessionService().logout();
    }
    this.setData({ navigating: true });
    const sequence = ++this.navigationSequence, unchanged = this.context.navigationGuard();
    wx.reLaunch({ url: '/pages/bootstrap/index', fail: () => {
      if (!this.disposed && sequence === this.navigationSequence && unchanged())
        this.setData({ navigating: false, errorMessage: '登录入口打开失败，请返回后重试' });
    } });
  },
});
