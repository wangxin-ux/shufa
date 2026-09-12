import {
  canPreviewFinance,
  loadReceiptPreview,
  previewReceiptDetail,
  ReceiptPreviewRow,
} from "./receipt-preview";
import { createTeacherRuntimeEnv } from "../../../config/teacher-env";
import { createSessionService } from "../../../services/session.service";
import {
  createFinanceService,
  FinanceChoice,
  FinanceReceipt,
  financeMoney,
  financeToday,
  parseDecimalUnits,
} from "../../../services/finance.service";
import {
  CORRECTION_STATUS_LABELS,
  CORRECTION_TYPE_LABELS,
  CorrectionView,
  correctionActions,
  createCorrectionApi,
  type CorrectionAction,
  type CorrectionType,
  type CreateCorrectionInput,
} from "../../../services/finance-corrections.service";

const channels = [
  { code: "WECHAT", name: "微信收款" },
  { code: "ALIPAY", name: "支付宝" },
  { code: "BANK", name: "银行转账" },
  { code: "CASH", name: "现金" },
  { code: "OTHER", name: "其他" },
];

type FinanceReceiptRow = ReceiptPreviewRow & {
  studentId?: string;
  channelCode?: string;
  validFrom?: string;
  expiresOn?: string;
  recordKind?: "ORIGINAL" | "REPLACEMENT";
  replacementOfCorrectionId?: string | null;
  correctionEffectLabel?: string;
  correction?: FinanceReceipt["correction"];
  correctionStatusLabel?: string;
  correctionTypeLabel?: string;
  canRequestCorrection?: boolean;
  correctionButtonLabel?: string;
};

function apiRow(receipt: FinanceReceipt): FinanceReceiptRow {
  const issued = receipt.issuance;
  const correction = receipt.correction;
  const terminalCorrection =
    correction?.status === "REJECTED" || correction?.status === "WITHDRAWN";
  return {
    id: receipt.id,
    studentName: receipt.studentName,
    campusId: receipt.campusId,
    campusName: receipt.campusName,
    date: receipt.receivedOn,
    amountFen: receipt.amountFen,
    linked: !!issued,
    main: (issued?.initialMainUnits ?? 0) / 100,
    gift: (issued?.initialGiftUnits ?? 0) / 100,
    price: issued ? financeMoney(issued.unitPriceFen) : "",
    channel:
      channels.find((item) => item.code === receipt.channel)?.name ??
      receipt.channel,
    channelCode: receipt.channel,
    studentId: receipt.studentId,
    course: issued?.name ?? "",
    amountLabel: financeMoney(receipt.amountFen),
    statusLabel: issued ? "已录包" : "待录包",
    packageLabel: issued
      ? `购买 ${issued.initialMainUnits / 100} 节 · 赠送 ${issued.initialGiftUnits / 100} 节`
      : "尚未录入课包",
    unitPriceLabel: issued
      ? `${financeMoney(issued.unitPriceFen)} 元/节`
      : "待录包",
    validityLabel: issued
      ? `${shanghaiDay(issued.validFrom)} 至 ${issued.expiresAt ? shanghaiDay(issued.expiresAt) : "长期有效"}`
      : "",
    validFrom: issued ? shanghaiDay(issued.validFrom) : "",
    expiresOn: issued?.expiresAt ? shanghaiDay(issued.expiresAt) : "",
    createdLabel: new Date(new Date(receipt.createdAt).getTime() + 8 * 3600000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 16),
    note: receipt.note,
    recordKind: receipt.recordKind,
    replacementOfCorrectionId: receipt.replacementOfCorrectionId,
    correctionEffectLabel: financeMoney(receipt.correctionEffectFen),
    correction,
    correctionStatusLabel: correction
      ? CORRECTION_STATUS_LABELS[correction.status]
      : "",
    correctionTypeLabel: correction
      ? CORRECTION_TYPE_LABELS[correction.type]
      : "",
    canRequestCorrection:
      receipt.recordKind === "ORIGINAL" &&
      !!issued &&
      (!correction || terminalCorrection),
    correctionButtonLabel:
      correction && !terminalCorrection ? "查看纠错" : "申请纠错",
  };
}
function shanghaiDay(value: string) {
  return new Date(new Date(value).getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 10);
}

