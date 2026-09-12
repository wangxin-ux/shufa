import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminWithdrawalPolicy } from '../../../types/super-admin';
import { createMutationKey, formatMoneyFen } from '../../../utils/super-admin-format';

Page({
  data: { viewState: 'loading', errorMessage: '', minimumYuan: '100', dailyLimit: '1', policies: [] as Array<SuperAdminWithdrawalPolicy & { amountLabel: string; statusLabel: string }>, submitting: false },
  onLoad() { void this.load(); },
  onMinimumInput(event: WechatMiniprogram.Input) { this.setData({ minimumYuan: event.detail.value }); },
  onLimitInput(event: WechatMiniprogram.Input) { this.setData({ dailyLimit: event.detail.value }); },
  async load() { const state = await superAdminService.loadWithdrawalPolicies({ page: 1, pageSize: 100 }); if (state.status === 'success' || state.status === 'empty') this.setData({ viewState: state.status, policies: state.data.data.map((item) => ({ ...item, amountLabel: formatMoneyFen(item.minimumAmountFen), statusLabel: { DRAFT: '草稿', ACTIVE: '生效中', RETIRED: '已退役' }[item.status] })) }); else if (state.status === 'error') this.setData({ viewState: 'error', errorMessage: state.message }); },
  async onCreate() { const amount = Math.round(Number(this.data.minimumYuan) * 100); const limit = Number(this.data.dailyLimit); if (!Number.isInteger(amount) || amount <= 0 || !Number.isInteger(limit) || limit <= 0) { wx.showToast({ title: '请填写有效策略参数', icon: 'none' }); return; } this.setData({ submitting: true }); const state = await superAdminService.createWithdrawalPolicy({ minimumAmountFen: amount, dailyRequestLimit: limit, effectiveFrom: new Date().toISOString() }, createMutationKey('withdrawal-policy-create')); this.setData({ submitting: false }); if (state.status === 'success') { wx.showToast({ title: '策略草稿已创建', icon: 'success' }); void this.load(); } else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' }); },
  async onTransition(event: WechatMiniprogram.TouchEvent) { const id = String(event.currentTarget.dataset.id ?? ''); const action = String(event.currentTarget.dataset.action ?? '') as 'activate' | 'retire'; const version = Number(event.currentTarget.dataset.version); const state = await superAdminService.transitionWithdrawalPolicy(id, action, version, createMutationKey(`withdrawal-policy-${action}`)); if (state.status === 'success') void this.load(); else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' }); },
  onRetry() { void this.load(); },
});
