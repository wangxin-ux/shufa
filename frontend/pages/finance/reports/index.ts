import {
  createFinanceService,
  financeMoney,
  financeToday,
  type FinanceChoice,
} from "../../../services/finance.service";
import {
  createFinanceReportsService,
  type FinanceConsumptionRow,
  type FinancePaidRefundRow,
  type FinanceReportKind,
} from "../../../services/finance-reports.service";
import { createSessionService } from "../../../services/session.service";

type DisplayRow = {
  id: string;
  studentName: string;
  campusName: string;
  packageName: string;
  contextLabel: string;
  timeLabel: string;
  unitsLabel: string;
  amountLabel: string;
  pending: boolean;
};

Page({
  data: {
    headerTop: 54,
    headerRight: 24,
    apiEnabled: false,
    viewState: "loading" as
      "loading" | "ready" | "empty" | "error" | "forbidden",
    errorMessage: "",
    kind: "lesson-consumption" as FinanceReportKind,
    tabs: [
      { code: "lesson-consumption", name: "课耗" },
      { code: "refunds", name: "实退" },
    ],
    campuses: [{ id: "", name: "全部校区" }] as FinanceChoice[],
    campusIndex: 0,
    startDate: `${financeToday().slice(0, 7)}-01`,
    endDate: financeToday(),
    rows: [] as DisplayRow[],
    total: 0,
    page: 1,
    pageSize: 20,
    hasMore: false,
    mainUnitsLabel: "0.00",
    giftUnitsLabel: "0.00",
    amountLabel: "0.00",
    pendingCheckCount: 0,
    exporting: false,
    exportError: "",
  },
  requestVersion: 0,

  onLoad() {
    const info = wx.getWindowInfo?.();
    const menu = wx.getMenuButtonBoundingClientRect?.();
    if (info && menu)
      this.setData({
        headerTop: menu.top,
        headerRight: Math.max(16, info.windowWidth - menu.left + 12),
      });
    void this.initialize();
  },

  async initialize() {
    this.setData({
      viewState: "loading",
      errorMessage: "",
      rows: [],
      total: 0,
      hasMore: false,
      ...emptySummary(),
    });
    try {
      const session = await createSessionService().load();
      if (
        !session ||
        session.roles.length !== 1 ||
        session.roles[0].code !== "FINANCE" ||
        session.roles[0].campusId !== null
      ) {
        this.setData({ apiEnabled: false, viewState: "forbidden" });
        return;
      }
      const campuses: FinanceChoice[] = [{ id: "", name: "全部校区" }];
      const service = createFinanceService();
      let page = 1;
      while (true) {
        const result = await service.campuses(page);
        campuses.push(...result.items);
        if (page * result.pageSize >= result.total || !result.items.length)
          break;
        page += 1;
      }
      this.setData({
        apiEnabled: true,
        campuses,
        campusIndex: 0,
      });
      await this.reload();
    } catch (error) {
      this.setData({
        apiEnabled: false,
        viewState: "error",
        errorMessage: errorMessage(error, "财务报表加载失败"),
      });
    }
  },

  async reload(append = false) {
    if (!this.data.apiEnabled || this.data.startDate > this.data.endDate) {
      if (this.data.startDate > this.data.endDate)
        this.setData({
          rows: [],
          total: 0,
          hasMore: false,
          ...emptySummary(),
          viewState: "error",
          errorMessage: "开始日期不能晚于结束日期",
        });
      return;
    }
    const version = ++this.requestVersion;
    const page = append ? this.data.page + 1 : 1;
    if (!append)
      this.setData({
        rows: [],
        total: 0,
        page: 1,
        hasMore: false,
        ...emptySummary(),
        viewState: "loading",
        errorMessage: "",
        exportError: "",
      });
    try {
      const service = createFinanceReportsService();
      const query = this.query(page);
      const consumption = this.data.kind === "lesson-consumption";
      const result = consumption
        ? await service.lessonConsumption(query)
        : await service.refunds(query);
      if (version !== this.requestVersion) return;
      const rows = consumption
        ? result.items.map((row) =>
            consumptionRow(row as FinanceConsumptionRow),
          )
        : result.items.map((row) => refundRow(row as FinancePaidRefundRow));
      const summary = consumption
        ? (result.summary as {
            mainUnits: number;
            giftUnits: number;
            knownAmountFen: number;
            pendingCheckCount: number;
          })
        : (result.summary as {
            mainUnits: number;
            giftUnits: number;
            actualRefundFen: number;
          });
      this.setData({
        rows: append ? [...this.data.rows, ...rows] : rows,
        total: result.total,
        page,
        pageSize: result.pageSize,
        hasMore: page * result.pageSize < result.total,
        viewState: result.total === 0 ? "empty" : "ready",
        ...(consumption
          ? {
              mainUnitsLabel: units(summary.mainUnits),
              giftUnitsLabel: units(summary.giftUnits),
              amountLabel: financeMoney(
                (summary as { knownAmountFen: number }).knownAmountFen,
              ),
              pendingCheckCount: (summary as { pendingCheckCount: number })
                .pendingCheckCount,
            }
          : {
              mainUnitsLabel: units(summary.mainUnits),
              giftUnitsLabel: units(summary.giftUnits),
              amountLabel: financeMoney(
                (summary as { actualRefundFen: number }).actualRefundFen,
              ),
              pendingCheckCount: 0,
            }),
      });
    } catch (error) {
      if (version === this.requestVersion)
        this.setData({
          ...(append
            ? {}
            : {
                rows: [],
                total: 0,
                hasMore: false,
                ...emptySummary(),
              }),
          viewState: "error",
          errorMessage: errorMessage(error, "财务报表加载失败"),
        });
    }
  },

  query(page?: number) {
    const query: {
      campusId?: string;
      from: string;
      to: string;
      page: number;
      pageSize: number;
    } = {
      from: this.data.startDate,
      to: this.data.endDate,
      page: page ?? this.data.page,
      pageSize: this.data.pageSize,
    };
    const campusId = this.data.campuses[this.data.campusIndex]?.id;
    if (campusId) query.campusId = campusId;
    return query;
  },

  async onTab(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind) as FinanceReportKind;
    if (
      kind === this.data.kind ||
      !["lesson-consumption", "refunds"].includes(kind)
    )
      return;
    this.requestVersion += 1;
    this.setData({ kind, rows: [], total: 0, page: 1 });
    await this.reload();
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ campusIndex: Number(event.detail.value) });
    void this.reload();
  },
  onStartChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ startDate: String(event.detail.value) });
    void this.reload();
  },
  onEndChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ endDate: String(event.detail.value) });
    void this.reload();
  },
  onLoadMore() {
    if (this.data.hasMore && this.data.viewState === "ready")
      void this.reload(true);
  },
  onRetry() {
    if (this.data.apiEnabled) void this.reload();
    else void this.initialize();
  },
  onReset() {
    const today = financeToday();
    this.setData({
      campusIndex: 0,
      startDate: `${today.slice(0, 7)}-01`,
      endDate: today,
    });
    void this.reload();
  },
  async onExport() {
    if (!this.data.apiEnabled || this.data.exporting) return;
    this.setData({ exporting: true, exportError: "" });
    try {
      const query = {
        campusId: this.data.campuses[this.data.campusIndex]?.id || undefined,
        from: this.data.startDate,
        to: this.data.endDate,
      };
      await createFinanceReportsService().export(this.data.kind, query);
    } catch (error) {
      this.setData({ exportError: errorMessage(error, "报表导出失败") });
    } finally {
      this.setData({ exporting: false });
    }
  },
  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/finance/home/index" });
  },
});

