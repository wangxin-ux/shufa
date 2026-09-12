import {
  buildPartnerAttendancePageModel,
  mergePartnerAttendanceItems,
  PartnerAttendanceItemModel,
  PartnerAttendanceSummaryModel,
} from '../../../services/partner-attendance.presenter';
import { partnerService } from '../../../services/partner-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;
let campusTimeZone = 'Asia/Shanghai';

const EMPTY_SUMMARY: PartnerAttendanceSummaryModel = {
  attendanceRateLabel: '暂无数据',
  presentCountLabel: '0',
  absentCountLabel: '0',
  leaveCountLabel: '0',
  recordedCountLabel: '0',
};

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    summary: EMPTY_SUMMARY,
    items: [] as PartnerAttendanceItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.initialize();
  },

  onPullDownRefresh() {
    void this.loadAttendance(true).finally(() => wx.stopPullDownRefresh());
  },

  async initialize() {
    const profileState = await partnerService.loadProfile();
    if (profileState.status === 'success' || profileState.status === 'empty') {
      campusTimeZone = profileState.data.campus.timezone;
    }
    await this.loadAttendance(true);
  },

  async loadAttendance(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: 'loading',
            errorMessage: '',
            items: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );
    const state = await partnerService.loadAttendance({
      page,
      pageSize: PAGE_SIZE,
    });
    if (sequence !== requestSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      const model = buildPartnerAttendancePageModel(state.data, campusTimeZone);
      const items = mergePartnerAttendanceItems(
        this.data.items,
        model.items,
        page,
      );
      this.setData({
        summary: model.summary,
        items,
        page: state.data.meta.page,
        total: state.data.meta.total,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length > 0 ? 'ready' : 'empty',
        errorMessage: '',
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        loadingMore: false,
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看本校区出勤统计'
            : state.message,
      });
    }
  },

  onRetry() {
    void this.loadAttendance(true);
  },

  onLoadMore() {
    void this.loadAttendance(false);
  },
});
