import { presentParentGroupOrder } from '../../../services/parent-group-buying.presenter';
import { parentService } from '../../../services/parent-runtime';
import { GroupMemberStatus } from '../../../types/group-buying';

const STATUS_OPTIONS: Array<{ label: string; value?: GroupMemberStatus }> = [
  { label: '全部' }, { label: '待支付', value: 'PENDING_PAYMENT' },
  { label: '拼团中', value: 'PAID' }, { label: '已结算', value: 'SETTLED' },
  { label: '已退款', value: 'REFUNDED' },
];

Page({
  data: { viewState: 'loading', errorMessage: '', statusOptions: STATUS_OPTIONS, statusIndex: 0, orders: [] as Array<ReturnType<typeof presentParentGroupOrder>> },
  onLoad() { void this.load(); },
  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()); },
  onStatusChange(event: WechatMiniprogram.PickerChange) { this.setData({ statusIndex: Number(event.detail.value) }); void this.load(); },
  async load() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const status = this.data.statusOptions[this.data.statusIndex]?.value as GroupMemberStatus | undefined;
    const state = await parentService.loadGroupOrders({ page: 1, pageSize: 50, status });
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({ viewState: state.data.data.length ? 'ready' : 'empty', orders: state.data.data.map(presentParentGroupOrder) }); return;
    }
    if (state.status === 'error') this.setData({ viewState: 'error', errorMessage: state.message });
  },
  onOpen(event: WechatMiniprogram.TouchEvent) {
    const campaignId = String(event.currentTarget.dataset.campaign ?? '');
    const teamId = String(event.currentTarget.dataset.team ?? '');
    wx.navigateTo({ url: `/pages/parent/group-detail/index?id=${encodeURIComponent(campaignId)}&teamId=${encodeURIComponent(teamId)}` });
  },
  onRetry() { void this.load(); },
});
