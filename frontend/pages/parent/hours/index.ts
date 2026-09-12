import {
  buildParentHoursPageModel,
  normalizeParentHoursFilter,
  ParentHoursFilter,
  ParentHoursPageModel,
} from '../../../services/parent-hours.presenter';
import { ParentPageLoader } from '../../../services/parent-page-loader';
import { parentService } from '../../../services/parent-runtime';
import { ParentHoursView } from '../../../types/parent';

const hoursLoader = new ParentPageLoader(() => parentService.loadHoursView());
let currentHoursView: ParentHoursView | null = null;

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
    filters: [
      { key: 'all', label: '全部' },
      { key: 'debit', label: '扣减' },
      { key: 'credit', label: '增加' },
    ],
  },

  onLoad() {
    void this.loadHours();
  },

  onPullDownRefresh() {
    void this.loadHours().finally(() => wx.stopPullDownRefresh());
  },

  async loadHours() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await hoursLoader.load();

    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
      currentHoursView = snapshot.data;
      const model = buildParentHoursPageModel(
        snapshot.data,
        normalizeParentHoursFilter(this.data.activeFilter),
      );
      this.setData({ ...model, viewState: 'ready', errorMessage: '' });
      return;
    }

    if (snapshot.status === 'error') {
      this.setData({ viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadHours();
  },

  onFilterTap(e: WechatMiniprogram.TouchEvent) {
    if (!currentHoursView) {
      return;
    }
    const filter = normalizeParentHoursFilter(e.currentTarget.dataset.filter);
    this.setData(buildParentHoursPageModel(currentHoursView, filter));
  },

  onRenewTap() {
    wx.showToast({ title: '当前为演示，续费流程待确认', icon: 'none' });
  },
});
