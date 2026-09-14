import { presentSuperAdminPartnerEarning } from '../../../services/super-admin-partner-earnings.presenter';
import { superAdminService } from '../../../services/super-admin-runtime';
import { PartnerEarningStatus } from '../../../types/super-admin';
import { createMutationKey } from '../../../utils/super-admin-format';

const PAGE_SIZE = 20;
let requestSequence = 0;

const STATUS_OPTIONS: Array<{
  label: string;
  value?: PartnerEarningStatus;
}> = [
  { label: '全部状态' },
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '可结算', value: 'AVAILABLE' },
  { label: '已驳回', value: 'REJECTED' },
  { label: '已冲正', value: 'REVERSED' },
];

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    reason: '',
    statusOptions: STATUS_OPTIONS,
    statusIndex: 1,
    entries: [] as Array<ReturnType<typeof presentSuperAdminPartnerEarning>>,
    submittingId: '',
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.load(true);
  },

  onReasonInput(event: WechatMiniprogram.Input) {
    this.setData({ reason: event.detail.value });
  },

  onStatusChange(event: WechatMiniprogram.PickerChange) {
    this.setData({ statusIndex: Number(event.detail.value) });
    void this.load(true);
  },

  async load(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: 'loading',
            errorMessage: '',
            entries: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );
    const status = this.data.statusOptions[this.data.statusIndex]?.value as
      | PartnerEarningStatus
      | undefined;
    const state = await superAdminService.loadPartnerEarnings({
      page,
      pageSize: PAGE_SIZE,
      status,
    });
    if (sequence !== requestSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      const nextEntries = state.data.data.map(presentSuperAdminPartnerEarning);
      const entries = reset
        ? nextEntries
        : [...this.data.entries, ...nextEntries];
      this.setData({
        entries,
        page: state.data.meta.page,
        total: state.data.meta.total,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: entries.length > 0 ? 'ready' : 'empty',
        errorMessage: '',
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        loadingMore: false,
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: state.message,
      });
    }
  },

  onReview(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const action = String(event.currentTarget.dataset.action ?? '') as
      | 'approve'
      | 'reject';
    const version = Number(event.currentTarget.dataset.version);
    const reason = action === 'reject' ? this.data.reason.trim() : undefined;
    if (action === 'reject' && !reason) {
      wx.showToast({ title: '请先填写驳回原因', icon: 'none' });
      return;
    }
    wx.showModal({
      title: action === 'approve' ? '确认审核通过' : '确认驳回',
      content:
        action === 'approve'
          ? '通过后该笔内部收益进入可结算状态。'
          : `驳回原因：${reason}`,
      confirmText: action === 'approve' ? '通过' : '驳回',
      success: ({ confirm }) => {
        if (confirm) void this.performReview(id, action, version, reason);
      },
    });
  },

  async performReview(
    id: string,
    action: 'approve' | 'reject',
    version: number,
    reason: string | undefined,
  ) {
    if (this.data.submittingId) return;
    this.setData({ submittingId: id });
    const state = await superAdminService.reviewPartnerEarning(
      id,
      action,
      version,
      reason,
      createMutationKey(`partner-earning-${action}`),
    );
    this.setData({ submittingId: '' });
    if (state.status === 'success') {
      wx.showToast({
        title: action === 'approve' ? '审核通过' : '已驳回',
        icon: 'success',
      });
      this.setData({ reason: '' });
      void this.load(true);
    } else if (state.status === 'error') {
      wx.showToast({ title: state.message, icon: 'none' });
      void this.load(true);
    }
  },

  onRetry() {
    void this.load(true);
  },

  onLoadMore() {
    void this.load(false);
  },
});
