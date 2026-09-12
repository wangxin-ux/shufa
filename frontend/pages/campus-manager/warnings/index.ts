import {
  buildCampusManagerWarningItems,
  buildCampusManagerWarningQuery,
  CampusManagerWarningItemModel,
  mergeCampusManagerWarningItems,
} from "../../../services/campus-manager-warnings.presenter";
import { campusManagerService } from "../../../services/campus-manager-runtime";

let searchTimer: ReturnType<typeof setTimeout> | null = null;

Page({
  data: {
    viewState: "loading",
    errorMessage: "",
    query: "",
    items: [] as CampusManagerWarningItemModel[],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    loadingMore: false,
  },

  onLoad() {
    void this.loadWarnings(1);
  },

  onUnload() {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  },

  onPullDownRefresh() {
    void this.loadWarnings(1).finally(() => wx.stopPullDownRefresh());
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const query = event.detail.value;
    this.setData({ query });
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
    }
    searchTimer = setTimeout(() => {
      searchTimer = null;
      void this.loadWarnings(1);
    }, 300);
  },

  onRetry() {
    void this.loadWarnings(1);
  },

  onLoadMore() {
    if (this.data.loadingMore || this.data.page >= this.data.totalPages) {
      return;
    }
    void this.loadWarnings(this.data.page + 1);
  },

  async loadWarnings(page: number) {
    if (page === 1) {
      this.setData({ viewState: "loading", errorMessage: "" });
    } else {
      this.setData({ loadingMore: true });
    }
    const state = await campusManagerService.loadWarnings(
      buildCampusManagerWarningQuery(
        this.data.query,
        page,
        this.data.pageSize,
      ),
    );
    if (state.status === "success" || state.status === "empty") {
      const incoming = buildCampusManagerWarningItems(state.data.data);
      this.setData({
        viewState:
          page === 1 && incoming.length === 0 ? "empty" : "ready",
        errorMessage: "",
        items: mergeCampusManagerWarningItems(
          this.data.items,
          incoming,
          page,
        ),
        page: state.data.meta.page,
        total: state.data.meta.total,
        totalPages: state.data.meta.totalPages,
        loadingMore: false,
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
        loadingMore: false,
      });
    }
  },
});
