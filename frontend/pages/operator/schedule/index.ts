import {
  buildOperatorLessonItems,
  buildOperatorLessonQuery,
  OperatorLessonItemModel,
  mergeOperatorLessonItems,
} from "../runtime/services/operator-schedule.presenter";
import { OperatorPageContext } from "../runtime/operator-page-context";
import { createSessionService } from "../../../services/session.service";
import {
  OperatorLessonSeriesWorkflow, OperatorSeriesOutcome, readOperatorSeriesAuthority,
} from "../runtime/services/operator-lesson-series.workflow";
import { seriesDateLabels } from "../runtime/services/operator-lesson-series.presenter";
import type {
  OperatorLessonStatus, OperatorLessonSession, OperatorCancellationMode,
  OperatorCancellationPreview, OperatorSeriesCancelled,
} from "../runtime/types/operator";
import {
  OperatorLessonMembersWorkflow, emptyOperatorLessonMembersView,
} from "../runtime/services/operator-lesson-members.workflow";

const PAGE_SIZE = 20;

interface WriteResult {
  operation: "cancel";
  outcome: OperatorSeriesOutcome<OperatorSeriesCancelled>;
}

interface UncertainWrite {
  operation: WriteResult["operation"];
  invoke: () => Promise<OperatorSeriesOutcome<OperatorSeriesCancelled>>;
}

interface StatusOptionModel {
  value: OperatorLessonStatus | "";
  label: string;
}

const STATUS_OPTIONS: StatusOptionModel[] = [
  { value: "", label: "全部状态" },
  { value: "SCHEDULED", label: "待上课" },
  { value: "IN_PROGRESS", label: "进行中" },
  { value: "COMPLETED", label: "已完成" },
  { value: "REVERSED", label: "已撤销" },
  { value: "CANCELLED", label: "已取消" },
];

function manageable(item: OperatorLessonItemModel): boolean {
  return item.canManage &&
    Date.parse(`${item.draft.date}T${item.draft.startsAt}:00+08:00`) > Date.now();
}
function emptyCancellation() {
  return { id: "", mode: "THIS" as OperatorCancellationMode, allowFollowing: false,
    loading: false, error: "", preview: null as OperatorCancellationPreview | null,
    rows: [] as Array<{ id: string; version: number; label: string }> };
}

