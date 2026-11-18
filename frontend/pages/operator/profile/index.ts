import {
  buildOperatorProfilePageModel,
  OPERATOR_PROFILE_ACTIONS,
  OPERATOR_PRIMARY_PROFILE_ACTIONS,
  OPERATOR_MORE_PROFILE_ACTIONS,
  OperatorProfileActionKey,
  resolveOperatorProfileAction,
} from "../runtime/services/operator-profile.presenter";
import { createSessionService } from "../../../services/session.service";
import { OperatorPageContext } from "../runtime/operator-page-context";

const EMPTY_PROFILE = { displayName: "", identityLabel: "", campusName: "", studentCount: "" };

Page({
  context: undefined as OperatorPageContext | undefined,
  pendingRequest: undefined as Promise<void> | undefined,
  initialShowPending: true,
  navigating: false,
  navigationSequence: 0,
  pullSequence: 0,
  data: {
    viewState: "loading",
    errorMessage: "",
    refreshError: "",
    ...EMPTY_PROFILE,
    actions: OPERATOR_PRIMARY_PROFILE_ACTIONS,
    moreActions: OPERATOR_MORE_PROFILE_ACTIONS,
    toolsOpen: false,
  },

  onLoad() {
    this.context = new OperatorPageContext((errorMessage) => {
      this.pendingRequest = undefined;
      this.navigationSequence += 1;
      this.navigating = false;
      this.setData({ ...EMPTY_PROFILE, viewState: "forbidden", errorMessage, refreshError: "" });
    });
    void this.loadProfile();
  },

  onShow() {
    if (!this.context?.show()) return;
    this.navigationSequence += 1;
    this.navigating = false;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadProfile();
  },

  onHide() {
    this.setData({ toolsOpen: false });
    this.context?.hide();
    this.pendingRequest = undefined;
    this.initialShowPending = false;
    this.navigationSequence += 1;
    this.pullSequence += 1;
    this.navigating = false;
  },

  onUnload() { this.context?.dispose(); },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadProfile().finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  loadProfile(): Promise<void> {
    const context = this.context;
    if (!context?.isActive()) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    const sequence = context.nextRead();
    const keepContent = this.data.viewState === "ready";
    this.setData({ ...(keepContent ? {} : { viewState: "loading" }), errorMessage: "", refreshError: "" });
    const guard = <T extends { status: string; statusCode?: number; message?: string }>(state: T): T => {
      if (context.accepts(sequence) && (state.statusCode === 401 || state.statusCode === 403)) {
        context.invalidate(state.message ?? "当前账号无运营端访问权限");
      }
      return state;
    };
    const request = Promise.resolve().then(async () => {
      if (!context.accepts(sequence)) return;
      const [profile, dashboard] = await Promise.all([
        context.service.loadProfile().then(guard),
        context.service.loadDashboard().then(guard),
      ]);
      if (!context.accepts(sequence)) return;
      if ((profile.status === "success" || profile.status === "empty") &&
        (dashboard.status === "success" || dashboard.status === "empty")) {
        this.setData({
          ...buildOperatorProfilePageModel(profile.data),
          studentCount: String(dashboard.data.activeStudentCount),
          viewState: "ready", errorMessage: "", refreshError: "",
        });
      } else {
        const failure = [profile, dashboard].find((state) => state.status === "error");
        const message = failure?.status === "error" ? failure.message : "运营资料加载失败，请重试";
        this.setData(keepContent ? { refreshError: message } : { viewState: "error", errorMessage: message });
      }
    }).finally(() => {
      if (this.pendingRequest === request) this.pendingRequest = undefined;
    });
    this.pendingRequest = request;
    return request;
  },

  onLogin() {
    if (!this.context) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate("请重新登录");
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },

  onRetry() {
    void this.loadProfile();
  },

  onOpenTools() { if (this.context?.isActive()) this.setData({ toolsOpen: true }); },
  onCloseTools() { this.setData({ toolsOpen: false }); },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.navigating || this.data.viewState !== "ready") return;
    const key = String(event.currentTarget.dataset.key ?? "") as
      | OperatorProfileActionKey
      | "";
    const action = OPERATOR_PROFILE_ACTIONS.find(
      (item) => item.key === key,
    );
    if (!action) {
      return;
    }
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    wx.navigateTo({
      url: resolveOperatorProfileAction(action.key).url,
      fail: () => {
        if (sequence !== this.navigationSequence || !this.context?.isActive()) return;
        this.navigating = false;
        wx.showToast({ title: "页面打开失败，请重试", icon: "none" });
      },
    });
  },
});
