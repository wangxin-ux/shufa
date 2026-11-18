import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  PARTNER_REPORT_PERIOD_OPTIONS,
  buildPartnerOperationsPageModel,
  buildPartnerPeriodQuery,
  formatPartnerPeriodLabel,
  todayPartnerAnchorDate,
} from '../../../services/partner-operations.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { createSessionService } from '../../../services/session.service';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import { PartnerReportPeriod } from '../../../types/partner';

type OperationsModel = ReturnType<typeof buildPartnerOperationsPageModel>;

Page({
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingKey: '',
  contentKey: '',
  hidden: false,
  disposed: false,
  initialShowPending: false,
  runtime: undefined as ReturnType<typeof createPartnerService> | undefined,
  operationsOwnerKey: '',
  pullSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    periodOptions: PARTNER_REPORT_PERIOD_OPTIONS,
    periodIndex: 1,
    anchorDate: todayPartnerAnchorDate(),
    periodLabel: formatPartnerPeriodLabel('MONTH', todayPartnerAnchorDate()),
    summary: null as OperationsModel | null,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.operationsOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    void this.loadOperations();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.loadOperations();
  },

  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingKey = '';
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed || !this.runtime) return;
    const sequence = ++this.pullSequence;
    void this.loadOperations().finally(() => {
      if (!this.hidden && !this.disposed && this.runtime &&
        sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  invalidateOperations(message: string) {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingKey = '';
    this.contentKey = '';
    this.setData({
      viewState: 'forbidden', errorMessage: message,
      summary: null, refreshError: '',
    });
  },

  validateOwner() {
    if (!this.runtime) return false;
    if (getPartnerCampaignDraftService().getSessionKey() === this.operationsOwnerKey) return true;
    this.invalidateOperations('登录已更新，请重新登录');
    return false;
  },

  onPeriodTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const period = String(
      event.currentTarget.dataset.period ?? '',
    ) as PartnerReportPeriod;
    const periodIndex = this.data.periodOptions.findIndex(
      (item) => item.value === period,
    );
    if (periodIndex < 0 || periodIndex === this.data.periodIndex) return;
    this.setData({
      periodIndex,
      periodLabel: formatPartnerPeriodLabel(period, this.data.anchorDate),
    });
    void this.loadOperations();
  },

  onAnchorDateChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const anchorDate = String(event.detail.value);
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    this.setData({
      anchorDate,
      periodLabel: formatPartnerPeriodLabel(period, anchorDate),
    });
    void this.loadOperations();
  },

  loadOperations(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    const runtime = this.runtime;
    const period = this.data.periodOptions[this.data.periodIndex]
      .value as PartnerReportPeriod;
    const query = buildPartnerPeriodQuery(period, this.data.anchorDate);
    const key = JSON.stringify(query);
    if (this.pendingRequest && this.pendingKey === key) return this.pendingRequest;
    const sequence = ++this.requestSequence;
    const keepContent = this.contentKey === key && this.data.summary !== null;
    this.pendingKey = key;
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading', summary: null }),
      errorMessage: '',
      refreshError: '',
    });
    const current = () =>
      !this.hidden && !this.disposed && sequence === this.requestSequence && this.validateOwner();
    const fail = (failure: { statusCode?: number; message: string }) => {
      if (!current()) return;
      if (failure.statusCode === 401 || failure.statusCode === 403) {
        this.invalidateOperations(failure.statusCode === 401
          ? '登录已失效，请重新登录'
          : '当前账号无权查看本校区经营统计');
        return;
      }
      this.setData(keepContent
        ? { refreshError: failure.message }
        : { viewState: 'error', errorMessage: failure.message, summary: null });
    };
    const request = Promise.resolve()
      .then(() => {
        if (!current()) return;
        return runtime.loadOperationsSummary(query);
      })
      .then((state) => {
        if (!state || !current()) return;
        if (state.status === 'success' || state.status === 'empty') {
          const summary = buildPartnerOperationsPageModel(state.data);
          this.contentKey = key;
          this.setData({
            viewState: state.status === 'success' ? 'ready' : 'empty',
            errorMessage: '',
            refreshError: '',
            periodLabel: formatPartnerPeriodLabel(state.data.period, state.data.anchorDate),
            summary,
          });
          return;
        }
        if (state.status === 'error') {
          fail(state);
        }
      })
      .catch((error: unknown) => fail({
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
        message: '经营统计加载失败，请重试',
      }))
      .finally(() => {
        if (sequence === this.requestSequence) {
          this.pendingRequest = undefined;
          this.pendingKey = '';
        }
      });
    this.pendingRequest = request;
    return request;
  },

  onRetry() {
    void this.loadOperations();
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateOperations('登录已失效，请重新登录');
    this.pullSequence += 1;
    this.runtime = undefined;
    createSessionService().logout();
    try {
      wx.reLaunch({ url: '/pages/bootstrap/index' });
    } catch {
      // The old page stays stopped when native login navigation fails.
    }
  },
});
