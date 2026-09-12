import { presentParentGroupCampaign } from '../../../services/parent-group-buying.presenter';
import { parentService } from '../../../services/parent-runtime';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    campaigns: [] as Array<ReturnType<typeof presentParentGroupCampaign>>,
  },
  onLoad() { void this.load(); },
  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await parentService.loadGroupCampaigns({ page: 1, pageSize: 20 });
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({
        viewState: state.data.data.length ? 'ready' : 'empty',
        campaigns: state.data.data.map(presentParentGroupCampaign),
      });
      return;
    }
    if (state.status === 'error') this.setData({ viewState: 'error', errorMessage: state.message });
  },
  onOpen(event: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: `/pages/parent/group-detail/index?id=${encodeURIComponent(String(event.currentTarget.dataset.id ?? ''))}` });
  },
  onOrders() { wx.navigateTo({ url: '/pages/parent/group-orders/index' }); },
  onRetry() { void this.load(); },
});