Page({
  context: undefined as OperatorPageContext | undefined,
  workflow: undefined as OperatorLessonSeriesWorkflow | undefined,
  currentLessons: [] as OperatorLessonSession[],
  cancellationTarget: undefined as OperatorLessonSession | undefined,
  cancellationSequence: 0,
  pendingRecovery: undefined as Promise<void> | undefined,
  recoverySequence: 0,
  memberPanel: undefined as OperatorLessonMembersWorkflow | undefined,
  pendingLessons: undefined as Promise<void> | undefined,
  pendingWrite: undefined as Promise<void> | undefined,
  deferredResult: undefined as WriteResult | undefined,
  uncertainWrite: undefined as UncertainWrite | undefined,
  lessonSequence: 0,
  navigationSequence: 0,
  navigating: false,
  savedLessonId: "",
  modalSequence: 0,
  confirming: false,
  pullSequence: 0,
  initialShowPending: true,
  data: {
    viewState: "loading",
    errorMessage: "",
    items: [] as OperatorLessonItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    refreshing: false,
    refreshError: "",
    loadMoreError: "",
    filterDate: "",
    filtersOpen: false,
    statusOptions: STATUS_OPTIONS,
    statusIndex: 0,
    statusLabel: STATUS_OPTIONS[0].label,
    savedNotice: "",
    navigating: false,
    submitting: false,
    recoveryAvailable: false,
    recoveryReady: false,
    recoveryReading: false,
    recoveryMessage: "",
    cancellation: emptyCancellation(),
    members: emptyOperatorLessonMembersView(),
  },

  onLoad() {
    this.context = new OperatorPageContext((errorMessage) => {
      this.lessonSequence += 1;
      this.navigationSequence += 1;
      this.navigating = false;
      this.savedLessonId = "";
      this.invalidateConfirmation();
      this.pendingLessons = undefined;
      this.workflow = undefined;
      this.currentLessons = [];
      this.cancellationTarget = undefined;
      this.cancellationSequence += 1;
      this.recoverySequence += 1;
      this.pendingRecovery = undefined;
      this.deferredResult = undefined;
      this.uncertainWrite = undefined;
      this.memberPanel?.invalidate();
      this.setData({
        viewState: "forbidden", errorMessage, items: [], page: 0, total: 0,
        hasMore: false, loadingMore: false, refreshing: false, refreshError: "", loadMoreError: "",
        filterDate: "", statusIndex: 0, statusLabel: STATUS_OPTIONS[0].label,
        savedNotice: "", navigating: false, submitting: false,
        recoveryAvailable: false, recoveryMessage: "",
        recoveryReady: false, recoveryReading: false, cancellation: emptyCancellation(),
      });
    });
    this.workflow = new OperatorLessonSeriesWorkflow(this.context.service);
    this.memberPanel = new OperatorLessonMembersWorkflow(
      this.context, (members) => this.setData({ members }),
    );
    void this.loadLessons(true);
  },

  onShow() {
    if (!this.context?.show()) return;
    this.memberPanel?.show();
    this.navigationSequence += 1;
    this.navigating = false;
    this.setData({
      navigating: false, submitting: Boolean(this.pendingWrite),
      recoveryAvailable: Boolean(this.uncertainWrite), recoveryReady: false, recoveryReading: false,
      ...(this.savedLessonId ? { savedNotice: "课次已保存" } : {}),
    });
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    if (this.deferredResult) {
      const result = this.deferredResult;
      this.deferredResult = undefined;
      this.applyWriteResult(result);
    }
    void this.loadLessons(true);
  },

  onHide() {
    this.context?.hide();
    this.memberPanel?.hide();
    this.currentLessons = [];
    this.closeCancellation();
    this.recoverySequence += 1;
    this.pendingRecovery = undefined;
    this.setData({ items: [], page: 0, total: 0, hasMore: false,
      loadingMore: false, refreshing: false, viewState: "loading",
      errorMessage: "", refreshError: "", loadMoreError: "", savedNotice: "",
      recoveryMessage: "", recoveryReady: false, recoveryReading: false });
    this.lessonSequence += 1;
    this.navigationSequence += 1;
    this.pendingLessons = undefined;
    this.initialShowPending = false;
    this.pullSequence += 1;
    this.invalidateConfirmation();
  },

  onUnload() {
    this.onHide();
    this.memberPanel?.dispose();
    this.memberPanel = undefined;
    this.context?.dispose();
    this.workflow = undefined;
    this.deferredResult = undefined;
    this.uncertainWrite = undefined;
    this.currentLessons = [];
    this.cancellationTarget = undefined;
    this.cancellationSequence += 1;
    this.recoverySequence += 1;
    this.pendingRecovery = undefined;
    this.lessonSequence += 1;
    this.navigationSequence += 1;
    this.invalidateConfirmation();
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadLessons(true).finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  loadLessons(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || this.pendingRecovery || this.memberPanel?.isBlocking() ||
      (!reset && !this.data.hasMore)) return Promise.resolve();
    if (reset && this.memberPanel?.isOpen() && !this.memberPanel.isBlocking()) this.memberPanel.close();
    if (this.pendingLessons && (!reset || this.data.refreshing)) return this.pendingLessons;
    const page = reset ? 1 : this.data.page + 1;
    const status = this.data.statusOptions[this.data.statusIndex]?.value ?? "";
    const query = buildOperatorLessonQuery(this.data.filterDate, status, page, PAGE_SIZE);
    const sequence = ++this.lessonSequence;
    const keepContent = ["ready", "empty"].includes(this.data.viewState);
    this.closeCancellation();
    if (reset) this.invalidateConfirmation();
    this.setData({ recoveryReady: false });
    this.setData(
      reset ? {
        ...(keepContent ? {} : { viewState: "loading" }),
        errorMessage: "", loadingMore: false, refreshing: true, refreshError: "", loadMoreError: "",
      } : { loadingMore: true, loadMoreError: "" },
    );
    const request = Promise.resolve().then(() => {
      if (context.isActive() && sequence === this.lessonSequence) return context.service.loadLessonSessions(query);
    }).then((state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === "error" && (state.statusCode === 401 || state.statusCode === 403)) {
        context.invalidate(state.message);
        return;
      }
      if (!context.isActive() || sequence !== this.lessonSequence) return;
      if (state.status === "success" || state.status === "empty") {
        this.currentLessons = reset ? state.data.data : [...this.currentLessons,
          ...state.data.data.filter(row => !this.currentLessons.some(current => current.id === row.id))];
        const items = mergeOperatorLessonItems(
          this.data.items, buildOperatorLessonItems(state.data.data), page,
        );
        this.setData({
          items, page: state.data.meta.page, total: state.data.meta.total,
          hasMore: state.data.meta.page < state.data.meta.totalPages,
          loadingMore: false, refreshing: false,
          viewState: items.length === 0 ? "empty" : "ready",
          errorMessage: "", refreshError: "", loadMoreError: "",
          ...(this.savedLessonId ? {
            savedNotice: items.some((item) => item.id === this.savedLessonId)
              ? "课次已保存" : "课次已保存，当前列表未显示，可调整筛选查看",
          } : {}),
        });
      } else if (state.status === "error") {
        this.setData({
          ...(keepContent
            ? reset ? { refreshError: state.message } : { loadMoreError: state.message }
            : { viewState: "error", errorMessage: state.message }),
          loadingMore: false, refreshing: false,
        });
      }
    }).finally(() => {
      if (this.pendingLessons === request) this.pendingLessons = undefined;
    });
    this.pendingLessons = request;
    return request;
  },

  resetFilter() {
    this.lessonSequence += 1;
    this.pendingLessons = undefined;
    this.setData({
      items: [], page: 0, total: 0, hasMore: false, refreshing: false,
      viewState: "loading", refreshError: "", loadMoreError: "",
    });
    void this.loadLessons(true);
  },

  onToggleFilters() { this.setData({ filtersOpen: !this.data.filtersOpen }); },

  onFilterDateChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || this.pendingWrite || this.memberPanel?.isBlocking()) return;
    this.setData({ filterDate: String(event.detail.value) });
    this.resetFilter();
  },

  onClearFilterDate() {
    if (!this.context?.isActive() || this.pendingWrite || this.memberPanel?.isBlocking()) return;
    this.setData({ filterDate: "" });
    this.resetFilter();
  },

  onStatusChange(event: WechatMiniprogram.PickerChange) {
    if (!this.context?.isActive() || this.pendingWrite || this.memberPanel?.isBlocking()) return;
    const statusIndex = Number(event.detail.value);
    const option = this.data.statusOptions[statusIndex];
    if (!option) {
      return;
    }
    this.setData({ statusIndex, statusLabel: option.label });
    this.resetFilter();
  },

  onCreateTap() {
    this.openEditor("/pages/operator/schedule-editor/index");
  },

  onEditTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.pendingWrite || this.confirming || this.navigating ||
      this.uncertainWrite || this.memberPanel?.isBlocking() || this.data.refreshing) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    const item = this.data.items.find((candidate) => candidate.id === id);
    if (!item || !manageable(item)) {
      return;
    }
    this.openEditor(`/pages/operator/schedule-editor/index?mode=edit&id=${encodeURIComponent(item.id)}`);
  },

  openEditor(url: string) {
    const context = this.context;
    if (!context?.isActive() || this.pendingWrite || this.confirming || this.uncertainWrite ||
      this.memberPanel?.isBlocking() || this.navigating) return;
    this.memberPanel?.cancelRemove();
    this.closeCancellation();
    this.navigating = true;
    this.setData({ navigating: true });
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (sequence !== this.navigationSequence || !context.isActive()) return;
      this.navigating = false;
      this.setData({ navigating: false });
      wx.showToast({ title: "页面打开失败，请重试", icon: "none" });
    };
    try {
      wx.navigateTo({
        url, fail,
        events: {
          scheduleSaved: (result: { id?: string }) => {
            if (context.isCurrent() && typeof result?.id === "string") this.savedLessonId = result.id;
          },
        },
      });
    } catch { fail(); }
  },

  onCancelTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.pendingWrite || this.confirming || this.uncertainWrite ||
      this.memberPanel?.isBlocking() || this.navigating || this.data.refreshing) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    const item = this.data.items.find((candidate) => candidate.id === id);
    const target = this.currentLessons.find(row => row.id === id);
    if (!item || !manageable(item) || !target) return;
    this.memberPanel?.cancelRemove();
    this.memberPanel?.close();
    this.closeCancellation();
    this.cancellationTarget = { ...target };
    this.setData({ cancellation: { ...emptyCancellation(), id, allowFollowing: Boolean(target.seriesId) } });
    void this.readCancellation();
  },
  onCancellationModeChange(event: WechatMiniprogram.PickerChange) {
    const mode = String(event.detail.value) as OperatorCancellationMode;
    if (!this.context?.isActive() || this.pendingWrite || this.uncertainWrite || this.navigating ||
      !this.cancellationTarget || !["THIS", "FOLLOWING"].includes(mode) ||
      (mode === "FOLLOWING" && !this.data.cancellation.allowFollowing)) return;
    this.invalidateConfirmation();
    this.cancellationSequence += 1;
    this.setData({ cancellation: { ...this.data.cancellation, mode, preview: null, rows: [], error: "" } });
    void this.readCancellation();
  },
  async readCancellation() {
    const context = this.context, target = this.cancellationTarget;
    if (!context?.isActive() || !target || this.pendingWrite || this.uncertainWrite || this.navigating) return;
    const mode = this.data.cancellation.mode, sequence = ++this.cancellationSequence;
    this.setData({ cancellation: { ...this.data.cancellation, loading: true, preview: null, rows: [], error: "" } });
    const state = await context.service.previewLessonCancellation(target.id, mode);
    if (!context.isCurrent()) return;
    if (state.status === "error" && [401, 403].includes(state.statusCode ?? 0)) {
      context.invalidate(state.message); return;
    }
    if (!context.isActive() || sequence !== this.cancellationSequence) return;
    if (state.status === "success") {
      // Loaded rows are a required subset; the server may include further unseen lessons.
      const known = mode === "FOLLOWING" ? this.currentLessons.filter(row =>
        row.seriesId === target.seriesId && row.status === "SCHEDULED" &&
        Date.parse(row.startsAt) >= Date.parse(target.startsAt) && Date.parse(row.startsAt) > Date.now()) : [];
      const matches = [target, ...known].every(row => state.data.sessions.some(selected =>
        selected.id === row.id && selected.version === row.version &&
        Date.parse(selected.startsAt) === Date.parse(row.startsAt) &&
        Date.parse(selected.endsAt) === Date.parse(row.endsAt)));
      if (state.data.seriesId !== (target.seriesId ?? null) || !matches) {
        this.setData({ cancellation: { ...this.data.cancellation, loading: false, error: "课次已变化，请刷新课表" } });
        return;
      }
      this.setData({ cancellation: { ...this.data.cancellation, loading: false, preview: state.data,
        rows: seriesDateLabels(state.data.sessions) } });
    } else this.setData({ cancellation: { ...this.data.cancellation, loading: false,
      error: state.status === "error" ? state.message : "取消范围尚未读取完成" } });
  },
  onRefreshCancellation() {
    this.invalidateConfirmation();
    void this.readCancellation();
  },
  closeCancellation() {
    this.cancellationSequence += 1;
    this.cancellationTarget = undefined;
    this.invalidateConfirmation();
    this.setData({ cancellation: emptyCancellation() });
  },
  onCloseCancellation() {
    if (!this.pendingWrite && !this.uncertainWrite) this.closeCancellation();
  },
  onConfirmCancellation() {
    const context = this.context, workflow = this.workflow, target = this.cancellationTarget;
    const { preview, mode } = this.data.cancellation;
    if (!context?.isActive() || !workflow || !target || !preview || this.confirming || this.pendingWrite ||
      this.uncertainWrite || this.navigating || this.data.refreshing || this.memberPanel?.isOpen() ||
      preview.sessions.some(row => Date.parse(row.startsAt) <= Date.now())) return;
    this.confirming = true;
    const sequence = ++this.modalSequence;
    const release = () => { if (sequence === this.modalSequence) this.confirming = false; };
    try {
      wx.showModal({
        title: "取消课次",
        content: `确认取消预览中的${mode === "FOLLOWING" ? "本次及后续" : "本次"} ${preview.sessions.length} 节课吗？`,
        confirmText: "确认取消",
        confirmColor: "#990a04",
        success: (result) => {
          if (sequence !== this.modalSequence || !this.context?.isActive()) return;
          release();
          const current = this.currentLessons.find(row => row.id === target.id);
          if (result.confirm && current && current.version === target.version &&
            current.status === "SCHEDULED" && this.data.cancellation.preview === preview &&
            this.data.cancellation.mode === mode && !this.navigating && !this.memberPanel?.isOpen() &&
            preview.sessions.every(row => Date.parse(row.startsAt) > Date.now())) {
            const input = { mode, previewHash: preview.previewHash };
            void this.runWrite("cancel", () => workflow.cancel(target.id, input, preview));
          }
        },
        fail: () => {
          if (sequence !== this.modalSequence || !this.context?.isActive()) return;
          release();
          wx.showToast({ title: "确认框打开失败，请重试", icon: "none" });
        },
        complete: release,
      });
    } catch {
      release();
      if (this.context?.isActive()) wx.showToast({ title: "确认框打开失败，请重试", icon: "none" });
    }
  },

  invalidateConfirmation() {
    this.modalSequence += 1;
    this.confirming = false;
  },

  runWrite(operation: WriteResult["operation"], invoke: UncertainWrite["invoke"]): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || this.pendingWrite) return Promise.resolve();
    this.invalidateConfirmation();
    this.setData({ submitting: true, recoveryReady: false });
    const request = Promise.resolve().then(() => {
      if (context.isActive()) return invoke();
    }).then(async (outcome) => {
      if (!outcome || !context.isCurrent()) return;
      if (outcome.status === "forbidden") { context.invalidate(outcome.message); return; }
      this.uncertainWrite = outcome.status === "error" && outcome.retryable ? { operation, invoke } : undefined;
      const result = { operation, outcome };
      if (!context.isActive()) { this.deferredResult = result; return; }
      if (this.applyWriteResult(result)) {
        // A pre-write list snapshot must not satisfy the post-write readback.
        this.lessonSequence += 1;
        this.pendingLessons = undefined;
        this.setData({ refreshing: false });
        await this.loadLessons(true);
      }
    }).finally(() => {
      if (this.pendingWrite === request) {
        this.pendingWrite = undefined;
        if (context.isActive()) this.setData({ submitting: false });
      }
    });
    this.pendingWrite = request;
    return request;
  },

  applyWriteResult({ operation, outcome }: WriteResult): boolean {
    if (outcome.status === "forbidden") { this.context?.invalidate(outcome.message); return false; }
    this.setData({
      submitting: Boolean(this.pendingWrite), recoveryAvailable: Boolean(this.uncertainWrite),
      recoveryReady: false,
      recoveryMessage: this.uncertainWrite && outcome.status === "error" ? outcome.message : "",
    });
    if (outcome.status === "success" || outcome.status === "conflict") {
      this.closeCancellation();
      wx.showToast({
        title: outcome.status === "conflict" ? "课次已变化，请查看最新列表"
          : "课次已取消",
        icon: outcome.status === "success" ? "success" : "none",
      });
      return true;
    }
    wx.showToast({ title: outcome.message, icon: "none" });
    return false;
  },

  onRetryWrite() {
    const context = this.context, recovery = this.uncertainWrite;
    if (!context?.isActive() || !recovery || this.pendingWrite || this.pendingRecovery || this.confirming || this.navigating) return;
    if (this.data.recoveryReady) { void this.runWrite(recovery.operation, recovery.invoke); return; }
    this.lessonSequence += 1;
    this.pendingLessons = undefined;
    const sequence = ++this.recoverySequence;
    const accepts = () => Boolean(context.isActive() && sequence === this.recoverySequence);
    this.setData({ recoveryReading: true, recoveryReady: false, refreshing: false, loadingMore: false });
    const request = readOperatorSeriesAuthority(context.service, accepts).then(state => {
      if (!state || !accepts()) return;
      if (state.status === "error" && [401, 403].includes(state.statusCode ?? 0)) {
        context.invalidate(state.message); return;
      }
      if (state.status === "success") {
        this.closeCancellation();
        const query = buildOperatorLessonQuery(this.data.filterDate,
          this.data.statusOptions[this.data.statusIndex]?.value ?? "", 1, PAGE_SIZE);
        const rows = state.data.filter(row => (!query.status || row.status === query.status) &&
          (!query.from || Date.parse(row.startsAt) >= Date.parse(query.from)) &&
          (!query.to || Date.parse(row.startsAt) < Date.parse(query.to)));
        const page = Math.min(Math.max(1, this.data.page), Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
        this.currentLessons = rows.slice(0, page * PAGE_SIZE);
        this.setData({ items: buildOperatorLessonItems(this.currentLessons), page, total: rows.length,
          hasMore: page * PAGE_SIZE < rows.length, viewState: rows.length ? "ready" : "empty",
          refreshing: false, loadingMore: false, refreshError: "", loadMoreError: "" });
      }
      this.setData({ recoveryReading: false, recoveryReady: state.status === "success",
        recoveryMessage: state.status === "success" ? "已读取最新课表，可重试确认原操作" :
          state.status === "error" ? state.message : "课表尚未完整读取" });
    }).finally(() => { if (this.pendingRecovery === request) this.pendingRecovery = undefined; });
    this.pendingRecovery = request;
  },

  onMembersTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive() || this.pendingWrite || this.uncertainWrite ||
      this.navigating || this.data.refreshing || this.memberPanel?.isBlocking()) return;
    const id = String(event.currentTarget.dataset.id ?? "");
    if (!this.data.items.some((item) => item.id === id)) return;
    this.invalidateConfirmation();
    this.closeCancellation();
    this.memberPanel?.open(id);
  },
  onCloseMembers() {
    if (this.memberPanel?.close()) void this.loadLessons(true);
  },
  onRefreshMembers() { void this.memberPanel?.readRoster(); },
  onMemberSearchInput(event: { detail: { value: string } }) {
    this.memberPanel?.setSearchInput(event.detail.value);
  },
  onMemberSearch() { void this.memberPanel?.search(true); },
  onMemberSearchMore() { void this.memberPanel?.search(false); },
  onMemberStudentTap(event: WechatMiniprogram.TouchEvent) {
    this.memberPanel?.select(String(event.currentTarget.dataset.id ?? ""));
  },
  onAddMember() {
    if (!this.pendingWrite && !this.uncertainWrite && !this.confirming && !this.navigating) this.memberPanel?.add();
  },
  onRemoveMemberTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.pendingWrite && !this.uncertainWrite && !this.confirming && !this.navigating)
      this.memberPanel?.requestRemove(String(event.currentTarget.dataset.id ?? ""));
  },
  onConfirmRemoveMember() {
    if (!this.pendingWrite && !this.uncertainWrite && !this.confirming &&
      !this.navigating && !this.data.refreshing) this.memberPanel?.remove();
  },
  onCancelRemoveMember() { this.memberPanel?.cancelRemove(); },
  onRecoverMembers() { this.memberPanel?.recover(); },

  onLogin() {
    if (!this.context) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate("请重新登录");
    wx.reLaunch({ url: "/pages/bootstrap/index" });
  },

  onRetry() {
    void this.loadLessons(true);
  },

  onLoadMore() {
    void this.loadLessons(false);
  },
});
