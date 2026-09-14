import {
  buildPartnerHomePageModel,
  PARTNER_HOME_ACTIONS,
  resolvePartnerHomeAction,
} from '../../../services/partner-home.presenter';
import { partnerService } from '../../../services/partner-runtime';

type HomePageModel = ReturnType<typeof buildPartnerHomePageModel>;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    partnerName: '',
    campusName: '',
    highlightValue: '0',
    highlightUnit: '节',
    highlightStudent: '',
    highlightClass: '',
    highlightSummary: '',
    stats: [] as HomePageModel['stats'],
    actions: PARTNER_HOME_ACTIONS,
  },

  onLoad() {
    void this.loadHome();
  },

  onPullDownRefresh() {
    void this.loadHome().finally(() => wx.stopPullDownRefresh());
  },

  async loadHome() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await partnerService.loadDashboard();
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        ...buildPartnerHomePageModel(state.data),
        viewState: state.status === 'empty' ? 'empty' : 'ready',
        errorMessage: '',
      });
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
    void this.loadHome();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? '');
    const result = resolvePartnerHomeAction(key);
    if (result.kind === 'unavailable') {
      wx.showToast({ title: result.message, icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: result.url,
      fail: () =>
        wx.showToast({
          title: '该页面将在首页确认后开放',
          icon: 'none',
        }),
    });
  },
});
