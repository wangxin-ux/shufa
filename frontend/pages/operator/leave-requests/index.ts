import {
  buildOperatorLeaveItems,
  OperatorLeaveItemModel,
  mergeOperatorLeaveHistory,
} from "../runtime/services/operator-leave.presenter";
import { OperatorLeaveWorkflow } from "../runtime/services/operator-leave.workflow";
import { createSessionService } from "../../../services/session.service";
import { OperatorPageContext } from "../runtime/operator-page-context";
import {
  OperatorLeaveRequest,
  OperatorPage,
} from "../runtime/types/operator";
import { RequestState } from "../../../utils/request-state";

type LeaveTab = "pending" | "history";
type ReviewCommand =
  | { operation: "approve"; id: string; version: number }
  | { operation: "reject"; id: string; version: number; reviewReason: string };

const PAGE_SIZE = 20;
const EMPTY_REJECTION = {
  rejectVisible: false, rejectId: "", rejectStudentName: "", rejectReason: "", rejectError: "",
};
const EMPTY_RECOVERY = {
  reviewRecoveryAvailable: false, reviewRecoveryReady: false,
};

Page({
  context: undefined as OperatorPageContext | undefined,
  workflow: undefined as OperatorLeaveWorkflow | undefined,
  currentRequests: [] as OperatorLeaveRequest[],
  pendingRequest: undefined as Promise<void> | undefined,
  initialShowPending: true,
  requestedLeaveId: "",
  needsRevalidation: true,
  reviewing: false,
  reviewSequence: 0,
  modalSequence: 0,
  modalId: "",
  pullSequence: 0,
  uncertainReview: undefined as ReviewCommand | undefined,
  recoveryReady: false,
  data: {
    viewState: "loading",
    errorMessage: "",
    activeTab: "pending" as LeaveTab,
    tabs: [
      { key: "pending", label: "待审批" },
      { key: "history", label: "审批记录" },
    ],
    items: [] as OperatorLeaveItemModel[],
    selectedItem: null as OperatorLeaveItemModel | null,
    total: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    refreshing: false,
    refreshError: "",
    loadMoreError: "",
    selectionMessage: "",
    reviewBlocked: true,
    submitting: false,
    submittingId: "",
    ...EMPTY_REJECTION,
    ...EMPTY_RECOVERY,
  },

  onLoad(options: { selectedLeaveId?: string } = {}) {
    this.currentRequests = [];
    this.requestedLeaveId = options.selectedLeaveId ?? "";
    this.context = new OperatorPageContext((errorMessage) => {
      this.currentRequests = [];
      this.workflow = undefined;
      this.pendingRequest = undefined;
      this.uncertainReview = undefined;
      this.recoveryReady = false;
      this.requestedLeaveId = "";
      this.needsRevalidation = true;
      this.reviewSequence += 1;
      this.dismissModal();
      this.setData({
        ...EMPTY_REJECTION, ...EMPTY_RECOVERY, viewState: "forbidden", errorMessage,
        items: [], selectedItem: null, total: 0, page: 1, hasMore: false,
        loadingMore: false, refreshing: false, submitting: false, submittingId: "",
        refreshError: "", loadMoreError: "", selectionMessage: "", reviewBlocked: true,
      });
    });
    this.workflow = new OperatorLeaveWorkflow(this.context.service);
    void this.loadRequests(true);
  },

  onShow() {
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    this.setData({ submitting: this.reviewing, submittingId: this.reviewing ? this.data.submittingId : "" });
    void this.loadRequests(true);
  },

  onHide() {
    this.context?.hide();
    this.pendingRequest = undefined;
    this.initialShowPending = false;
    this.needsRevalidation = true;
    this.reviewSequence += 1;
    this.pullSequence += 1;
    this.dismissModal();
    this.requestedLeaveId = this.data.selectedItem?.id || this.requestedLeaveId;
    this.currentRequests = [];
    this.recoveryReady = false;
    this.setData({
      ...EMPTY_REJECTION, ...EMPTY_RECOVERY,
      items: [], selectedItem: null, total: 0, page: 1, hasMore: false,
      loadingMore: false, refreshing: false, selectionMessage: "", reviewBlocked: true,
    });
  },

  onUnload() {
    this.context?.dispose();
    this.pendingRequest = undefined;
    this.currentRequests = [];
    this.workflow = undefined;
    this.uncertainReview = undefined;
    this.recoveryReady = false;
    this.reviewSequence += 1;
    this.dismissModal();
  },

  dismissModal() {
    this.modalSequence += 1;
    this.modalId = "";
  },

  onPullDownRefresh() {
    if (this.reviewing) { wx.stopPullDownRefresh(); return; }
    const sequence = ++this.pullSequence;
    void this.loadRequests(true).finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  loadRequests(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive()) return Promise.resolve();
    // A refresh supersedes pagination; repeated first-page reads share one request.
    if (this.pendingRequest && (!reset || this.data.refreshing)) return this.pendingRequest;
    const page = reset ? 1 : this.data.page + 1;
    const tab = this.data.activeTab;
    const keepContent = ["ready", "empty"].includes(this.data.viewState);
    const sequence = context.nextRead();
    this.dismissModal();
    this.needsRevalidation = true;
    this.recoveryReady = false;
    this.setData({
      reviewBlocked: true, reviewRecoveryAvailable: Boolean(this.uncertainReview),
      reviewRecoveryReady: false,
    });
    if (reset) {
      this.needsRevalidation = true;
      this.setData({
        ...(keepContent ? {} : { viewState: "loading" }),
        errorMessage: "", refreshError: "", loadMoreError: "", refreshing: true, loadingMore: false, reviewBlocked: true,
      });
    } else {
      this.setData({ loadingMore: true, loadMoreError: "" });
    }
    const request = Promise.resolve().then(() => {
      if (!context.accepts(sequence)) return;
      return tab === "pending" ? this.loadPending(page) : this.loadHistory(page);
    }).then((result) => {
    if (!result || !context.accepts(sequence)) return;
    if (result.status === "error") {
      if (result.statusCode === 401 || result.statusCode === 403) {
        context.invalidate(result.message);
      } else {
        this.requestedLeaveId = this.data.selectedItem?.id || this.requestedLeaveId;
        this.setData({
        ...EMPTY_REJECTION, selectedItem: null,
        ...(keepContent
          ? reset ? { refreshError: result.message } : { loadMoreError: result.message }
          : { viewState: "error", errorMessage: result.message }),
        loadingMore: false, refreshing: false,
      });
      }
      return;
    }
    this.currentRequests = reset
      ? result.requests
      : mergeOperatorLeaveHistory(this.currentRequests, result.requests);
    const items = buildOperatorLeaveItems(this.currentRequests);
    const desiredId = this.requestedLeaveId || this.data.selectedItem?.id;
    const selectedItem =
      tab === "pending" && !this.uncertainReview
        ? desiredId ? items.find((item) => item.id === desiredId && item.canReview) ?? null
          : items.find((item) => item.canReview) ?? null
        : null;
    const selectionMessage = tab === "pending" && desiredId && !selectedItem && !this.uncertainReview
      ? items.some((item) => item.id === desiredId)
        ? "当前不可审批，请选择其他申请"
        : "指定申请不在当前列表，请刷新或选择其他申请"
      : "";
    if (selectedItem?.id === this.requestedLeaveId) this.requestedLeaveId = "";
    if (desiredId && !selectedItem) this.requestedLeaveId = desiredId;
    const keepRejection = tab === "pending" && !this.uncertainReview && items.some(
      (item) => item.id === this.data.rejectId && item.canReview &&
        item.version === this.data.items.find((previous) => previous.id === item.id)?.version,
    );
    this.needsRevalidation = false;
    this.recoveryReady = Boolean(this.uncertainReview);
    this.setData({
      ...(!keepRejection ? EMPTY_REJECTION : {}),
      viewState: this.currentRequests.length === 0 ? "empty" : "ready",
      items,
      selectedItem,
      total: result.total,
      page,
      hasMore: result.hasMore,
      loadingMore: false, refreshing: false, reviewBlocked: Boolean(this.uncertainReview),
      reviewRecoveryAvailable: Boolean(this.uncertainReview), reviewRecoveryReady: this.recoveryReady,
      errorMessage: "", refreshError: "", loadMoreError: "", selectionMessage,
    });
    }).finally(() => {
      if (this.pendingRequest === request) this.pendingRequest = undefined;
    });
    this.pendingRequest = request;
    return request;
  },

  async loadPending(page: number) {
    const state = await this.context!.service.loadLeaveRequests({
      page,
      pageSize: PAGE_SIZE,
      status: "PENDING",
    });
    return this.toLoadResult(state, page);
  },

  async loadHistory(page: number) {
    const state = await this.context!.service.loadLeaveRequests({
      page,
      pageSize: PAGE_SIZE,
      reviewedOnly: true,
    });
    return this.toLoadResult(state, page);
  },

  toLoadResult(
    state: RequestState<OperatorPage<OperatorLeaveRequest>>,
    page: number,
  ) {
    if (state.status === "error") {
      return state;
    }
    if (state.status !== "success" && state.status !== "empty") {
      return { status: "error" as const, message: "审批列表尚未加载完成" };
    }
    const value = state.data;
    const meta = value?.meta;
    if (!Array.isArray(value?.data) || !meta || meta.page !== page || meta.pageSize !== PAGE_SIZE ||
      !Number.isSafeInteger(meta.total) || meta.total < value.data.length ||
      meta.totalPages !== Math.ceil(meta.total / PAGE_SIZE) || value.data.length > PAGE_SIZE ||
      value.data.length !== Math.min(PAGE_SIZE, Math.max(0, meta.total - (page - 1) * PAGE_SIZE)) ||
      value.data.some((item) => !item || typeof item.id !== "string" || !item.id ||
        !Number.isSafeInteger(item.version) || item.version < 1 ||
        !["PENDING", "APPROVED", "REJECTED"].includes(item.status) ||
        ["studentName", "courseName", "startsAt", "reason"].some((key) =>
          typeof item[key as keyof OperatorLeaveRequest] !== "string") ||
        !Number.isFinite(Date.parse(item.startsAt)))) {
      return { status: "error" as const, message: "审批列表数据异常，请重新加载" };
    }
    return {
      status: "success" as const,
      requests: state.data.data,
      total: state.data.meta.total,
      hasMore: state.data.meta.page < state.data.meta.totalPages,
    };
  },

  onTabTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.reviewing) {
      return;
    }
    const activeTab = String(event.currentTarget.dataset.key ?? "") as LeaveTab;
    if (!(["pending", "history"] as string[]).includes(activeTab)) {
      return;
    }
    if (activeTab === this.data.activeTab) return;
    if (this.data.activeTab === "pending") {
      this.requestedLeaveId = this.data.selectedItem?.id || this.requestedLeaveId;
    }
    this.context.nextRead();
    this.pendingRequest = undefined;
    this.currentRequests = [];
    this.needsRevalidation = true;
    this.dismissModal();
    this.setData({
      ...EMPTY_REJECTION,
      activeTab,
      items: [], selectedItem: null, total: 0, page: 1, hasMore: false,
      viewState: "loading", loadingMore: false, reviewBlocked: true, selectionMessage: "",
    });
    void this.loadRequests(true);
  },

  onRequestSelectTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.reviewing || this.needsRevalidation || this.uncertainReview ||
      this.data.activeTab !== "pending") {
      return;
    }
    const id = String(event.currentTarget.dataset.id ?? "");
    const selectedItem = this.data.items.find(
      (item) => item.id === id && item.canReview,
    );
    if (!selectedItem) {
      return;
    }
    this.dismissModal();
    this.requestedLeaveId = "";
    this.setData({
      ...EMPTY_REJECTION,
      selectedItem,
      selectionMessage: "",
    });
  },

  onApproveTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.reviewing || this.modalId || this.data.rejectVisible) {
      return;
    }
    const item = this.findReviewableItem(event);
    if (!item) {
      return;
    }
    this.modalId = item.id;
    const sequence = ++this.modalSequence;
    const release = () => {
      if (sequence === this.modalSequence) this.modalId = "";
    };
    const options: WechatMiniprogram.ShowModalOption = {
      title: "批准请假",
      content: `确认批准 ${item.studentName} 的请假申请吗？`,
      confirmText: "确认批准",
      confirmColor: "#238760",
      success: (result) => {
        if (sequence !== this.modalSequence || !this.context?.isActive()) return;
        release();
        if (result.confirm && this.data.selectedItem?.id === item.id && !this.needsRevalidation &&
          this.data.items.some((current) => current.id === item.id && current.version === item.version && current.canReview)) {
          void this.submitApprove(item);
        }
      },
      fail: release,
    };
    try { wx.showModal(options); }
    catch { release(); wx.showToast({ title: "确认窗口打开失败，请重试", icon: "none" }); }
  },

  onRejectTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.reviewing || this.modalId) {
      return;
    }
    const item = this.findReviewableItem(event);
    if (!item) {
      return;
    }
    this.setData({
      rejectVisible: true,
      rejectId: item.id,
      rejectStudentName: item.studentName,
      rejectReason: "",
      rejectError: "",
    });
  },

  onRejectReasonInput(event: WechatMiniprogram.Input) {
    if (!this.context?.isActive() || this.reviewing || !this.data.rejectVisible) return;
    this.setData({
      rejectReason: event.detail.value,
      rejectError: "",
    });
  },

  onRejectCancel() {
    if (this.context?.isActive() && !this.reviewing) {
      this.setData({ ...EMPTY_REJECTION });
    }
  },

  async onRejectSubmit() {
    if (!this.context?.isActive() || !this.workflow || this.reviewing || !this.data.rejectVisible) {
      return;
    }
    const item = this.data.items.find(
      (candidate) => candidate.id === this.data.rejectId,
    );
    if (this.uncertainReview) return;
    if (!item || !item.canReview || this.needsRevalidation || this.data.selectedItem?.id !== item.id) {
      await this.loadRequests(true);
      return;
    }
    await this.runReview({
      operation: "reject", id: item.id, version: item.version, reviewReason: this.data.rejectReason.trim(),
    });
  },

  async submitApprove(item: OperatorLeaveItemModel) {
    if (!this.context?.isActive() || !this.workflow || this.reviewing || this.needsRevalidation ||
      this.uncertainReview || this.data.activeTab !== "pending" || this.data.selectedItem?.id !== item.id ||
      !this.data.items.some((current) => current.id === item.id && current.version === item.version && current.canReview)) return;
    await this.runReview({ operation: "approve", id: item.id, version: item.version });
  },

  async runReview(command: ReviewCommand) {
    if (!this.context?.isActive() || !this.workflow || this.reviewing) return;
    if (this.uncertainReview) {
      if (command !== this.uncertainReview || !this.recoveryReady || this.pendingRequest) return;
    } else if (this.needsRevalidation || this.data.activeTab !== "pending" ||
      this.data.selectedItem?.id !== command.id || !this.data.items.some(
        (item) => item.id === command.id && item.version === command.version && item.canReview,
      )) return;
    this.reviewing = true;
    const sequence = ++this.reviewSequence;
    this.recoveryReady = false;
    this.setData({ submitting: true, submittingId: command.id, rejectError: "", reviewRecoveryReady: false });
    const outcome = await (command.operation === "approve"
      ? this.workflow.approve(command.id, command.version)
      : this.workflow.reject(command.id, command.version, command.reviewReason));
    this.reviewing = false;
    if (!this.context?.isCurrent()) return;
    if (outcome.status === "forbidden") {
      this.context.invalidate(outcome.message);
      return;
    }
    if (outcome.status === "error" && outcome.uncertain) {
      this.uncertainReview = command;
      this.needsRevalidation = true;
      this.requestedLeaveId = command.id;
      if (!this.context.isActive()) return;
      this.dismissModal();
      this.setData({
        ...EMPTY_REJECTION, selectedItem: null, submitting: false, submittingId: "",
        reviewBlocked: true, reviewRecoveryAvailable: true, reviewRecoveryReady: false,
      });
      if (sequence !== this.reviewSequence) await this.reconcileReview();
      return;
    }
    const wasRecovery = Boolean(this.uncertainReview);
    this.uncertainReview = undefined;
    if (!this.context.isActive()) return;
    this.setData({ ...EMPTY_RECOVERY });
    if (sequence !== this.reviewSequence) {
      await this.reconcileReview();
      return;
    }
    if (outcome.status === "validation") {
      this.setData({ submitting: false, submittingId: "", rejectError: outcome.message });
      return;
    }
    await this.finishReview(outcome, command.operation === "approve" ? "请假申请已批准" : "请假申请已驳回");
    if (wasRecovery && outcome.status === "error") await this.reconcileReview();
  },

  onRecoverReview() {
    if (!this.context?.isActive() || !this.uncertainReview || this.reviewing || this.pendingRequest) return;
    if (!this.recoveryReady) {
      void this.loadRequests(true);
      return;
    }
    // Reconcile the already-issued command; capability never authorizes a new command here.
    void this.runReview(this.uncertainReview);
  },

  async reconcileReview() {
    this.requestedLeaveId = this.data.selectedItem?.id || this.requestedLeaveId;
    this.setData({ ...EMPTY_REJECTION, selectedItem: null, submitting: false, submittingId: "" });
    this.context!.nextRead();
    this.pendingRequest = undefined;
    await this.loadRequests(true);
  },

  async finishReview(
    outcome: Awaited<ReturnType<OperatorLeaveWorkflow["approve"]>>,
    successMessage: string,
  ) {
    if (!this.context?.isActive()) return;
    this.setData({ submitting: false, submittingId: "" });
    if (outcome.status === "success") {
      this.requestedLeaveId = "";
      this.setData({ ...EMPTY_REJECTION, selectedItem: null });
      wx.showToast({ title: successMessage, icon: "success" });
      await this.reconcileReview();
      return;
    }
    if (outcome.status === "conflict") {
      this.setData({ ...EMPTY_REJECTION });
      wx.showToast({ title: "申请状态已变化，列表已刷新", icon: "none" });
      await this.reconcileReview();
      return;
    }
    if (this.data.rejectVisible) {
      this.setData({ rejectError: outcome.message });
      return;
    }
    wx.showToast({ title: outcome.message, icon: "none" });
  },

  findReviewableItem(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.needsRevalidation || this.uncertainReview || this.data.activeTab !== "pending" ||
      this.data.viewState !== "ready") return;
    const id = String(event.currentTarget.dataset.id ?? "");
    return this.data.items.find((item) => item.id === id && item.canReview && this.data.selectedItem?.id === id);
  },

  onRetry() {
    if (!this.reviewing) void this.loadRequests(true);
  },

  onLoadMore() {
    if (!this.reviewing && !this.data.loadingMore && this.data.hasMore) {
      void this.loadRequests(false);
    }
  },

  onLogin() {
    if (!this.context) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate("请重新登录");
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },
});
