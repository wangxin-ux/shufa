import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import { buildCampusMarkers, ParentCampusMarker } from '../../../services/parent-campus.presenter';
import { presentCourseCatalogItem } from '../../../services/parent-course-catalog.presenter';
import { parentService } from '../../../services/parent-runtime';
import { sessionService } from '../../../services/session.service';
import type { ParentCampusLocation } from '../../../types/parent';

type CourseRow = ReturnType<typeof presentCourseCatalogItem>;

Page({
  data: {
    contentHeight: 650,
    viewState: 'loading', errorMessage: '',
    mapState: 'loading', mapError: '',
    courses: [] as CourseRow[],
    activeCourse: null as CourseRow | null,
    campuses: [] as ParentCampusLocation[],
    markers: [] as ParentCampusMarker[],
    selectedCampus: null as ParentCampusLocation | null,
    mapLatitude: 0, mapLongitude: 0,
    includePoints: [] as Array<{ latitude: number; longitude: number }>,
  },
  disposed: false,
  loading: false,

  onLoad(options: { section?: string }) {
    void loadParentPdfDisplayFont();
    const win = wx.getWindowInfo();
    let headerBottom = (win.statusBarHeight ?? 20) + 60;
    try {
      const capsule = wx.getMenuButtonBoundingClientRect();
      if (capsule.height > 0) headerBottom = capsule.bottom + 16;
    } catch {
      // Match the page shell fallback when capsule geometry is unavailable.
    }
    const safeBottom = win.safeArea ? win.screenHeight - win.safeArea.bottom : 0;
    this.setData({ contentHeight: Math.max(420, win.windowHeight - headerBottom - safeBottom - 8) });
    void this.load(options.section === 'map');
  },
  onUnload() { this.disposed = true; },

  async load(showMap = false) {
    if (this.loading) return;
    this.loading = true;
    this.setData({ viewState: 'loading', mapState: 'loading', errorMessage: '', mapError: '', activeCourse: null });
    try {
      await Promise.all([this.loadCourses(), this.loadCampuses()]);
      if (showMap && !this.disposed && this.data.selectedCampus) this.selectCampus(this.data.selectedCampus.id);
    } finally {
      this.loading = false;
    }
  },

  handleAuthError(state: { statusCode?: number; code?: string }): boolean {
    if (state.statusCode !== 401 && state.code !== 'UNAUTHORIZED') return false;
    this.disposed = true;
    sessionService.logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
    return true;
  },

  async loadCourses() {
    const courses: CourseRow[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const state = await parentService.loadCourseCatalog({ page, pageSize: 100 });
      if (this.disposed) return;
      if (state.status === 'error') {
        if (this.handleAuthError(state)) return;
        this.setData({ viewState: 'error', errorMessage: state.message });
        return;
      }
      if (state.status !== 'success' && state.status !== 'empty') return;
      courses.push(...state.data.data.map(presentCourseCatalogItem));
      totalPages = state.data.meta.totalPages;
      page += 1;
    } while (page <= totalPages);
    this.setData({ courses, viewState: courses.length ? 'ready' : 'empty' });
  },

  async loadCampuses() {
    const campuses: ParentCampusLocation[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const state = await parentService.loadCampuses({ page, pageSize: 100 });
      if (this.disposed) return;
      if (state.status === 'error') {
        if (this.handleAuthError(state)) return;
        this.setData({ mapState: 'error', mapError: state.message });
        return;
      }
      if (state.status !== 'success' && state.status !== 'empty') return;
      campuses.push(...state.data.data);
      totalPages = state.data.meta.totalPages;
      page += 1;
    } while (page <= totalPages);
    this.setData({
      campuses, mapState: campuses.length ? 'ready' : 'empty',
      selectedCampus: null, markers: [],
      includePoints: campuses.map(({ latitude, longitude }) => ({ latitude, longitude })),
    });
    if (campuses.length) this.selectCampus(campuses[0].id);
  },

  onClassTypeTap(event: WechatMiniprogram.TouchEvent) {
    const name = String(event.currentTarget.dataset.name ?? '');
    this.setData({ activeCourse: this.data.activeCourse?.courseName === name
      ? null : this.data.courses.find((course) => course.courseName === name) ?? null });
  },
  onCloseQuotes() { this.setData({ activeCourse: null }); },
  onQuotePanelTap() {},
  selectCampus(id: string) {
    const selectedCampus = this.data.campuses.find((campus) => campus.id === id);
    if (!selectedCampus) return;
    this.setData({
      selectedCampus, mapLatitude: selectedCampus.latitude, mapLongitude: selectedCampus.longitude,
      markers: buildCampusMarkers(this.data.campuses, id),
      includePoints: [{ latitude: selectedCampus.latitude, longitude: selectedCampus.longitude }],
    });
  },
  onMarkerTap(event: WechatMiniprogram.MarkerTap) {
    const marker = this.data.markers.find((item) => item.id === event.detail.markerId);
    if (marker) this.selectCampus(marker.campusId);
  },
  onNavigateTap(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? this.data.selectedCampus?.id ?? '');
    const campus = this.data.campuses.find((item) => item.id === id);
    if (!campus) return;
    this.selectCampus(id);
    wx.openLocation({
      latitude: campus.latitude, longitude: campus.longitude,
      name: campus.name, address: campus.address, scale: 16,
      fail: () => wx.showToast({ title: '暂时无法打开地图导航', icon: 'none' }),
    });
  },
  onMoreCampuses() { wx.navigateTo({ url: '/pages/parent/campuses/index' }); },
  onOffersTap() { wx.navigateTo({ url: '/pages/parent/group-campaigns/index' }); },
  onRetry() { void this.load(); },
  onMapRetry() { void this.loadCampuses(); },
});
