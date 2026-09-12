import { superAdminService } from '../../../services/super-admin-runtime';

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    displayName: '',
    campusName: '',
  },
  onLoad() { void this.load(); },
  async load() { const state = await superAdminService.loadProfile(); if (state.status === 'success') this.setData({ viewState: 'ready', displayName: state.data.displayName, campusName: state.data.campusName }); else if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message }); },
  onNavigate(event: WechatMiniprogram.TouchEvent) { wx.navigateTo({ url: String(event.currentTarget.dataset.url ?? '') }); },
  onRetry() { void this.load(); },
});
