import { loadTeacherDisplayFont } from '../runtime/teacher-display-font';

import { createSessionService } from '../../../services/session.service';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from '../runtime/teacher-read-context';
import {
  buildTeacherStudentDetailPageModel,
  buildTeacherStudentFeedbackModels,
  TeacherStudentFeedbackModel,
  TeacherStudentDetailPageModel,
} from '../../../services/teacher-students.presenter';
import { TeacherStudentDetail } from '../../../types/teacher';

Page({
  context: undefined as TeacherReadContext | undefined,
  runtime: undefined as ReturnType<typeof createTeacherPageService> | undefined,
  hidden: false,
  disposed: false,
  blocked: false,
  pendingDenial: false,
  initialShowPending: false,
  navigating: false,
  navigationSequence: 0,
  requestSequence: 0,
  pullSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  data: {
    viewState: 'loading',
    errorMessage: '',
    studentId: '',
    detail: null as TeacherStudentDetailPageModel | null,
    refreshError: '',
    feedbackHistory: [] as TeacherStudentFeedbackModel[],
    feedbackPage: 0,
    feedbackHasMore: false,
    feedbackLoading: false,
    feedbackError: '',
    photoFailed: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    void loadTeacherDisplayFont();
    this.context = readTeacherReadContext();
    this.initialShowPending = true;
    if (!this.validateOwner()) return;
    try { this.runtime = createTeacherPageService(this.context); }
    catch {
      this.setData({ viewState: 'error', errorMessage: '教师端配置不可用，请重新登录' });
      return;
    }
    this.setData({ studentId: options.id?.trim() ?? '' });
    void this.loadStudent();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.navigating = false;
    this.navigationSequence += 1;
    if (this.pendingDenial) {
      this.invalidateOwner('登录已失效或无权查看该学员，请重新登录');
      return;
    }
    if (!this.validateOwner()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadStudent();
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pullSequence += 1;
    this.navigationSequence += 1;
    this.pendingRequest = undefined;
    this.setData({ feedbackLoading: false });
  },

  onUnload() { this.disposed = true; this.onHide(); },

  invalidateOwner(message: string) {
    this.blocked = true;
    this.pendingDenial = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.setData({
      viewState: 'forbidden', errorMessage: message, detail: null, studentId: '', refreshError: '',
      feedbackHistory: [], feedbackPage: 0, feedbackHasMore: false, feedbackLoading: false, feedbackError: '',
      photoFailed: false,
    });
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

  onPullDownRefresh() {
    if (this.hidden || this.disposed) return;
    if (!this.validateOwner()) { wx.stopPullDownRefresh(); return; }
    const pull = ++this.pullSequence;
    void this.loadStudent().finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  loadStudent(more = false): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    if (!this.data.studentId) {
      this.setData({
        viewState: 'error',
        errorMessage: '缺少学员标识，请返回后重新进入',
        detail: null,
      });
      return Promise.resolve();
    }
    const sequence = ++this.requestSequence;
    const page = more ? this.data.feedbackPage + 1 : 1;
    this.setData({
      ...(!this.data.detail ? { viewState: 'loading' } : {}),
      errorMessage: '', refreshError: '',
      feedbackLoading: more, feedbackError: '',
    });
    const pending = this.runtime.loadStudent(this.data.studentId, {
      feedbackPage: page, feedbackPageSize: 10,
    }).then((state) => {
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        if (!this.disposed && this.validateOwner()) {
          if (this.hidden) this.pendingDenial = true;
          else this.invalidateOwner('登录已失效或无权查看该学员，请重新登录');
        }
        return;
      }
      if (!this.canReceive(sequence)) return;
      if (state.status === 'success') {
        this.applyStudent(state.data, more);
      } else if (state.status === 'empty') {
        this.setData({ viewState: 'empty', detail: null, feedbackHistory: [], feedbackHasMore: false });
      } else if (state.status === 'error') this.applyReadFailure(state.statusCode, more);
    }).catch(() => {
      if (this.canReceive(sequence)) this.applyReadFailure(undefined, more);
    }).finally(() => {
      if (sequence === this.requestSequence) {
        this.pendingRequest = undefined;
        if (!this.hidden && !this.disposed) this.setData({ feedbackLoading: false });
      }
    });
    this.pendingRequest = pending;
    return pending;
  },

  applyStudent(student: TeacherStudentDetail, more: boolean) {
    const incoming = buildTeacherStudentFeedbackModels(student.feedbackHistory?.data ?? []);
    const records = new Map((more ? this.data.feedbackHistory : []).map((item) => [item.id, item]));
    for (const item of incoming) records.set(item.id, item);
    const meta = student.feedbackHistory?.meta;
    this.setData({
      viewState: 'ready',
      ...(!more ? { detail: buildTeacherStudentDetailPageModel(student), photoFailed: false } : {}),
      feedbackHistory: [...records.values()],
      feedbackPage: meta?.page ?? 1,
      feedbackHasMore: !!meta && meta.page < meta.totalPages,
      feedbackError: '',
    });
  },

  applyReadFailure(code?: number, more = false) {
    if (code === 401 || code === 403) {
      this.invalidateOwner('登录已失效或无权查看该学员，请重新登录');
      return;
    }
    if (code === 404) {
      this.setData({ viewState: 'error', detail: null, feedbackHistory: [], feedbackHasMore: false,
        errorMessage: '学员不存在或已不在负责范围，请返回学员列表' });
    } else if (more) {
      this.setData({ feedbackError: '反馈加载失败，请重试' });
    } else this.setData(this.data.detail
      ? { refreshError: '档案刷新失败，请重试' }
      : { viewState: 'error', errorMessage: '档案加载失败，请稍后重试' });
  },

  onRetry() {
    void this.loadStudent();
  },

  onLoadMoreFeedback() {
    if (!this.data.feedbackHasMore || this.data.feedbackLoading) return;
    void this.loadStudent(true);
  },

  onOpenFeedback(event: WechatMiniprogram.BaseEvent) {
    const record = this.data.feedbackHistory.find((item) => item.id === event.currentTarget.dataset.id);
    if (record) this.navigate(`/pages/teacher/feedback-detail/index?id=${encodeURIComponent(record.lessonSessionId)}`);
  },

  onPhotoError() {
    if (!this.hidden && !this.disposed && this.validateOwner())
      this.setData({ photoFailed: true });
  },

  onPreviewFeedback(event: WechatMiniprogram.BaseEvent) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const record = this.data.feedbackHistory.find((item) => item.id === event.currentTarget.dataset.id);
    const current = record?.images.find((image) => image.id === event.currentTarget.dataset.imageId);
    if (!record || !current) return;
    if (Date.parse(current.accessUrlExpiresAt) <= Date.now()) {
      this.setData({ feedbackError: '图片访问已过期，请刷新档案后重试' });
      return;
    }
    wx.previewImage({ current: current.accessUrl, urls: record.images.map((image) => image.accessUrl),
      fail: () => {
        if (!this.hidden && !this.disposed && this.validateOwner())
          this.setData({ feedbackError: '图片打开失败，请刷新档案后重试' });
      } });
  },

  onFeedback() { this.navigate('/pages/teacher/feedback/index'); },
  onStudents() { this.navigate('/pages/teacher/students/index', true); },

  navigate(url: string, returnToList = false) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating) return;
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (!this.hidden && !this.disposed && sequence === this.navigationSequence && this.validateOwner()) {
        this.navigating = false;
      }
    };
    try {
      if (returnToList) {
        const pages = getCurrentPages();
        const index = pages.slice(0, -1).map((page) => page.route).lastIndexOf('pages/teacher/students/index');
        if (index >= 0) wx.navigateBack({ delta: pages.length - 1 - index, fail });
        else wx.redirectTo({ url, fail });
      } else wx.navigateTo({ url, fail });
    } catch { fail(); }
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    createSessionService().logout();
    this.invalidateOwner('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
