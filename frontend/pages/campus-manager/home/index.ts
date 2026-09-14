import {
  buildCampusManagerHomePageModel,
  CAMPUS_MANAGER_HOME_ACTIONS,
  resolveCampusManagerHomeAction,
} from '../../../services/campus-manager-home.presenter';
import { campusManagerService } from '../../../services/campus-manager-runtime';

type HomePageModel = ReturnType<typeof buildCampusManagerHomePageModel>;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    managerName: '',
    campusName: '',
    pendingCount: '0',
    pendingUnit: '请假',
    latestLabel: '',
    latestStatus: '',
    latestLeaveId: null as HomePageModel['latestLeaveId'],
    stats: [] as HomePageModel['stats'],
    actions: CAMPUS_MANAGER_HOME_ACTIONS,
  },

  onLoad() {
    void this.loadHome();
  },

  onPullDownRefresh() {
    void this.loadHome().finally(() => wx.stopPullDownRefresh());
  },

  async loadHome() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await campusManagerService.loadDashboard();
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        ...buildCampusManagerHomePageModel(state.data),
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
            ? '当前账号无管理员端访问权限'
            : state.message,
      });
    }
  },

  onRetry() {
    void this.loadHome();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? '');
    const result = resolveCampusManagerHomeAction(key);
    if (result.kind === 'unavailable') {
      wx.showToast({ title: result.message, icon: 'none' });
      return;
    }
    wx.navigateTo({
      url: result.url,
      fail: () =>
        wx.showToast({
          title: '该功能将在首页确认后开放',
          icon: 'none',
        }),
    });
  },
});
