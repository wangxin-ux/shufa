import {
  buildPartnerStudentDetailPageModel,
} from '../../../services/partner-student-detail.presenter';
import { partnerService } from '../../../services/partner-runtime';

type StudentDetailModel = ReturnType<
  typeof buildPartnerStudentDetailPageModel
>;

let campusTimeZone = 'Asia/Shanghai';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    studentId: '',
    detail: null as StudentDetailModel | null,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ studentId: options.id ?? '' });
    void this.initialize();
  },

  onPullDownRefresh() {
    void this.loadStudent().finally(() => wx.stopPullDownRefresh());
  },

  async initialize() {
    const profileState = await partnerService.loadProfile();
    if (profileState.status === 'success' || profileState.status === 'empty') {
      campusTimeZone = profileState.data.campus.timezone;
    }
    await this.loadStudent();
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
    const state = await partnerService.loadStudent(this.data.studentId);
    if (state.status === 'success') {
      this.setData({
        viewState: 'ready',
        errorMessage: '',
        detail: buildPartnerStudentDetailPageModel(state.data, campusTimeZone),
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
