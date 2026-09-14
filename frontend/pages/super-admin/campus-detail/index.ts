import { superAdminService } from '../../../services/super-admin-runtime';
import { SuperAdminCampusDetail } from '../../../types/super-admin';
import { presentLessonBalance } from '../../../services/lesson-availability';
import {
  createMutationKey,
  formatLessonUnits,
} from '../../../utils/super-admin-format';

interface MapDraft {
  address: string;
  latitude: number | null;
  longitude: number | null;
  mapVisible: boolean;
}

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    campusId: '',
    campus: null as SuperAdminCampusDetail | null,
    mainLessons: '0',
    giftLessons: '0',
    reservationLabel: '',
    mapDraft: {
      address: '',
      latitude: null,
      longitude: null,
      mapVisible: false,
    } as MapDraft,
    mapReady: false,
    submittingMap: false,
    uploadingQr: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ campusId: options.id ?? '' });
    void this.load();
  },

  async load() {
    if (!this.data.campusId) {
      this.setData({ viewState: 'error', errorMessage: '缺少校区标识' });
      return;
    }
    const state = await superAdminService.loadCampus(this.data.campusId);
    if (state.status === 'success') {
      const campus = state.data;
      const mapReady =
        Boolean(campus.address) &&
        campus.latitude !== null &&
        campus.longitude !== null;
      this.setData({
        viewState: 'ready',
        campus,
        mainLessons: presentLessonBalance(campus).mainBalanceLabel,
        giftLessons: presentLessonBalance(campus).giftBalanceLabel,
        reservationLabel: presentLessonBalance(campus).reservationLabel ?? '',
        mapDraft: {
          address: campus.address ?? '',
          latitude: campus.latitude,
          longitude: campus.longitude,
          mapVisible: mapReady && campus.mapVisible,
        },
        mapReady,
      });
    } else if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage: state.message,
      });
    }
  },

  onChooseLocation() {
    wx.chooseLocation({
      success: (location) => {
        const address = (location.address || location.name || '').trim();
        if (!address) {
          wx.showToast({ title: '该位置缺少地址信息', icon: 'none' });
          return;
        }
        this.setData({
          mapDraft: {
            ...this.data.mapDraft,
            address,
            latitude: location.latitude,
            longitude: location.longitude,
          },
          mapReady: true,
        });
      },
    });
  },

  onMapVisibleChange(event: WechatMiniprogram.SwitchChange) {
    if (!this.data.mapReady) return;
    this.setData({
      mapDraft: {
        ...this.data.mapDraft,
        mapVisible: Boolean(event.detail.value),
      },
    });
  },

  async onSaveMapLocation() {
    const campus = this.data.campus;
    const draft = this.data.mapDraft;
    if (!campus || !this.data.mapReady || this.data.submittingMap) return;
    if (draft.latitude === null || draft.longitude === null) return;

    this.setData({ submittingMap: true });
    const state = await superAdminService.updateCampusMapLocation(
      campus.id,
      {
        address: draft.address,
        latitude: draft.latitude,
        longitude: draft.longitude,
        mapVisible: draft.mapVisible,
        expectedVersion: campus.version,
      },
      createMutationKey('campus-map-location'),
    );
    this.setData({ submittingMap: false });

    if (state.status === 'success') {
      const updated = state.data;
      this.setData({
        campus: { ...campus, ...updated },
        mapDraft: {
          address: updated.address,
          latitude: updated.latitude,
          longitude: updated.longitude,
          mapVisible: updated.mapVisible,
        },
      });
      wx.showToast({ title: '地图配置已保存', icon: 'success' });
    } else if (state.status === 'error') {
      wx.showToast({
        title:
          state.statusCode === 409
            ? '配置已更新，请刷新后重试'
            : state.message,
        icon: 'none',
      });
    }
  },

  onChooseCustomerServiceQr() {
    const campus = this.data.campus;
    if (!campus || this.data.uploadingQr) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => {
        const filePath = result.tempFiles[0]?.tempFilePath;
        if (filePath) void this.uploadCustomerServiceQr(filePath);
      },
    });
  },

  async uploadCustomerServiceQr(filePath: string) {
    const campus = this.data.campus;
    if (!campus || this.data.uploadingQr) return;
    this.setData({ uploadingQr: true });
    const state = await superAdminService.uploadCampusCustomerServiceQr(
      campus.id,
      filePath,
      campus.version,
      createMutationKey('campus-customer-service-qr'),
    );
    this.setData({ uploadingQr: false });
    if (state.status === 'success') {
      this.setData({
        campus: {
          ...campus,
          customerServiceQrCodeUrl: state.data.customerServiceQrCodeUrl,
          version: state.data.version,
        },
      });
      wx.showToast({ title: '客服二维码已更新', icon: 'success' });
    } else if (state.status === 'error') {
      wx.showToast({
        title:
          state.statusCode === 409
            ? '配置已更新，请刷新后重试'
            : state.message,
        icon: 'none',
      });
    }
  },

  onPreviewCustomerServiceQr() {
    const url = this.data.campus?.customerServiceQrCodeUrl;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },

  onLedgerTap() {
    wx.navigateTo({
      url: `/pages/super-admin/lesson-ledger/index?campusId=${encodeURIComponent(this.data.campusId)}`,
    });
  },

  onRetry() {
    void this.load();
  },
});
