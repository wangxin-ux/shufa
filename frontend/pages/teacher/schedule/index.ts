import { loadTeacherDisplayFont } from '../runtime/teacher-display-font';

import {
  buildTeacherSchedulePageModel,
  buildTeacherScheduleQuery,
  resolveTeacherScheduleNavigation,
  TEACHER_SCHEDULE_STATUS_FILTERS,
  TeacherScheduleItemModel,
  TeacherScheduleStatusFilter,
} from '../../../services/teacher-schedule.presenter';
import { createSessionService } from '../../../services/session.service';
import { TeacherService } from '../../../services/teacher.service';
import { formatDateLabel } from '../../../utils/format';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from '../runtime/teacher-read-context';
import {
  presentTeacherRosterSummary, TeacherRosterSummaryModel,
} from '../runtime/teacher-roster-summary.presenter';

const PAGE_SIZE = 10;
type ScheduleItem = TeacherScheduleItemModel & { rosterSummary: TeacherRosterSummaryModel };

const ALL_DATE_LABEL = '全部日期';
const FILTER_LABEL = '筛选';

function presentDateFilterLabel(value: string): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  return matched ? `${Number(matched[2])}月${Number(matched[3])}日` : ALL_DATE_LABEL;
}

Page({
  context: undefined as TeacherReadContext | undefined,
  runtime: undefined as TeacherService | undefined,
  hidden: false,
  disposed: false,
  blocked: false,
  loaded: false,
  initialShowPending: false,
  pendingDenial: false,
  requestSequence: 0,
  pullSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  failedReadMode: undefined as 'refresh' | 'more' | undefined,
  autoExpandPending: true,
  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    selectedDate: '',
    selectedStatus: 'ALL' as TeacherScheduleStatusFilter,
    statusFilters: TEACHER_SCHEDULE_STATUS_FILTERS,
    filterOpen: false,
    dateFilterLabel: ALL_DATE_LABEL,
    statusFilterLabel: FILTER_LABEL,
    items: [] as ScheduleItem[],
    expandedId: '',
    page: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void loadTeacherDisplayFont();
    this.context = readTeacherReadContext();
    this.initialShowPending = true;
    if (!this.validateOwner()) return;
    try { this.runtime = createTeacherPageService(this.context); }
    catch {
      this.setData({ viewState: 'error', errorMessage: '教师端配置不可用，请重新登录' });
      return;
    }
    void this.loadSchedule(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.pendingDenial) { this.invalidateOwner(); return; }
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadSchedule(true);
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pullSequence += 1;
    this.pendingRequest = undefined;
    this.failedReadMode = undefined;
    this.setData({ loadingMore: false });
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
    this.pendingDenial = false;
    this.clearPrivate();
    this.runtime = undefined;
  },

  clearPrivate() {
    this.loaded = false;
    this.failedReadMode = undefined;
    this.setData({
      items: [], expandedId: '', page: 0, hasMore: false, loadingMore: false, refreshError: '',
    });
  },

  invalidateOwner() {
    this.blocked = true;
    this.pendingDenial = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.clearPrivate();
    this.setData({
      viewState: 'forbidden',
      errorMessage: '登录已失效或无教师端访问权限，请重新登录',
    });
  },

  validateOwner(): boolean {
    if (this.blocked || !this.context || this.disposed) return false;
    if (isCurrentTeacherReadContext(this.context)) return true;
    this.invalidateOwner();
    return false;
  },

  canReceive(sequence: number): boolean {
    return this.validateOwner() && !this.hidden && sequence === this.requestSequence;
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed) return;
    if (!this.validateOwner()) { wx.stopPullDownRefresh(); return; }
    const pull = ++this.pullSequence;
    void this.loadSchedule(true).finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence &&
        this.validateOwner()) wx.stopPullDownRefresh();
    });
  },

  loadSchedule(reset: boolean): Promise<void> {
    if (!this.validateOwner() || this.hidden || !this.runtime) return Promise.resolve();
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) {
      return Promise.resolve();
    }
    if (this.pendingRequest && !(reset && this.data.loadingMore)) return this.pendingRequest;
    this.failedReadMode = undefined;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++this.requestSequence;
    this.setData({
      ...(!this.loaded ? { viewState: 'loading' } : {}),
      loadingMore: !reset, errorMessage: '', refreshError: '',
    });
    const pending = this.runtime.loadLessonSessions(
      buildTeacherScheduleQuery({
        date: this.data.selectedDate,
        status: this.data.selectedStatus,
        page,
        pageSize: PAGE_SIZE,
      }),
    ).then(state => {
      if (this.disposed || !this.validateOwner()) return;
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        if (this.hidden) this.pendingDenial = true;
        else this.invalidateOwner();
        return;
      }
      if (!this.canReceive(sequence)) return;
      if (state.status !== 'success' && state.status !== 'empty') {
        if (state.status === 'error') this.applyReadFailure(reset);
        return;
      }
      const incoming = buildTeacherSchedulePageModel(
        state.data.data,
        formatDateLabel(new Date()),
      ).map((item, index): ScheduleItem => {
        const rosterSummary = presentTeacherRosterSummary(state.data.data[index]);
        return { ...item, studentCountLabel: rosterSummary.expectedLabel, rosterSummary };
      });
      const byId = new Map((page <= 1 ? [] : this.data.items).map(item => [item.id, item]));
      for (const item of incoming) byId.set(item.id, item);
      const items = [...byId.values()];
      const keepExpanded = items.some(item => item.id === this.data.expandedId);
      let expandedId = keepExpanded ? this.data.expandedId : '';
      if (!expandedId && this.autoExpandPending && page <= 1 && items.length > 0) {
        expandedId = items[0].id;
      }
      if (page <= 1) this.autoExpandPending = false;
      this.loaded = true;
      this.setData({
        items, expandedId,
        page: state.data.meta.page, hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false, viewState: items.length === 0 ? 'empty' : 'ready',
        errorMessage: '', refreshError: '',
      });
    }).catch(() => {
      if (this.canReceive(sequence)) this.applyReadFailure(reset);
    }).finally(() => {
      if (sequence === this.requestSequence) this.pendingRequest = undefined;
    });
    this.pendingRequest = pending;
    return pending;
  },

  applyReadFailure(reset: boolean) {
    this.failedReadMode = reset ? 'refresh' : 'more';
    this.setData(this.loaded
      ? { refreshError: '刷新失败，请重试', loadingMore: false }
      : { viewState: 'error', errorMessage: '课表加载失败，请稍后重试', loadingMore: false });
  },

  resetFilters() {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.clearPrivate();
    void this.loadSchedule(true);
  },

  onRetry() {
    if (this.pendingRequest) return;
    void this.loadSchedule(this.failedReadMode !== 'more');
  },

  onFilterToggle() {
    if (this.hidden || !this.validateOwner()) return;
    this.setData({ filterOpen: !this.data.filterOpen });
  },

  onDateChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (this.hidden || !this.validateOwner()) return;
    const selectedDate = event.detail.value;
    this.setData({ selectedDate, dateFilterLabel: presentDateFilterLabel(selectedDate) });
    this.resetFilters();
  },

  onClearDate() {
    if (this.hidden || !this.validateOwner()) return;
    this.setData({ selectedDate: '', dateFilterLabel: ALL_DATE_LABEL });
    this.resetFilters();
  },

  onStatusTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || !this.validateOwner()) return;
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
    const matched = TEACHER_SCHEDULE_STATUS_FILTERS.find(({ value }) => value === selectedStatus);
    this.setData({
      selectedStatus,
      filterOpen: false,
      statusFilterLabel: selectedStatus === 'ALL' || !matched
        ? FILTER_LABEL
        : `${FILTER_LABEL}·${matched.label}`,
    });
    this.resetFilters();
  },

  onToggleLesson(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || !this.validateOwner() || !this.loaded) return;
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!this.data.items.some(item => item.id === id)) return;
    this.setData({ expandedId: this.data.expandedId === id ? '' : id });
  },

  onLessonTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || !this.validateOwner() || !this.loaded) return;
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

  onLogin() {
    if (this.hidden || this.disposed) return;
    createSessionService().logout();
    this.invalidateOwner();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
