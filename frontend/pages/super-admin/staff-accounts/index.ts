import { superAdminService } from '../../../services/super-admin-runtime';
import {
  DirectlyCreatableStaffRole,
  ManageableStaffRole,
  StaffAccountStatus,
  SuperAdminCampus,
  SuperAdminStaffAccount,
} from '../../../types/super-admin';
import { createMutationKey } from '../../../utils/super-admin-format';

interface StaffRoleOption {
  value: DirectlyCreatableStaffRole;
  label: string;
}

interface StaffAccountView extends SuperAdminStaffAccount {
  roleLabel: string;
  statusLabel: string;
  bindingLabel: string;
}

const ROLE_OPTIONS: StaffRoleOption[] = [
  { value: 'CAMPUS_MANAGER', label: '分校区管理员' },
  { value: 'PARTNER', label: '合作方' },
  { value: 'HR', label: '总部人力' },
  { value: 'FINANCE', label: '总部财务' },
];

const ROLE_LABELS: Record<ManageableStaffRole, string> = {
  TEACHER: '授课老师',
  CAMPUS_MANAGER: '分校区管理员',
  PARTNER: '合作方',
  HR: '总部人力',
  FINANCE: '总部财务',
};

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    keyword: '',
    accounts: [] as StaffAccountView[],
    campuses: [] as SuperAdminCampus[],
    roleOptions: ROLE_OPTIONS,
    createOpen: false,
    createName: '',
    createPhone: '',
    createRoleIndex: 0,
    createCampusIndex: 0,
    createHeadquarters: false,
    submitting: false,
    submittingId: '',
  },

  onLoad() {
    void this.load();
  },

  onKeywordInput(event: WechatMiniprogram.Input) {
    this.setData({ keyword: event.detail.value });
  },

  onSearch() {
    void this.loadAccounts();
  },

  onToggleCreate() {
    this.setData({ createOpen: !this.data.createOpen });
  },

  onNameInput(event: WechatMiniprogram.Input) {
    this.setData({ createName: event.detail.value });
  },

  onPhoneInput(event: WechatMiniprogram.Input) {
    this.setData({ createPhone: event.detail.value });
  },

  onRoleChange(event: WechatMiniprogram.PickerChange) {
    const createRoleIndex = Number(event.detail.value);
    const role = ROLE_OPTIONS[createRoleIndex];
    if (!role) return;
    this.setData({
      createRoleIndex,
      createHeadquarters: role.value === 'HR' || role.value === 'FINANCE',
    });
  },

  onCampusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ createCampusIndex: Number(event.detail.value) });
  },

  async load() {
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
        errorMessage: '校区数据加载失败，请稍后重试',
      });
      return;
    }
    this.setData({ campuses: campuses.data.data });
    await this.loadAccounts();
  },

  async loadAccounts() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await superAdminService.loadStaffAccounts({
      page: 1,
      pageSize: 100,
      query: this.data.keyword.trim() || undefined,
    });
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        viewState: state.status,
        accounts: state.data.data.map(toAccountView),
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: state.message,
      });
    }
  },

  async onCreate() {
    if (this.data.submitting) return;
    const displayName = this.data.createName.trim();
    const phone = this.data.createPhone.trim();
    const role = this.data.roleOptions[this.data.createRoleIndex];
    const campus = this.data.campuses[this.data.createCampusIndex];
    const headquarters = role?.value === 'HR' || role?.value === 'FINANCE';
    if (!displayName) {
      wx.showToast({ title: '请填写姓名', icon: 'none' });
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      return;
    }
    if (!role || (!headquarters && !campus)) {
      wx.showToast({ title: '请选择角色和所属校区', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    const state = await superAdminService.createStaffAccount(
      {
        displayName,
        phone,
        roleCode: role.value,
        campusId: headquarters ? null : campus.id,
      },
      createMutationKey('staff-account-create'),
    );
    this.setData({ submitting: false });
    if (state.status === 'success') {
      this.setData({
        createOpen: false,
        createName: '',
        createPhone: '',
      });
      wx.showToast({ title: '账号已创建', icon: 'success' });
      await this.loadAccounts();
      return;
    }
    if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  onStatusAction(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const version = Number(event.currentTarget.dataset.version);
    const currentStatus = String(
      event.currentTarget.dataset.status ?? '',
    ) as StaffAccountStatus;
    const nextStatus: StaffAccountStatus =
      currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    wx.showModal({
      title: nextStatus === 'DISABLED' ? '确认停用账号' : '确认启用账号',
      content:
        nextStatus === 'DISABLED'
          ? '停用后，该工作人员现有登录会话将立即失效。'
          : '启用后，该工作人员可继续使用已绑定微信登录。',
      confirmText: nextStatus === 'DISABLED' ? '停用' : '启用',
      confirmColor: nextStatus === 'DISABLED' ? '#a52720' : '#238760',
      success: ({ confirm }) => {
        if (confirm) void this.updateStatus(id, version, nextStatus);
      },
    });
  },

  async updateStatus(
    id: string,
    expectedVersion: number,
    status: StaffAccountStatus,
  ) {
    this.setData({ submittingId: id });
    const state = await superAdminService.updateStaffAccountStatus(
      id,
      { status, expectedVersion },
      createMutationKey('staff-account-status'),
    );
    this.setData({ submittingId: '' });
    if (state.status === 'success') {
      await this.loadAccounts();
      return;
    }
    if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  onUnbindAction(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const version = Number(event.currentTarget.dataset.version);
    wx.showModal({
      title: '确认解除微信绑定',
      content: '解除后，工作人员需要再次授权当前账号手机号才能登录。',
      confirmText: '解除绑定',
      confirmColor: '#a52720',
      success: ({ confirm }) => {
        if (confirm) void this.unbindWechat(id, version);
      },
    });
  },

  async unbindWechat(id: string, expectedVersion: number) {
    this.setData({ submittingId: id });
    const state = await superAdminService.unbindStaffWechat(
      id,
      { expectedVersion },
      createMutationKey('staff-account-unbind'),
    );
    this.setData({ submittingId: '' });
    if (state.status === 'success') {
      await this.loadAccounts();
      return;
    }
    if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  onRetry() {
    void this.load();
  },
});

function toAccountView(account: SuperAdminStaffAccount): StaffAccountView {
  return {
    ...account,
    roleLabel: ROLE_LABELS[account.roleCode],
    statusLabel: account.status === 'ACTIVE' ? '已启用' : '已停用',
    bindingLabel: account.bindingStatus === 'BOUND' ? '微信已绑定' : '微信未绑定',
  };
}
