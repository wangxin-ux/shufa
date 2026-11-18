import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  buildPartnerTeacherItems,
  buildPartnerTeacherQuery,
  mergePartnerTeacherItems,
  PartnerTeacherItemModel,
} from '../../../services/partner-teachers.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import { createSessionService } from '../../../services/session.service';

const PAGE_SIZE = 20;
type TeacherStripItem = PartnerTeacherItemModel & { nameFontSize: number };

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
  teachersOwnerKey: '',
  pullSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    paginationError: '',
    query: '',
    items: [] as TeacherStripItem[],
    expandedId: '',
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.teachersOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    void this.loadTeachers(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.loadTeachers(true);
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
    const sequence = ++this.pullSequence;
    void this.loadTeachers(true).finally(() => {
      if (!this.hidden && !this.disposed && sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  invalidateTeachers(message: string) {
    this.invalidateRequest();
    this.contentKey = '';
    this.setData({
      viewState: 'forbidden', errorMessage: message, query: '',
      items: [], expandedId: '', page: 0, total: 0, hasMore: false,
      loadingMore: false, refreshError: '', paginationError: '',
    });
  },

  validateOwner() {
    if (!this.runtime) return false;
    if (getPartnerCampaignDraftService().getSessionKey() === this.teachersOwnerKey) return true;
    this.invalidateTeachers('登录已更新，请重新登录');
    return false;
  },

  loadTeachers(reset: boolean): Promise<void> {
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
              expandedId: '',
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
    const request = Promise.resolve()
      .then(() => {
        if (this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
        return runtime.loadTeachers(buildPartnerTeacherQuery(query, page, PAGE_SIZE));
      })
      .catch((error: unknown) => ({
        status: 'error' as const,
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
        message: '教师信息加载失败，请稍后重试',
      }))
      .then((state) => {
        if (!state || this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
        if (state.status === 'success' || state.status === 'empty') {
          const incoming = Array.from(new Map(
            buildPartnerTeacherItems(state.data.data).map((item) => [item.id, item]),
          ).values());
          const items = mergePartnerTeacherItems(
            this.data.items,
            incoming,
            page,
          ).map((item) => {
            const length = Array.from(item.displayName).length;
            return {
              ...item,
              nameFontSize: length <= 3 ? 90 : length === 4 ? 70 : length <= 6 ? 44 : 36,
            };
          });
          this.contentKey = contentKey;
          this.setData({
            items,
            expandedId: items.some((item) => item.id === this.data.expandedId)
              ? this.data.expandedId : '',
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
        if (state.status !== 'error') return;
        const forbidden = state.statusCode === 401 || state.statusCode === 403;
        if (forbidden) {
          this.invalidateTeachers(state.statusCode === 401
            ? '登录已失效，请重新登录' : '当前账号无权查看本校区教师信息');
          return;
        }
        this.setData({
          loadingMore: false,
          ...(keepContent
            ? reset ? { refreshError: state.message } : { paginationError: state.message }
            : { viewState: 'error', errorMessage: state.message }),
        });
      })
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
    this.setSearchQuery(event.detail.value);
  },

  onClearSearch() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    if (!this.data.query) return;
    this.setSearchQuery('');
  },

  setSearchQuery(query: string) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    this.invalidateRequest();
    this.setData({
      query,
      loadingMore: false,
      ...(JSON.stringify([query.trim()]) !== this.contentKey ? { expandedId: '' } : {}),
    });
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      void this.loadTeachers(true);
    }, 300);
  },

  onRetry() {
    void this.loadTeachers(true);
  },

  onTeacherToggle(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.data.viewState !== 'ready' ||
      this.contentKey !== JSON.stringify([this.data.query.trim()])) return;
    const id: unknown = event.currentTarget.dataset.id;
    if (typeof id !== 'string' || !this.data.items.some((item) => item.id === id)) return;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  onLoadMore() {
    void this.loadTeachers(false);
  },

  onRetryMore() {
    void this.loadTeachers(false);
  },

  onPerformanceForbidden(event: WechatMiniprogram.CustomEvent<{ message: string }>) {
    if (this.hidden || this.disposed) return;
    this.invalidateTeachers(event.detail.message || '登录或访问权限已变化，请重新登录');
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateTeachers('登录已失效，请重新登录');
    this.runtime = undefined;
    createSessionService().logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
