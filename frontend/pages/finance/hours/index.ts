import { createSessionService } from "../../../services/session.service";
import {
  createFinanceService,
  FinanceChoice,
  financeMoney,
  financeToday,
} from "../../../services/finance.service";
import {
  createFinanceOverviewService,
  FinanceHoursRow,
} from "../../../services/finance-overview.service";

type HoursView = FinanceHoursRow & {
  consumedLabel: string;
  unitPriceLabel: string;
  validityLabel: string;
  remainingLabel: string;
  remainingDetail: string;
  reservedLabel: string;
};

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    campuses: [{ id: "", name: "全部校区" }] as FinanceChoice[],
    campusIndex: 0,
    keyword: "",
    startDate: `${financeToday().slice(0, 7)}-01`,
    endDate: financeToday(),
    rows: [] as HoursView[],
    total: 0,
    page: 1,
    hasMore: false,
    asOfLabel: "",
    studentCount: 0,
    consumedLabel: "0.00",
    remainingLabel: "0.00",
  },

  onLoad() {
    void this.initialize();
  },
  async initialize() {
    this.setData({ viewState: "loading", errorMessage: "" });
    try {
      const session = await createSessionService().load();
      if (
        !session ||
        session.roles.length !== 1 ||
        session.roles[0].code !== "FINANCE" ||
        session.roles[0].campusId !== null
      ) {
        this.setData({ viewState: "forbidden" });
        return;
      }
      const campuses: FinanceChoice[] = [{ id: "", name: "全部校区" }];
      let page = 1;
      while (true) {
        const result = await createFinanceService().campuses(page);
        campuses.push(...result.items);
        if (page * result.pageSize >= result.total || !result.items.length)
          break;
        page += 1;
      }
      this.setData({ campuses, campusIndex: 0 });
      await this.reload();
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: message(error) });
    }
  },
  async reload(append = false) {
    if (this.data.startDate > this.data.endDate) {
      this.setData({
        viewState: "error",
        rows: [],
        errorMessage: "开始日期不能晚于结束日期",
      });
      return;
    }
    const page = append ? this.data.page + 1 : 1;
    if (!append)
      this.setData({ viewState: "loading", rows: [], errorMessage: "" });
    try {
      const campusId = this.data.campuses[this.data.campusIndex]?.id;
      const result = await createFinanceOverviewService().hours({
        ...(campusId ? { campusIds: campusId } : {}),
        keyword: this.data.keyword,
        from: this.data.startDate,
        to: this.data.endDate,
        page,
        pageSize: 20,
      });
      const rows = result.items.map(hoursView);
      this.setData({
        rows: append ? [...this.data.rows, ...rows] : rows,
        total: result.total,
        page,
        hasMore: page * result.pageSize < result.total,
        asOfLabel: shanghaiDay(result.asOf),
        studentCount: result.summary.studentCount,
        consumedLabel: units(
          result.summary.consumedMainUnits + result.summary.consumedGiftUnits,
        ),
        remainingLabel: units(result.summary.remainingUnits),
        viewState: result.total ? "ready" : "empty",
      });
    } catch (error) {
      this.setData({ viewState: "error", errorMessage: message(error) });
    }
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ campusIndex: Number(event.detail.value) });
    void this.reload();
  },
  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
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
    if (this.data.hasMore) void this.reload(true);
  },
  onRetry() {
    void this.initialize();
  },
});

function hoursView(row: FinanceHoursRow): HoursView {
  return {
    ...row,
    consumedLabel: `${units(row.consumedMainUnits + row.consumedGiftUnits)} 节`,
    unitPriceLabel:
      row.unitPriceFen === null
        ? "待核对"
        : `${financeMoney(row.unitPriceFen)} 元/节`,
    validityLabel: row.expiresAt
      ? `有效期 ${shanghaiDay(row.validFrom)} 至 ${shanghaiDay(row.expiresAt)}`
      : `有效期 ${shanghaiDay(row.validFrom)} 起 · 长期有效`,
    remainingLabel: `${units(row.totalRemainingUnits)} 节`,
    remainingDetail: `购买 ${units(row.mainRemainingUnits)} · 赠送 ${units(row.giftRemainingUnits)}`,
    reservedLabel:
      row.mainReservedUnits + row.giftReservedUnits > 0
        ? `其中退课处理中 ${units(row.mainReservedUnits + row.giftReservedUnits)} 节`
        : "",
  };
}

function units(value: number) {
  return (value / 100).toFixed(2);
}

function shanghaiDay(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "课时一览加载失败";
}
