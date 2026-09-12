import {
  buildCampusManagerLeaveItems,
  CampusManagerLeaveItemModel,
  mergeCampusManagerLeaveHistory,
} from "../../../services/campus-manager-leave.presenter";
import { CampusManagerLeaveWorkflow } from "../../../services/campus-manager-leave.workflow";
import {
  campusManagerService,
} from "../../../services/campus-manager-runtime";
import {
  CampusManagerLeaveRequest,
  CampusManagerLeaveStatus,
  CampusManagerPage,
} from "../../../types/campus-manager";
import { RequestState } from "../../../utils/request-state";

type LeaveTab = "pending" | "history";

const PAGE_SIZE = 20;
const workflow = new CampusManagerLeaveWorkflow(campusManagerService);
let currentRequests: CampusManagerLeaveRequest[] = [];

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    activeTab: "pending" as LeaveTab,
    tabs: [
      { key: "pending", label: "待审批" },
      { key: "history", label: "审批记录" },
    ],
    items: [] as CampusManagerLeaveItemModel[],
    selectedItem: null as CampusManagerLeaveItemModel | null,
    total: 0,
    page: 1,
    hasMore: false,
    loadingMore: false,
    submitting: false,
    submittingId: "",
    rejectVisible: false,
    rejectId: "",
    rejectStudentName: "",
    rejectReason: "",
    rejectError: "",
  },

  onLoad() {
    void this.loadRequests(true);
  },

  onPullDownRefresh() {
    void this.loadRequests(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadRequests(reset: boolean) {
    const page = reset ? 1 : this.data.page + 1;
    if (reset) {
      this.setData({
        viewState: "loading",
        errorMessage: "",
        items: [],
        selectedItem: null,
      });
      currentRequests = [];
    } else {
      this.setData({ loadingMore: true });
    }
    const result =
      this.data.activeTab === "pending"
        ? await this.loadPending(page)
        : await this.loadHistory(page);
    if (result.status === "error") {
      this.setData({
        viewState: result.statusCode === 403 ? "forbidden" : "error",
        errorMessage:
          result.statusCode === 403
            ? "当前账号无请假审批权限"
            : result.message,
        loadingMore: false,
      });
      return;
    }
    currentRequests = reset
      ? result.requests
      : mergeCampusManagerLeaveHistory(currentRequests, result.requests);
    const items = buildCampusManagerLeaveItems(currentRequests);
    const selectedItem =
      this.data.activeTab === "pending"
        ? items.find((item) => item.id === this.data.selectedItem?.id) ??
          items[0] ??
          null
        : null;
    this.setData({
      viewState: currentRequests.length === 0 ? "empty" : "ready",
      items,
      selectedItem,
      total: result.total,
      page,
      hasMore: result.hasMore,
      loadingMore: false,
      errorMessage: "",
    });
  },

  async loadPending(page: number) {
    const state = await campusManagerService.loadLeaveRequests({
      page,
      pageSize: PAGE_SIZE,
      status: "PENDING",
    });
    return this.toLoadResult(state);
  },

  async loadHistory(page: number) {
    const [approved, rejected] = await Promise.all([
      campusManagerService.loadLeaveRequests({
        page,
        pageSize: PAGE_SIZE,
        status: "APPROVED",
      }),
      campusManagerService.loadLeaveRequests({
        page,
        pageSize: PAGE_SIZE,
        status: "REJECTED",
      }),
    ]);
    const failure = [approved, rejected].find(
      (state): state is Extract<typeof state, { status: "error" }> =>
        state.status === "error",
    );
    if (failure) {
      return failure;
    }
    if (
      (approved.status !== "success" && approved.status !== "empty") ||
      (rejected.status !== "success" && rejected.status !== "empty")
    ) {
      return { status: "error" as const, message: "审批记录尚未加载完成" };
    }
    const approvedPage = approved.data;
    const rejectedPage = rejected.data;
    return {
      status: "success" as const,
      requests: mergeCampusManagerLeaveHistory(
        approvedPage.data,
        rejectedPage.data,
      ),
      total: approvedPage.meta.total + rejectedPage.meta.total,
      hasMore:
        page < approvedPage.meta.totalPages || page < rejectedPage.meta.totalPages,
    };
  },

  toLoadResult(
    state: RequestState<CampusManagerPage<CampusManagerLeaveRequest>>,
  ) {
    if (state.status === "error") {
      return state;
    }
    if (state.status !== "success" && state.status !== "empty") {
      return { status: "error" as const, message: "审批列表尚未加载完成" };
    }
    return {
      status: "success" as const,
      requests: state.data.data,
      total: state.data.meta.total,
      hasMore: state.data.meta.page < state.data.meta.totalPages,
    };
  },

  onTabTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) {
      return;
    }
    const activeTab = String(event.currentTarget.dataset.key ?? "") as LeaveTab;
    if (!(["pending", "history"] as string[]).includes(activeTab)) {
      return;
    }
    this.setData({
      activeTab,
      selectedItem: null,
      rejectVisible: false,
      rejectReason: "",
      rejectError: "",
    });
    void this.loadRequests(true);
  },

  onRequestSelectTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting || this.data.activeTab !== "pending") {
      return;
    }
    const id = String(event.currentTarget.dataset.id ?? "");
    const selectedItem = this.data.items.find(
      (item) => item.id === id && item.canReview,
    );
    if (!selectedItem) {
      return;
    }
    this.setData({
      selectedItem,
      rejectVisible: false,
      rejectReason: "",
      rejectError: "",
    });
  },

  onApproveTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) {
      return;
    }
    const item = this.findReviewableItem(event);
    if (!item) {
      return;
    }
    wx.showModal({
      title: "批准请假",
      content: `确认批准 ${item.studentName} 的请假申请吗？`,
      confirmText: "确认批准",
      confirmColor: "#238760",
      success: (result) => {
        if (result.confirm) {
          void this.submitApprove(item);
        }
      },
    });
  },

  onRejectTap(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) {
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
    this.setData({
      rejectReason: event.detail.value,
      rejectError: "",
    });
  },

  onRejectCancel() {
    if (!this.data.submitting) {
      this.setData({
        rejectVisible: false,
        rejectReason: "",
        rejectError: "",
      });
    }
  },

  async onRejectSubmit() {
    if (this.data.submitting) {
      return;
    }
    const item = this.data.items.find(
      (candidate) => candidate.id === this.data.rejectId,
    );
    if (!item || !item.canReview) {
      await this.loadRequests(true);
      return;
    }
    this.setData({ submitting: true, submittingId: item.id, rejectError: "" });
    const outcome = await workflow.reject(
      item.id,
      item.version,
      this.data.rejectReason,
    );
    if (outcome.status === "validation") {
      this.setData({
        submitting: false,
        submittingId: "",
        rejectError: outcome.message,
      });
      return;
    }
    await this.finishReview(outcome, "请假申请已驳回");
  },

  async submitApprove(item: CampusManagerLeaveItemModel) {
    this.setData({ submitting: true, submittingId: item.id });
    const outcome = await workflow.approve(item.id, item.version);
    await this.finishReview(outcome, "请假申请已批准");
  },

  async finishReview(
    outcome: Awaited<ReturnType<CampusManagerLeaveWorkflow["approve"]>>,
    successMessage: string,
  ) {
    this.setData({ submitting: false, submittingId: "" });
    if (outcome.status === "success") {
      this.setData({ rejectVisible: false, rejectReason: "", rejectError: "" });
      wx.showToast({ title: successMessage, icon: "success" });
      await this.loadRequests(true);
      return;
    }
    if (outcome.status === "conflict") {
      this.setData({ rejectVisible: false, rejectReason: "", rejectError: "" });
      wx.showToast({ title: "申请状态已变化，列表已刷新", icon: "none" });
      await this.loadRequests(true);
      return;
    }
    if (this.data.rejectVisible) {
      this.setData({ rejectError: outcome.message });
      return;
    }
    wx.showToast({ title: outcome.message, icon: "none" });
  },

  findReviewableItem(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? "");
    return this.data.items.find((item) => item.id === id && item.canReview);
  },

  onRetry() {
    void this.loadRequests(true);
  },

  onLoadMore() {
    if (!this.data.loadingMore && this.data.hasMore) {
      void this.loadRequests(false);
    }
  },
});