function correctionSnapshot(snapshot: CorrectionView["original"]) {
  return {
    ...snapshot,
    amountLabel: financeMoney(snapshot.amountFen),
    channelLabel:
      channels.find((item) => item.code === snapshot.channel)?.name ??
      snapshot.channel,
    mainLabel: String(snapshot.package.mainUnits / 100),
    giftLabel: String(snapshot.package.giftUnits / 100),
    validFromLabel: shanghaiDay(snapshot.package.validFrom),
    expiresLabel: snapshot.package.expiresAt
      ? shanghaiDay(snapshot.package.expiresAt)
      : "长期有效",
  };
}

function correctionView(row: CorrectionView) {
  return {
    ...row,
    typeLabel: CORRECTION_TYPE_LABELS[row.type],
    statusLabel: CORRECTION_STATUS_LABELS[row.status],
    effectLabel: financeMoney(row.correctionEffectFen),
    createdLabel: new Date(new Date(row.createdAt).getTime() + 8 * 3600000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 16),
    original: correctionSnapshot(row.original),
    proposedReplacement: row.proposedReplacement
      ? correctionSnapshot(row.proposedReplacement)
      : null,
    events: row.events.map((event) => ({
      ...event,
      actionLabel:
        event.action in CORRECTION_TYPE_LABELS
          ? CORRECTION_TYPE_LABELS[event.action as CorrectionType]
          : event.action,
      timeLabel: new Date(new Date(event.createdAt).getTime() + 8 * 3600000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 16),
    })),
  };
}