function consumptionRow(row: FinanceConsumptionRow): DisplayRow {
  return {
    id: row.id,
    studentName: row.studentName,
    campusName: row.campusName,
    packageName: row.packageName,
    contextLabel: `${row.entryType === "CONSUME" ? "扣课" : "撤销"} · ${row.bucket === "MAIN" ? "购买课时" : "赠送课时"} · ${row.courseName}`,
    timeLabel: shanghaiTime(row.lessonCompletedAt),
    unitsLabel: `${units(row.units)} 节`,
    amountLabel:
      row.amountFen === null ? "待核对" : `${financeMoney(row.amountFen)} 元`,
    pending: row.amountStatus === "PENDING_CHECK",
  };
}

function refundRow(row: FinancePaidRefundRow): DisplayRow {
  return {
    id: row.id,
    studentName: row.studentName,
    campusName: row.campusName,
    packageName: row.packageName,
    contextLabel: "实际退款",
    timeLabel: shanghaiTime(row.paidAt),
    unitsLabel: `购买 ${units(row.mainUnits)} · 赠送 ${units(row.giftUnits)} 节`,
    amountLabel: `${financeMoney(row.amountFen)} 元`,
    pending: false,
  };
}

function units(value: number) {
  return (value / 100).toFixed(2);
}

function emptySummary() {
  return {
    mainUnitsLabel: "0.00",
    giftUnitsLabel: "0.00",
    amountLabel: "0.00",
    pendingCheckCount: 0,
  };
}

function shanghaiTime(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
