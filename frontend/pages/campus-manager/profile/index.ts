import {
  buildCampusManagerProfilePageModel,
  CAMPUS_MANAGER_PROFILE_ACTIONS,
  CampusManagerProfileActionKey,
  resolveCampusManagerProfileAction,
} from "../../../services/campus-manager-profile.presenter";
import { campusManagerService } from "../../../services/campus-manager-runtime";

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    displayName: "",
    identityLabel: "",
    campusName: "",
    actions: CAMPUS_MANAGER_PROFILE_ACTIONS,
  },

  onLoad() {
    void this.loadProfile();
  },

  onPullDownRefresh() {
    void this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  async loadProfile() {
    this.setData({ viewState: "loading", errorMessage: "" });
    const state = await campusManagerService.loadProfile();
    if (state.status === "success" || state.status === "empty") {
      this.setData({
        ...buildCampusManagerProfilePageModel(state.data),
        viewState: "ready",
        errorMessage: "",
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
    void this.loadProfile();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? "") as
      | CampusManagerProfileActionKey
      | "";
    const action = CAMPUS_MANAGER_PROFILE_ACTIONS.find(
      (item) => item.key === key,
    );
    if (!action) {
      return;
    }
    wx.navigateTo({
      url: resolveCampusManagerProfileAction(action.key).url,
    });
  },
});
