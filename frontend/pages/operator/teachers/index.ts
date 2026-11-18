import { OperatorPageContext } from '../runtime/operator-page-context';
import { createSessionService } from '../../../services/session.service';
import {
  confirmOperatorRosterExport,
  openOperatorRosterImport,
  operatorRosterEntryKey,
} from '../runtime/services/operator-roster-actions';
import { TeacherRosterItem } from '../../../types/roster';

const ROSTER_PREFIX = '/operators/me/rosters';
const PAGE_SIZE = 20;

Page({
  context: undefined as OperatorPageContext | undefined,
  initialShowPending: true,
  quickKeys: new Map<string, string>(),
  data: {
    viewState: 'loading',
    errorMessage: '',
    query: '',
    items: [] as TeacherRosterItem[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    quickOpen: false,
    quickTeacherName: '',
    quickPhone: '',
    rosterBusy: false,
  },

  onLoad() {
    this.quickKeys = new Map();
    this.context = new OperatorPageContext((errorMessage) => {
      this.quickKeys.clear();
      this.setData({
        viewState: 'forbidden', errorMessage, query: '', items: [], page: 0, total: 0,
        hasMore: false, loadingMore: false, quickOpen: false, quickTeacherName: '', quickPhone: '', rosterBusy: false,
      });
    });
    void this.loadTeachers(true);
  },

  onShow() {
    if (!this.context?.show()) return;
    this.setData({ rosterBusy: false });
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.loadTeachers(true);
  },
  onHide() { this.context?.hide(); this.initialShowPending = false; },
  onUnload() { this.context?.dispose(); this.quickKeys.clear(); },

  onPullDownRefresh() {
    void this.loadTeachers(true).finally(() => {
      if (this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  async loadTeachers(reset: boolean) {
    const context = this.context;
    if (!context?.isActive()) return;
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = context.nextRead();
    this.setData(
      reset
        ? { viewState: 'loading', errorMessage: '', items: [] }
        : { loadingMore: true, errorMessage: '' },
    );
    try {
      const result = await context.roster.listTeachers(ROSTER_PREFIX, {
        page,
        pageSize: PAGE_SIZE,
        query: this.data.query.trim() || undefined,
      });
      if (!context.accepts(sequence)) return;
      const items = reset ? result.data : [...this.data.items, ...result.data];
      this.setData({
        items,
        page: result.meta.page,
        total: result.meta.total,
        hasMore: result.meta.page < result.meta.totalPages,
        loadingMore: false,
        viewState: items.length ? 'ready' : 'empty',
      });
    } catch (error) {
      if (!context.accepts(sequence)) return;
      this.setData({
        viewState: 'error',
        loadingMore: false,
        errorMessage:
          error instanceof Error ? error.message : '教师名册加载失败',
      });
    }
  },

  onQueryInput(event: WechatMiniprogram.Input) {
    this.setData({ query: event.detail.value });
  },

  onSearch() {
    void this.loadTeachers(true);
  },

  onQuickToggle() {
    if (!this.context?.isActive() || !['ready', 'empty'].includes(this.data.viewState)) return;
    this.setData({ quickOpen: !this.data.quickOpen });
  },

  onStudentRosterTap() {
    if (!this.context?.isActive()) return;
    wx.redirectTo({ url: '/pages/operator/students/index' });
  },

  onQuickNameInput(event: WechatMiniprogram.Input) {
    this.setData({ quickTeacherName: event.detail.value });
  },

  onQuickPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ quickPhone: event.detail.value });
  },

  async onQuickSubmit() {
    const context = this.context;
    if (!context?.isActive() || this.data.rosterBusy || !['ready', 'empty'].includes(this.data.viewState)) return;
    const isCurrent = context.operationIsCurrent();
    const teacherName = this.data.quickTeacherName.trim();
    const phone = this.data.quickPhone.trim();
    if (!teacherName) {
      return void wx.showToast({ title: '请填写教师姓名', icon: 'none' });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return void wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
    }
    try {
      this.setData({ rosterBusy: true });
      const input = { teacherName, phone };
      const result = await context.rosterFor(isCurrent).quickEntry(
        ROSTER_PREFIX,
        'teachers',
        input,
        operatorRosterEntryKey(this.quickKeys, input),
      );
      if (!isCurrent()) return;
      wx.showToast({
        title: result.status === 'CREATED' ? '教师已录入' : result.reason,
        icon: result.status === 'CREATED' ? 'success' : 'none',
      });
      if (result.status === 'CREATED') {
        this.setData({
          quickOpen: false,
          quickTeacherName: '',
          quickPhone: '',
        });
        await this.loadTeachers(true);
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
      if (await openOperatorRosterImport(context.rosterFor(isCurrent), ROSTER_PREFIX, 'teachers', isCurrent)) {
        if (isCurrent()) await this.loadTeachers(true);
      }
    } finally { if (isCurrent()) this.setData({ rosterBusy: false }); }
  },

  async onRosterExport() {
    const context = this.context;
    if (!context?.isActive() || this.data.rosterBusy || !['ready', 'empty'].includes(this.data.viewState)) return;
    const isCurrent = context.operationIsCurrent();
    this.setData({ rosterBusy: true });
    try { await confirmOperatorRosterExport(context.rosterFor(isCurrent), ROSTER_PREFIX, 'teachers', {
      query: this.data.query.trim() || undefined,
    }, isCurrent); } finally { if (isCurrent()) this.setData({ rosterBusy: false }); }
  },

  onLoadMore() {
    void this.loadTeachers(false);
  },

  onRetry() {
    void this.loadTeachers(true);
  },

  onLogin() {
    if (this.context?.ownsRuntime()) createSessionService().logout();
    this.context?.invalidate('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
