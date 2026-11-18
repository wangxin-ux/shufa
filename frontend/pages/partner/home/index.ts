import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import { presentPartnerEnrollment } from '../runtime/partner-enrollment.presenter';
import {
  buildPartnerHomePageModel,
  PARTNER_HOME_ACTIONS,
  resolvePartnerHomeAction,
} from '../../../services/partner-home.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { createSessionService } from '../../../services/session.service';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import {
  PARTNER_PROFILE_PRIMARY_ACTIONS,
  PARTNER_PROFILE_SECONDARY_ACTIONS,
} from '../../../services/partner-profile.presenter';

type HomePageModel = ReturnType<typeof buildPartnerHomePageModel>;

const EMPTY_HOME = {
  partnerName: '',
  campusName: '',
  highlightValue: '0',
  highlightFontSizeRpx: 152,
  highlightUnit: '节',
  highlightStudent: '',
  highlightClass: '',
  highlightSummary: '',
  highlightEnrollment: null as ReturnType<typeof presentPartnerEnrollment> | null,
  highlightCourses: [] as HomePageModel['highlightCourses'],
  highlightAttendance: '',
  stats: [] as HomePageModel['stats'],
};

Page({
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  hidden: false,
  disposed: false,
  initialShowPending: false,
  navigating: false,
  navigationSequence: 0,
  runtime: undefined as ReturnType<typeof createPartnerService> | undefined,
  homeOwnerKey: '',
  pullSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    menuExpanded: false,
    primaryMenuActions: PARTNER_PROFILE_PRIMARY_ACTIONS,
    secondaryMenuActions: PARTNER_PROFILE_SECONDARY_ACTIONS,
    ...EMPTY_HOME,
    actions: PARTNER_HOME_ACTIONS,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.homeOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    void this.loadHome();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    this.navigating = false;
    this.navigationSequence += 1;
    this.setData({ menuExpanded: false });
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.loadHome(true);
  },

  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.navigationSequence += 1;
    this.navigating = false;
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadHome(true).finally(() => {
      if (!this.hidden && !this.disposed && sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  invalidateHome(message: string) {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.navigationSequence += 1;
    this.navigating = false;
    this.setData({
      ...EMPTY_HOME, viewState: 'forbidden', errorMessage: message,
      refreshError: '', menuExpanded: false,
    });
  },

  validateOwner() {
    if (!this.runtime) return false;
    if (getPartnerCampaignDraftService().getSessionKey() === this.homeOwnerKey) return true;
    this.invalidateHome('登录已更新，请重新登录');
    return false;
  },

  loadHome(silent = false): Promise<void> {
    if (this.disposed || this.hidden || !this.validateOwner() || !this.runtime) return Promise.resolve();
    const runtime = this.runtime;
    if (this.pendingRequest) return this.pendingRequest;
    const sequence = ++this.requestSequence;
    const keepContent =
      silent && ['ready', 'empty'].includes(this.data.viewState);
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading' }),
      errorMessage: '',
      refreshError: '',
    });
    const fail = (failure: { statusCode?: number; message: string }) => {
      if (this.disposed || this.hidden || sequence !== this.requestSequence || !this.validateOwner()) return;
      if (failure.statusCode === 401 || failure.statusCode === 403) {
        this.invalidateHome(failure.statusCode === 401
          ? '登录已失效，请重新登录' : '当前账号无合作方端访问权限');
      } else {
        this.setData(keepContent
          ? { refreshError: failure.message }
          : { viewState: 'error', errorMessage: failure.message });
      }
    };
    const request = Promise.resolve()
      .then(() => {
        if (this.disposed || this.hidden || sequence !== this.requestSequence || !this.validateOwner()) return;
        return runtime.loadDashboard();
      })
      .then((state) => {
        if (!state || this.disposed || this.hidden || sequence !== this.requestSequence || !this.validateOwner()) return;
        if (state.status === 'success' || state.status === 'empty') {
          this.setData({
            ...buildPartnerHomePageModel(state.data),
            highlightEnrollment: state.data.highlight
              ? presentPartnerEnrollment(state.data.highlight) : null,
            viewState: state.status === 'empty' ? 'empty' : 'ready',
            errorMessage: '',
            refreshError: '',
          });
        } else if (state.status === 'error') {
          fail(state);
        }
      })
      .catch((error: unknown) => fail({
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
        message: keepContent ? '经营数据刷新失败，请重试' : '经营数据加载失败，请重试',
      }))
      .finally(() => {
        if (sequence === this.requestSequence) this.pendingRequest = undefined;
      });
    this.pendingRequest = request;
    return request;
  },

  onRetry() {
    void this.loadHome(true);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateHome('登录已失效，请重新登录');
    this.runtime = undefined;
    createSessionService().logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating ||
      !['ready', 'empty'].includes(this.data.viewState)) return;
    const key = String(event.currentTarget.dataset.key ?? '');
    const result = resolvePartnerHomeAction(key);
    if (result.kind === 'unavailable') {
      wx.showToast({ title: result.message, icon: 'none' });
      return;
    }
    this.navigating = true;
    this.setData({ menuExpanded: false });
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (this.hidden || this.disposed || sequence !== this.navigationSequence || !this.validateOwner()) return;
      this.navigating = false;
      if (!['ready', 'empty'].includes(this.data.viewState)) return;
      wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
    };
    try {
      wx.navigateTo({ url: result.url, fail });
    } catch {
      fail();
    }
  },

  onMenuToggle() {
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating ||
      !['ready', 'empty'].includes(this.data.viewState)) return;
    this.setData({ menuExpanded: !this.data.menuExpanded });
  },

  onCloseMenu() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    this.setData({ menuExpanded: false });
  },

  noop() {},
});
