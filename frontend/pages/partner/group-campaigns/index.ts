import { presentGroupPromotionCampaign } from '../../../services/group-promotion.presenter';
import { partnerService } from '../../../services/partner-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    campaigns: [] as Array<ReturnType<typeof presentGroupPromotionCampaign>>,
    page: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.load(true);
  },

  onPullDownRefresh() {
    void this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    void this.load(false);
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
            campaigns: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );

    const state = await partnerService.loadGroupPromotionCampaigns({
      page,
      pageSize: PAGE_SIZE,
    });
    if (sequence !== requestSequence) return;

    if (state.status === 'success' || state.status === 'empty') {
      const next = state.data.data.map(presentGroupPromotionCampaign);
      const campaigns = reset ? next : [...this.data.campaigns, ...next];
      this.setData({
        campaigns,
        page: state.data.meta.page,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: campaigns.length ? 'ready' : 'empty',
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
            ? '当前账号无权查看本校区活动'
            : state.message,
      });
    }
  },

  onOpen(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!id) return;
    wx.navigateTo({
      url: `/pages/partner/group-detail/index?id=${encodeURIComponent(id)}`,
    });
  },

  onRetry() {
    void this.load(true);
  },
});
