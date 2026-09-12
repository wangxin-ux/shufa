import {
  CampusManagerSettingsWorkflow,
  formatCampusManagerLessonHours,
} from "../../../services/campus-manager-settings.workflow";
import { campusManagerService } from "../../../services/campus-manager-runtime";

const workflow = new CampusManagerSettingsWorkflow(campusManagerService);

Page({
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
    void this.loadSettings();
  },

  async loadSettings() {
    this.setData({ viewState: "loading", errorMessage: "" });
    const state = await campusManagerService.loadCampusSettings();
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
        lessonWarningThresholdHours: formatCampusManagerLessonHours(
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
            ? "当前账号无管理员端访问权限"
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
    if (this.data.viewState === "submitting") {
      return;
    }
    this.setData({ viewState: "submitting", errorMessage: "" });
    const outcome = await workflow.submit(
      {
        name: this.data.name,
        contactPhone: this.data.contactPhone,
        address: this.data.address,
        lessonWarningThresholdHours:
          this.data.lessonWarningThresholdHours,
      },
      this.data.version,
    );
    if (outcome.status === "success") {
      this.setData({
        viewState: "ready",
        version: outcome.data.version,
        name: outcome.data.name,
        contactPhone: outcome.data.contactPhone ?? "",
        address: outcome.data.address ?? "",
        lessonWarningThresholdHours: formatCampusManagerLessonHours(
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
});
