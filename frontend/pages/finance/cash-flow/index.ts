import {
  createFinanceOverviewService,
  FinanceCashFlowRow,
} from "../../../services/finance-overview.service";
import {
  loadFinanceCampuses,
  overviewError,
  overviewMoney,
  overviewTime,
  requireFinanceSession,
} from "../../../services/finance-overview.presenter";
import { financeToday } from "../../../services/finance.service";

type CashView = FinanceCashFlowRow & {
  directionLabel: string;
  amountLabel: string;
  timeLabel: string;
};

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    campuses: [{ id: "", name: "全部校区" }],
    campusIndex: 0,
    startDate: `${financeToday().slice(0, 7)}-01`,
    endDate: financeToday(),
    rows: [] as CashView[],
    total: 0,
    page: 1,
    hasMore: false,
    inflowLabel: "¥ 0.00",
    outflowLabel: "¥ 0.00",
    balanceLabel: "¥ 0.00",
    feeStatus: "NOT_RECORDED",
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
      this.setData({ campuses: await loadFinanceCampuses() });
      await this.reload();
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "资金流水加载失败") });
    }
  },
  query(page?: number) {
    const campusId = this.data.campuses[this.data.campusIndex]?.id;
    return { ...(campusId ? { campusIds: campusId } : {}), from: this.data.startDate, to: this.data.endDate, page: page ?? this.data.page, pageSize: 20 };
  },
  async reload(append = false) {
    if (this.data.startDate > this.data.endDate) {
      this.setData({ viewState: "error", rows: [], errorMessage: "开始日期不能晚于结束日期" });
      return;
    }
    const page = append ? this.data.page + 1 : 1;
    if (!append) this.setData({ viewState: "loading", rows: [], errorMessage: "", exportError: "" });
    try {
      const result = await createFinanceOverviewService().cashFlow(this.query(page));
      const rows = result.items.map(cashView);
      this.setData({
        rows: append ? [...this.data.rows, ...rows] : rows,
        total: result.total,
        page,
        hasMore: page * result.pageSize < result.total,
        inflowLabel: overviewMoney(result.summary.inflowFen),
        outflowLabel: overviewMoney(result.summary.outflowFen),
        balanceLabel: overviewMoney(result.summary.inflowFen - result.summary.outflowFen),
        feeStatus: result.feeStatus,
        viewState: result.total ? "ready" : "empty",
      });
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "资金流水加载失败") });
    }
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) { this.setData({ campusIndex: Number(event.detail.value) }); void this.reload(); },
  onStartChange(event: WechatMiniprogram.PickerChange) { this.setData({ startDate: String(event.detail.value) }); void this.reload(); },
  onEndChange(event: WechatMiniprogram.PickerChange) { this.setData({ endDate: String(event.detail.value) }); void this.reload(); },
  onLoadMore() { if (this.data.hasMore) void this.reload(true); },
  async onExport() {
    if (this.data.exporting) return;
    this.setData({ exporting: true, exportError: "" });
    try {
      const query = this.query(1);
      await createFinanceOverviewService().export("cash-flow", { campusIds: query.campusIds, from: query.from, to: query.to });
    } catch (error) {
      this.setData({ exportError: overviewError(error, "资金流水导出失败") });
    } finally { this.setData({ exporting: false }); }
  },
  onRetry() { void this.initialize(); },
});

function cashView(row: FinanceCashFlowRow): CashView {
  return {
    ...row,
    directionLabel: row.direction === "INFLOW" ? "收入" : "支出",
    amountLabel: `${row.direction === "INFLOW" ? "+" : "-"}${overviewMoney(row.amountFen)}`,
    timeLabel: overviewTime(row.occurredAt),
  };
}
