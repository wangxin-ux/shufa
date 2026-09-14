import {
  buildTeacherHomePageModel,
  resolveTeacherHomeAction,
  TEACHER_HOME_ACTIONS,
} from '../../../services/teacher-home.presenter';
import { teacherService } from '../../../services/teacher-runtime';

type HomePageModel = ReturnType<typeof buildTeacherHomePageModel>;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    teacher: {
      displayName: '',
      subjectLabel: '',
      campusName: '',
    },
    nextLesson: null as HomePageModel['nextLesson'],
    stats: [] as HomePageModel['stats'],
    emptyMessage: '今日暂无待上课程',
    actions: TEACHER_HOME_ACTIONS,
  },

  onLoad() {
    void this.loadHome();
  },

  onPullDownRefresh() {
    void this.loadHome().finally(() => wx.stopPullDownRefresh());
  },

  async loadHome() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await teacherService.loadDashboard();

    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        ...buildTeacherHomePageModel(state.data),
        viewState: state.status === 'empty' ? 'empty' : 'ready',
        errorMessage: '',
      });
      return;
    }

    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403 ? '当前账号无教师端访问权限' : state.message,
      });
    }
  },

  onRetry() {
    void this.loadHome();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? '');
    const result = resolveTeacherHomeAction(key, this.data.nextLesson?.id);
    if (result.kind === 'navigate') {
      wx.navigateTo({ url: result.url });
      return;
    }
    wx.showToast({ title: result.message, icon: 'none' });
  },

  onProfileTap() {
    const result = resolveTeacherHomeAction('profile');
    if (result.kind === 'navigate') {
      wx.navigateTo({ url: result.url });
    }
  },
});
