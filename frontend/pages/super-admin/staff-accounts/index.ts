import type { StaffAccountPort } from '../runtime/staff-account-runtime';
import { HeadquartersManagementContext, managementSessionKey as sessionKey } from '../runtime/headquarters-management.context';
import { HeadquartersWorkflow, headquartersInitial } from '../runtime/headquarters-management.workflow';
import { headquartersAccount } from '../runtime/headquarters-management.types';
import { HeadquartersLifecycleWorkflow, lifecycleInitial } from '../runtime/headquarters-lifecycle.workflow';
import {
  DirectlyCreatableStaffRole,
  ManageableStaffRole,
  StaffAccountStatus,
  SuperAdminCreateStaffAccountInput,
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
  headquartersOperator: boolean;
  manageable: boolean;
}

interface StaffCreationAttempt {
  owner: string;
  input: SuperAdminCreateStaffAccountInput;
  key: string;
}

type StaffCampusChoice = Pick<SuperAdminCampus, 'id' | 'name'>;
const CAMPUS_VIEW_BATCH_SIZE = 50;

const ROLE_OPTIONS: StaffRoleOption[] = [
  { value: 'CAMPUS_MANAGER', label: '分校区管理员' },
  { value: 'PARTNER', label: '合作方' },
  { value: 'HR', label: '总部人力' },
  { value: 'FINANCE', label: '总部财务' },
  { value: 'OPERATOR', label: '运营' },
];

const ROLE_LABELS: Record<ManageableStaffRole, string> = {
  TEACHER: '授课老师',
  CAMPUS_MANAGER: '分校区管理员',
  PARTNER: '合作方',
  OPERATOR: '运营',
  HR: '总部人力',
  FINANCE: '总部财务',
};

