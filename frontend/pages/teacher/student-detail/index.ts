import { teacherService } from '../../../services/teacher-runtime';
import {
  buildTeacherStudentDetailPageModel,
  TeacherStudentDetailPageModel,
} from '../../../services/teacher-students.presenter';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    studentId: '',
    detail: null as TeacherStudentDetailPageModel | null,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ studentId: options.id ?? '' });
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
    this.setData({ viewState: 'loading', errorMessage: '', detail: null });
    const state = await teacherService.loadStudent(this.data.studentId);
    if (state.status === 'success') {
      this.setData({
        viewState: 'ready',
        errorMessage: '',
        detail: buildTeacherStudentDetailPageModel(state.data),
      });
      return;
    }
    if (state.status === 'empty') {
      this.setData({ viewState: 'empty', errorMessage: '', detail: null });
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
