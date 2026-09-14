import {
  buildPartnerTeacherItems,
  buildPartnerTeacherQuery,
  mergePartnerTeacherItems,
  PartnerTeacherItemModel,
} from '../../../services/partner-teachers.presenter';
import { partnerService } from '../../../services/partner-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    query: '',
    items: [] as PartnerTeacherItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.loadTeachers(true);
  },

  onUnload() {
    if (searchTimer !== null) clearTimeout(searchTimer);
    searchTimer = null;
  },

  onPullDownRefresh() {
    void this.loadTeachers(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadTeachers(reset: boolean) {
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
    const state = await partnerService.loadTeachers(
      buildPartnerTeacherQuery(this.data.query, page, PAGE_SIZE),
    );
    if (sequence !== requestSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      const items = mergePartnerTeacherItems(
        this.data.items,
        buildPartnerTeacherItems(state.data.data),
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
            ? '当前账号无权查看本校区教师信息'
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
      void this.loadTeachers(true);
    }, 300);
  },

  onRetry() {
    void this.loadTeachers(true);
  },

  onLoadMore() {
    void this.loadTeachers(false);
  },
});
