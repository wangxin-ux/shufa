import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  buildPartnerAttendancePageModel,
  mergePartnerAttendanceItems,
  PartnerAttendanceItemModel,
  PartnerAttendanceSummaryModel,
} from '../../../services/partner-attendance.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { createSessionService } from '../../../services/session.service';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';

const PAGE_SIZE = 20;

const EMPTY_SUMMARY: PartnerAttendanceSummaryModel = {
  attendanceRateLabel: '暂无数据',
  presentCountLabel: '0',
  absentCountLabel: '0',
  leaveCountLabel: '0',
  recordedCountLabel: '0',
};

Page({
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingPage: 0,
  campusTimeZone: undefined as string | undefined,
  hidden: false,
  disposed: false,
  initialShowPending: false,
  runtime: undefined as ReturnType<typeof createPartnerService> | undefined,
  runtimeStopped: false,
  attendanceOwnerKey: '',
  pullSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    pageError: '',
    summary: EMPTY_SUMMARY,
    items: [] as PartnerAttendanceItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
  },

  onLoad() {
    if (this.runtimeStopped) return;
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.attendanceOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    void this.initialize();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.loadAttendance(true);
  },

  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed || this.runtimeStopped) return;
    const sequence = ++this.pullSequence;
    void this.loadAttendance(true).finally(() => {
      if (!this.hidden && !this.disposed && !this.runtimeStopped &&
        sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  initialize() {
    if (this.hidden || this.disposed || this.runtimeStopped) return Promise.resolve();
    if (!this.runtime) {
      this.runtime = createPartnerService();
      this.attendanceOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    }
    return this.loadAttendance(true);
  },

  invalidateAttendance(message: string) {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.campusTimeZone = undefined;
    this.setData({
      viewState: 'forbidden',
      errorMessage: message,
      summary: { ...EMPTY_SUMMARY },
      items: [],
      page: 0,
      total: 0,
      hasMore: false,
      loadingMore: false,
      refreshError: '',
      pageError: '',
    });
  },

  validateOwner() {
    if (!this.runtime || this.runtimeStopped) return false;
    if (getPartnerCampaignDraftService().getSessionKey() === this.attendanceOwnerKey) return true;
    this.invalidateAttendance('登录已更新，请重新登录');
    return false;
  },

  loadAttendance(reset: boolean): Promise<void> {
    if (this.hidden || this.disposed || this.runtimeStopped) return Promise.resolve();
    if (!this.runtime) return this.initialize();
    if (!this.validateOwner()) return Promise.resolve();
    if (!reset && (
      this.pendingRequest || !this.campusTimeZone || !this.data.hasMore ||
      this.data.refreshError || this.data.viewState !== 'ready'
    )) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    if (this.pendingRequest && this.pendingPage === page) return this.pendingRequest;
    const runtime = this.runtime;
    const sequence = ++this.requestSequence;
    const keepContent = !!this.campusTimeZone &&
      (this.data.viewState === 'ready' || this.data.viewState === 'empty');
    this.pendingPage = page;
    const current = () =>
      !this.hidden && !this.disposed && sequence === this.requestSequence && this.validateOwner();
    this.setData(
      reset
        ? {
            ...(keepContent ? {} : {
              viewState: 'loading',
              summary: { ...EMPTY_SUMMARY },
              items: [],
              page: 0,
              total: 0,
              hasMore: false,
            }),
            errorMessage: '',
            refreshError: '',
            pageError: '',
            loadingMore: false,
          }
        : { loadingMore: true, pageError: '' },
    );
    const fail = (failure: { message: string; statusCode?: number }) => {
      if (!current()) return;
      if (failure.statusCode === 401 || failure.statusCode === 403) {
        this.invalidateAttendance(failure.statusCode === 401
          ? '登录已失效，请重新登录'
          : '当前账号无权查看本校区出勤统计');
        return;
      }
      this.setData({
        loadingMore: false,
        ...(keepContent
          ? reset ? { refreshError: failure.message } : { pageError: failure.message }
          : { viewState: 'error', errorMessage: failure.message }),
      });
    };
    const request = Promise.resolve()
      .then(async () => {
        if (!current()) return;
        let timeZone = this.campusTimeZone;
        if (reset) {
          const profileState = await runtime.loadProfile();
          if (!current()) return;
          if (profileState.status === 'error') {
            fail(profileState);
            return;
          }
          if (profileState.status !== 'success' && profileState.status !== 'empty') return;
          timeZone = profileState.data.campus.timezone;
        }
        const state = await runtime.loadAttendance({ page, pageSize: PAGE_SIZE });
        if (!current()) return;
        if (state.status === 'success' || state.status === 'empty') {
          const model = buildPartnerAttendancePageModel(state.data, timeZone);
          const incoming = Array.from(new Map(model.items.map((item) => [item.id, item])).values());
          const items = mergePartnerAttendanceItems(this.data.items, incoming, page);
          this.campusTimeZone = timeZone;
          this.setData({
            summary: model.summary,
            items,
            page: state.data.meta.page,
            total: state.data.meta.total,
            hasMore: state.data.meta.page < state.data.meta.totalPages,
            loadingMore: false,
            viewState: items.length > 0 ? 'ready' : 'empty',
            errorMessage: '',
            refreshError: '',
            pageError: '',
          });
        } else if (state.status === 'error') {
          fail(state);
        }
      })
      .catch((error: unknown) => fail({
        message: '出勤统计加载失败，请重试',
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
      }))
      .finally(() => {
        if (sequence === this.requestSequence) {
          this.pendingRequest = undefined;
          this.pendingPage = 0;
        }
      });
    this.pendingRequest = request;
    return request;
  },

  onRetry() {
    void this.loadAttendance(true);
  },

  onLoadMore() {
    void this.loadAttendance(false);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateAttendance('登录已失效，请重新登录');
    this.pullSequence += 1;
    this.runtimeStopped = true;
    this.runtime = undefined;
    createSessionService().logout();
    try {
      wx.reLaunch({ url: '/pages/bootstrap/index' });
    } catch {
      // Keep reads stopped if native login navigation fails.
    }
  },
});
