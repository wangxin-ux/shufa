import {
  buildTeacherSchedulePageModel,
  buildTeacherScheduleQuery,
  mergeTeacherScheduleItems,
  resolveTeacherScheduleNavigation,
  TEACHER_SCHEDULE_STATUS_FILTERS,
  TeacherScheduleItemModel,
  TeacherScheduleStatusFilter,
} from '../../../services/teacher-schedule.presenter';
import { teacherService } from '../../../services/teacher-runtime';

const PAGE_SIZE = 10;
let requestSequence = 0;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    selectedDate: '',
    selectedStatus: 'ALL' as TeacherScheduleStatusFilter,
    statusFilters: TEACHER_SCHEDULE_STATUS_FILTERS,
    items: [] as TeacherScheduleItemModel[],
    page: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.loadSchedule(true);
  },

  onPullDownRefresh() {
    void this.loadSchedule(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadSchedule(reset: boolean) {
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
    const state = await teacherService.loadLessonSessions(
      buildTeacherScheduleQuery({
        date: this.data.selectedDate,
        status: this.data.selectedStatus,
        page,
        pageSize: PAGE_SIZE,
      }),
    );
    if (sequence !== requestSequence) {
      return;
    }

    if (state.status === 'success' || state.status === 'empty') {
      const incoming = buildTeacherSchedulePageModel(state.data.data);
      const items = mergeTeacherScheduleItems(this.data.items, incoming, page);
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
          state.statusCode === 403 ? '当前账号无权查看教师课表' : state.message,
      });
    }
  },

  onRetry() {
    void this.loadSchedule(true);
  },

  onDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ selectedDate: event.detail.value });
    void this.loadSchedule(true);
  },

  onClearDate() {
    this.setData({ selectedDate: '' });
    void this.loadSchedule(true);
  },

  onStatusTap(event: WechatMiniprogram.TouchEvent) {
    const selectedStatus = String(
      event.currentTarget.dataset.status ?? 'ALL',
    ) as TeacherScheduleStatusFilter;
    if (
      selectedStatus === this.data.selectedStatus ||
      !TEACHER_SCHEDULE_STATUS_FILTERS.some(
        ({ value }) => value === selectedStatus,
      )
    ) {
      return;
    }
    this.setData({ selectedStatus });
    void this.loadSchedule(true);
  },

  onLessonTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const item = this.data.items.find((candidate) => candidate.id === id);
    if (!item) {
      return;
    }
    const result = resolveTeacherScheduleNavigation(id, item.actionDisabled);
    if (result.kind === 'navigate') {
      wx.navigateTo({ url: result.url });
    }
  },

  onLoadMore() {
    void this.loadSchedule(false);
  },
});
