import {
  buildTeacherLedgerPageModel,
  mergeTeacherLedgerItems,
  TeacherLedgerItemModel,
} from '../../../services/teacher-ledger.presenter';
import { teacherService } from '../../../services/teacher-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    items: [] as TeacherLedgerItemModel[],
    page: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.loadLedger(true);
  },

  onPullDownRefresh() {
    void this.loadLedger(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadLedger(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? { viewState: 'loading', items: [], errorMessage: '', loadingMore: false }
        : { loadingMore: true, errorMessage: '' },
    );
    const state = await teacherService.loadLessonLedger({ page, pageSize: PAGE_SIZE });
    if (sequence !== requestSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      const items = mergeTeacherLedgerItems(
        this.data.items,
        buildTeacherLedgerPageModel(state.data.data),
        page,
      );
      this.setData({
        items,
        page: state.data.meta.page,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length ? 'ready' : 'empty',
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        loadingMore: false,
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: state.statusCode === 403 ? '当前账号无权查看扣课流水' : state.message,
      });
    }
  },

  onRetry() {
    void this.loadLedger(true);
  },

  onLoadMore() {
    void this.loadLedger(false);
  },
});
