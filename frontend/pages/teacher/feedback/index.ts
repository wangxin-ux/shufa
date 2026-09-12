import {
  buildTeacherFeedbackPageModel,
  mergeTeacherFeedbackItems,
  resolveTeacherFeedbackNavigation,
  TeacherFeedbackItemModel,
} from '../../../services/teacher-feedback.presenter';
import { teacherService } from '../../../services/teacher-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    items: [] as TeacherFeedbackItemModel[],
    page: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.loadFeedback(true);
  },

  onShow() {
    if (this.data.page > 0) {
      void this.loadFeedback(true);
    }
  },

  onPullDownRefresh() {
    void this.loadFeedback(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadFeedback(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) {
      return;
    }
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: 'loading',
            items: [],
            errorMessage: '',
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );
    const state = await teacherService.loadTeachingRecords({
      page,
      pageSize: PAGE_SIZE,
    });
    if (sequence !== requestSequence) {
      return;
    }
    if (state.status === 'success' || state.status === 'empty') {
      const items = mergeTeacherFeedbackItems(
        this.data.items,
        buildTeacherFeedbackPageModel(state.data.data),
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
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看课堂反馈'
            : state.message,
      });
    }
  },

  onFeedbackTap(event: WechatMiniprogram.TouchEvent) {
    const lessonSessionId = String(event.currentTarget.dataset.id ?? '');
    if (!lessonSessionId) {
      return;
    }
    wx.navigateTo(resolveTeacherFeedbackNavigation(lessonSessionId));
  },

  onRetry() {
    void this.loadFeedback(true);
  },

  onLoadMore() {
    void this.loadFeedback(false);
  },
});