Page({
  requestVersion: 0,
  choiceVersion: 0,
  mutation: { fingerprint: "", key: "" },
  data: {
    previewEnabled: false,
    apiEnabled: false,
    formMode: "",
    submitting: false,
    exporting: false,
    exportError: "",
    formError: "",
    studentOptions: [] as FinanceChoice[],
    studentIndex: -1,
    studentQuery: "",
    studentPage: 1,
    studentHasMore: false,
    choicesLoading: false,
    createCampusIndex: -1,
    channels,
    channelIndex: 0,
    proofPath: "",
    proofFileId: "",
    amount: "",
    receivedOn: "",
    note: "",
    packageName: "",
    mainLessons: "",
    giftLessons: "0",
    validFrom: "",
    expiresOn: "",
    correctionType: "VOID" as CorrectionType,
    correctionReason: "",
    correctionAction: "",
    correctionDetail: null as ReturnType<typeof correctionView> | null,
    correctionActions: [] as Array<{ code: string; name: string }>,
    showCorrection: false,
    today: "",
    headerTop: 28,
    headerRight: 100,
    viewState: "forbidden",
    errorMessage: "",
    campuses: [
      { id: "", name: "全部校区" },
      { id: "east", name: "东城校区" },
      { id: "west", name: "西城校区" },
    ],
    campusIndex: 0,
    startDate: "2026-09-01",
    endDate: "2026-09-06",
    keyword: "",
    status: "",
    tabs: [
      { code: "", name: "全部收款" },
      { code: "UNLINKED", name: "待录包" },
      { code: "LINKED", name: "已录包" },
    ],
    rows: [] as ReceiptPreviewRow[],
    total: 0,
    page: 1,
    hasMore: false,
    summary: {
      receiptsLabel: "0.00",
      correctionEffectLabel: "0.00",
      netAmountLabel: "0.00",
      linkedCount: 0,
      unlinkedCount: 0,
    },
    detail: null as FinanceReceiptRow | null,
  },
  onLoad(query: Record<string, string | undefined>) {
    let version: string | undefined;
    try {
      version = wx.getAccountInfoSync().miniProgram.envVersion;
    } catch {
      // Missing runtime identity must never enable the development fixture.
    }
    const info = wx.getWindowInfo();
    let headerTop = (info.statusBarHeight || 20) + 8;
    let headerRight = 100;
    try {
      const capsule = wx.getMenuButtonBoundingClientRect();
      if (capsule.height > 0) {
        headerTop = capsule.top;
        headerRight = info.windowWidth - capsule.left + 8;
      }
    } catch {
      // Keep room for the native capsule when geometry is unavailable.
    }
    const previewEnabled = canPreviewFinance(version, query.preview);
    this.setData({ previewEnabled, headerTop, headerRight });
    if (previewEnabled) {
      this.reload();
      return;
    }
    if (query.preview) return;
    void this.initializeApi();
  },
  async initializeApi() {
    if (createTeacherRuntimeEnv().dataDriver !== "api") return;
    this.setData({ viewState: "loading" });
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
      const today = financeToday();
      this.setData({
        apiEnabled: true,
        campuses: [{ id: "", name: "全部校区" }],
        today,
        startDate: today.slice(0, 7) + "-01",
        endDate: today,
        receivedOn: today,
        validFrom: today,
      });
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
      this.reload();
    } catch (error) {
      this.setData({
        viewState: "error",
        errorMessage:
          error instanceof Error ? error.message : "财务账号加载失败",
      });
    }
  },
  reload(append = false) {
    if (this.data.apiEnabled) {
      void this.reloadApi(append);
      return;
    }
    if (!this.data.previewEnabled) return;
    this.setData({ viewState: "loading", errorMessage: "", detail: null });
    try {
      const page = append ? this.data.page + 1 : 1;
      const result = loadReceiptPreview({
        campusId: this.data.campuses[this.data.campusIndex].id,
        keyword: this.data.keyword,
        startDate: this.data.startDate,
        endDate: this.data.endDate,
        status: this.data.status,
        page,
      });
      this.setData({
        ...result,
        summary: {
          ...result.summary,
          correctionEffectLabel: "0.00",
          netAmountLabel: result.summary.receiptsLabel,
        },
        rows: append ? [...this.data.rows, ...result.rows] : result.rows,
        page,
        viewState: result.total ? "ready" : "empty",
      });
    } catch (error) {
      this.setData({
        viewState: "error",
        rows: [],
        total: 0,
        hasMore: false,
        summary: {
          receiptsLabel: "0.00",
          correctionEffectLabel: "0.00",
          netAmountLabel: "0.00",
          linkedCount: 0,
          unlinkedCount: 0,
        },
        errorMessage:
          error instanceof Error ? error.message : "收款记录加载失败",
      });
    }
  },
  async reloadApi(append = false) {
    const version = ++this.requestVersion;
    this.setData({ viewState: "loading", errorMessage: "", detail: null });
    try {
      const page = append ? this.data.page + 1 : 1;
      if (this.data.startDate > this.data.endDate)
        throw new Error("开始日期不能晚于结束日期");
      const query = { page, pageSize: 20, ...this.receiptFilters() };
      const result = await createFinanceService().list(query);
      if (version !== this.requestVersion) return;
      const rows = result.items.map(apiRow);
      this.setData({
        rows: append ? [...this.data.rows, ...rows] : rows,
        page,
        total: result.total,
        hasMore: page * result.pageSize < result.total,
        viewState: result.total ? "ready" : "empty",
        summary: {
          receiptsLabel: financeMoney(result.summary.amountFen),
          correctionEffectLabel: financeMoney(
            result.summary.correctionEffectFen,
          ),
          netAmountLabel: financeMoney(result.summary.netAmountFen),
          linkedCount: result.total - result.summary.unlinkedCount,
          unlinkedCount: result.summary.unlinkedCount,
        },
      });
    } catch (error) {
      if (version !== this.requestVersion) return;
      this.setData({
        viewState: "error",
        errorMessage: error instanceof Error ? error.message : "收款加载失败",
        rows: [],
        total: 0,
        hasMore: false,
        summary: {
          receiptsLabel: "0.00",
          correctionEffectLabel: "0.00",
          netAmountLabel: "0.00",
          linkedCount: 0,
          unlinkedCount: 0,
        },
      });
    }
  },
  receiptFilters() {
    if (this.data.startDate > this.data.endDate)
      throw new Error("开始日期不能晚于结束日期");
    const query: Record<string, string | number> = {
      from: this.data.startDate,
      to: this.data.endDate,
      query: this.data.keyword,
    };
    const campusId = this.data.campuses[this.data.campusIndex]?.id;
    if (campusId) query.campusId = campusId;
    if (this.data.status) query.status = this.data.status;
    return query;
  },
  async onExport() {
    if (!this.data.apiEnabled || this.data.exporting) return;
    this.setData({ exporting: true, exportError: "" });
    try {
      await createFinanceService().exportReceipts(this.receiptFilters());
    } catch (error) {
      this.setData({
        exportError:
          error instanceof Error ? error.message : "收款明细导出失败",
      });
    } finally {
      this.setData({ exporting: false });
    }
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) {
    const campusIndex = Number(event.detail.value);
    if (!this.data.campuses[campusIndex]) return;
    this.setData({ campusIndex });
    this.reload();
  },
  onStartChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ startDate: String(event.detail.value) });
    this.reload();
  },
  onEndChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ endDate: String(event.detail.value) });
    this.reload();
  },
  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
    this.reload();
  },
  onStatusTap(event: WechatMiniprogram.TouchEvent) {
    const status = String(event.currentTarget.dataset.status || "");
    if (!this.data.tabs.some((tab) => tab.code === status)) return;
    this.setData({ status });
    this.reload();
  },
  onLoadMore() {
    this.reload(true);
  },
  onRetry() {
    if (!this.data.apiEnabled && !this.data.previewEnabled)
      void this.initializeApi();
    else this.reload();
  },
  onReset() {
    const today = this.data.apiEnabled ? financeToday() : "2026-09-06";
    this.setData({
      keyword: "",
      campusIndex: 0,
      status: "",
      startDate: today.slice(0, 7) + "-01",
      endDate: today,
    });
    this.reload();
  },
  onReceiptTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.apiEnabled) {
      void this.openApiDetail(String(event.currentTarget.dataset.id));
      return;
    }
    if (!this.data.previewEnabled) return;
    this.setData({
      detail: previewReceiptDetail(String(event.currentTarget.dataset.id)),
    });
  },
  async openApiDetail(id: string) {
    try {
      const detail = await createFinanceService().detail(id);
      let fullCorrection: CorrectionView | null = null;
      if (detail.correction) {
        fullCorrection = await createCorrectionApi("FINANCE").detail(
          detail.correction.id,
        );
      }
      this.setData({
        detail: apiRow(detail),
        correctionDetail: fullCorrection
          ? correctionView(fullCorrection)
          : null,
        correctionActions: fullCorrection
          ? correctionActions("FINANCE", fullCorrection.status)
          : [],
        showCorrection: false,
      });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "详情加载失败",
        icon: "none",
      });
    }
  },
  onCreate() {
    if (!this.data.apiEnabled) return;
    this.mutation = { fingerprint: "", key: "" };
    this.setData({
      formMode: "receipt",
      formError: "",
      createCampusIndex: -1,
      studentOptions: [],
      studentIndex: -1,
      studentQuery: "",
      choicesLoading: false,
      studentHasMore: false,
      proofPath: "",
      proofFileId: "",
      amount: "",
      note: "",
      receivedOn: financeToday(),
      channelIndex: 0,
    });
  },
  onIssue() {
    if (!this.data.apiEnabled || !this.data.detail || this.data.detail.linked)
      return;
    this.mutation = { fingerprint: "", key: "" };
    this.setData({
      formMode: "issue",
      formError: "",
      packageName: "",
      mainLessons: "",
      giftLessons: "0",
      validFrom: financeToday(),
      expiresOn: "",
    });
  },
  onCorrection() {
    if (
      !this.data.apiEnabled ||
      !this.data.detail?.linked ||
      this.data.detail.recordKind !== "ORIGINAL"
    )
      return;
    if (
      this.data.detail.correction &&
      !this.data.detail.canRequestCorrection
    ) {
      this.setData({ showCorrection: true });
      return;
    }
    const detail = this.data.detail;
    const campusIndex = this.data.campuses.findIndex(
      (campus) => campus.id === detail.campusId,
    );
    const channelIndex = Math.max(
      0,
      channels.findIndex((channel) => channel.code === detail.channelCode),
    );
    this.mutation = { fingerprint: "", key: "" };
    this.setData({
      formMode: "correction",
      correctionType: "VOID",
      correctionReason: "",
      correctionAction: "",
      formError: "",
      createCampusIndex: campusIndex,
      studentOptions: detail.studentId
        ? [{ id: detail.studentId, name: detail.studentName }]
        : [],
      studentIndex: detail.studentId ? 0 : -1,
      studentQuery: "",
      studentHasMore: false,
      amount: financeMoney(detail.amountFen),
      receivedOn: detail.date,
      channelIndex,
      note: detail.note ?? "",
      packageName: detail.course,
      mainLessons: String(detail.main),
      giftLessons: String(detail.gift),
      validFrom: detail.validFrom ?? "",
      expiresOn: detail.expiresOn ?? "",
      proofPath: "",
      proofFileId: "",
    });
  },
  onCorrectionType(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting || this.data.formMode !== "correction") return;
    const type = String(event.currentTarget.dataset.type);
    if (type === "VOID" || type === "REPLACE")
      this.setData({ correctionType: type, formError: "" });
  },
  onCorrectionAction(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.apiEnabled || this.data.submitting || !this.data.correctionDetail)
      return;
    const action = String(event.currentTarget.dataset.action);
    if (
      !this.data.correctionActions.some((item) => item.code === action)
    )
      return;
    this.mutation = { fingerprint: "", key: "" };
    this.setData({
      formMode: "correctionAction",
      correctionAction: action,
      correctionReason: "",
      formError: "",
    });
  },
  onCloseForm() {
    if (this.data.submitting) return;
    this.choiceVersion += 1;
    this.setData({
      formMode: "",
      formError: "",
      choicesLoading: false,
      correctionAction: "",
    });
  },
  onField(event: WechatMiniprogram.Input) {
    if (this.data.submitting) return;
    const field = String(event.currentTarget.dataset.field);
    if (
      [
        "amount",
        "note",
        "packageName",
        "mainLessons",
        "giftLessons",
        "studentQuery",
        "correctionReason",
      ].includes(field)
    ) {
      this.setData({ [field]: event.detail.value });
    }
  },
  onDateField(event: WechatMiniprogram.PickerChange) {
    if (this.data.submitting) return;
    const field = String(event.currentTarget.dataset.field);
    if (["receivedOn", "validFrom", "expiresOn"].includes(field))
      this.setData({ [field]: String(event.detail.value) });
  },
  onClearExpiry() {
    if (!this.data.submitting) this.setData({ expiresOn: "" });
  },
  onChannel(event: WechatMiniprogram.PickerChange) {
    const channelIndex = Number(event.detail.value);
    if (!this.data.submitting && channels[channelIndex])
      this.setData({ channelIndex });
  },
  onCreateCampus(event: WechatMiniprogram.PickerChange) {
    if (this.data.submitting) return;
    const createCampusIndex = Number(event.detail.value);
    if (!this.data.campuses[createCampusIndex]?.id) return;
    this.setData({
      createCampusIndex,
      studentIndex: -1,
      studentQuery: "",
      studentOptions: [],
    });
    void this.loadStudents();
  },
  onStudent(event: WechatMiniprogram.PickerChange) {
    const studentIndex = Number(event.detail.value);
    if (!this.data.submitting && this.data.studentOptions[studentIndex])
      this.setData({ studentIndex });
  },
  onStudentSearch() {
    void this.loadStudents();
  },
  onMoreStudents() {
    void this.loadStudents(true);
  },
  async loadStudents(append = false) {
    const campusId = this.data.campuses[this.data.createCampusIndex]?.id;
    if (!campusId || this.data.submitting) return;
    const version = ++this.choiceVersion;
    this.setData({
      choicesLoading: true,
      formError: "",
      ...(append ? {} : { studentIndex: -1, studentOptions: [] }),
    });
    try {
      const page = append ? this.data.studentPage + 1 : 1;
      const result = await createFinanceService().students(
        campusId,
        this.data.studentQuery,
        page,
      );
      if (version !== this.choiceVersion) return;
      this.setData({
        studentOptions: append
          ? [...this.data.studentOptions, ...result.items]
          : result.items,
        studentPage: page,
        studentHasMore: page * result.pageSize < result.total,
      });
    } catch (error) {
      if (version === this.choiceVersion)
        this.setData({
          formError: error instanceof Error ? error.message : "学员加载失败",
        });
    } finally {
      if (version === this.choiceVersion)
        this.setData({ choicesLoading: false });
    }
  },
  onChooseProof() {
    if (this.data.submitting) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const file = result.tempFiles[0];
        if (!file || file.size > 3 * 1024 * 1024) {
          this.setData({ formError: "凭证图片不能超过 3 MB" });
          return;
        }
        this.setData({
          proofPath: file.tempFilePath,
          proofFileId: "",
          formError: "",
        });
      },
    });
  },
  async onViewProof() {
    if (!this.data.apiEnabled || !this.data.detail) return;
    try {
      const path = await createFinanceService().proof(this.data.detail.id);
      wx.previewImage({ urls: [path], current: path });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "凭证读取失败",
        icon: "none",
      });
    }
  },
  async onCorrectionProof(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.apiEnabled || !this.data.correctionDetail) return;
    try {
      const kind = String(event.currentTarget.dataset.kind);
      const api = createCorrectionApi("FINANCE");
      const path =
        kind === "replacement"
          ? await api.replacementProof(this.data.correctionDetail.id)
          : await api.originalProof(this.data.correctionDetail.id);
      wx.previewImage({ urls: [path], current: path });
    } catch (error) {
      wx.showToast({
        title: error instanceof Error ? error.message : "纠错凭证读取失败",
        icon: "none",
      });
    }
  },
  async onSubmit() {
    if (!this.data.apiEnabled || this.data.submitting || !this.data.formMode)
      return;
    this.setData({ submitting: true, formError: "" });
    try {
      const service = createFinanceService();
      let receiptId = this.data.detail?.id ?? "";
      let successTitle = "操作已完成";
      if (this.data.formMode === "receipt") {
        const campusId = this.data.campuses[this.data.createCampusIndex]?.id;
        const studentId = this.data.studentOptions[this.data.studentIndex]?.id;
        const amountFen = parseDecimalUnits(this.data.amount);
        if (!campusId || !studentId || amountFen <= 0 || !this.data.proofPath)
          throw new Error("请完整填写校区、学员、实收金额和凭证");
        if (!this.data.proofFileId) {
          const proof = await service.upload(this.data.proofPath);
          this.setData({ proofFileId: proof.id });
        }
        const input = {
          campusId,
          studentId,
          amountFen,
          receivedOn: this.data.receivedOn,
          channel: channels[this.data.channelIndex].code,
          proofFileId: this.data.proofFileId,
          note: this.data.note,
        };
        receiptId = (
          await service.create(input, this.mutationKey("receipt", input))
        ).id;
        successTitle = "收款已登记";
      } else if (this.data.formMode === "issue") {
        if (!this.data.detail || this.data.detail.linked)
          throw new Error("请重新选择待录包收款");
        receiptId = this.data.detail.id;
        const input = {
          name: this.data.packageName.trim(),
          mainUnits: parseDecimalUnits(this.data.mainLessons),
          giftUnits: parseDecimalUnits(this.data.giftLessons),
          validFrom: `${this.data.validFrom}T00:00:00+08:00`,
          expiresAt: this.data.expiresOn
            ? `${this.data.expiresOn}T23:59:59.999+08:00`
            : null,
        };
        if (!input.name || input.mainUnits <= 0)
          throw new Error("请填写课包名称和购买课时");
        if (this.data.expiresOn && this.data.expiresOn < this.data.validFrom)
          throw new Error("到期日不能早于生效日");
        await service.issue(
          receiptId,
          input,
          this.mutationKey(receiptId, input),
        );
        successTitle = "课包已发放";
      } else if (this.data.formMode === "correction") {
        if (!this.data.detail?.linked)
          throw new Error("请重新打开已录包的收款详情");
        receiptId = this.data.detail.id;
        const reason = this.data.correctionReason.trim();
        if (!reason) throw new Error("请填写纠错原因");
        let input: CreateCorrectionInput;
        if (this.data.correctionType === "VOID") {
          input = { type: "VOID", reason };
        } else {
          const campusId = this.data.campuses[this.data.createCampusIndex]?.id;
          const studentId = this.data.studentOptions[this.data.studentIndex]?.id;
          if (!campusId || !studentId)
            throw new Error("请选择更正后的校区和学员");
          if (!this.data.proofPath && !this.data.proofFileId)
            throw new Error("更正替代必须选择新的收款凭证");
          if (!this.data.proofFileId) {
            const proof = await service.upload(this.data.proofPath);
            this.setData({ proofFileId: proof.id });
          }
          const amountFen = parseDecimalUnits(this.data.amount);
          const mainUnits = parseDecimalUnits(this.data.mainLessons);
          const giftUnits = parseDecimalUnits(this.data.giftLessons);
          if (
            amountFen <= 0 ||
            mainUnits <= 0 ||
            !this.data.packageName.trim() ||
            !this.data.validFrom
          )
            throw new Error("请完整填写更正后的收款与课包");
          if (this.data.expiresOn && this.data.expiresOn < this.data.validFrom)
            throw new Error("到期日不能早于生效日");
          input = {
            type: "REPLACE",
            reason,
            replacement: {
              campusId,
              studentId,
              amountFen,
              receivedOn: this.data.receivedOn,
              channel: channels[this.data.channelIndex].code,
              proofFileId: this.data.proofFileId,
              note: this.data.note,
              package: {
                name: this.data.packageName.trim(),
                mainUnits,
                giftUnits,
                validFrom: `${this.data.validFrom}T00:00:00+08:00`,
                expiresAt: this.data.expiresOn
                  ? `${this.data.expiresOn}T23:59:59.999+08:00`
                  : null,
              },
            },
          };
        }
        await createCorrectionApi("FINANCE").submit(
          receiptId,
          input,
          this.mutationKey(`correction-${receiptId}`, input),
        );
        successTitle = "纠错申请已提交";
      } else {
        if (!this.data.correctionDetail)
          throw new Error("请重新打开纠错详情");
        const reason = this.data.correctionReason.trim();
        if (!reason) throw new Error("请填写处理说明");
        const action = this.data.correctionAction as CorrectionAction;
        if (
          !correctionActions("FINANCE", this.data.correctionDetail.status).some(
            (item) => item.code === action,
          )
        )
          throw new Error("纠错状态已变化，请刷新详情");
        receiptId = this.data.correctionDetail.originalReceiptId;
        const input = {
          action,
          expectedVersion: this.data.correctionDetail.version,
          reason,
        };
        await createCorrectionApi("FINANCE").act(
          this.data.correctionDetail.id,
          input,
          this.mutationKey(`correction-action-${this.data.correctionDetail.id}`, input),
        );
        successTitle = action === "APPLY" ? "账面纠错已执行" : "纠错申请已撤回";
      }
      wx.showToast({
        title: successTitle,
        icon: "success",
      });
      this.setData({ formMode: "" });
      await this.reloadApi();
      await this.openApiDetail(receiptId);
    } catch (error) {
      this.setData({
        formError: error instanceof Error ? error.message : "提交失败，请重试",
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
  mutationKey(scope: string, input: unknown) {
    const fingerprint = JSON.stringify([scope, input]);
    if (this.mutation.fingerprint !== fingerprint)
      this.mutation = {
        fingerprint,
        key: `finance-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      };
    return this.mutation.key;
  },
  onRefund() {
    if (!this.data.apiEnabled || !this.data.detail?.linked) return;
    wx.navigateTo({
      url: `/pages/finance/refunds/index?receiptId=${encodeURIComponent(this.data.detail.id)}`,
    });
  },
  onRefundList() {
    if (this.data.apiEnabled)
      wx.navigateTo({ url: "/pages/finance/refunds/index" });
  },
  onReports() {
    if (this.data.apiEnabled)
      wx.navigateTo({ url: "/pages/finance/reports/index" });
  },
  onLogout() {
    if (this.data.submitting) return;
    createSessionService().logout();
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },
  onCloseDetail() {
    this.setData({
      detail: null,
      correctionDetail: null,
      correctionActions: [],
      showCorrection: false,
    });
  },
  onSheetTap() {},
  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: "/pages/finance/home/index" });
  },
});
