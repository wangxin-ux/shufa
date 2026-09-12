import {
  buildTeacherStudentPageModel,
  buildTeacherStudentQuery,
  mergeTeacherStudentItems,
  TeacherStudentItemModel,
  TeacherStudentSearchDebouncer,
} from '../../../services/teacher-students.presenter';
import { teacherService } from '../../../services/teacher-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;
let searchDebouncer: TeacherStudentSearchDebouncer | null = null;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    searchValue: '',
    activeQuery: '',
    items: [] as TeacherStudentItemModel[],
    page: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    searchDebouncer = new TeacherStudentSearchDebouncer((activeQuery) => {
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
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) {
      return;
    }
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? { viewState: 'loading', errorMessage: '', items: [], loadingMore: false }
        : { loadingMore: true, errorMessage: '' },
    );
    const state = await teacherService.loadStudents(
      buildTeacherStudentQuery(this.data.activeQuery, page, PAGE_SIZE),
    );
    if (sequence !== requestSequence) {
      return;
    }

    if (state.status === 'success' || state.status === 'empty') {
      const incoming = buildTeacherStudentPageModel(state.data.data);
      const items = mergeTeacherStudentItems(this.data.items, incoming, page);
      this.setData({
        items,
        page: state.data.meta.page,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length === 0 ? 'empty' : 'ready',
        errorMessage: '',
      });
      return;
    }

    if (state.status === 'error') {
      this.setData({
        loadingMore: false,
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403 ? '当前账号无权查看负责学员' : state.message,
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

  onLoadMore() {
    void this.loadStudents(false);
  },

  onStudentTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/teacher/student-detail/index?id=${encodeURIComponent(id)}`,
    });
  },
});
