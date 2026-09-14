import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminCampus } from '../../../types/super-admin';

Page({
  data: { viewState: 'loading', errorMessage: '', keyword: '', campuses: [] as SuperAdminCampus[] },
  onLoad() { void this.load(); },
  onKeywordInput(event: WechatMiniprogram.Input) { this.setData({ keyword: event.detail.value }); },
  onSearch() { void this.load(); },
  async load() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await superAdminService.loadCampuses({ page: 1, pageSize: 100, query: this.data.keyword.trim() || undefined });
    if (state.status === 'success' || state.status === 'empty') this.setData({ viewState: state.status, campuses: state.data.data });
    else if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message });
  },
  onCampusTap(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: `/pages/super-admin/campus-detail/index?id=${encodeURIComponent(String(event.currentTarget.dataset.id ?? ''))}` }); },
  onRetry() { void this.load(); },
});
