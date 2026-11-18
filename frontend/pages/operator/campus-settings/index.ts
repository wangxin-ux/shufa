import {
  OperatorSettingsWorkflow,
  formatOperatorLessonHours,
} from "../runtime/services/operator-settings.workflow";
import { OperatorPageContext } from "../runtime/operator-page-context";
import { createSessionService } from "../../../services/session.service";

Page({
  context: undefined as OperatorPageContext | undefined,
  workflow: undefined as OperatorSettingsWorkflow | undefined,
  initialShowPending: true,
  data: {
    viewState: "loading",
    errorMessage: "",
    version: 0,
    code: "",
    timezone: "",
    name: "",
    contactPhone: "",
    address: "",
    lessonWarningThresholdHours: "",
  },

  onLoad() {
    this.context = new OperatorPageContext((errorMessage) => this.setData({
      viewState: "forbidden", errorMessage, version: 0, code: "", timezone: "",
      name: "", contactPhone: "", address: "", lessonWarningThresholdHours: "",
    }));
    this.workflow = new OperatorSettingsWorkflow(this.context.service);
    void this.loadSettings();
  },

  onShow() {
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadSettings();
  },
  onHide() { this.context?.hide(); this.initialShowPending = false; },
  onUnload() { this.context?.dispose(); },

  async loadSettings() {
    const context = this.context;
    if (!context?.isActive()) return;
    const sequence = context.nextRead();
    this.setData({ viewState: "loading", errorMessage: "" });
    const state = await context.service.loadCampusSettings();
    if (!context.accepts(sequence)) return;
    if (state.status === "success" || state.status === "empty") {
      this.setData({
        viewState: "ready",
        errorMessage: "",
        version: state.data.version,
        code: state.data.code,
        timezone: state.data.timezone,
        name: state.data.name,
        contactPhone: state.data.contactPhone ?? "",
        address: state.data.address ?? "",
        lessonWarningThresholdHours: formatOperatorLessonHours(
          state.data.lessonWarningThresholdUnits,
        ),
      });
      return;
    }
    if (state.status === "error") {
      this.setData({
        viewState: state.statusCode === 403 ? "forbidden" : "error",
        errorMessage:
          state.statusCode === 403
            ? "当前账号无运营端访问权限"
            : state.message,
      });
    }
  },

  onRetry() {
    void this.loadSettings();
  },

  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ name: event.detail.value });
  },

  onPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ contactPhone: event.detail.value });
  },

  onAddressInput(event: WechatMiniprogram.TextareaInput) {
    this.setData({ address: event.detail.value });
  },

  onThresholdInput(event: WechatMiniprogram.Input) {
    this.setData({ lessonWarningThresholdHours: event.detail.value });
  },

  async onSubmit() {
    const context = this.context;
    if (!context?.isActive() || !this.workflow || this.data.viewState !== "ready") {
      return;
    }
    const sequence = context.nextRead();
    this.setData({ viewState: "submitting", errorMessage: "" });
    const outcome = await this.workflow.submit(
      {
        name: this.data.name,
        contactPhone: this.data.contactPhone,
        address: this.data.address,
        lessonWarningThresholdHours:
          this.data.lessonWarningThresholdHours,
      },
      this.data.version,
    );
    if (!context.accepts(sequence)) return;
    if (outcome.status === "success") {
      this.setData({
        viewState: "ready",
        version: outcome.data.version,
        name: outcome.data.name,
        contactPhone: outcome.data.contactPhone ?? "",
        address: outcome.data.address ?? "",
        lessonWarningThresholdHours: formatOperatorLessonHours(
          outcome.data.lessonWarningThresholdUnits,
        ),
      });
      wx.showToast({ title: "设置已保存", icon: "success" });
      return;
    }
    if (outcome.status === "conflict") {
      wx.showToast({ title: "设置已更新，正在刷新", icon: "none" });
      await this.loadSettings();
      return;
    }
    this.setData({
      viewState: outcome.status === "forbidden" ? "forbidden" : "ready",
      errorMessage: outcome.message,
    });
    wx.showToast({ title: outcome.message, icon: "none" });
  },

  onLogin() {
    if (this.context?.ownsRuntime()) createSessionService().logout();
    this.context?.invalidate("请重新登录");
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },
});
