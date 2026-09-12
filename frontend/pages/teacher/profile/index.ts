import {
  buildTeacherProfilePageModel,
  resolveTeacherProfileAction,
  TEACHER_PROFILE_ACTIONS,
  TeacherProfileActionKey,
} from '../../../services/teacher-profile.presenter';
import { teacherService } from '../../../services/teacher-runtime';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    displayName: '',
    subjectLabel: '',
    subjectLines: [] as string[],
    campusName: '',
    studentCount: '0',
    studentCountCompact: false,
    actions: TEACHER_PROFILE_ACTIONS,
  },

  onLoad() {
    void this.loadProfile();
  },

  onPullDownRefresh() {
    void this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  async loadProfile() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await teacherService.loadProfile();

    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        ...buildTeacherProfilePageModel(state.data),
        viewState: 'ready',
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
    void this.loadProfile();
  },

  onAction(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = event.detail.key as TeacherProfileActionKey;
    if (!TEACHER_PROFILE_ACTIONS.some((item) => item.key === key)) {
      return;
    }
    const result = resolveTeacherProfileAction(key);
    wx.navigateTo({ url: result.url });
  },
});
