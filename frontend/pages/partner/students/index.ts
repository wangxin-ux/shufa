import {
  buildPartnerStudentItems,
  buildPartnerStudentQuery,
  mergePartnerStudentItems,
  PartnerStudentItemModel,
  PartnerStudentSearchDebouncer,
  resolvePartnerStudentDetailRoute,
} from '../../../services/partner-students.presenter';
import { partnerService } from '../../../services/partner-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;
let searchDebouncer: PartnerStudentSearchDebouncer | null = null;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    searchValue: '',
    activeQuery: '',
    items: [] as PartnerStudentItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    searchDebouncer = new PartnerStudentSearchDebouncer((activeQuery) => {
      this.setData({ activeQuery });
      void this.loadStudents(true);
    });
    void this.loadStudents(true);
  },

  onUnload() {
    searchDebouncer?.cancel();
    searchDebouncer = null;
  },

  onPullDownRefresh() {
    void this.loadStudents(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadStudents(reset: boolean) {
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
    const state = await partnerService.loadStudents(
      buildPartnerStudentQuery(this.data.activeQuery, page, PAGE_SIZE),
    );
    if (sequence !== requestSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      const items = mergePartnerStudentItems(
        this.data.items,
        buildPartnerStudentItems(state.data.data),
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
            ? '当前账号无权查看本校区学员档案'
            : state.message,
      });
    }
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const searchValue = event.detail.value;
    this.setData({ searchValue });
    searchDebouncer?.schedule(searchValue);
  },

  onRetry() {
    void this.loadStudents(true);
  },

  onStudentTap(event: WechatMiniprogram.TouchEvent) {
    const studentId = String(event.currentTarget.dataset.id ?? '');
    if (!studentId) return;
    wx.navigateTo({ url: resolvePartnerStudentDetailRoute(studentId) });
  },

  onLoadMore() {
    void this.loadStudents(false);
  },
});
