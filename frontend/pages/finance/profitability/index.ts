import {
  createFinanceOverviewService,
  FinanceProfitabilityRow,
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

type CampusOption = { id: string; name: string; checked: boolean };
type ProfitView = FinanceProfitabilityRow & {
  grossLabel: string;
  teacherLabel: string;
  partnerLabel: string;
  refundLabel: string;
  contributionLabel: string;
};

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    periods,
    period: "MONTH" as FinancePeriod,
    startDate: financePeriodRange("MONTH").from,
    endDate: financePeriodRange("MONTH").to,
    region: "",
    campusOptions: [] as CampusOption[],
    selectedCampusIds: [] as string[],
    rows: [] as ProfitView[],
    grossLabel: "¥ 0.00",
    teacherLabel: "¥ 0.00",
    partnerLabel: "¥ 0.00",
    refundLabel: "¥ 0.00",
    contributionLabel: "¥ 0.00",
    exporting: false,
    exportError: "",
  },
  onLoad() { void this.initialize(); },
  async initialize() {
    this.setData({ viewState: "loading", errorMessage: "" });
    try {
      if (!(await requireFinanceSession())) {
        this.setData({ viewState: "forbidden" });
        return;
      }
      const campusOptions = (await loadFinanceCampuses()).slice(1).map((item) => ({ ...item, checked: false }));
      this.setData({ campusOptions });
      await this.reload();
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "成本收益加载失败") });
    }
  },
  query() {
    return {
      ...(this.data.selectedCampusIds.length ? { campusIds: this.data.selectedCampusIds.join(",") } : {}),
      ...(this.data.region.trim() ? { region: this.data.region.trim() } : {}),
      from: this.data.startDate,
      to: this.data.endDate,
    };
  },
  async reload() {
    if (this.data.startDate > this.data.endDate) {
      this.setData({ viewState: "error", rows: [], errorMessage: "开始日期不能晚于结束日期" });
      return;
    }
    this.setData({ viewState: "loading", rows: [], errorMessage: "", exportError: "" });
    try {
      const result = await createFinanceOverviewService().profitability(this.query());
      this.setData({
        rows: result.rows.map(profitView),
        grossLabel: overviewMoney(result.summary.grossLessonRevenueFen),
        teacherLabel: overviewMoney(result.summary.teacherEarningFen),
        partnerLabel: overviewMoney(result.summary.partnerEarningFen),
        refundLabel: overviewMoney(result.summary.refundFen),
        contributionLabel: overviewMoney(result.summary.knownContributionFen),
        viewState: result.rows.length ? "ready" : "empty",
      });
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "成本收益加载失败") });
    }
  },
  onPeriod(event: WechatMiniprogram.TouchEvent) {
    const period = String(event.currentTarget.dataset.period) as FinancePeriod;
    if (!periods.some((item) => item.code === period)) return;
    const range = financePeriodRange(period);
    this.setData({ period, startDate: range.from, endDate: range.to });
    void this.reload();
  },
  onRegionInput(event: WechatMiniprogram.Input) { this.setData({ region: event.detail.value }); },
  onRegionConfirm() { void this.reload(); },
  onCampusesChange(event: WechatMiniprogram.CheckboxGroupChange) {
    const selectedCampusIds = event.detail.value.map(String);
    this.setData({ selectedCampusIds, campusOptions: this.data.campusOptions.map((item) => ({ ...item, checked: selectedCampusIds.includes(item.id) })) });
    void this.reload();
  },
  onStartChange(event: WechatMiniprogram.PickerChange) { this.setData({ startDate: String(event.detail.value) }); void this.reload(); },
  onEndChange(event: WechatMiniprogram.PickerChange) { this.setData({ endDate: String(event.detail.value) }); void this.reload(); },
  async onExport() {
    if (this.data.exporting) return;
    this.setData({ exporting: true, exportError: "" });
    try { await createFinanceOverviewService().export("profitability", this.query()); }
    catch (error) { this.setData({ exportError: overviewError(error, "成本收益导出失败") }); }
    finally { this.setData({ exporting: false }); }
  },
  onRetry() { void this.initialize(); },
});

function profitView(row: FinanceProfitabilityRow): ProfitView {
  return {
    ...row,
    grossLabel: overviewMoney(row.grossLessonRevenueFen),
    teacherLabel: overviewMoney(row.teacherEarningFen),
    partnerLabel: overviewMoney(row.partnerEarningFen),
    refundLabel: overviewMoney(row.refundFen),
    contributionLabel: overviewMoney(row.knownContributionFen),
  };
}
