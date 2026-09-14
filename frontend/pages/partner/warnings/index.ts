import {
  buildPartnerWarningItems,
  buildPartnerWarningQuery,
  mergePartnerWarningItems,
  PartnerWarningItemModel,
} from '../../../services/partner-warnings.presenter';
import { partnerService } from '../../../services/partner-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    query: '',
    items: [] as PartnerWarningItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.loadWarnings(true);
  },

  onUnload() {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  },

  onPullDownRefresh() {
    void this.loadWarnings(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadWarnings(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: 'loading',
            errorMessage: '',
            items: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );
    const state = await partnerService.loadWarnings(
      buildPartnerWarningQuery(this.data.query, page, PAGE_SIZE),
    );
    if (sequence !== requestSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      const items = mergePartnerWarningItems(
        this.data.items,
        buildPartnerWarningItems(state.data.data),
        page,
      );
      this.setData({
        items,
        page: state.data.meta.page,
        total: state.data.meta.total,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length > 0 ? 'ready' : 'empty',
        errorMessage: '',
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        loadingMore: false,
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看本校区课时预警'
            : state.message,
      });
    }
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const query = event.detail.value;
    this.setData({ query });
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void this.loadWarnings(true);
    }, 300);
  },

  onRetry() {
    void this.loadWarnings(true);
  },

  onLoadMore() {
    void this.loadWarnings(false);
  },
});
