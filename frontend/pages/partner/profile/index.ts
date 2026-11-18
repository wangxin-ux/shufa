import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  buildPartnerProfilePageModel,
  PARTNER_PROFILE_ACTIONS,
  PARTNER_PROFILE_PRIMARY_ACTIONS,
  PARTNER_PROFILE_SECONDARY_ACTIONS,
  PartnerProfileActionKey,
  resolvePartnerProfileAction,
} from '../../../services/partner-profile.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import { createSessionService } from '../../../services/session.service';

const EMPTY_PROFILE = {
    displayName: '',
    identityLabel: '',
    campusName: '',
    campusNameCompact: false,
    campusNameFontSizeRpx: 54,
    campusNameHeightRpx: 63.72,
    campusCodeLabel: '',
    contactPhoneLabel: '',
    addressLabel: '',
    warningThresholdLabel: '',
    activeStudentCountLabel: '',
    moreExpanded: false,
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
  profileOwnerKey: '',
  pullSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    profileBodyHeightPx: 800,
    ...EMPTY_PROFILE,
    primaryActions: PARTNER_PROFILE_PRIMARY_ACTIONS,
    secondaryActions: PARTNER_PROFILE_SECONDARY_ACTIONS,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.profileOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.updateLayout();
    this.initialShowPending = true;
    void this.loadProfile();
  },

  onResize() {
    if (!this.disposed) this.updateLayout();
  },

  updateLayout() {
    if (typeof wx.getWindowInfo !== 'function') return;
    const info = wx.getWindowInfo();
    let headerBottom = (info.statusBarHeight ?? 20) + 8 + 52;
    try {
      const capsule = wx.getMenuButtonBoundingClientRect();
      if (capsule.height > 0) {
        headerBottom = capsule.top + Math.max(capsule.height + 16, 88 * info.windowWidth / 750);
      }
    } catch {
      // Match the page shell's status-bar fallback.
    }
    this.setData({
      profileBodyHeightPx: Math.max(0, Math.floor(
        info.windowHeight - headerBottom - 42 * info.windowWidth / 750,
      )),
    });
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.navigating = false;
    this.navigationSequence += 1;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.loadProfile();
  },

  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.navigating = false;
    this.navigationSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadProfile().finally(() => {
      if (!this.hidden && !this.disposed && sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  invalidateProfile(message: string) {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.navigationSequence += 1;
    this.navigating = false;
    this.setData({
      ...EMPTY_PROFILE,
      viewState: 'forbidden',
      errorMessage: message,
      refreshError: '',
    });
  },

  validateOwner() {
    if (!this.runtime) return false;
    if (getPartnerCampaignDraftService().getSessionKey() === this.profileOwnerKey) return true;
    this.invalidateProfile('登录已更新，请重新登录');
    return false;
  },

  loadProfile(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    const runtime = this.runtime;
    if (this.pendingRequest) return this.pendingRequest;
    const sequence = ++this.requestSequence;
    const keepContent = this.data.viewState === 'ready';
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading', ...EMPTY_PROFILE }),
      errorMessage: '',
      refreshError: '',
    });
    const fail = (failure: { statusCode?: number; message: string }) => {
      if (this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
      if (failure.statusCode === 401 || failure.statusCode === 403) {
        this.invalidateProfile(failure.statusCode === 401
          ? '登录已失效，请重新登录'
          : '当前账号无合作方端访问权限');
        return;
      }
      this.setData(keepContent
        ? { refreshError: failure.message }
        : { viewState: 'error', errorMessage: failure.message });
    };
    const request = Promise.resolve()
      .then(() => {
        if (this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
        return runtime.loadProfile();
      })
      .then((state) => {
        if (!state || this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner()) return;
        if (state.status === 'success') {
          this.setData({
            ...buildPartnerProfilePageModel(state.data),
            viewState: 'ready',
            errorMessage: '',
            refreshError: '',
          });
          return;
        }
        if (state.status === 'empty') {
          this.setData({
            ...EMPTY_PROFILE,
            viewState: 'empty',
            errorMessage: '',
            refreshError: '',
          });
          return;
        }
        if (state.status === 'error') {
          fail(state);
        }
      })
      .catch((error: unknown) => fail({
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
        message: '合作方资料加载失败，请重试',
      }))
      .finally(() => {
        if (sequence === this.requestSequence) this.pendingRequest = undefined;
      });
    this.pendingRequest = request;
    return request;
  },

  onRetry() {
    void this.loadProfile();
  },

  onMoreToggle() {
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating || this.data.viewState !== 'ready') return;
    this.setData({ moreExpanded: !this.data.moreExpanded });
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating || this.data.viewState !== 'ready') return;
    const key = String(event.currentTarget.dataset.key ?? '') as
      | PartnerProfileActionKey
      | '';
    const action = PARTNER_PROFILE_ACTIONS.find((item) => item.key === key);
    if (!action) return;
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (this.hidden || this.disposed || !this.validateOwner() || sequence !== this.navigationSequence) return;
      this.navigating = false;
      if (this.data.viewState !== 'ready') return;
      wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
    };
    try {
      wx.navigateTo({ url: resolvePartnerProfileAction(action.key).url, fail });
    } catch {
      fail();
    }
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateProfile('登录已失效，请重新登录');
    this.runtime = undefined;
    createSessionService().logout();
    try {
      wx.reLaunch({ url: '/pages/bootstrap/index' });
    } catch {
      // Keep this page stopped if the native login navigation fails.
    }
  },
});
