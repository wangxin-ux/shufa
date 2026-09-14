import {
  presentPartnerEarningEntry,
  presentPartnerEarningRule,
  presentPartnerEarningSummary,
} from '../../../services/partner-earnings.presenter';
import {
  PARTNER_REPORT_PERIOD_OPTIONS,
  buildPartnerPeriodQuery,
  formatPartnerPeriodLabel,
  todayPartnerAnchorDate,
} from '../../../services/partner-operations.presenter';
import { partnerService } from '../../../services/partner-runtime';
import {
  PartnerEarningStatus,
  PartnerReportPeriod,
} from '../../../types/partner';

const PAGE_SIZE = 20;
let requestSequence = 0;

const EMPTY_SUMMARY = presentPartnerEarningSummary({
  estimatedTotalFen: 0,
  pendingReviewFen: 0,
  availableFen: 0,
  reversedNetFen: 0,
  currency: 'CNY',
});

const STATUS_OPTIONS: Array<{
  label: string;
  value?: PartnerEarningStatus;
}> = [
  { label: '全部状态' },
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '可结算', value: 'AVAILABLE' },
  { label: '已驳回', value: 'REJECTED' },
  { label: '已冲正', value: 'REVERSED' },
];

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    summary: EMPTY_SUMMARY,
    rule: null as ReturnType<typeof presentPartnerEarningRule>,
    entries: [] as Array<ReturnType<typeof presentPartnerEarningEntry>>,
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    periodOptions: PARTNER_REPORT_PERIOD_OPTIONS,
    periodIndex: 1,
    anchorDate: todayPartnerAnchorDate(),
    periodLabel: formatPartnerPeriodLabel('MONTH', todayPartnerAnchorDate()),
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.load(true);
  },

  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  onStatusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) });
    void this.load(true);
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
    void this.load(true);
  },

  onAnchorDateChange(event: WechatMiniprogram.PickerChange) {
    const anchorDate = String(event.detail.value);
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    this.setData({
      anchorDate,
      periodLabel: formatPartnerPeriodLabel(period, anchorDate),
    });
    void this.load(true);
  },

  async load(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: 'loading',
            errorMessage: '',
            entries: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );
    const status = this.data.statusOptions[this.data.statusIndex]?.value as
      | PartnerEarningStatus
      | undefined;
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    const periodQuery = buildPartnerPeriodQuery(period, this.data.anchorDate);
    const requests = reset
      ? Promise.all([
          partnerService.loadEarningSummary(periodQuery),
          partnerService.loadCurrentEarningRule(),
          partnerService.loadEarnings({
            page,
            pageSize: PAGE_SIZE,
            status,
            ...periodQuery,
          }),
        ])
      : Promise.all([
          Promise.resolve(null),
          Promise.resolve(null),
          partnerService.loadEarnings({
            page,
            pageSize: PAGE_SIZE,
            status,
            ...periodQuery,
          }),
        ]);
    const [summaryState, ruleState, entriesState] = await requests;
    if (sequence !== requestSequence) return;

    const failure = [summaryState, ruleState, entriesState].find(
      (state) => state?.status === 'error',
    );
    if (failure?.status === 'error') {
      this.setData({
        loadingMore: false,
        viewState: failure.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          failure.statusCode === 403
            ? '当前账号无权查看本校区合作收益'
            : failure.message,
      });
      return;
    }
    if (entriesState.status !== 'success' && entriesState.status !== 'empty') {
      return;
    }

    const nextEntries = entriesState.data.data.map(presentPartnerEarningEntry);
    const entries = reset ? nextEntries : [...this.data.entries, ...nextEntries];
    const updates: Record<string, unknown> = {
      entries,
      page: entriesState.data.meta.page,
      total: entriesState.data.meta.total,
      hasMore: entriesState.data.meta.page < entriesState.data.meta.totalPages,
      loadingMore: false,
      viewState: entries.length > 0 ? 'ready' : 'empty',
      errorMessage: '',
    };
    if (
      summaryState &&
      (summaryState.status === 'success' || summaryState.status === 'empty')
    ) {
      updates.summary = presentPartnerEarningSummary(summaryState.data);
    }
    if (ruleState && (ruleState.status === 'success' || ruleState.status === 'empty')) {
      updates.rule = presentPartnerEarningRule(ruleState.data);
    }
    this.setData(updates);
  },

  onRetry() {
    void this.load(true);
  },

  onLoadMore() {
    void this.load(false);
  },
});
