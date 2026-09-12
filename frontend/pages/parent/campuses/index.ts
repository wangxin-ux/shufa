import {
  buildCampusMarkers,
  formatCampusDistance,
  ParentCampusMarker,
} from '../../../services/parent-campus.presenter';
import { parentService } from '../../../services/parent-runtime';
import { ParentCampusLocation, ParentCampusQuery } from '../../../types/parent';

type CampusMapState =
  | 'locating'
  | 'ready'
  | 'location-denied'
  | 'empty'
  | 'error';

type CampusCard = ParentCampusLocation & {
  distanceLabel: string;
  isNearest: boolean;
};

type MapPoint = Pick<ParentCampusLocation, 'latitude' | 'longitude'>;

const PAGE_SIZE = 100;

function isLocationPermissionDenied(error: WechatMiniprogram.GeneralCallbackResult): boolean {
  const message = error.errMsg.toLowerCase();
  return message.includes('auth deny') || message.includes('permission');
}

Page({
  data: {
    viewState: 'locating' as CampusMapState,
    errorMessage: '',
    locationMessage: '',
    permissionDenied: false,
    locationAvailable: false,
    userLatitude: 0,
    userLongitude: 0,
    mapLatitude: 0,
    mapLongitude: 0,
    campuses: [] as CampusCard[],
    selectedCampusId: '',
    selectedCampus: null as CampusCard | null,
    markers: [] as ParentCampusMarker[],
    includePoints: [] as MapPoint[],
  },

  onLoad() {
    this.locateAndLoad();
  },

  onPullDownRefresh() {
    this.locateAndLoad(() => wx.stopPullDownRefresh());
  },

  locateAndLoad(done?: () => void) {
    this.setData({
      viewState: 'locating',
      errorMessage: '',
      locationMessage: '',
    });
    wx.getLocation({
      type: 'gcj02',
      success: ({ latitude, longitude }) => {
        void this.loadCampuses(
          { latitude, longitude },
          false,
          false,
        ).finally(done);
      },
      fail: (error) => {
        void this.loadCampuses(
          undefined,
          true,
          isLocationPermissionDenied(error),
        ).finally(done);
      },
    });
  },

  async loadCampuses(
    location?: MapPoint,
    locationUnavailable = false,
    permissionDenied = false,
  ) {
    const campuses: ParentCampusLocation[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const query: ParentCampusQuery = {
        page,
        pageSize: PAGE_SIZE,
        ...(location ?? {}),
      };
      const state = await parentService.loadCampuses(query);
      if (state.status === 'error') {
        this.setData({
          viewState: 'error',
          errorMessage: state.message || '门店加载失败，请稍后重试',
        });
        return;
      }
      if (state.status !== 'success' && state.status !== 'empty') {
        this.setData({
          viewState: 'error',
          errorMessage: '门店加载失败，请稍后重试',
        });
        return;
      }
      campuses.push(...state.data.data);
      totalPages = state.data.meta.totalPages;
      page += 1;
    } while (page <= totalPages);

    if (campuses.length === 0) {
      this.setData({
        viewState: 'empty',
        campuses: [],
        markers: [],
        includePoints: [],
        selectedCampusId: '',
        selectedCampus: null,
      });
      return;
    }

    const cards = campuses.map((campus, index) => ({
      ...campus,
      distanceLabel: formatCampusDistance(campus.distanceMeters),
      isNearest: Boolean(location) && index === 0,
    }));
    const selectedCampus = cards[0];
    const includePoints = location
      ? [location, selectedCampus]
      : cards.map(({ latitude, longitude }) => ({ latitude, longitude }));

    this.setData({
      viewState: locationUnavailable ? 'location-denied' : 'ready',
      locationMessage: permissionDenied
        ? '定位权限未开启，门店暂按名称展示'
        : locationUnavailable
          ? '暂未获取到位置，门店按名称展示'
          : '',
      permissionDenied,
      locationAvailable: Boolean(location),
      userLatitude: location?.latitude ?? 0,
      userLongitude: location?.longitude ?? 0,
      mapLatitude: location?.latitude ?? selectedCampus.latitude,
      mapLongitude: location?.longitude ?? selectedCampus.longitude,
      campuses: cards,
      selectedCampusId: selectedCampus.id,
      selectedCampus,
      markers: buildCampusMarkers(cards, selectedCampus.id),
      includePoints,
      errorMessage: '',
    });
  },

  selectCampus(campusId: string) {
    const selectedCampus = this.data.campuses.find(({ id }) => id === campusId);
    if (!selectedCampus) return;

    const includePoints = this.data.locationAvailable
      ? [
          {
            latitude: this.data.userLatitude,
            longitude: this.data.userLongitude,
          },
          {
            latitude: selectedCampus.latitude,
            longitude: selectedCampus.longitude,
          },
        ]
      : this.data.campuses.map(({ latitude, longitude }) => ({
          latitude,
          longitude,
        }));

    this.setData({
      selectedCampusId: selectedCampus.id,
      selectedCampus,
      markers: buildCampusMarkers(this.data.campuses, selectedCampus.id),
      includePoints,
      mapLatitude: this.data.locationAvailable
        ? this.data.userLatitude
        : selectedCampus.latitude,
      mapLongitude: this.data.locationAvailable
        ? this.data.userLongitude
        : selectedCampus.longitude,
    });
  },

  onMarkerTap(event: WechatMiniprogram.MarkerTap) {
    const marker = this.data.markers.find(({ id }) => id === event.detail.markerId);
    if (marker) this.selectCampus(marker.campusId);
  },

  onCampusTap(event: WechatMiniprogram.TouchEvent) {
    this.selectCampus(String(event.currentTarget.dataset.id ?? ''));
  },

  onRelocateTap() {
    if (!this.data.permissionDenied) {
      this.locateAndLoad();
      return;
    }
    wx.openSetting({
      success: ({ authSetting }) => {
        if (authSetting['scope.userLocation']) {
          this.locateAndLoad();
          return;
        }
        wx.showToast({ title: '请先开启定位权限', icon: 'none' });
      },
      fail: () => wx.showToast({ title: '无法打开权限设置', icon: 'none' }),
    });
  },

  onRetry() {
    this.locateAndLoad();
  },

  onNavigateTap(event: WechatMiniprogram.TouchEvent) {
    const campus = this.findCampusFromEvent(event);
    if (!campus) return;
    this.selectCampus(campus.id);
    wx.openLocation({
      latitude: campus.latitude,
      longitude: campus.longitude,
      name: campus.name,
      address: campus.address,
      scale: 16,
      fail: () => wx.showToast({ title: '无法打开微信地图，请稍后重试', icon: 'none' }),
    });
  },

  onPhoneTap(event: WechatMiniprogram.TouchEvent) {
    const campus = this.findCampusFromEvent(event);
    if (!campus?.contactPhone) return;
    wx.makePhoneCall({
      phoneNumber: campus.contactPhone,
      fail: (error) => {
        if (!error.errMsg.toLowerCase().includes('cancel')) {
          wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' });
        }
      },
    });
  },

  findCampusFromEvent(event: WechatMiniprogram.TouchEvent): CampusCard | undefined {
    const campusId = String(
      event.currentTarget.dataset.id ?? this.data.selectedCampusId,
    );
    return this.data.campuses.find(({ id }) => id === campusId);
  },
});
