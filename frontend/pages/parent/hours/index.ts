import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import {
  buildParentHoursPageModel,
  normalizeParentHoursFilter,
  ParentHoursPageModel,
} from '../../../services/parent-hours.presenter';
import { parentService } from '../../../services/parent-runtime';
import { sessionService } from '../../../services/session.service';

const EMPTY_MODEL: ParentHoursPageModel = {
  grossTotal: 0,
  reservedPaidHours: 0,
  reservedGiftHours: 0,
  hasReservations: false,
  remainingTotal: 0,
  paidAmountLabel: '¥0.00',
  validUntilLabel: '',
  hourCards: [],
  entries: [],
  activeFilter: 'all',
  isEmpty: true,
};

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    ...EMPTY_MODEL,
    subjectOptions: ['全部科目'],
    subjectIndex: 0,
    selectedCourseName: '',
    showFilters: false,
    page: 1,
    hasMore: false,
    loadingMore: false,
    paginationError: '',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'debit', label: '扣减' },
      { key: 'credit', label: '增加' },
    ],
  },
  disposed: false,
  requestVersion: 0,

  onLoad() {
    void loadParentPdfDisplayFont();
    void this.loadHours();
  },
  onShow() {
    if (this.data.viewState === 'ready' || this.data.viewState === 'error') void this.loadHours();
  },
  onUnload() { this.disposed = true; this.requestVersion += 1; },
  onReachBottom() { void this.loadMore(); },

  onPullDownRefresh() {
    void this.loadHours().finally(() => wx.stopPullDownRefresh());
  },

  async loadHours(append = false) {
    const version = ++this.requestVersion;
    const page = append ? this.data.page + 1 : 1;
    const direction = normalizeParentHoursFilter(this.data.activeFilter);
    const courseName = this.data.selectedCourseName;
    this.setData(append ? { loadingMore: true, paginationError: '' } :
      { viewState: 'loading', errorMessage: '', loadingMore: false, paginationError: '' });
    const snapshot = await parentService.loadHoursView({
      page, pageSize: 20, direction, ...(courseName ? { courseName } : {}),
    });
    if (this.disposed || version !== this.requestVersion) return;

    if (snapshot.status === 'success' || snapshot.status === 'empty') {
      const model = buildParentHoursPageModel(
        snapshot.data,
        direction,
      );
      for (const card of model.hourCards) {
        if (!card.hasKnownGrant) continue;
        // Reserve the unit inside 276rpx: 276 - 2 * (28 - 14) - 53 = 195.
        card.valueSize = Math.min(card.valueSize,
          Math.floor(195 / (card.grantedLabel.length * 0.72)));
      }
      const entries = append ? [...this.data.entries, ...model.entries] : model.entries;
      const subjectOptions = ['全部科目', ...(snapshot.data.courseNames ?? [])];
      const hasLongBalance = model.remainingTotal >= 100 || model.paidAmountLabel.length > 10;
      this.setData({ ...model, entries, isEmpty: entries.length === 0,
        balanceValueSize: hasLongBalance ? Math.min(155, Math.floor(220 / (String(model.remainingTotal).length * 0.72))) :
          Math.min(155, Math.floor(360 / String(model.remainingTotal).length)),
        subjectOptions, subjectIndex: Math.max(0, subjectOptions.indexOf(courseName || '全部科目')),
        viewState: 'ready', errorMessage: '', page,
        hasMore: page < (snapshot.data.meta?.totalPages ?? 1), loadingMore: false,
      });
      return;
    }

    if (snapshot.status === 'error') {
      if (snapshot.statusCode === 401 || snapshot.code === 'UNAUTHORIZED') {
        this.disposed = true;
        sessionService.logout();
        wx.reLaunch({ url: '/pages/bootstrap/index' });
        return;
      }
      this.setData(append ? { loadingMore: false, paginationError: snapshot.message } :
        { viewState: 'error', errorMessage: snapshot.message });
    }
  },
  async loadMore() {
    if (!this.data.hasMore || this.data.loadingMore || this.data.viewState !== 'ready') return;
    await this.loadHours(true);
  },

  onRetry() {
    void this.loadHours();
  },

  onFilterTap(e: WechatMiniprogram.TouchEvent) {
    const filter = normalizeParentHoursFilter(e.currentTarget.dataset.filter);
    this.setData({ activeFilter: filter });
    void this.loadHours();
  },
  onToggleFilters() { this.setData({ showFilters: !this.data.showFilters }); },
  onSubjectChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.subjectOptions.length) return;
    this.setData({ subjectIndex: index, selectedCourseName: index ? this.data.subjectOptions[index] : '' });
    void this.loadHours();
  },

  onRenewTap() {
    wx.navigateTo({ url: '/pages/parent/courses/index' });
  },
});
