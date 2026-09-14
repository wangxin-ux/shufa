import {
  buildPartnerProfilePageModel,
  PARTNER_PROFILE_ACTIONS,
  PartnerProfileActionKey,
  resolvePartnerProfileAction,
} from '../../../services/partner-profile.presenter';
import { partnerService } from '../../../services/partner-runtime';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    displayName: '',
    identityLabel: '',
    campusName: '',
    campusCodeLabel: '',
    contactPhoneLabel: '',
    addressLabel: '',
    warningThresholdLabel: '',
    actions: PARTNER_PROFILE_ACTIONS,
  },

  onLoad() {
    void this.loadProfile();
  },

  onPullDownRefresh() {
    void this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  async loadProfile() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await partnerService.loadProfile();
    if (state.status === 'success') {
      this.setData({
        ...buildPartnerProfilePageModel(state.data),
        viewState: 'ready',
        errorMessage: '',
      });
      return;
    }
    if (state.status === 'empty') {
      this.setData({ viewState: 'empty', errorMessage: '' });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无合作方端访问权限'
            : state.message,
      });
    }
  },

  onRetry() {
    void this.loadProfile();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? '') as
      | PartnerProfileActionKey
      | '';
    const action = PARTNER_PROFILE_ACTIONS.find((item) => item.key === key);
    if (!action) return;
    wx.navigateTo({ url: resolvePartnerProfileAction(action.key).url });
  },
});
