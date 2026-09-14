import {
  createFinanceOverviewService,
  FinanceEarningRow,
} from "../../../services/finance-overview.service";
import {
  financePeriodRange,
  FinancePeriod,
  loadFinanceCampuses,
  overviewError,
  overviewMoney,
  requireFinanceSession,
} from "../../../services/finance-overview.presenter";

const periods = [
  { code: "DAY", label: "日" },
  { code: "MONTH", label: "月" },
  { code: "QUARTER", label: "季度" },
  { code: "YEAR", label: "年度" },
] as const;

type EarningView = FinanceEarningRow & {
  grossLabel: string;
  platformLabel: string;
  partnerLabel: string;
  teacherLabel: string;
  contributionLabel: string;
};

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    periods,
    period: "MONTH" as FinancePeriod,
    campuses: [{ id: "", name: "全部校区" }],
    campusIndex: 0,
    startDate: financePeriodRange("MONTH").from,
    endDate: financePeriodRange("MONTH").to,
    rows: [] as EarningView[],
    grossLabel: "¥ 0.00",
    platformLabel: "¥ 0.00",
    partnerLabel: "¥ 0.00",
    teacherLabel: "¥ 0.00",
  },
  onLoad() { void this.initialize(); },
  async initialize() {
    this.setData({ viewState: "loading", errorMessage: "" });
    try {
      if (!(await requireFinanceSession())) {
        this.setData({ viewState: "forbidden" });
        return;
      }
      this.setData({ campuses: await loadFinanceCampuses() });
      await this.reload();
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "经营收益加载失败") });
    }
  },
  async reload() {
    this.setData({ viewState: "loading", errorMessage: "", rows: [] });
    try {
      const campusId = this.data.campuses[this.data.campusIndex]?.id;
      const result = await createFinanceOverviewService().earnings({
        ...(campusId ? { campusIds: campusId } : {}),
        from: this.data.startDate,
        to: this.data.endDate,
      });
      this.setData({
        rows: result.rows.map(earningView),
        grossLabel: overviewMoney(result.summary.grossLessonRevenueFen),
        platformLabel: overviewMoney(result.summary.platformRetainedFen),
        partnerLabel: overviewMoney(result.summary.partnerEarningFen),
        teacherLabel: overviewMoney(result.summary.teacherEarningFen),
        viewState: result.rows.length ? "ready" : "empty",
      });
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "经营收益加载失败") });
    }
  },
  onPeriod(event: WechatMiniprogram.TouchEvent) {
    const period = String(event.currentTarget.dataset.period) as FinancePeriod;
    if (!periods.some((item) => item.code === period)) return;
    const range = financePeriodRange(period);
    this.setData({ period, startDate: range.from, endDate: range.to });
    void this.reload();
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) { this.setData({ campusIndex: Number(event.detail.value) }); void this.reload(); },
  onStartChange(event: WechatMiniprogram.PickerChange) { this.setData({ startDate: String(event.detail.value) }); void this.reload(); },
  onEndChange(event: WechatMiniprogram.PickerChange) { this.setData({ endDate: String(event.detail.value) }); void this.reload(); },
  onRetry() { void this.initialize(); },
  noop() {},
});

function earningView(row: FinanceEarningRow): EarningView {
  return {
    ...row,
    grossLabel: overviewMoney(row.grossLessonRevenueFen),
    platformLabel: overviewMoney(row.platformRetainedFen),
    partnerLabel: overviewMoney(row.partnerEarningFen),
    teacherLabel: overviewMoney(row.teacherEarningFen),
    contributionLabel: overviewMoney(row.knownContributionFen),
  };
}
