import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  buildPartnerWarningItems,
  buildPartnerWarningQuery,
  mergePartnerWarningItems,
  PartnerWarningItemModel,
} from '../../../services/partner-warnings.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import { createSessionService } from '../../../services/session.service';

const PAGE_SIZE = 20;

Page({
  requestSequence: 0,
  searchTimer: null as ReturnType<typeof setTimeout> | null,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingKey: '',
  contentKey: '',
  hidden: false,
  disposed: false,
  initialShowPending: false,
  runtime: undefined as ReturnType<typeof createPartnerService> | undefined,
  warningsOwnerKey: '',
  pullSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    paginationError: '',
    query: '',
    items: [] as PartnerWarningItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.warningsOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    void this.loadWarnings(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.loadWarnings(true);
  },

  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.initialShowPending = false;
    this.invalidateRequest();
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  invalidateRequest() {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingKey = '';
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed || !this.runtime) return;
    const sequence = ++this.pullSequence;
    void this.loadWarnings(true).finally(() => {
      if (!this.hidden && !this.disposed && this.runtime &&
        sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  invalidateWarnings(message: string) {
    this.invalidateRequest();
    this.contentKey = '';
    this.setData({
      viewState: 'forbidden', errorMessage: message, query: '',
      items: [], page: 0, total: 0, hasMore: false, loadingMore: false,
      refreshError: '', paginationError: '',
    });
  },

  validateOwner() {
    if (!this.runtime) return false;
    if (getPartnerCampaignDraftService().getSessionKey() === this.warningsOwnerKey) return true;
    this.invalidateWarnings('登录已更新，请重新登录');
    return false;
  },

  loadWarnings(reset: boolean): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    const runtime = this.runtime;
    const query = this.data.query.trim();
    const contentKey = JSON.stringify([query]);
    if (!reset && (
      this.pendingRequest || this.searchTimer !== null ||
      !this.data.hasMore || this.data.loadingMore || this.data.refreshError ||
      this.data.viewState !== 'ready' || this.contentKey !== contentKey
    )) return Promise.resolve();
    if (reset && this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const page = reset ? 1 : this.data.page + 1;
    const pendingKey = JSON.stringify([contentKey, page]);
    if (this.pendingRequest && this.pendingKey === pendingKey) return this.pendingRequest;
    const sequence = ++this.requestSequence;
    const keepContent = this.contentKey === contentKey &&
      (this.data.viewState === 'ready' || this.data.viewState === 'empty');
    this.pendingKey = pendingKey;
    this.setData(
      reset
        ? {
            ...(keepContent ? {} : {
              viewState: 'loading',
              items: [],
              page: 0,
              total: 0,
              hasMore: false,
            }),
            errorMessage: '',
            refreshError: '',
            paginationError: '',
            loadingMore: false,
          }
        : { loadingMore: true, paginationError: '' },
    );
    const fail = (failure: { statusCode?: number; message: string }) => {
      if (this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
      if (failure.statusCode === 401 || failure.statusCode === 403) {
        this.invalidateWarnings(failure.statusCode === 401
          ? '登录已失效，请重新登录'
          : '当前账号无权查看本校区课时预警');
        return;
      }
      this.setData({
        loadingMore: false,
        ...(keepContent
          ? reset ? { refreshError: failure.message } : { paginationError: failure.message }
          : { viewState: 'error', errorMessage: failure.message }),
      });
    };
    const request = Promise.resolve()
      .then(() => {
        if (this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
        return runtime.loadWarnings(buildPartnerWarningQuery(query, page, PAGE_SIZE));
      })
      .then((state) => {
        if (!state || this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
        if (state.status === 'success' || state.status === 'empty') {
          const incoming = Array.from(new Map(
            buildPartnerWarningItems(state.data.data).map((item) => [item.studentId, item]),
          ).values());
          const items = mergePartnerWarningItems(this.data.items, incoming, page);
          this.contentKey = contentKey;
          this.setData({
            items,
            page: state.data.meta.page,
            total: state.data.meta.total,
            hasMore: state.data.meta.page < state.data.meta.totalPages,
            loadingMore: false,
            viewState: items.length > 0 ? 'ready' : 'empty',
            errorMessage: '',
            refreshError: '',
            paginationError: '',
          });
          return;
        }
        if (state.status === 'error') fail(state);
      })
      .catch((error: unknown) => fail({
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
        message: '课时预警加载失败，请稍后重试',
      }))
      .finally(() => {
        if (sequence === this.requestSequence) {
          this.pendingRequest = undefined;
          this.pendingKey = '';
        }
      });
    this.pendingRequest = request;
    return request;
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    this.invalidateRequest();
    const query = event.detail.value;
    this.setData({ query, loadingMore: false });
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      void this.loadWarnings(true);
    }, 300);
  },

  onRetry() {
    void this.loadWarnings(true);
  },

  onLoadMore() {
    void this.loadWarnings(false);
  },

  onRetryMore() {
    void this.loadWarnings(false);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateWarnings('登录已失效，请重新登录');
    this.pullSequence += 1;
    this.runtime = undefined;
    createSessionService().logout();
    try {
      wx.reLaunch({ url: '/pages/bootstrap/index' });
    } catch {
      // Keep this page stopped if the native login navigation fails.
    }
  },
});
