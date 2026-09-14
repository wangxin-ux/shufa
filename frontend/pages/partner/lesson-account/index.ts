import {
  buildPartnerLessonAccountPageModel,
  mergePartnerLessonAccountItems,
  PartnerLessonAccountItemModel,
  PartnerLessonAccountSummaryModel,
} from '../../../services/partner-lesson-account.presenter';
import { partnerService } from '../../../services/partner-runtime';

const PAGE_SIZE = 20;
let requestSequence = 0;
let campusTimeZone = 'Asia/Shanghai';

const EMPTY_SUMMARY: PartnerLessonAccountSummaryModel = {
  mainBalanceLabel: '0',
  giftBalanceLabel: '0',
  totalBalanceLabel: '0',
};

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    summary: EMPTY_SUMMARY,
    items: [] as PartnerLessonAccountItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    void this.initialize();
  },

  onPullDownRefresh() {
    void this.loadLessonAccount(true).finally(() => wx.stopPullDownRefresh());
  },

  async initialize() {
    const profileState = await partnerService.loadProfile();
    if (profileState.status === 'success' || profileState.status === 'empty') {
      campusTimeZone = profileState.data.campus.timezone;
    }
    await this.loadLessonAccount(true);
  },

  async loadLessonAccount(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    const sequence = ++requestSequence;
    this.setData(
      reset
        ? {
            viewState: 'loading',
            errorMessage: '',
            items: [],
            loadingMore: false,
          }
        : { loadingMore: true, errorMessage: '' },
    );
    const state = await partnerService.loadLessonAccount({
      page,
      pageSize: PAGE_SIZE,
    });
    if (sequence !== requestSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      const model = buildPartnerLessonAccountPageModel(
        state.data,
        campusTimeZone,
      );
      const items = mergePartnerLessonAccountItems(
        this.data.items,
        model.items,
        page,
      );
      this.setData({
        summary: model.summary,
        items,
        page: state.data.meta.page,
        total: state.data.meta.total,
        hasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
        viewState: items.length > 0 ? 'ready' : 'empty',
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
            ? '当前账号无权查看本校区课时账户'
            : state.message,
      });
    }
  },

  onRetry() {
    void this.loadLessonAccount(true);
  },

  onLoadMore() {
    void this.loadLessonAccount(false);
  },
});