Page({
  hidden: false, disposed: false, initial: true, generation: 0, owner: '',
  dialog: false, mutationPending: undefined as object | undefined,
  service: undefined as StaffAccountPort | undefined,
  creation: undefined as object | undefined,
  creationRetry: undefined as StaffCreationAttempt | undefined,
  campusRead: undefined as object | undefined, campusesReady: false,
  accountQuery: '',
  context: undefined as HeadquartersManagementContext | undefined,
  hq: undefined as HeadquartersWorkflow | undefined,
  lifecycle: undefined as HeadquartersLifecycleWorkflow | undefined,
  data: {
    ...headquartersInitial,
    ...lifecycleInitial,
    accountConfirming: false,
    hqMode: false,
    creationModes: ['校区及职能账号', '总部运营只读账号'],
    viewState: 'loading',
    errorMessage: '',
    keyword: '',
    accounts: [] as StaffAccountView[],
    page: 0, total: 0, totalPages: 0, pageLoading: false, pageError: '',
    campuses: [] as StaffCampusChoice[],
    roleOptions: ROLE_OPTIONS,
    createOpen: false,
    createName: '',
    createPhone: '',
    createRoleIndex: 0,
    createCampusIndex: 0,
    createCampusMissing: false,
    createHeadquarters: false,
    submitting: false,
    submittingId: '',
  },

  onLoad() {
    this.initial = true;
    void this.load();
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.context?.show(); this.lifecycle?.show();
    if (!this.lifecycle?.blocked()) this.hq?.show();
    if (this.initial) { this.initial = false; return; }
    this.setData({ submitting: Boolean(this.creation) });
    void this.load(true);
  },
  onHide() {
    this.hq?.hide(); this.lifecycle?.hide(); this.context?.hide();
    this.hidden = true; ++this.generation; this.dialog = false; this.campusRead = undefined;
    this.accountQuery = '';
    this.setData({ accounts: [], campuses: [], createName: '', createPhone: '', createOpen: false,
      page: 0, total: 0, totalPages: 0, pageLoading: false, pageError: '',
      submittingId: '', submitting: false, accountConfirming: false });
  },
  onUnload() { this.disposed = true; this.onHide(); this.hq?.clear(); this.lifecycle?.clear(); this.context?.dispose(); },
  active() { return !this.hidden && !this.disposed; },
  commandBlocked() { return Boolean(this.dialog || this.mutationPending || this.creation || this.hq?.blocked() || this.lifecycle?.blocked()); },
  interactionBlocked() { return Boolean(this.commandBlocked() || this.data.pageLoading || this.campusRead); },
  current(generation: number, owner: string) {
    if (!this.active() || generation !== this.generation || this.owner !== owner) return false;
    if (sessionKey() !== owner || !this.context?.current()) {
      this.clearPrivate('登录已更新，请重新读取账号');
      return false;
    }
    return true;
  },
  clearPrivate(errorMessage: string) {
    this.hq?.clear(); this.lifecycle?.clear();
    ++this.generation; this.dialog = false; this.creation = undefined; this.creationRetry = undefined;
    this.mutationPending = undefined;
    this.campusRead = undefined; this.campusesReady = false;
    this.accountQuery = '';
    this.setData({ accounts: [], campuses: [], keyword: '', createOpen: false, createName: '', createPhone: '',
      page: 0, total: 0, totalPages: 0, pageLoading: false, pageError: '',
      createRoleIndex: 0, createCampusIndex: 0, createCampusMissing: false, createHeadquarters: false, submitting: false, submittingId: '',
      accountConfirming: false, viewState: 'forbidden', errorMessage });
  },

  onKeywordInput(event: WechatMiniprogram.Input) {
    if (!this.current(this.generation, this.owner) || this.commandBlocked()) return;
    this.setData({ keyword: event.detail.value });
  },

  onSearch() {
    void this.loadAccounts();
  },

  async onPreviousPage() {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked() ||
      this.creation || this.data.viewState !== 'success' || this.data.page <= 1) return;
    await this.loadAccounts(this.data.page - 1, this.accountQuery);
  },

  async onNextPage() {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked() ||
      this.creation || this.data.viewState !== 'success' || this.data.page >= this.data.totalPages) return;
    await this.loadAccounts(this.data.page + 1, this.accountQuery);
  },

  onToggleCreate() {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked()) return;
    this.setData({ createOpen: !this.data.createOpen });
  },

  onNameInput(event: WechatMiniprogram.Input) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked()) return;
    this.setData({ createName: event.detail.value });
  },

  onPhoneInput(event: WechatMiniprogram.Input) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked()) return;
    this.setData({ createPhone: event.detail.value });
  },

  onRoleChange(event: WechatMiniprogram.PickerChange) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked()) return;
    const createRoleIndex = Number(event.detail.value);
    const role = ROLE_OPTIONS[createRoleIndex];
    if (!role) return;
    this.setData({
      createRoleIndex,
      createHeadquarters: role.value === 'HR' || role.value === 'FINANCE',
    });
  },
  onCreationModeChange(event: WechatMiniprogram.PickerChange) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked()) return;
    const value = Number(event.detail.value);
    if (value !== 0 && value !== 1) return;
    this.setData({ hqMode: value === 1 });
  },
  onHeadquartersAction(event: WechatMiniprogram.TouchEvent) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked()) return;
    const account = this.data.accounts.find(row => row.id === event.currentTarget.dataset.id);
    this.hq?.select(account);
  },
  onGrantCampusChange(event: WechatMiniprogram.PickerChange) { if (!this.interactionBlocked()) this.hq?.choose(Number(event.detail.value)); },
  onGrantValueChange(event: WechatMiniprogram.SwitchChange) { if (!this.interactionBlocked()) this.hq?.setDesired(event.detail.value); },
  onGrantConfirm() { if (!this.interactionBlocked()) this.hq?.grant(); },
  onRetryOriginal() { if (!this.lifecycle?.blocked() && !this.dialog && !this.creation && !this.mutationPending) this.hq?.retryOriginal(); },
  onReconcile() { if (!this.lifecycle?.blocked() && !this.dialog && !this.creation && !this.mutationPending) void this.hq?.reconcile(); },
  onCloseGrants() { if (!this.lifecycle?.blocked()) this.hq?.close(); },
  onLifecycleRetry() {
    if (!this.hq?.blocked() && !this.dialog && !this.creation && !this.mutationPending && !this.data.pageLoading) this.lifecycle?.retry();
  },
  onLifecycleReconcile() {
    if (!this.hq?.blocked() && !this.dialog && !this.creation && !this.mutationPending && !this.data.pageLoading) void this.lifecycle?.reconcile();
  },
  ensureContext() {
    if (this.context?.current()) return this.context;
    this.context?.dispose(); this.hq?.clear(); this.lifecycle?.clear();
    const context = new HeadquartersManagementContext(message => {
      if (this.context === context) this.clearPrivate(message);
    });
    this.context = context;
    this.hq = new HeadquartersWorkflow(context, patch => this.setData(patch), () => this.loadAccounts());
    this.lifecycle = new HeadquartersLifecycleWorkflow(context, patch => {
      if (this.context === context) this.setData(patch);
    }, row => {
      if (this.context !== context || !context.isActive()) return;
      this.setData({ accounts: this.data.accounts.map(account => account.id === row.id ? toAccountView(row) : account) });
      if (this.data.hqTarget?.id === row.id) void this.hq?.refresh();
    });
    return context;
  },

  onCampusChange(event: WechatMiniprogram.PickerChange) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked()) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !this.data.campuses[index]) return;
    this.setData({ createCampusIndex: index, createCampusMissing: false });
  },

  async load(internal = false) {
    if (!this.active()) return;
    const nextOwner = sessionKey();
    if (this.owner && this.owner !== nextOwner) this.clearPrivate('登录已更新，请重新读取账号');
    if (!internal && this.commandBlocked()) return;
    if (this.campusRead) return;
    const service = this.service = this.ensureContext().staff;
    const generation = ++this.generation; const owner = this.owner = nextOwner;
    const campusRead = {}; this.campusRead = campusRead; this.campusesReady = false;
    this.dialog = false;
    this.accountQuery = '';
    this.setData({ viewState: 'loading', errorMessage: '', accounts: [],
      page: 0, total: 0, totalPages: 0, pageLoading: false, pageError: '' });
    const choices: SuperAdminCampus[] = []; const ids = new Set<string>();
    let page = 1; let total: number | undefined;
    try {
      for (;;) {
        const campuses = await service.loadCampuses({ page, pageSize: 100 });
        if (!this.current(generation, owner)) return;
        if (campuses.status === 'error') {
          if ([401, 403].includes(Number(campuses.statusCode))) { this.clearPrivate(campuses.message); return; }
          this.setData({ viewState: 'error', errorMessage: campuses.message });
          return;
        }
        if (campuses.status !== 'success' && campuses.status !== 'empty') {
          this.setData({ viewState: 'error', errorMessage: '校区数据加载失败，请稍后重试' });
          return;
        }
        const rows = campuses.data?.data; const meta = campuses.data?.meta;
        if (!meta || !Array.isArray(rows) || meta.page !== page || meta.pageSize !== 100 ||
          !Number.isSafeInteger(meta.total) || meta.total < 0 || meta.totalPages !== Math.ceil(meta.total / 100) ||
          total !== undefined && total !== meta.total ||
          rows.length !== Math.min(100, Math.max(0, meta.total - (page - 1) * 100)) ||
          rows.some((row) => typeof row?.id !== 'string' || !row.id || row.id.length > 100 ||
            typeof row.name !== 'string' || row.name.length > 200 || ids.has(row.id)) ||
          new Set(rows.map((row) => row.id)).size !== rows.length) {
          this.setData({ viewState: 'error', errorMessage: '校区数据加载失败，请稍后重试' });
          return;
        }
        total = meta.total;
        choices.push(...rows); for (const row of rows) ids.add(row.id);
        if (choices.length === total) break;
        ++page;
      }
    } finally {
      if (this.campusRead === campusRead) this.campusRead = undefined;
    }
    if (!this.current(generation, owner)) return;
    const selected = !this.data.createCampusMissing && this.data.campuses[this.data.createCampusIndex];
    const index = selected ? choices.findIndex((row) => row.id === selected.id) : 0;
    const pickerChoices: StaffCampusChoice[] = choices.map(({ id, name }) => ({ id, name }));
    this.setData({ campuses: pickerChoices.slice(0, CAMPUS_VIEW_BATCH_SIZE) });
    for (let start = CAMPUS_VIEW_BATCH_SIZE; start < pickerChoices.length; start += CAMPUS_VIEW_BATCH_SIZE) {
      const patch: Record<string, StaffCampusChoice> = {};
      for (let offset = start; offset < Math.min(start + CAMPUS_VIEW_BATCH_SIZE, pickerChoices.length); ++offset)
        patch[`campuses[${offset}]`] = pickerChoices[offset];
      this.setData(patch);
    }
    this.campusesReady = true;
    this.setData({ createCampusIndex: Math.max(0, index),
      createCampusMissing: this.data.createCampusMissing || index < 0 });
    await this.loadAccounts(1, undefined, true, internal);
  },

  async loadAccounts(page = 1, requestedQuery?: string, allowRedirect = true, internal = false) {
    if (!this.active()) return;
    const nextOwner = sessionKey();
    if (this.owner && this.owner !== nextOwner) this.clearPrivate('登录已更新，请重新读取账号');
    if (!internal && this.commandBlocked()) return;
    if (!Number.isSafeInteger(page) || page < 1) return;
    const query = requestedQuery ?? this.data.keyword.trim();
    if (!this.campusesReady || this.owner && this.owner !== nextOwner) { await this.load(); return; }
    this.service = this.ensureContext().staff;
    const generation = ++this.generation; const owner = this.owner = nextOwner;
    this.dialog = false;
    const preserve = this.data.viewState === 'success' && this.data.page > 0 && query === this.accountQuery;
    this.setData({ viewState: preserve ? this.data.viewState : 'loading', errorMessage: '',
      pageLoading: true, pageError: '',
      ...(!preserve ? { accounts: [], page: 0, total: 0, totalPages: 0 } : {}) });
    const fail = (message: string) => {
      this.setData(preserve
        ? { pageLoading: false, pageError: message }
        : { pageLoading: false, viewState: 'error', errorMessage: message });
    };
    try {
      const state = await this.service.loadStaffAccounts({
        page, pageSize: 100, query: query || undefined,
      });
      if (!this.current(generation, owner)) return;
      if (state.status === 'error') {
        if ([401, 403].includes(Number(state.statusCode))) { this.clearPrivate(state.message); return; }
        fail(state.message); return;
      }
      if (state.status !== 'success' && state.status !== 'empty') {
        fail('账号数据加载失败，请稍后重试'); return;
      }
      const rows = state.data?.data; const meta = state.data?.meta;
      if (!meta || !Array.isArray(rows) || meta.page !== page || meta.pageSize !== 100 ||
        !Number.isSafeInteger(meta.total) || meta.total < 0 || meta.totalPages !== Math.ceil(meta.total / 100) ||
        rows.length !== Math.min(100, Math.max(0, meta.total - (page - 1) * 100)) ||
        rows.some((row) => typeof row?.id !== 'string' || !row.id) ||
        new Set(rows.map((row) => row.id)).size !== rows.length) {
        fail('账号数据加载失败，请稍后重试'); return;
      }
      if (page > Math.max(1, meta.totalPages)) {
        if (allowRedirect) await this.loadAccounts(Math.max(1, meta.totalPages), query, false, true);
        else fail('账号列表已变化，请重新查询');
        return;
      }
      const accounts = rows.map(toAccountView);
      this.accountQuery = query;
      this.setData({
        viewState: accounts.length ? 'success' : 'empty', accounts,
        page, total: meta.total, totalPages: meta.totalPages, pageLoading: false, pageError: '',
      });
    } catch {
      if (this.current(generation, owner)) fail('账号数据加载失败，请稍后重试');
    }
  },

  async onCreate() {
    const generation = this.generation; const owner = this.owner;
    if (!this.current(generation, owner) || this.interactionBlocked()) return;
    if (this.data.hqMode) { this.hq?.create(this.data.createName, this.data.createPhone); return; }
    if (this.hq?.blocked()) return;
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
    if (!role || (!headquarters && (!this.campusesReady || this.data.createCampusMissing || !campus))) {
      wx.showToast({ title: '请选择角色和所属校区', icon: 'none' });
      return;
    }

    const input: SuperAdminCreateStaffAccountInput = {
      displayName, phone, roleCode: role.value, campusId: headquarters ? null : campus.id,
    };
    let attempt = this.creationRetry;
    if (!attempt || attempt.owner !== owner || attempt.input.displayName !== input.displayName ||
      attempt.input.phone !== input.phone || attempt.input.roleCode !== input.roleCode ||
      attempt.input.campusId !== input.campusId) {
      attempt = { owner, input, key: createMutationKey('staff-account-create') };
      this.creationRetry = attempt;
    }
    const creation = attempt; this.creation = creation;
    this.setData({ submitting: true });
    let state: Awaited<ReturnType<StaffAccountPort['createStaffAccount']>>;
    try {
      state = await this.service!.createStaffAccount(attempt.input, attempt.key);
    } finally {
      if (this.creation === creation) this.creation = undefined;
      if (this.active() && this.owner === owner && sessionKey() === owner)
        this.setData({ submitting: Boolean(this.creation) });
    }
    if (!this.current(generation, owner)) return;
    if (state.status === 'success') {
      if (this.creationRetry === attempt) this.creationRetry = undefined;
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
      if ([401, 403].includes(Number(state.statusCode))) { this.clearPrivate(state.message); return; }
      const statusCode = Number(state.statusCode);
      if (statusCode >= 400 && statusCode < 500 && ![408, 429].includes(statusCode) &&
        this.creationRetry === attempt) this.creationRetry = undefined;
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  onStatusAction(event: WechatMiniprogram.TouchEvent) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked() ||
      this.data.pageLoading || this.data.viewState !== 'success') return;
    const id = String(event.currentTarget.dataset.id ?? '');
    const version = Number(event.currentTarget.dataset.version);
    const currentStatus = String(
      event.currentTarget.dataset.status ?? '',
    ) as StaffAccountStatus;
    const account = this.data.accounts.find((item) => item.id === id && item.version === version && item.status === currentStatus);
    const generation = this.generation; const owner = this.owner;
    if (!account || !account.manageable || !this.current(generation, owner)) return;
    if (account.headquartersOperator) { this.lifecycle?.start(account, 'status'); return; }
    const nextStatus: StaffAccountStatus =
      currentStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    this.dialog = true;
    this.setData({ accountConfirming: true });
    wx.showModal({
      title: nextStatus === 'DISABLED' ? '确认停用账号' : '确认启用账号',
      content:
        nextStatus === 'DISABLED'
          ? '停用后，该工作人员现有登录会话将立即失效。'
          : '启用后，该工作人员可继续使用已绑定微信登录。',
      confirmText: nextStatus === 'DISABLED' ? '停用' : '启用',
      confirmColor: nextStatus === 'DISABLED' ? '#a52720' : '#238760',
      success: ({ confirm }) => {
        if (!this.current(generation, owner) || !this.dialog) return;
        this.dialog = false;
        this.setData({ accountConfirming: false });
        if (confirm) void this.updateStatus(id, version, nextStatus, generation, owner);
      },
      fail: () => { if (this.current(generation, owner)) { this.dialog = false; this.setData({ accountConfirming: false }); } },
    });
  },

  async updateStatus(
    id: string,
    expectedVersion: number,
    status: StaffAccountStatus,
    requestedGeneration?: number,
    requestedOwner?: string,
  ) {
    const generation = requestedGeneration ?? this.generation; const owner = requestedOwner ?? this.owner;
    if (!this.current(generation, owner) || this.interactionBlocked() ||
        this.hq?.blocked() || !this.data.accounts.some((item) => item.id === id && item.version === expectedVersion && !item.headquartersOperator)) return;
    const mutation = this.mutationPending = {};
    this.setData({ submittingId: id });
    let state: Awaited<ReturnType<StaffAccountPort['updateStaffAccountStatus']>>;
    try {
      state = await this.service!.updateStaffAccountStatus(
        id, { status, expectedVersion }, createMutationKey('staff-account-status'),
      );
    } finally {
      if (this.mutationPending === mutation) {
        this.mutationPending = undefined;
        if (this.active() && sessionKey() === owner && this.data.submittingId === id)
          this.setData({ submittingId: '' });
      }
    }
    if (!this.current(generation, owner)) return;
    this.setData({ submittingId: '' });
    if (state.status === 'success') {
      await this.loadAccounts(this.data.page || 1, this.accountQuery);
      return;
    }
    if (state.status === 'error') {
      if ([401, 403].includes(Number(state.statusCode))) {
        this.clearPrivate(state.message);
        return;
      }
      wx.showToast({ title: state.message, icon: 'none' });
    }
  },

  onUnbindAction(event: WechatMiniprogram.TouchEvent) {
    if (!this.current(this.generation, this.owner) || this.interactionBlocked() ||
      this.data.pageLoading || this.data.viewState !== 'success') return;
    const id = String(event.currentTarget.dataset.id ?? '');
    const version = Number(event.currentTarget.dataset.version);
    const account = this.data.accounts.find((item) => item.id === id && item.version === version);
    if (!account || !account.manageable ||
      account.maskedPhone === '未绑定个人手机号' || account.bindingStatus !== 'BOUND' || this.data.submittingId) return;
    if (account.headquartersOperator) { this.lifecycle?.start(account, 'unbind'); return; }
    const generation = this.generation; const owner = this.owner;
    if (!this.current(generation, owner)) return;
    this.dialog = true;
    this.setData({ accountConfirming: true });
    wx.showModal({
      title: '确认解除微信绑定',
      content: '解除后，工作人员需要再次授权当前账号手机号才能登录。',
      confirmText: '解除绑定',
      confirmColor: '#a52720',
      success: ({ confirm }) => {
        if (!this.current(generation, owner) || !this.dialog) return;
        this.dialog = false;
        this.setData({ accountConfirming: false });
        if (confirm) void this.unbindWechat(id, version, generation, owner);
      },
      fail: () => { if (this.current(generation, owner)) { this.dialog = false; this.setData({ accountConfirming: false }); } },
    });
  },

  async unbindWechat(id: string, expectedVersion: number, requestedGeneration?: number, requestedOwner?: string) {
    const generation = requestedGeneration ?? this.generation; const owner = requestedOwner ?? this.owner;
    if (!this.current(generation, owner) || this.interactionBlocked()) return;
    const account = this.data.accounts.find((item) => item.id === id && item.version === expectedVersion);
    if (!account || account.headquartersOperator || this.hq?.blocked() ||
      account.maskedPhone === '未绑定个人手机号' || account.bindingStatus !== 'BOUND' || this.data.submittingId) return;
    const mutation = this.mutationPending = {};
    this.setData({ submittingId: id });
    let state: Awaited<ReturnType<StaffAccountPort['unbindStaffWechat']>>;
    try {
      state = await this.service!.unbindStaffWechat(
        id, { expectedVersion }, createMutationKey('staff-account-unbind'),
      );
    } finally {
      if (this.mutationPending === mutation) {
        this.mutationPending = undefined;
        if (this.active() && sessionKey() === owner && this.data.submittingId === id)
          this.setData({ submittingId: '' });
      }
    }
    if (!this.current(generation, owner)) return;
    this.setData({ submittingId: '' });
    if (state.status === 'success') {
      await this.loadAccounts(this.data.page || 1, this.accountQuery);
      return;
    }
    if (state.status === 'error') {
      if ([401, 403].includes(Number(state.statusCode))) {
        this.clearPrivate(state.message);
        return;
      }
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
    headquartersOperator: Boolean(headquartersAccount(account)),
    manageable: !('roles' in account) && ['ACTIVE', 'DISABLED'].includes(account.status) &&
      ['BOUND', 'UNBOUND'].includes(account.bindingStatus) && Number.isSafeInteger(account.version) && account.version > 0 &&
      (Boolean(headquartersAccount(account)) || (account.roleCode === 'HR' || account.roleCode === 'FINANCE'
        ? account.campusId === null : ['TEACHER', 'CAMPUS_MANAGER', 'PARTNER', 'OPERATOR'].includes(account.roleCode) &&
          typeof account.campusId === 'string' && Boolean(account.campusId.trim()))),
    roleLabel: headquartersAccount(account) ? '总部运营只读账号' : ROLE_LABELS[account.roleCode],
    statusLabel: account.status === 'ACTIVE' ? '已启用' : '已停用',
    bindingLabel: account.bindingStatus === 'BOUND' ? '微信已绑定' : '微信未绑定',
  };
}
