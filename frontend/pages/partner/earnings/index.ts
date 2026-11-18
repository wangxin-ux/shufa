import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  presentPartnerEarningEntry,
  presentPartnerEarningRule,
  presentPartnerEarningSummary,
} from "../../../services/partner-earnings.presenter";
import {
  PARTNER_REPORT_PERIOD_OPTIONS,
  buildPartnerPeriodQuery,
  formatPartnerPeriodLabel,
  todayPartnerAnchorDate,
} from "../../../services/partner-operations.presenter";
import { createPartnerService } from "../../../services/partner-runtime";
import { getPartnerCampaignDraftService } from "../runtime/partner-campaign-draft.service";
import { createSessionService } from "../../../services/session.service";
import type { RequestState } from "../../../utils/request-state";
import {
  PartnerEarningStatus,
  PartnerReportPeriod,
} from "../../../types/partner";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: Array<{
  label: string;
  value?: PartnerEarningStatus;
}> = [
  { label: "全部状态" },
  { label: "待审核", value: "PENDING_REVIEW" },
  { label: "可结算", value: "AVAILABLE" },
  { label: "已驳回", value: "REJECTED" },
  { label: "已冲正", value: "REVERSED" },
];

Page({
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingKey: "",
  contentKey: "",
  hidden: false,
  disposed: false,
  initialShowPending: false,
  runtime: undefined as ReturnType<typeof createPartnerService> | undefined,
  earningsOwnerKey: "",

  data: {
    viewState: "loading",
    errorMessage: "",
    refreshError: "",
    pageError: "",
    summary: null as ReturnType<typeof presentPartnerEarningSummary> | null,
    rule: null as ReturnType<typeof presentPartnerEarningRule>,
    entries: [] as Array<ReturnType<typeof presentPartnerEarningEntry>>,
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    periodOptions: PARTNER_REPORT_PERIOD_OPTIONS,
    periodIndex: 1,
    anchorDate: todayPartnerAnchorDate(),
    periodLabel: formatPartnerPeriodLabel("MONTH", todayPartnerAnchorDate()),
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.earningsOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    void this.load(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.load(true);
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingKey = "";
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  onStatusChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const statusIndex = Number(event.detail.value);
    if (!Number.isInteger(statusIndex) || !this.data.statusOptions[statusIndex] ||
      statusIndex === this.data.statusIndex) return;
    this.setData({ statusIndex });
    void this.load(true);
  },

  onPeriodTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const period = String(
      event.currentTarget.dataset.period ?? "",
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
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const anchorDate = String(event.detail.value);
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    this.setData({
      anchorDate,
      periodLabel: formatPartnerPeriodLabel(period, anchorDate),
    });
    void this.load(true);
  },

  invalidateEarnings(message: string) {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingKey = "";
    this.contentKey = "";
    this.setData({
      viewState: "forbidden", errorMessage: message,
      summary: null, rule: null, entries: [], page: 0, total: 0,
      hasMore: false, loadingMore: false, refreshError: "", pageError: "",
    });
  },

  validateOwner() {
    if (!this.earningsOwnerKey ||
      getPartnerCampaignDraftService().getSessionKey() === this.earningsOwnerKey) return true;
    this.invalidateEarnings("登录已更新，请重新登录");
    return false;
  },

  load(reset: boolean): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    if (
      !reset &&
      (this.pendingRequest ||
        !this.data.hasMore ||
        this.data.refreshError ||
        this.data.viewState !== "ready")
    ) {
      return Promise.resolve();
    }
    const page = reset ? 1 : this.data.page + 1;
    const status = this.data.statusOptions[this.data.statusIndex]?.value as
      PartnerEarningStatus | undefined;
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    const periodQuery = buildPartnerPeriodQuery(period, this.data.anchorDate);
    const contentKey = JSON.stringify([period, this.data.anchorDate, status]);
    const pendingKey = JSON.stringify([contentKey, page]);
    if (this.pendingRequest && this.pendingKey === pendingKey)
      return this.pendingRequest;
    const sequence = ++this.requestSequence;
    const runtime = this.runtime;
    const current = () => !this.hidden && !this.disposed &&
      sequence === this.requestSequence && this.validateOwner();
    const keepContent =
      this.contentKey === contentKey && this.data.summary !== null;
    this.pendingKey = pendingKey;
    this.setData(
      reset
        ? {
            ...(keepContent
              ? {}
              : {
                  viewState: "loading",
                  summary: null,
                  rule: null,
                  entries: [],
                  page: 0,
                  total: 0,
                  hasMore: false,
                }),
            errorMessage: "",
            refreshError: "",
            pageError: "",
            loadingMore: false,
          }
        : { loadingMore: true, pageError: "" },
    );
    const request = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        const rejected = (error: unknown) => ({
          status: "error" as const,
          statusCode:
            typeof error === "object" && error !== null &&
            "statusCode" in error && typeof error.statusCode === "number"
              ? error.statusCode : undefined,
          message: "合作收益加载失败，请重试",
        });
        const read = async <T>(load: () => Promise<RequestState<T>>) => {
          const result = await Promise.resolve().then(() => {
            if (!current()) return;
            return load();
          }).catch(rejected);
          if (!result || !current()) return result;
          if (result.status === "error" && (result.statusCode === 401 || result.statusCode === 403)) {
            this.invalidateEarnings(result.statusCode === 401
              ? "登录已失效，请重新登录" : "当前账号无权查看本校区合作收益");
          }
          return result;
        };
        const [summaryState, ruleState, entriesState] = await Promise.all([
          reset ? read(() => runtime.loadEarningSummary(periodQuery)) : Promise.resolve(null),
          reset ? read(() => runtime.loadCurrentEarningRule()) : Promise.resolve(null),
          read(() => runtime.loadEarnings({
            page, pageSize: PAGE_SIZE, status, ...periodQuery,
          })),
        ]);
        if (!entriesState || !current()) return;
        const states = [summaryState, ruleState, entriesState];
        const failure = states.find((state) => state?.status === "error");
        if (failure?.status === "error") {
          this.setData({
            loadingMore: false,
            ...(keepContent
              ? reset
                ? { refreshError: failure.message }
                : { pageError: failure.message }
              : { viewState: "error", errorMessage: failure.message }),
          });
          return;
        }
        if (
          entriesState.status !== "success" &&
          entriesState.status !== "empty"
        )
          return;
        const nextEntries = entriesState.data.data.map(
          presentPartnerEarningEntry,
        );
        const entries = reset
          ? nextEntries
          : Array.from(
              new Map(
                [...this.data.entries, ...nextEntries].map((entry) => [
                  entry.id,
                  entry,
                ]),
              ).values(),
            );
        const updates: Record<string, unknown> = {
          entries,
          page: entriesState.data.meta.page,
          total: entriesState.data.meta.total,
          hasMore:
            entriesState.data.meta.page < entriesState.data.meta.totalPages,
          loadingMore: false,
          viewState: entries.length > 0 ? "ready" : "empty",
          errorMessage: "",
          refreshError: "",
          pageError: "",
        };
        if (
          summaryState?.status === "success" ||
          summaryState?.status === "empty"
        ) {
          updates.summary = presentPartnerEarningSummary(summaryState.data);
        }
        if (ruleState?.status === "success" || ruleState?.status === "empty") {
          updates.rule = presentPartnerEarningRule(ruleState.data);
        }
        this.contentKey = contentKey;
        this.setData(updates);
      })
      .finally(() => {
        if (sequence === this.requestSequence) {
          this.pendingRequest = undefined;
          this.pendingKey = "";
        }
      });
    this.pendingRequest = request;
    return request;
  },

  onRetry() {
    void this.load(true);
  },

  onLoadMore() {
    void this.load(false);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateEarnings("登录已失效，请重新登录");
    this.runtime = undefined;
    createSessionService().logout();
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },
});
