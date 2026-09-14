import {
  createFinanceOverviewService,
  FinanceOrderRow,
} from "../../../services/finance-overview.service";
import {
  loadFinanceCampuses,
  ORDER_STATUS_LABELS,
  overviewError,
  overviewMoney,
  overviewTime,
  requireFinanceSession,
} from "../../../services/finance-overview.presenter";
import { financeToday } from "../../../services/finance.service";

const statuses = [
  { value: "", label: "全部状态" },
  ...Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    campuses: [{ id: "", name: "全部校区" }],
    campusIndex: 0,
    statuses,
    statusIndex: 0,
    keyword: "",
    startDate: `${financeToday().slice(0, 7)}-01`,
    endDate: financeToday(),
    rows: [] as Array<FinanceOrderRow & { amountLabel: string; statusLabel: string; sourceLabel: string; createdLabel: string }>,
    total: 0,
    page: 1,
    hasMore: false,
    proofLoadingId: "",
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
      this.setData({ viewState: "error", errorMessage: overviewError(error, "订单加载失败") });
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
      const status = this.data.statuses[this.data.statusIndex]?.value;
      const result = await createFinanceOverviewService().orders({
        ...(campusId ? { campusIds: campusId } : {}),
        ...(status ? { status } : {}),
        keyword: this.data.keyword,
        from: this.data.startDate,
        to: this.data.endDate,
        page,
        pageSize: 20,
      });
      const rows = result.items.map(orderView);
      this.setData({ rows: append ? [...this.data.rows, ...rows] : rows, total: result.total, page, hasMore: page * result.pageSize < result.total, viewState: result.total ? "ready" : "empty" });
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: overviewError(error, "订单加载失败") });
    }
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) { this.setData({ campusIndex: Number(event.detail.value) }); void this.reload(); },
  onStatusChange(event: WechatMiniprogram.PickerChange) { this.setData({ statusIndex: Number(event.detail.value) }); void this.reload(); },
  onKeywordInput(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }); void this.reload(); },
  onStartChange(event: WechatMiniprogram.PickerChange) { this.setData({ startDate: String(event.detail.value) }); void this.reload(); },
  onEndChange(event: WechatMiniprogram.PickerChange) { this.setData({ endDate: String(event.detail.value) }); void this.reload(); },
  onLoadMore() { if (this.data.hasMore) void this.reload(true); },
  async onProof(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id);
    if (this.data.proofLoadingId) return;
    this.setData({ proofLoadingId: id });
    try {
      const path = await createFinanceOverviewService().orderProof(id);
      wx.previewImage({ urls: [path], current: path });
    } catch (error) {
      wx.showToast({ title: overviewError(error, "凭证读取失败"), icon: "none" });
    } finally { this.setData({ proofLoadingId: "" }); }
  },
  onRetry() { void this.initialize(); },
});

function orderView(row: FinanceOrderRow) {
  return {
    ...row,
    amountLabel: overviewMoney(row.amountFen),
    statusLabel: ORDER_STATUS_LABELS[row.status] ?? row.status,
    sourceLabel: row.source === "GROUP_BUYING" ? "拼团订单" : "报名订单",
    createdLabel: overviewTime(row.createdAt),
  };
}
