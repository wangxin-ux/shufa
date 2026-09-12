import { createTeacherRuntimeEnv } from '../../../config/teacher-env';
import { buildTeacherSettingsModel } from '../../../services/session.service';
import { teacherService } from '../../../services/teacher-runtime';

const runtimeEnv = createTeacherRuntimeEnv();

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    displayName: '',
    identityLabel: '',
    campusLabel: '',
    environmentLabel: '',
  },

  onLoad() {
    void this.loadSettings();
  },

  async loadSettings() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await teacherService.loadProfile();
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        ...buildTeacherSettingsModel(state.data, runtimeEnv.dataDriver),
        viewState: 'ready',
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
    void this.loadSettings();
  },
});
