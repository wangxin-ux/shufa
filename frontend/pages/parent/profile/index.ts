import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import {
  buildParentProfilePageModel,
  PARENT_PROFILE_ACTIONS,
  ParentProfileAction,
  resolveParentProfileAction,
} from '../../../services/parent-profile.presenter';
import { parentService } from '../../../services/parent-runtime';
import { sessionService } from '../../../services/session.service';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    isEmpty: true,
    studentName: '',
    studentAgeLabel: '',
    nameFontSize: 95,
    refreshError: '',
    emptyMessage: '',
    actions: PARENT_PROFILE_ACTIONS,
  },
  disposed: false,
  hasLoaded: false,
  requestVersion: 0,
  refreshTimer: null as ReturnType<typeof setInterval> | null,

  onLoad() {
    void loadParentPdfDisplayFont();
    void this.loadProfile();
  },
  onShow() {
    this.stopRefresh();
    if (this.hasLoaded) void this.loadProfile(true);
    this.refreshTimer = setInterval(() => { void this.loadProfile(true); }, 30000);
  },
  onHide() { this.stopRefresh(); this.requestVersion += 1; },
  onUnload() { this.disposed = true; this.onHide(); },
  stopRefresh() {
    if (this.refreshTimer !== null) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  },

  onPullDownRefresh() {
    void this.loadProfile(this.hasLoaded).finally(() => wx.stopPullDownRefresh());
  },

  async loadProfile(silent = false) {
    if (this.disposed) return;
    const version = ++this.requestVersion;
    if (!silent) this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await parentService.loadProfile();
    if (this.disposed || version !== this.requestVersion) return;

    if (snapshot.status === 'success' || snapshot.status === 'empty') {
      const model = buildParentProfilePageModel(snapshot.data);
      this.hasLoaded = true;
      this.setData({
        ...model,
        nameFontSize: Math.max(20, Math.min(95, Math.floor(360 / Math.max(1, Array.from(model.studentName).length)))),
        viewState: 'ready',
        errorMessage: '',
        refreshError: '',
      });
      return;
    }

    if (snapshot.status === 'error') {
      if (snapshot.statusCode === 401 || snapshot.code === 'UNAUTHORIZED') {
        this.disposed = true;
        this.stopRefresh();
        sessionService.logout();
        wx.reLaunch({ url: '/pages/bootstrap/index' });
        return;
      }
      this.setData(silent && this.hasLoaded ? { refreshError: snapshot.message } :
        { viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadProfile(this.hasLoaded);
  },
  onIdentityTap() {
    if (this.data.isEmpty) return;
    wx.navigateTo({ url: '/pages/parent/student-profile/index' });
  },

  onActionTap(e: WechatMiniprogram.TouchEvent) {
    const action = e.currentTarget.dataset.action as ParentProfileAction;
    if (!PARENT_PROFILE_ACTIONS.some((item) => item.key === action)) {
      return;
    }

    const result = resolveParentProfileAction(action);
    if (result.kind === 'navigate') {
      wx.navigateTo({ url: result.url });
      return;
    }
    wx.showToast({ title: result.title, icon: 'none' });
  },
});
