import {
  buildSuperAdminStudentItems,
  normalizeSuperAdminStudentSearch,
  resolveSuperAdminStudentsViewState,
  SuperAdminStudentItemModel,
} from '../../../services/super-admin-students.presenter';
import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminCampus } from '../../../types/super-admin';
import { createSuperAdminRuntimeEnv } from '../../../config/super-admin-env';
import { createRuntimeAccessTokenProvider } from '../../../config/local-runtime';
import { RosterFileTransferClient } from '../../../services/roster-file-transfer';
import {
  confirmRosterExport,
  openRosterImportMenu,
} from '../../../services/roster-page-actions';
import { createMutationKey } from '../../../utils/super-admin-format';

interface CampusOption {
  id: string;
  name: string;
}

const rosterEnv = createSuperAdminRuntimeEnv();
const rosterClient = new RosterFileTransferClient({
  baseUrl: rosterEnv.apiBaseUrl,
  accessToken: createRuntimeAccessTokenProvider(rosterEnv.accessToken),
});
const ROSTER_PREFIX = '/management/rosters';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    keyword: '',
    campusIndex: 0,
    campuses: [{ id: '', name: '全部校区' }] as CampusOption[],
    students: [] as SuperAdminStudentItemModel[],
    page: 1,
    pageSize: 10,
    hasMore: false,
    loadingMore: false,
    quickOpen: false,
    quickStudentName: '',
    quickParentPhone: '',
    rosterBusy: false,
  },

  onLoad() {
    void this.initialize();
  },

  onPullDownRefresh() {
    void this.loadStudents(true).finally(() => wx.stopPullDownRefresh());
  },

  async initialize() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const campuses = await superAdminService.loadCampuses({
      page: 1,
      pageSize: 100,
    });
    if (campuses.status === 'error') {
      this.setData({
        viewState: campuses.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: campuses.message,
      });
      return;
    }
    if (campuses.status !== 'success' && campuses.status !== 'empty') {
      this.setData({
        viewState: 'error',
        errorMessage: '校区列表尚未就绪，请重试',
      });
      return;
    }
    this.setData({
      campuses: [
        { id: '', name: '全部校区' },
        ...campuses.data.data.map((campus: SuperAdminCampus) => ({
          id: campus.id,
          name: campus.name,
        })),
      ],
    });
    await this.loadStudents(true);
  },

  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },

  onSearch() {
    void this.loadStudents(true);
  },

  onCampusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ campusIndex: Number(event.detail.value) });
    void this.loadStudents(true);
  },

  async loadStudents(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData(
      reset
        ? { viewState: 'loading', errorMessage: '' }
        : { loadingMore: true },
    );
    const campusId = this.data.campuses[this.data.campusIndex]?.id ?? '';
    const query = normalizeSuperAdminStudentSearch(this.data.keyword);
    const state = await superAdminService.loadStudents({
      page,
      pageSize: this.data.pageSize,
      ...(campusId ? { campusId } : {}),
      ...(query ? { query } : {}),
    });
    if (state.status === 'success' || state.status === 'empty') {
      const incoming = buildSuperAdminStudentItems(state.data.data);
      this.setData({
        viewState: resolveSuperAdminStudentsViewState(incoming.length),
        errorMessage: '',
        students: reset ? incoming : [...this.data.students, ...incoming],
        page,
        hasMore: page < state.data.meta.totalPages,
        loadingMore: false,
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: state.message,
        loadingMore: false,
      });
    }
  },

  onLoadMore() {
    void this.loadStudents(false);
  },

  onTeacherRosterTap() {
    wx.redirectTo({ url: '/pages/super-admin/teachers/index' });
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
    const campus = this.data.campuses[this.data.campusIndex];
    const studentName = this.data.quickStudentName.trim();
    const parentPhone = this.data.quickParentPhone.trim();
    if (!campus?.id) return void wx.showToast({ title: '请先选择所属校区', icon: 'none' });
    if (!studentName) return void wx.showToast({ title: '请填写学员姓名', icon: 'none' });
    if (!/^1[3-9]\d{9}$/.test(parentPhone)) {
      return void wx.showToast({ title: '请输入正确的家长手机号', icon: 'none' });
    }
    try {
      this.setData({ rosterBusy: true });
      const result = await rosterClient.quickEntry(
        ROSTER_PREFIX,
        'customers',
        { studentName, parentPhone, campusId: campus.id },
        createMutationKey('customer-roster-entry'),
      );
      wx.showToast({
        title: result.status === 'CREATED' ? '顾客已录入' : result.reason,
        icon: result.status === 'CREATED' ? 'success' : 'none',
      });
      if (result.status === 'CREATED') {
        this.setData({ quickOpen: false, quickStudentName: '', quickParentPhone: '' });
        await this.loadStudents(true);
      }
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '录入失败', icon: 'none' });
    } finally {
      this.setData({ rosterBusy: false });
    }
  },

  async onRosterImport() {
    if (await openRosterImportMenu(rosterClient, ROSTER_PREFIX, 'customers')) {
      await this.loadStudents(true);
    }
  },

  onRosterExport() {
    const campusId = this.data.campuses[this.data.campusIndex]?.id || undefined;
    void confirmRosterExport(rosterClient, ROSTER_PREFIX, 'customers', {
      campusId,
      query: this.data.keyword.trim() || undefined,
    });
  },

  onStudentTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!id) return;
    wx.navigateTo({
      url: `/pages/super-admin/student-detail/index?id=${encodeURIComponent(id)}`,
    });
  },

  onRetry() {
    void this.initialize();
  },
});
