import { sessionService } from "../../../services/session.service";

const PROFILE_ACTIONS = [
  { key: "teachers", label: "教师档案", command: "查看" },
  { key: "teaching", label: "授课统计", command: "查看" },
  { key: "earnings", label: "课时费报表", command: "查看" },
] as const;

const PROFILE_ROUTES: Readonly<Record<string, string>> = {
  teachers: "/pages/hr/teachers/index",
  teaching: "/pages/hr/teaching/index",
  earnings: "/pages/hr/earnings/index",
};

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    displayName: "",
    roleCode: "HR",
    roleLabel: "总部人力",
    accountLabel: "总部账号 · 无校区绑定",
    actions: PROFILE_ACTIONS,
  },

  onLoad() {
    void this.loadProfile();
  },

  onPullDownRefresh() {
    void this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  async loadProfile() {
    this.setData({ viewState: "loading", errorMessage: "", displayName: "" });
    try {
      const session = await sessionService.load();
      const role = session?.roles[0];
      if (
        !session ||
        session.roles.length !== 1 ||
        role?.code !== "HR" ||
        role.campusId !== null
      ) {
        this.setData({
          viewState: "forbidden",
          errorMessage: "当前账号无总部人力端访问权限",
        });
        return;
      }
      this.setData({
        viewState: "ready",
        errorMessage: "",
        displayName: session.displayName.trim() || "总部人力账号",
      });
    } catch (error) {
      this.setData({
        viewState: "error",
        errorMessage:
          error instanceof Error ? error.message : "人力资料加载失败",
      });
    }
  },

  onRetry() {
    void this.loadProfile();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "");
    const url = PROFILE_ROUTES[key];
    if (url) wx.navigateTo({ url });
  },
});
