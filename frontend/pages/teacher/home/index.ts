import { loadTeacherDisplayFont } from '../runtime/teacher-display-font';

import {
  buildTeacherHomePageModel,
  resolveTeacherHomeAction,
  TEACHER_HOME_ACTIONS,
} from '../../../services/teacher-home.presenter';
import { createSessionService } from '../../../services/session.service';
import { TeacherService } from '../../../services/teacher.service';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from '../runtime/teacher-read-context';
import { presentTeacherRosterSummary } from '../runtime/teacher-roster-summary.presenter';

type HomePageModel = ReturnType<typeof buildTeacherHomePageModel>;

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
  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    teacher: {
      displayName: '',
      subjectLabel: '',
      campusName: '',
    },
    nextLesson: null as HomePageModel['nextLesson'],
    rosterSummary: presentTeacherRosterSummary(null),
    stats: [] as HomePageModel['stats'],
    emptyMessage: '今日暂无待上课程',
    actions: TEACHER_HOME_ACTIONS,
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
    void this.loadHome();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.pendingDenial) { this.invalidateOwner(); return; }
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadHome();
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pullSequence += 1;
    this.pendingRequest = undefined;
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
    this.setData({
      teacher: { displayName: '', subjectLabel: '', campusName: '' },
      nextLesson: null, rosterSummary: presentTeacherRosterSummary(null), stats: [],
      refreshError: '',
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
    void this.loadHome().finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence &&
        this.validateOwner()) wx.stopPullDownRefresh();
    });
  },

  loadHome(): Promise<void> {
    if (!this.validateOwner() || this.hidden || !this.runtime) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    const sequence = ++this.requestSequence;
    this.setData({
      ...(!this.loaded ? { viewState: 'loading' } : {}),
      errorMessage: '', refreshError: '',
    });
    const pending = this.runtime.loadDashboard().then(state => {
      // Explicit denial remains authoritative even after a newer successful read.
      if (this.disposed || !this.validateOwner()) return;
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        if (this.hidden) this.pendingDenial = true;
        else this.invalidateOwner();
        return;
      }
      if (!this.canReceive(sequence)) return;
      if (state.status === 'success' || state.status === 'empty') {
        const model = buildTeacherHomePageModel(state.data);
        const rosterSummary = presentTeacherRosterSummary(state.data.nextLesson);
        if (model.nextLesson) model.nextLesson.statusPrefix = rosterSummary.hasWarning ? '课时预警/' : '';
        this.loaded = true;
        this.setData({
          ...model, rosterSummary, viewState: state.status === 'empty' ? 'empty' : 'ready',
          errorMessage: '', refreshError: '',
        });
      } else if (state.status === 'error') this.applyReadFailure();
    }).catch(() => {
      if (this.canReceive(sequence)) this.applyReadFailure();
    }).finally(() => {
      if (sequence === this.requestSequence) this.pendingRequest = undefined;
    });
    this.pendingRequest = pending;
    return pending;
  },

  applyReadFailure() {
    this.setData(this.loaded ? { refreshError: '刷新失败，请重试' }
      : { viewState: 'error', errorMessage: '课表加载失败，请稍后重试' });
  },

  onRetry() {
    void this.loadHome();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || !this.validateOwner() || !this.loaded) return;
    const key = String(event.currentTarget.dataset.key ?? '');
    const result = resolveTeacherHomeAction(key, this.data.nextLesson?.id);
    if (result.kind === 'navigate') {
      wx.navigateTo({ url: result.url });
      return;
    }
    wx.showToast({ title: result.message, icon: 'none' });
  },

  onProfileTap() {
    if (this.hidden || !this.validateOwner() || !this.loaded) return;
    const result = resolveTeacherHomeAction('profile');
    if (result.kind === 'navigate') {
      wx.navigateTo({ url: result.url });
    }
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    createSessionService().logout();
    this.invalidateOwner();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
