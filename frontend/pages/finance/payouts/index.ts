import {
  createFinanceOverviewService,
  FinancePayoutRow,
} from "../../../services/finance-overview.service";
import {
  loadFinanceCampuses,
  overviewError,
  overviewMoney,
  overviewTime,
  PAYOUT_STATUS_LABELS,
  requireFinanceSession,
} from "../../../services/finance-overview.presenter";
import { financeToday } from "../../../services/finance.service";

const categories = [
  { code: "ALL", label: "全部" },
  { code: "PARENT_REFUND", label: "家长退费" },
  { code: "PARTNER_PAYOUT", label: "合作方" },
  { code: "TEACHER_WITHDRAWAL", label: "教师" },
] as const;

type PayoutView = FinancePayoutRow & {
  categoryLabel: string;
  statusLabel: string;
  amountLabel: string;
  requestedLabel: string;
  paidLabel: string;
};

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    categories,
    category: "ALL",
    campuses: [{ id: "", name: "全部校区" }],
    campusIndex: 0,
    startDate: `${financeToday().slice(0, 7)}-01`,
    endDate: financeToday(),
    rows: [] as PayoutView[],
    total: 0,
    page: 1,
    hasMore: false,
    partnerUnavailable: false,
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
      this.setData({ viewState: "error", errorMessage: overviewError(error, "出款记录加载失败") });
    }
  },
  async reload(append = false) {
    if (this.data.startDate > this.data.endDate) {
      this.setData({ viewState: "error", rows: [], errorMessage: "开始日期不能晚于结束日期" });
      return;
    }
    const page = append ? this.data.page + 1 : 1;
    if (!append) this.setData({ viewState: "loading", rows: [], errorMessage: "" });
    try {
      const campusId = this.data.campuses[this.data.campusIndex]?.id;
      const result = await createFinanceOverviewService().payouts({
        ...(campusId ? { campusIds: campusId } : {}),
        category: this.data.category,
        from: this.data.startDate,
        to: this.data.endDate,
        page,
        pageSize: 20,
      });
      const rows = result.items.map(payoutView);
      this.setData({
        rows: append ? [...this.data.rows, ...rows] : rows,
        total: result.total,
        page,
        hasMore: page * result.pageSize < result.total,
        partnerUnavailable: result.coverage.partnerPayouts === "NOT_IMPLEMENTED",
        viewState: result.total ? "ready" : "empty",
      });
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "出款记录加载失败") });
    }
  },
  onCategory(event: WechatMiniprogram.TouchEvent) {
    const category = String(event.currentTarget.dataset.category);
    if (!categories.some((item) => item.code === category)) return;
    this.setData({ category });
    void this.reload();
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) { this.setData({ campusIndex: Number(event.detail.value) }); void this.reload(); },
  onStartChange(event: WechatMiniprogram.PickerChange) { this.setData({ startDate: String(event.detail.value) }); void this.reload(); },
  onEndChange(event: WechatMiniprogram.PickerChange) { this.setData({ endDate: String(event.detail.value) }); void this.reload(); },
  onLoadMore() { if (this.data.hasMore) void this.reload(true); },
  onRetry() { void this.initialize(); },
});

function payoutView(row: FinancePayoutRow): PayoutView {
  return {
    ...row,
    categoryLabel: row.category === "TEACHER_WITHDRAWAL" ? "教师课时费提现" : "家长退费",
    statusLabel: PAYOUT_STATUS_LABELS[row.status] ?? row.status,
    amountLabel: overviewMoney(row.amountFen),
    requestedLabel: overviewTime(row.requestedAt),
    paidLabel: overviewTime(row.paidAt),
  };
}
