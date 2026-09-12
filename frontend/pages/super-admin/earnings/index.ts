import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminTeacherEarning } from '../../../types/super-admin';
import { createMutationKey, formatLocalDateTime, formatMoneyFen } from '../../../utils/super-admin-format';

Page({
  data: { viewState: 'loading', errorMessage: '', reason: '', submittingId: '', entries: [] as Array<SuperAdminTeacherEarning & { amountLabel: string; timeLabel: string; statusLabel: string }> },
  onLoad() { void this.load(); },
  onReasonInput(event: WechatMiniprogram.Input) { this.setData({ reason: event.detail.value }); },
  async load() {
    const state = await superAdminService.loadTeacherEarnings({ page: 1, pageSize: 100 });
    if (state.status === 'success' || state.status === 'empty') this.setData({ viewState: state.status, entries: state.data.data.map((item) => ({ ...item, amountLabel: formatMoneyFen(item.amountFen), timeLabel: formatLocalDateTime(item.createdAt), statusLabel: { PENDING_REVIEW: '待审核', AVAILABLE: '可提现', REJECTED: '已驳回', REVERSED: '已冲正' }[item.status] })) });
    else if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message });
  },
  async onReview(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? ''); const action = String(event.currentTarget.dataset.action ?? '') as 'approve' | 'reject'; const version = Number(event.currentTarget.dataset.version);
    const reason = action === 'reject' ? this.data.reason.trim() : undefined;
    if (action === 'reject' && !reason) { wx.showToast({ title: '请先填写驳回原因', icon: 'none' }); return; }
    this.setData({ submittingId: id }); const state = await superAdminService.reviewTeacherEarning(id, action, version, reason, createMutationKey(`earning-${action}`)); this.setData({ submittingId: '' });
    if (state.status === 'success') { wx.showToast({ title: action === 'approve' ? '审核通过' : '已驳回', icon: 'success' }); void this.load(); }
    else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' });
  },
  onRetry() { void this.load(); },
});
