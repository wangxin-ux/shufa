import {
  buildCampusManagerStudentDetail,
  CampusManagerStudentDetailModel,
} from '../../../services/campus-manager-students.presenter';
import { campusManagerService } from '../../../services/campus-manager-runtime';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    studentId: '',
    detail: null as CampusManagerStudentDetailModel | null,
  },

  onLoad(options: Record<string, string | undefined>) {
    const studentId = options.id ?? '';
    this.setData({ studentId });
    void this.loadStudent();
  },

  onPullDownRefresh() {
    void this.loadStudent().finally(() => wx.stopPullDownRefresh());
  },

  async loadStudent() {
    if (!this.data.studentId) {
      this.setData({
        viewState: 'error',
        errorMessage: '缺少学员标识，请返回后重新进入',
        detail: null,
      });
      return;
    }

    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await campusManagerService.loadStudent(this.data.studentId);
    if (state.status === 'success') {
      this.setData({
        viewState: 'ready',
        errorMessage: '',
        detail: buildCampusManagerStudentDetail(state.data),
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看该学员'
            : state.message,
        detail: null,
      });
    }
  },

  onRetry() {
    void this.loadStudent();
  },
});
