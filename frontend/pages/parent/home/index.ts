import {
  buildParentHomePageModel,
  resolveParentHomeAction,
} from '../../../services/parent-home.presenter';
import { ParentPageLoader } from '../../../services/parent-page-loader';
import { parentService } from '../../../services/parent-runtime';

const homeLoader = new ParentPageLoader(() => parentService.loadHomeSummary());

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    course: null as ReturnType<typeof buildParentHomePageModel>['course'],
    student: { id: '', name: '', age: 0 },
    metrics: [] as ReturnType<typeof buildParentHomePageModel>['metrics'],
    quickActions: [
      { key: 'leave', icon: '/pages/parent/assets/icon-qa-leave.png', label: '申请请假' },
      { key: 'hours', icon: '/pages/parent/assets/icon-qa-hours.png', label: '课时明细' },
      { key: 'group', icon: '/pages/parent/assets/icon-qa-team.png', label: '拼团报名' },
    ],
  },

  onLoad() {
    void this.loadHome();
  },

  onPullDownRefresh() {
    void this.loadHome().finally(() => wx.stopPullDownRefresh());
  },

  async loadHome() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await homeLoader.load();

    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
      const model = buildParentHomePageModel(snapshot.data);
      this.setData({
        ...model,
        viewState: snapshot.status,
        errorMessage: '',
      });
      return;
    }

    if (snapshot.status === 'error') {
      this.setData({ viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadHome();
  },

  onQuickAction(e: WechatMiniprogram.TouchEvent) {
    const key = e.currentTarget.dataset.key as string;
    const action = resolveParentHomeAction(key);
    if (action.type === 'navigate') {
      wx.navigateTo({ url: action.url });
      return;
    }
    wx.showToast({ title: action.message, icon: 'none' });
  },

  onCampusTap() {
    const action = resolveParentHomeAction('campuses');
    if (action.type === 'navigate') {
      wx.navigateTo({ url: action.url });
    }
  },

  onMoreCourseTap() {
    wx.navigateTo({ url: '/pages/parent/group-campaigns/index' });
  },

  onStudentTap() {
    wx.navigateTo({ url: '/pages/parent/profile/index' });
  },
});
