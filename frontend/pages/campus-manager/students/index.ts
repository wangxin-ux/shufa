import {
  buildCampusManagerStudentItems,
  buildCampusManagerStudentQuery,
  CampusManagerStudentItemModel,
  CampusManagerStudentSearchDebouncer,
  mergeCampusManagerStudentItems,
} from '../../../services/campus-manager-students.presenter';
import { campusManagerService } from '../../../services/campus-manager-runtime';
import { createCampusManagerRuntimeEnv } from '../../../config/campus-manager-env';
import { createRuntimeAccessTokenProvider } from '../../../config/local-runtime';
import { RosterFileTransferClient } from '../../../services/roster-file-transfer';
import {
  confirmRosterExport,
  openRosterImportMenu,
} from '../../../services/roster-page-actions';

const PAGE_SIZE = 20;
let requestSequence = 0;
let searchDebouncer: CampusManagerStudentSearchDebouncer | null = null;
const rosterEnv = createCampusManagerRuntimeEnv();
const rosterClient = new RosterFileTransferClient({
  baseUrl: rosterEnv.apiBaseUrl,
  accessToken: createRuntimeAccessTokenProvider(rosterEnv.accessToken),
});
const ROSTER_PREFIX = '/campus-managers/me/rosters';

const createRosterKey = (): string =>
  `customer-roster-entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    searchValue: '',
    activeQuery: '',
    items: [] as CampusManagerStudentItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    quickOpen: false,
    quickStudentName: '',
    quickParentPhone: '',
    rosterBusy: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    if (options.quick === '1') {
      this.setData({ quickOpen: true });
    }
    searchDebouncer = new CampusManagerStudentSearchDebouncer(
      (activeQuery) => {
        this.setData({ activeQuery });
        void this.loadStudents(true);
      },
    );
    void this.loadStudents(true);
  },

  onUnload() {
    searchDebouncer?.cancel();
    searchDebouncer = null;
  },

  onPullDownRefresh() {
    void this.loadStudents(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadStudents(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) {
      return;
    }
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: 'loading',
            errorMessage: '',
            items: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );
    const state = await campusManagerService.loadStudents(
      buildCampusManagerStudentQuery(
        this.data.activeQuery,
        page,
        PAGE_SIZE,
      ),
    );
    if (sequence !== requestSequence) {
      return;
    }
    if (state.status === 'success' || state.status === 'empty') {
      const incoming = buildCampusManagerStudentItems(state.data.data);
      const items = mergeCampusManagerStudentItems(
        this.data.items,
        incoming,
        page,
      );
      this.setData({
        items,
        page: state.data.meta.page,
        total: state.data.meta.total,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length === 0 ? 'empty' : 'ready',
        errorMessage: '',
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        loadingMore: false,
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看本校区学员'
            : state.message,
      });
    }
  },

  onSearchInput(event: WechatMiniprogram.Input) {
    const searchValue = event.detail.value;
    this.setData({ searchValue });
    searchDebouncer?.schedule(searchValue);
  },

  onTeacherRosterTap() {
    wx.redirectTo({ url: '/pages/campus-manager/teachers/index' });
  },

  onQuickToggle() {
    this.setData({ quickOpen: !this.data.quickOpen });
  },

  onQuickStudentInput(event: WechatMiniprogram.Input) {
    this.setData({ quickStudentName: event.detail.value });
  },

  onQuickPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ quickParentPhone: event.detail.value });
  },

  async onQuickSubmit() {
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
      const result = await rosterClient.quickEntry(
        ROSTER_PREFIX,
        'customers',
        { studentName, parentPhone },
        createRosterKey(),
      );
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
      await openRosterImportMenu(
        rosterClient,
        ROSTER_PREFIX,
        'customers',
      )
    ) {
      await this.loadStudents(true);
    }
  },

  onRosterExport() {
    void confirmRosterExport(
      rosterClient,
      ROSTER_PREFIX,
      'customers',
      { query: this.data.activeQuery || undefined },
    );
  },

  onStudentTap(
    event: WechatMiniprogram.CustomEvent<
      Record<string, never>,
      Record<string, never>,
      { id?: string }
    >,
  ) {
    const id = event.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/campus-manager/student-detail/index?id=${encodeURIComponent(id)}`,
    });
  },

  onRetry() {
    void this.loadStudents(true);
  },

  onLoadMore() {
    void this.loadStudents(false);
  },
});
