import {
  PARTNER_REPORT_PERIOD_OPTIONS,
  buildPartnerOperationsPageModel,
  buildPartnerPeriodQuery,
  formatPartnerPeriodLabel,
  todayPartnerAnchorDate,
} from '../../../services/partner-operations.presenter';
import { partnerService } from '../../../services/partner-runtime';
import { PartnerReportPeriod } from '../../../types/partner';

type OperationsModel = ReturnType<typeof buildPartnerOperationsPageModel>;

const initialAnchorDate = todayPartnerAnchorDate();

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    periodOptions: PARTNER_REPORT_PERIOD_OPTIONS,
    periodIndex: 1,
    anchorDate: initialAnchorDate,
    periodLabel: formatPartnerPeriodLabel('MONTH', initialAnchorDate),
    summary: null as OperationsModel | null,
  },

  onLoad() {
    void this.loadOperations();
  },

  onPullDownRefresh() {
    void this.loadOperations().finally(() => wx.stopPullDownRefresh());
  },

  onPeriodTap(event: WechatMiniprogram.TouchEvent) {
    const period = String(
      event.currentTarget.dataset.period ?? '',
    ) as PartnerReportPeriod;
    const periodIndex = this.data.periodOptions.findIndex(
      (item) => item.value === period,
    );
    if (periodIndex < 0 || periodIndex === this.data.periodIndex) return;
    this.setData({
      periodIndex,
      periodLabel: formatPartnerPeriodLabel(period, this.data.anchorDate),
    });
    void this.loadOperations();
  },

  onAnchorDateChange(event: WechatMiniprogram.PickerChange) {
    const anchorDate = String(event.detail.value);
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    this.setData({
      anchorDate,
      periodLabel: formatPartnerPeriodLabel(period, anchorDate),
    });
    void this.loadOperations();
  },

  async loadOperations() {
    this.setData({ viewState: 'loading', errorMessage: '', summary: null });
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    const state = await partnerService.loadOperationsSummary(
      buildPartnerPeriodQuery(period, this.data.anchorDate),
    );
    if (state.status === 'success') {
      this.setData({
        viewState: 'ready',
        errorMessage: '',
        periodLabel: formatPartnerPeriodLabel(state.data.period, state.data.anchorDate),
        summary: buildPartnerOperationsPageModel(state.data),
      });
      return;
    }
    if (state.status === 'empty') {
      this.setData({
        viewState: 'empty',
        errorMessage: '',
        summary: buildPartnerOperationsPageModel(state.data),
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看本校区经营统计'
            : state.message,
        summary: null,
      });
    }
  },

  onRetry() {
    void this.loadOperations();
  },
});
