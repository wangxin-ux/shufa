import {
  buildOperatorWarningItems,
  buildOperatorWarningQuery,
  OperatorWarningItemModel,
  mergeOperatorWarningItems,
} from "../runtime/services/operator-warnings.presenter";
import { OperatorPageContext } from "../runtime/operator-page-context";
import { createSessionService } from "../../../services/session.service";

Page({
  context: undefined as OperatorPageContext | undefined,
  searchTimer: null as ReturnType<typeof setTimeout> | null,
  initialShowPending: true,
  data: {
    viewState: "loading",
    errorMessage: "",
    query: "",
    items: [] as OperatorWarningItemModel[],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    loadingMore: false,
  },

  onLoad() {
    this.context = new OperatorPageContext((errorMessage) => this.setData({
      viewState: "forbidden", errorMessage, query: "", items: [],
      page: 1, total: 0, totalPages: 0, loadingMore: false,
    }));
    void this.loadWarnings(1);
  },

  onShow() {
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadWarnings(1);
  },

  onHide() {
    this.context?.hide();
    this.initialShowPending = false;
    if (this.searchTimer !== null) clearTimeout(this.searchTimer);
    this.searchTimer = null;
  },

  onUnload() {
    this.onHide();
    this.context?.dispose();
  },

  onPullDownRefresh() {
    void this.loadWarnings(1).finally(() => {
      if (this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const query = event.detail.value;
    this.setData({ query });
    if (!this.context?.isActive()) return;
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
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
    const context = this.context;
    if (!context?.isActive()) return;
    const sequence = context.nextRead();
    if (page === 1) {
      this.setData({ viewState: "loading", errorMessage: "" });
    } else {
      this.setData({ loadingMore: true });
    }
    const state = await context.service.loadWarnings(
      buildOperatorWarningQuery(
        this.data.query,
        page,
        this.data.pageSize,
      ),
    );
    if (!context.accepts(sequence)) return;
    if (state.status === "success" || state.status === "empty") {
      const incoming = buildOperatorWarningItems(state.data.data);
      this.setData({
        viewState:
          page === 1 && incoming.length === 0 ? "empty" : "ready",
        errorMessage: "",
        items: mergeOperatorWarningItems(
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
            ? "当前账号无运营端访问权限"
            : state.message,
        loadingMore: false,
      });
    }
  },

  onLogin() {
    if (this.context?.ownsRuntime()) createSessionService().logout();
    this.context?.invalidate("请重新登录");
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },
});
