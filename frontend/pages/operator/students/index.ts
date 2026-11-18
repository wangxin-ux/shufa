import {
  buildOperatorStudentItems,
  buildOperatorStudentQuery,
  OperatorStudentItemModel,
  mergeOperatorStudentItems,
  normalizeOperatorStudentSearch,
  buildOperatorStudentArchive,
  OperatorStudentArchiveModel,
} from '../runtime/services/operator-students.presenter';
import { OperatorPageContext } from '../runtime/operator-page-context';
import { createSessionService } from '../../../services/session.service';
import {
  confirmOperatorRosterExport,
  openOperatorRosterImport,
  operatorRosterEntryKey,
} from '../runtime/services/operator-roster-actions';
import type { OperatorStudentMediaReader } from '../runtime/services/operator-student-media';

const PAGE_SIZE = 20;
const ROSTER_PREFIX = '/operators/me/rosters';

type StudentRow = OperatorStudentItemModel & {
  expanded: boolean;
  archive: OperatorStudentArchiveModel | null;
  archiveState: string;
  archiveError: string;
  photoPath: string;
  photoError: string;
};

Page({
  context: undefined as OperatorPageContext | undefined,
  pendingRequest: undefined as Promise<void> | undefined,
  expandedIds: [] as string[],
  archiveEpoch: 0,
  archiveRequests: new Map<string, Promise<void>>(),
  readers: new Map<string, OperatorStudentMediaReader>(),
  initialShowPending: true,
  pullSequence: 0,
  navigating: false,
  navigationSequence: 0,
  quickKeys: new Map<string, string>(),
  data: {
    toolsOpen: false,
    viewState: 'loading',
    errorMessage: '',
    searchValue: '',
    activeQuery: '',
    items: [] as StudentRow[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    refreshing: false,
    refreshError: '',
    loadMoreError: '',
    quickOpen: false,
    quickStudentName: '',
    quickParentPhone: '',
    rosterBusy: false,
  },

  onLoad(options: Record<string, string | undefined> = {}) {
    this.expandedIds = [];
    this.quickKeys = new Map();
    this.archiveRequests = new Map();
    this.readers = new Map();
    this.context = new OperatorPageContext((errorMessage) => {
      this.resetArchives();
      this.pendingRequest = undefined;
      this.expandedIds = [];
      this.quickKeys.clear();
      this.navigationSequence += 1;
      this.navigating = false;
      this.setData({
        viewState: 'forbidden', errorMessage, items: [], page: 0, total: 0,
        hasMore: false, loadingMore: false, refreshing: false,
        searchValue: '', activeQuery: '', refreshError: '', loadMoreError: '',
        quickOpen: false, quickStudentName: '', quickParentPhone: '',
      });
    });
    if (options.quick === '1') {
      this.setData({ quickOpen: true });
    }
    void this.loadStudents(true);
  },

  onShow() {
    if (!this.context?.show()) return;
    this.setData({ rosterBusy: false });
    this.navigating = false;
    this.navigationSequence += 1;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadStudents(true);
  },

  onHide() {
    this.context?.hide();
    this.resetArchives();
    this.interruptArchives();
    this.pendingRequest = undefined;
    this.initialShowPending = false;
    this.pullSequence += 1;
    this.navigationSequence += 1;
    this.navigating = false;
  },

  onUnload() {
    this.context?.dispose();
    this.resetArchives();
    this.pendingRequest = undefined;
    this.expandedIds = [];
    this.quickKeys.clear();
    this.navigationSequence += 1;
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadStudents(true).finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  loadStudents(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || (!reset && !this.data.hasMore)) return Promise.resolve();
    if (this.pendingRequest && (!reset || this.data.refreshing)) return this.pendingRequest;
    const page = reset ? 1 : this.data.page + 1;
    const query = this.data.activeQuery;
    const sequence = context.nextRead();
    const keepContent = ['ready', 'empty'].includes(this.data.viewState);
    if (reset) { this.resetArchives(); this.interruptArchives(); }
    this.setData(
      reset
        ? {
            ...(keepContent ? {} : { viewState: 'loading' }),
            errorMessage: '', refreshError: '', loadMoreError: '',
            loadingMore: false, refreshing: true,
          }
        : { loadingMore: true, loadMoreError: '' },
    );
    const request = Promise.resolve().then(() => {
      if (context.accepts(sequence)) return context.service.loadStudents(
        buildOperatorStudentQuery(query, page, PAGE_SIZE),
      );
    }).then((state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        context.invalidate(state.message);
        return;
      }
      if (!context.accepts(sequence)) return;
      if (state.status === 'success' || state.status === 'empty') {
        const incoming = buildOperatorStudentItems(state.data.data);
        const previous = new Map(this.data.items.map((item) => [item.id, item]));
        const current = this.data.items;
        const items: StudentRow[] = mergeOperatorStudentItems(current, incoming, page)
          .map((item) => ({
            ...item, expanded: this.expandedIds.includes(item.id),
            archive: reset ? null : previous.get(item.id)?.archive ?? null,
            archiveState: reset ? 'idle' : previous.get(item.id)?.archiveState ?? 'idle',
            archiveError: reset ? '' : previous.get(item.id)?.archiveError ?? '',
            photoPath: reset ? '' : previous.get(item.id)?.photoPath ?? '',
            photoError: reset ? '' : previous.get(item.id)?.photoError ?? '',
          }));
        this.setData({
          items, page: state.data.meta.page, total: state.data.meta.total,
          hasMore: state.data.meta.page < state.data.meta.totalPages,
          loadingMore: false, refreshing: false,
          viewState: items.length === 0 ? 'empty' : 'ready',
          errorMessage: '', refreshError: '', loadMoreError: '',
        });
        for (const item of items) if (item.expanded && item.archiveState === 'idle') void this.loadArchive(item.id);
      } else if (state.status === 'error') {
        if (state.statusCode === 401 || state.statusCode === 403) context.invalidate(state.message);
        else this.setData({
          ...(keepContent
            ? reset ? { refreshError: state.message } : { loadMoreError: state.message }
            : { viewState: 'error', errorMessage: state.message }),
          loadingMore: false, refreshing: false,
        });
      }
    }).finally(() => {
      if (this.pendingRequest === request) this.pendingRequest = undefined;
    });
    this.pendingRequest = request;
    return request;
  },

  onToggleTools() { if (this.context?.isActive()) this.setData({ toolsOpen: !this.data.toolsOpen }); },

  onSearchInput(event: WechatMiniprogram.Input) {
    if (this.context?.isActive()) this.setData({ searchValue: event.detail.value });
  },

  onSearchSubmit() {
    if (!this.context?.isActive()) return;
    this.context.nextRead();
    this.pendingRequest = undefined;
    this.expandedIds = [];
    this.setData({
      activeQuery: normalizeOperatorStudentSearch(this.data.searchValue),
      items: [], page: 0, total: 0, hasMore: false, viewState: 'loading',
    });
    void this.loadStudents(true);
  },

  onSearchClear() {
    if (!this.context?.isActive()) return;
    this.setData({ searchValue: '' });
    this.onSearchSubmit();
  },

  onStudentToggle(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive()) return;
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!this.data.items.some((item) => item.id === id)) return;
    this.expandedIds = this.expandedIds.includes(id)
      ? this.expandedIds.filter((current) => current !== id) : [...this.expandedIds, id];
    this.setData({
      items: this.data.items.map((item) => ({ ...item, expanded: this.expandedIds.includes(item.id) })),
    });
    if (this.expandedIds.includes(id)) void this.loadArchive(id);
  },

  resetArchives() {
    this.archiveEpoch += 1;
    this.archiveRequests.clear();
    for (const reader of this.readers.values()) reader.invalidate();
    this.readers.clear();
  },

  interruptArchives() {
    this.setData({ items: this.data.items.map((item) => ({
      ...item, photoPath: '',
      ...(item.archiveState === 'loading' ? { archiveState: 'error', archiveError: '摘要读取已中断，请重试' } : {}),
    })) });
  },

  patchArchive(id: string, patch: Partial<StudentRow>) {
    this.setData({ items: this.data.items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  },

  loadArchive(id: string): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || !this.expandedIds.includes(id)) return Promise.resolve();
    const pending = this.archiveRequests.get(id);
    if (pending) return pending;
    const epoch = this.archiveEpoch;
    this.patchArchive(id, { archiveState: 'loading', archiveError: '' });
    const current = () => context.isActive() && epoch === this.archiveEpoch &&
      this.expandedIds.includes(id) && this.data.items.some((item) => item.id === id);
    const request = Promise.resolve().then(() => {
      if (current()) return context.service.loadStudentArchive(id);
    }).then((state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        context.invalidate(state.message);
        return;
      }
      if (!current()) return;
      if (state.status === 'success') {
        this.patchArchive(id, { archive: buildOperatorStudentArchive(state.data),
          archiveState: 'ready', archiveError: '', photoPath: '', photoError: '' });
        if (state.data.photo) {
          const reader = this.readers.get(id) ?? context.studentMediaReader(id);
          if (!reader) return;
          this.readers.set(id, reader);
          return reader.load(state.data.photo).then((photoPath) => {
            if (current()) this.patchArchive(id, { photoPath, photoError: '' });
          }).catch((error: { statusCode?: number; message?: string }) => {
            if (epoch !== this.archiveEpoch || !context.isCurrent()) return;
            if (error.statusCode === 401 || error.statusCode === 403) context.invalidate(error.message ?? '无权查看学员照片');
            else if (current()) this.patchArchive(id, { photoPath: '', photoError: error.message ?? '照片读取失败，请重试' });
          });
        }
      } else if (state.status === 'error') {
        this.patchArchive(id, { archive: null, archiveState: 'error', archiveError: state.message, photoPath: '' });
      }
    }).finally(() => {
      if (this.archiveRequests.get(id) === request) this.archiveRequests.delete(id);
    });
    this.archiveRequests.set(id, request);
    return request;
  },

  onArchiveRetry(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    void this.loadArchive(id);
  },

  onPhotoError(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive()) return;
    this.patchArchive(String(event.currentTarget.dataset.id ?? ''), { photoPath: '', photoError: '照片显示失败，请重试' });
  },

  onLogin() {
    if (!this.context) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },

  onTeacherRosterTap() {
    if (!this.context?.isActive()) return;
    wx.redirectTo({ url: '/pages/operator/teachers/index' });
  },

  onQuickToggle() {
    if (!this.context?.isActive() || !['ready', 'empty'].includes(this.data.viewState)) return;
    this.setData({ quickOpen: !this.data.quickOpen });
  },

  onQuickStudentInput(event: WechatMiniprogram.Input) {
    this.setData({ quickStudentName: event.detail.value });
  },

  onQuickPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ quickParentPhone: event.detail.value });
  },

  async onQuickSubmit() {
    const context = this.context;
    if (!context?.isActive() || this.data.rosterBusy || !['ready', 'empty'].includes(this.data.viewState)) return;
    const isCurrent = context.operationIsCurrent();
    const studentName = this.data.quickStudentName.trim();
    const parentPhone = this.data.quickParentPhone.trim();
    if (!studentName) {
      return void wx.showToast({ title: '请填写学员姓名', icon: 'none' });
    }
    if (!/^1[3-9]\d{9}$/.test(parentPhone)) {
      return void wx.showToast({
        title: '请输入正确的家长手机号',
        icon: 'none',
      });
    }
    try {
      this.setData({ rosterBusy: true });
      const input = { studentName, parentPhone };
      const result = await context.rosterFor(isCurrent).quickEntry(
        ROSTER_PREFIX,
        'customers',
        input,
        operatorRosterEntryKey(this.quickKeys, input),
      );
      if (!isCurrent()) return;
      wx.showToast({
        title: result.status === 'CREATED' ? '顾客已录入' : result.reason,
        icon: result.status === 'CREATED' ? 'success' : 'none',
      });
      if (result.status === 'CREATED') {
        this.setData({
          quickOpen: false,
          quickStudentName: '',
          quickParentPhone: '',
        });
        await this.loadStudents(true);
      }
    } catch (error) {
      if (!isCurrent()) return;
      wx.showToast({
        title: error instanceof Error ? error.message : '录入失败',
        icon: 'none',
      });
    } finally {
      if (isCurrent()) this.setData({ rosterBusy: false });
    }
  },

  async onRosterImport() {
    const context = this.context;
    if (!context?.isActive() || this.data.rosterBusy || !['ready', 'empty'].includes(this.data.viewState)) return;
    const isCurrent = context.operationIsCurrent();
    this.setData({ rosterBusy: true });
    try {
      if (await openOperatorRosterImport(
        context.rosterFor(isCurrent), ROSTER_PREFIX, 'customers', isCurrent,
      )) {
        if (isCurrent()) await this.loadStudents(true);
      }
    } finally { if (isCurrent()) this.setData({ rosterBusy: false }); }
  },

  async onRosterExport() {
    const context = this.context;
    if (!context?.isActive() || this.data.rosterBusy || !['ready', 'empty'].includes(this.data.viewState)) return;
    const isCurrent = context.operationIsCurrent();
    this.setData({ rosterBusy: true });
    try { await confirmOperatorRosterExport(
      context.rosterFor(isCurrent),
      ROSTER_PREFIX,
      'customers',
      { query: this.data.activeQuery || undefined },
      isCurrent,
    ); } finally { if (isCurrent()) this.setData({ rosterBusy: false }); }
  },

  onStudentTap(
    event: WechatMiniprogram.CustomEvent<
      Record<string, never>,
      Record<string, never>,
      { id?: string }
    >,
  ) {
    const id = event.currentTarget.dataset.id;
    if (!this.context?.isActive() || this.navigating || !id ||
      !this.data.items.some((item) => item.id === id)) {
      return;
    }
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    wx.navigateTo({
      url: `/pages/operator/student-detail/index?id=${encodeURIComponent(id)}`,
      fail: () => {
        if (sequence !== this.navigationSequence || !this.context?.isActive()) return;
        this.navigating = false;
        wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
      },
    });
  },

  onRetry() {
    void this.loadStudents(true);
  },

  onLoadMore() {
    void this.loadStudents(false);
  },
});
