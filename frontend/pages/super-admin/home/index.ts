import {
  buildSuperAdminHomePageModel,
  resolveSuperAdminHomeAction,
  SUPER_ADMIN_HOME_ACTIONS,
} from '../../../services/super-admin-home.presenter';
import { superAdminService } from '../../../services/super-admin-runtime';

type HomeModel = ReturnType<typeof buildSuperAdminHomePageModel>;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    administratorName: '',
    campusCount: '0',
    featuredCampusName: '',
    featuredStudentCount: '0',
    featuredSummary: '',
    stats: [] as HomeModel['stats'],
    actions: SUPER_ADMIN_HOME_ACTIONS,
  },

  onLoad() {
    void this.loadHome();
  },

  onPullDownRefresh() {
    void this.loadHome().finally(() => wx.stopPullDownRefresh());
  },

  async loadHome() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await superAdminService.loadDashboard();
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        ...buildSuperAdminHomePageModel(state.data),
        viewState: state.status === 'empty' ? 'empty' : 'ready',
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403 ? '当前账号无总端访问权限' : state.message,
      });
    }
  },

  onRetry() {
    void this.loadHome();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const result = resolveSuperAdminHomeAction(
      String(event.currentTarget.dataset.key ?? ''),
    );
    if (result.kind === 'unavailable') {
      wx.showToast({ title: result.message, icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: result.url,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }),
    });
  },
});
