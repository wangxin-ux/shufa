import { createCampusManagerRuntimeEnv } from '../../../config/campus-manager-env';
import { createRuntimeAccessTokenProvider } from '../../../config/local-runtime';
import { RosterFileTransferClient } from '../../../services/roster-file-transfer';
import {
  confirmRosterExport,
  openRosterImportMenu,
} from '../../../services/roster-page-actions';
import { TeacherRosterItem } from '../../../types/roster';

const env = createCampusManagerRuntimeEnv();
const rosterClient = new RosterFileTransferClient({
  baseUrl: env.apiBaseUrl,
  accessToken: createRuntimeAccessTokenProvider(env.accessToken),
});
const ROSTER_PREFIX = '/campus-managers/me/rosters';
const PAGE_SIZE = 20;
let requestSequence = 0;

const createRosterKey = (): string =>
  `teacher-roster-entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

Page({
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
    void this.loadTeachers(true);
  },

  onPullDownRefresh() {
    void this.loadTeachers(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadTeachers(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? { viewState: 'loading', errorMessage: '', items: [] }
        : { loadingMore: true, errorMessage: '' },
    );
    try {
      const result = await rosterClient.listTeachers(ROSTER_PREFIX, {
        page,
        pageSize: PAGE_SIZE,
        query: this.data.query.trim() || undefined,
      });
      if (sequence !== requestSequence) return;
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
      if (sequence !== requestSequence) return;
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
    this.setData({ quickOpen: !this.data.quickOpen });
  },

  onStudentRosterTap() {
    wx.redirectTo({ url: '/pages/campus-manager/students/index' });
  },

  onQuickNameInput(event: WechatMiniprogram.Input) {
    this.setData({ quickTeacherName: event.detail.value });
  },

  onQuickPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ quickPhone: event.detail.value });
  },

  async onQuickSubmit() {
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
      const result = await rosterClient.quickEntry(
        ROSTER_PREFIX,
        'teachers',
        { teacherName, phone },
        createRosterKey(),
      );
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
      wx.showToast({
        title: error instanceof Error ? error.message : '录入失败',
        icon: 'none',
      });
    } finally {
      this.setData({ rosterBusy: false });
    }
  },

  async onRosterImport() {
    if (
      await openRosterImportMenu(rosterClient, ROSTER_PREFIX, 'teachers')
    ) {
      await this.loadTeachers(true);
    }
  },

  onRosterExport() {
    void confirmRosterExport(rosterClient, ROSTER_PREFIX, 'teachers', {
      query: this.data.query.trim() || undefined,
    });
  },

  onLoadMore() {
    void this.loadTeachers(false);
  },

  onRetry() {
    void this.loadTeachers(true);
  },
});
