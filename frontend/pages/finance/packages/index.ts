import { createSessionService } from "../../../services/session.service";
import {
  createFinanceService,
  FinanceChoice,
  FinanceReceipt,
  financeMoney,
  financeToday,
  parseDecimalUnits,
} from "../../../services/finance.service";

type ReceiptRow = FinanceReceipt & {
  amountLabel: string;
  channelLabel: string;
};

const CHANNELS: Record<string, string> = {
  WECHAT: "微信收款",
  ALIPAY: "支付宝",
  BANK: "银行转账",
  CASH: "现金",
  OTHER: "其他",
};

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    campuses: [{ id: "", name: "全部校区" }] as FinanceChoice[],
    campusIndex: 0,
    keyword: "",
    rows: [] as ReceiptRow[],
    total: 0,
    page: 1,
    hasMore: false,
    selected: null as ReceiptRow | null,
    packageName: "",
    mainLessons: "",
    giftLessons: "0",
    validFrom: financeToday(),
    expiresOn: "",
    submitting: false,
    formError: "",
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
      const service = createFinanceService();
      const campuses: FinanceChoice[] = [{ id: "", name: "全部校区" }];
      let page = 1;
      while (true) {
        const result = await service.campuses(page);
        campuses.push(...result.items);
        if (page * result.pageSize >= result.total || !result.items.length)
          break;
        page += 1;
      }
      this.setData({ campuses, campusIndex: 0 });
      await this.reload();
    } catch (error) {
      this.setData({
        viewState: "error",
        errorMessage: message(error, "课包录入加载失败"),
      });
    }
  },

  async reload(append = false) {
    const page = append ? this.data.page + 1 : 1;
    if (!append)
      this.setData({ viewState: "loading", rows: [], errorMessage: "" });
    try {
      const campusId = this.data.campuses[this.data.campusIndex]?.id;
      const result = await createFinanceService().list({
        page,
        pageSize: 20,
        status: "UNLINKED",
        query: this.data.keyword,
        ...(campusId ? { campusId } : {}),
      });
      const rows = result.items.map((item) => ({
        ...item,
        amountLabel: financeMoney(item.amountFen),
        channelLabel: CHANNELS[item.channel] ?? item.channel,
      }));
      this.setData({
        rows: append ? [...this.data.rows, ...rows] : rows,
        total: result.total,
        page,
        hasMore: page * result.pageSize < result.total,
        viewState: result.total ? "ready" : "empty",
      });
    } catch (error) {
      this.setData({
        viewState: "error",
        errorMessage: message(error, "待录包收款加载失败"),
      });
    }
  },

  onCampusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ campusIndex: Number(event.detail.value), selected: null });
    void this.reload();
  },
  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value, selected: null });
    void this.reload();
  },
  onLoadMore() {
    if (this.data.hasMore) void this.reload(true);
  },
  onSelect(event: WechatMiniprogram.TouchEvent) {
    const selected = this.data.rows.find(
      (item) => item.id === String(event.currentTarget.dataset.id),
    );
    if (!selected) return;
    this.setData({
      selected,
      packageName: "",
      mainLessons: "",
      giftLessons: "0",
      validFrom: financeToday(),
      expiresOn: "",
      formError: "",
    });
  },
  onClose() {
    if (!this.data.submitting) this.setData({ selected: null, formError: "" });
  },
  noop() {},
  onField(event: WechatMiniprogram.Input) {
    const field = String(event.currentTarget.dataset.field);
    if (["packageName", "mainLessons", "giftLessons"].includes(field))
      this.setData({ [field]: event.detail.value });
  },
  onDate(event: WechatMiniprogram.PickerChange) {
    const field = String(event.currentTarget.dataset.field);
    if (["validFrom", "expiresOn"].includes(field))
      this.setData({ [field]: String(event.detail.value) });
  },
  onClearExpiry() {
    this.setData({ expiresOn: "" });
  },
  async onSubmit() {
    const receipt = this.data.selected;
    if (!receipt || this.data.submitting) return;
    this.setData({ submitting: true, formError: "" });
    try {
      const mainUnits = parseDecimalUnits(this.data.mainLessons);
      const giftUnits = parseDecimalUnits(this.data.giftLessons);
      if (!this.data.packageName.trim()) throw new Error("请输入课包名称");
      if (mainUnits <= 0) throw new Error("购买课时必须大于 0");
      if (this.data.expiresOn && this.data.expiresOn <= this.data.validFrom)
        throw new Error("到期日必须晚于生效日");
      await createFinanceService().issue(
        receipt.id,
        {
          name: this.data.packageName.trim(),
          mainUnits,
          giftUnits,
          validFrom: `${this.data.validFrom}T00:00:00+08:00`,
          expiresAt: this.data.expiresOn
            ? `${this.data.expiresOn}T23:59:59.999+08:00`
            : null,
        },
        `finance-package-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      this.setData({ selected: null });
      wx.showToast({ title: "课包录入成功", icon: "success" });
      await this.reload();
    } catch (error) {
      this.setData({ formError: message(error, "课包录入失败") });
    } finally {
      this.setData({ submitting: false });
    }
  },
  onRetry() {
    void this.initialize();
  },
});

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
