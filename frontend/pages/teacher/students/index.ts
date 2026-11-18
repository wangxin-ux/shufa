import { loadTeacherDisplayFont } from '../runtime/teacher-display-font';

import {
  buildTeacherStudentPageModel,
  buildTeacherStudentDetailPageModel,
  buildTeacherStudentQuery,
  mergeTeacherStudentItems,
  TeacherStudentItemModel,
  TeacherStudentSearchDebouncer,
} from '../../../services/teacher-students.presenter';
import { createSessionService } from '../../../services/session.service';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from '../runtime/teacher-read-context';

const PAGE_SIZE = 20;
const emptyPreview = () => ({ expandedId: '', archive: null as ReturnType<typeof buildTeacherStudentDetailPageModel> | null,
  archiveState: 'idle', archiveError: '', archivePhotoFailed: false });
Page({
  context: undefined as TeacherReadContext | undefined,
  runtime: undefined as ReturnType<typeof createTeacherPageService> | undefined,
  searchDebouncer: undefined as TeacherStudentSearchDebouncer | undefined,
  requestSequence: 0,
  pullSequence: 0,
  navigationSequence: 0,
  navigating: false,
  hidden: false,
  disposed: false,
  blocked: false,
  pendingDenial: false,
  initialShowPending: false,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingReset: true,
  archiveSequence: 0,
  data: {
    viewState: 'loading',
    errorMessage: '',
    searchValue: '',
    activeQuery: '',
    items: [] as TeacherStudentItemModel[],
    page: 0,
    hasMore: false,
    loadingMore: false,
    refreshError: '',
    loadMoreError: '',
    searchOpen: false,
    ...emptyPreview(),
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
    this.searchDebouncer = new TeacherStudentSearchDebouncer((activeQuery) => {
      if (this.hidden || this.disposed || !this.validateOwner()) return;
      this.setData({ activeQuery });
      void this.loadStudents(true);
    });
    void this.loadStudents(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.navigating = false;
    this.navigationSequence += 1;
    if (this.pendingDenial) {
      this.invalidateOwner('登录已失效或无权查看负责学员，请重新登录');
      return;
    }
    if (!this.validateOwner()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    this.setData({ activeQuery: this.data.searchValue.trim() });
    void this.loadStudents(true);
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.searchDebouncer?.cancel();
    this.requestSequence += 1;
    this.pullSequence += 1;
    this.navigationSequence += 1;
    this.pendingRequest = undefined;
    this.archiveSequence += 1;
    this.setData(emptyPreview());
  },

  onUnload() { this.disposed = true; this.onHide(); },

  invalidateOwner(message: string) {
    this.blocked = true;
    this.pendingDenial = false;
    this.searchDebouncer?.cancel();
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.archiveSequence += 1;
    this.setData({ viewState: 'forbidden', errorMessage: message, items: [], page: 0,
      hasMore: false, loadingMore: false, searchValue: '', activeQuery: '',
      refreshError: '', loadMoreError: '', ...emptyPreview() });
  },

  validateOwner(): boolean {
    if (this.blocked || !this.context) return false;
    if (isCurrentTeacherReadContext(this.context)) return true;
    this.invalidateOwner('登录已更新，请重新登录');
    return false;
  },

  canReceive(sequence: number): boolean {
    return !this.hidden && !this.disposed && sequence === this.requestSequence && this.validateOwner();
  },

  receiveDenial(code?: number): boolean {
    if (code !== 401 && code !== 403) return false;
    if (!this.disposed && this.validateOwner()) {
      if (this.hidden) this.pendingDenial = true;
      else this.invalidateOwner('登录已失效或无权查看负责学员，请重新登录');
    }
    return true;
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed) return;
    if (!this.validateOwner()) { wx.stopPullDownRefresh(); return; }
    this.searchDebouncer?.cancel();
    this.setData({ activeQuery: this.data.searchValue.trim() });
    const pull = ++this.pullSequence;
    void this.loadStudents(true).finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  loadStudents(reset: boolean): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    if (reset) { this.archiveSequence += 1; this.setData(emptyPreview()); }
    if (this.pendingRequest && (!reset || this.pendingReset)) return this.pendingRequest;
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++this.requestSequence;
    this.pendingReset = reset;
    const keepContent = this.data.page > 0;
    this.setData({ ...(!keepContent ? { viewState: 'loading' } : {}),
      loadingMore: !reset, errorMessage: '', refreshError: '', loadMoreError: '' });
    const pending = this.runtime.loadStudents(
      buildTeacherStudentQuery(this.data.activeQuery, page, PAGE_SIZE),
    ).then((state) => {
      if (state.status === 'error' && this.receiveDenial(state.statusCode)) return;
      if (!this.canReceive(sequence)) return;
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
      } else if (state.status === 'error') this.applyReadFailure(reset, keepContent);
    }).catch(() => {
      if (this.canReceive(sequence)) this.applyReadFailure(reset, keepContent);
    }).finally(() => {
      if (sequence === this.requestSequence) {
        this.pendingRequest = undefined;
        if (!this.hidden && !this.disposed) this.setData({ loadingMore: false });
      }
    });
    this.pendingRequest = pending;
    return pending;
  },

  applyReadFailure(reset: boolean, keepContent: boolean) {
    this.setData(keepContent
      ? { loadingMore: false, [reset ? 'refreshError' : 'loadMoreError']:
        reset ? '刷新失败，请重试' : '加载更多失败，请重试' }
      : { loadingMore: false, viewState: 'error', errorMessage: '学员加载失败，请稍后重试' });
  },

  onToggleSearch() { if (this.validateOwner()) this.setData({ searchOpen: !this.data.searchOpen }); },
  onStudentToggle(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (this.hidden || this.disposed || !this.validateOwner() || !this.data.items.some(item => item.id === id)) return;
    this.archiveSequence += 1;
    if (this.data.expandedId === id) { this.setData(emptyPreview()); return; }
    this.setData({ ...emptyPreview(), expandedId: id });
    void this.loadPreview();
  },
  async loadPreview() {
    const id = this.data.expandedId;
    if (!id || !this.runtime || this.hidden || this.disposed || !this.validateOwner() || !this.data.items.some(item => item.id === id)) return;
    const sequence = ++this.archiveSequence;
    const current = () => !this.hidden && !this.disposed && sequence === this.archiveSequence && this.data.expandedId === id && this.data.items.some(item => item.id === id) && this.validateOwner();
    this.setData({ archiveState: 'loading', archiveError: '' });
    try {
      const state = await this.runtime.loadStudent(id, { feedbackPage: 1, feedbackPageSize: 10 });
      if (state.status === 'error' && this.receiveDenial(state.statusCode)) return;
      if (!current()) return;
      if (state.status === 'success') this.setData({ archive: buildTeacherStudentDetailPageModel(state.data), archiveState: 'ready' });
      else this.setData({ archiveState: 'error', archiveError: '档案暂不可用，请重试' });
    } catch { if (current()) this.setData({ archiveState: 'error', archiveError: '档案暂不可用，请重试' }); }
  },
  onRetryPreview() { void this.loadPreview(); },
  onPreviewPhotoError() { this.setData({ archivePhotoFailed: true }); },

  onSearchInput(event: WechatMiniprogram.Input) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const searchValue = event.detail.value;
    this.requestSequence += 1;
    this.archiveSequence += 1;
    this.pendingRequest = undefined;
    this.setData({
      searchValue, activeQuery: searchValue.trim(), items: [], page: 0, ...emptyPreview(),
      viewState: 'loading', hasMore: false, loadingMore: false, refreshError: '', loadMoreError: '',
      });
    this.searchDebouncer?.schedule(searchValue);
  },

  onRetry() {
    this.searchDebouncer?.cancel();
    void this.loadStudents(!this.data.loadMoreError);
  },

  onLoadMore() {
    void this.loadStudents(false);
  },

  onStudentTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating ||
        !this.data.items.some((item) => item.id === id)) return;
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (!this.hidden && !this.disposed && sequence === this.navigationSequence && this.validateOwner())
        this.navigating = false;
    };
    try { wx.navigateTo({ url: `/pages/teacher/student-detail/index?id=${encodeURIComponent(id)}`, fail }); }
    catch { fail(); }
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    createSessionService().logout();
    this.invalidateOwner('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
