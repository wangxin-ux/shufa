import { OperatorPageContext } from '../runtime/operator-page-context';
import {
  buildOperatorTeacherItems, buildOperatorTeacherPerformance, buildOperatorTeacherHistory,
} from '../runtime/services/operator-teacher-archives.presenter';
import type { OperatorTeacherArchive, OperatorTeacherEvaluationRevision } from '../runtime/types/operator';
import { navigateOperatorBack } from '../runtime/utils/operator-navigation';
import { createSessionService } from '../../../services/session.service';

const emptyDetails = () => ({
  expandedId: '', performance: null as ReturnType<typeof buildOperatorTeacherPerformance> | null,
  performanceState: 'loading', performanceError: '',
  historyItems: [] as ReturnType<typeof buildOperatorTeacherHistory>,
  historyState: 'loading', historyLoading: false, historyError: '', historyHasMore: false, historyPage: 0,
});

Page({
  context: undefined as OperatorPageContext | undefined,
  teacherRecords: [] as OperatorTeacherArchive[],
  historyRecords: [] as OperatorTeacherEvaluationRevision[],
  listRequest: undefined as Promise<void> | undefined,
  performanceRequest: undefined as Promise<void> | undefined,
  historyRequest: undefined as Promise<void> | undefined,
  listSequence: 0,
  detailSequence: 0,
  historySequence: 0,
  pullSequence: 0,
  initialShowPending: true,
  historyRetryReset: true,
  listRetryReset: true,
  data: {
    viewState: 'loading', errorMessage: '', query: '', activeQuery: '', toolsOpen: false,
    items: [] as ReturnType<typeof buildOperatorTeacherItems>, total: 0, page: 0,
    listLoading: false, listError: '', hasMore: false, month: '',
    ...emptyDetails(),
  },

  onLoad() {
    this.teacherRecords = [];
    this.historyRecords = [];
    this.context = new OperatorPageContext((errorMessage) => {
      this.listSequence += 1;
      this.clearDetails();
      this.teacherRecords = [];
      this.listRequest = undefined;
      this.setData({
        viewState: 'forbidden', errorMessage, query: '', activeQuery: '', items: [],
        total: 0, page: 0, hasMore: false, listLoading: false, listError: '', month: '',
      });
    });
    void this.loadTeachers(true);
  },

  onShow() {
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadTeachers(true);
  },

  onHide() {
    this.context?.hide();
    this.listSequence += 1;
    this.detailSequence += 1;
    this.historySequence += 1;
    this.pullSequence += 1;
    this.listRequest = undefined;
    this.performanceRequest = undefined;
    this.historyRequest = undefined;
    this.initialShowPending = false;
    this.setData({ listLoading: false, historyLoading: false });
  },

  onUnload() {
    this.context?.dispose();
    this.teacherRecords = [];
    this.historyRecords = [];
    this.listRequest = undefined;
    this.performanceRequest = undefined;
    this.historyRequest = undefined;
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadTeachers(true).finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  clearDetails() {
    this.detailSequence += 1;
    this.historySequence += 1;
    this.historyRecords = [];
    this.performanceRequest = undefined;
    this.historyRequest = undefined;
    this.historyRetryReset = true;
    this.setData(emptyDetails());
  },

  denied(state: { statusCode?: number; message?: string }): boolean {
    if (!this.context?.isCurrent()) return true;
    if (state.statusCode !== 401 && state.statusCode !== 403) return false;
    this.context.invalidate(state.message ?? '当前账号无教师档案访问权限');
    return true;
  },

  unavailable(teacherId?: string) {
    // A pending list must not reintroduce a teacher removed by a late scope error.
    this.listSequence += 1;
    this.listRequest = undefined;
    this.listRetryReset = true;
    if (!teacherId || this.data.expandedId === teacherId) this.clearDetails();
    this.teacherRecords = teacherId ? this.teacherRecords.filter((item) => item.id !== teacherId) : [];
    const message = '该教师档案已不可用，请刷新列表';
    this.setData({
      items: buildOperatorTeacherItems(this.teacherRecords), listLoading: false,
      ...(this.teacherRecords.length ? { viewState: 'ready', listError: message, errorMessage: '' } : {
        viewState: 'error', errorMessage: message, listError: '', total: 0, page: 0, hasMore: false, month: '',
      }),
    });
  },

  loadTeachers(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || (!reset && !this.data.hasMore)) return Promise.resolve();
    if (this.listRequest && (!reset || this.listRetryReset)) return this.listRequest;
    const sequence = ++this.listSequence;
    const page = reset ? 1 : this.data.page + 1;
    this.listRetryReset = reset;
    const query = this.data.activeQuery;
    this.setData({
      listLoading: true, listError: '', errorMessage: '',
      ...(this.teacherRecords.length ? {} : { viewState: 'loading' }),
    });
    const request = Promise.resolve().then(() => {
      if (context.isActive() && sequence === this.listSequence) {
        return context.service.loadTeacherArchives({ page, pageSize: 20, ...(query ? { query } : {}) });
      }
    }).then(async (state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === 'error' && this.denied(state)) return;
      if (state.status === 'error' && state.statusCode === 404) { this.unavailable(); return; }
      if (!context.isActive() || sequence !== this.listSequence) return;
      if (state.status === 'success' || state.status === 'empty') {
        if (state.data.meta.page !== page) {
          this.setData({ listLoading: false, listError: '教师列表分页不一致，请重试',
            viewState: this.teacherRecords.length ? 'ready' : 'error' });
          return;
        }
        const records = new Map((reset ? [] : this.teacherRecords).map((item) => [item.id, item]));
        for (const item of state.data.data) records.set(item.id, item);
        this.teacherRecords = [...records.values()];
        if (this.data.expandedId && !records.has(this.data.expandedId)) this.clearDetails();
        this.setData({
          items: buildOperatorTeacherItems(this.teacherRecords), total: state.data.meta.total,
          page, hasMore: page < state.data.meta.totalPages, listLoading: false, listError: '',
          viewState: this.teacherRecords.length ? 'ready' : 'empty',
        });
        if (reset && this.data.expandedId) {
          this.performanceRequest = undefined;
          await this.loadPerformance();
        }
      } else if (state.status === 'error') {
        this.setData(this.teacherRecords.length
          ? { viewState: 'ready', listError: state.message, listLoading: false }
          : { viewState: 'error', errorMessage: state.message, listLoading: false });
      }
    }).finally(() => {
      if (this.listRequest === request) this.listRequest = undefined;
    });
    this.listRequest = request;
    return request;
  },

  loadPerformance(): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || !this.data.expandedId) return Promise.resolve();
    if (this.performanceRequest) return this.performanceRequest;
    const teacherId = this.data.expandedId;
    const month = this.data.month || undefined;
    const sequence = ++this.detailSequence;
    this.historySequence += 1;
    this.historyRequest = undefined;
    this.setData({
      performanceState: this.data.performance ? 'ready' : 'loading', performanceError: '',
      historyLoading: false,
    });
    const request = Promise.resolve().then(() => {
      if (context.isActive() && sequence === this.detailSequence) {
        return context.service.loadTeacherPerformance(teacherId, month);
      }
    }).then(async (state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === 'error' && this.denied(state)) return;
      if (state.status === 'error' && state.statusCode === 404) { this.unavailable(teacherId); return; }
      if (!context.isActive() || sequence !== this.detailSequence) return;
      if (state.status === 'success') {
        this.setData({
          month: state.data.periodMonth, performance: buildOperatorTeacherPerformance(state.data),
          performanceState: 'ready', performanceError: '',
        });
        // Pin the server's campus month before reading its revision history.
        await this.loadHistory(true);
      } else if (state.status === 'error') {
        this.setData({ performanceState: this.data.performance ? 'ready' : 'error', performanceError: state.message });
      }
    }).finally(() => {
      if (this.performanceRequest === request) this.performanceRequest = undefined;
    });
    this.performanceRequest = request;
    return request;
  },

  loadHistory(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || !this.data.expandedId || !this.data.month ||
        (!reset && !this.data.historyHasMore)) return Promise.resolve();
    if (this.historyRequest) return this.historyRequest;
    const sequence = ++this.historySequence;
    const teacherId = this.data.expandedId;
    const month = this.data.month;
    const page = reset ? 1 : this.data.historyPage + 1;
    this.historyRetryReset = reset;
    this.setData({
      historyLoading: true, historyError: '',
      historyState: this.historyRecords.length ? 'ready' : 'loading',
    });
    const request = Promise.resolve().then(() => {
      if (context.isActive() && sequence === this.historySequence) {
        return context.service.loadTeacherEvaluationHistory(teacherId, { month, page, pageSize: 20 });
      }
    }).then((state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === 'error' && this.denied(state)) return;
      if (state.status === 'error' && state.statusCode === 404) { this.unavailable(teacherId); return; }
      if (!context.isActive() || sequence !== this.historySequence) return;
      if (state.status === 'success' || state.status === 'empty') {
        if (state.data.meta.page !== page) {
          this.setData({ historyLoading: false, historyError: '评价历史分页不一致，请重试',
            historyState: this.historyRecords.length ? 'ready' : 'error' });
          return;
        }
        const records = new Map((reset ? [] : this.historyRecords).map((item) => [`${item.periodMonth}:${item.version}`, item]));
        for (const item of state.data.data) records.set(`${item.periodMonth}:${item.version}`, item);
        this.historyRecords = [...records.values()];
        this.setData({
          historyItems: buildOperatorTeacherHistory(this.historyRecords), historyPage: page,
          historyHasMore: page < state.data.meta.totalPages, historyLoading: false, historyError: '',
          historyState: this.historyRecords.length ? 'ready' : 'empty',
        });
      } else if (state.status === 'error') {
        this.setData({
          historyState: this.historyRecords.length ? 'ready' : 'error',
          historyLoading: false, historyError: state.message,
        });
      }
    }).finally(() => {
      if (this.historyRequest === request) this.historyRequest = undefined;
    });
    this.historyRequest = request;
    return request;
  },

  onTeacherToggle(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive()) return;
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!this.teacherRecords.some((item) => item.id === id)) return;
    const collapse = this.data.expandedId === id;
    this.clearDetails();
    if (!collapse) { this.setData({ expandedId: id }); void this.loadPerformance(); }
  },

  onMonthChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || !this.data.expandedId) return;
    const month = String(event.detail.value);
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || month === this.data.month) return;
    const id = this.data.expandedId;
    this.clearDetails();
    this.setData({ expandedId: id, month });
    void this.loadPerformance();
  },

  onToggleTools() { this.setData({ toolsOpen: !this.data.toolsOpen }); },

  onSearchInput(event: WechatMiniprogram.Input) {
    if (this.context?.isActive()) this.setData({ query: event.detail.value });
  },

  search(query: string) {
    if (!this.context?.isActive()) return;
    this.listSequence += 1;
    this.listRequest = undefined;
    this.teacherRecords = [];
    this.clearDetails();
    this.setData({ activeQuery: query.trim(), query, items: [], total: 0, page: 0, hasMore: false });
    void this.loadTeachers(true);
  },

  onSearchSubmit() { this.search(this.data.query); },
  onSearchClear() { this.search(''); },
  onLoadMore() { void this.loadTeachers(false); },
  onRetry() { void this.loadTeachers(this.listRetryReset); },
  onPerformanceRetry() { void this.loadPerformance(); },
  onHistoryRetry() { void this.loadHistory(this.historyRetryReset); },
  onHistoryMore() { void this.loadHistory(false); },
  onBack() { navigateOperatorBack(wx, getCurrentPages().length); },
  onLogin() {
    if (!this.context) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
