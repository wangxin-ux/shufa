import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  mergePartnerLessonAccountItems,
  PartnerLessonAccountSummaryModel,
} from '../../../services/partner-lesson-account.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { createSessionService } from '../../../services/session.service';
import {
  PARTNER_LESSON_FILTERS, createPartnerLessonService, PartnerLessonQuery,
} from '../runtime/partner-lesson-runtime';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import type { RequestState } from '../../../utils/request-state';
import type { PartnerProfile } from '../../../types/partner';
import {
  buildPartnerLessonContextPageModel,
  PartnerLessonContextItemModel,
} from '../runtime/partner-lesson-context.presenter';
import { presentPartnerAccountEarning } from '../runtime/partner-account-earnings.presenter';
import { presentPartnerEarningSummary } from '../../../services/partner-earnings.presenter';

const PAGE_SIZE = 20;
const baseSubjects = () => [{ value: '', label: '全部科目' }, { value: 'UNCLASSIFIED', label: '未归类' }];

Page({
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingPage: 0,
  campusTimeZone: 'Asia/Shanghai',
  hidden: false,
  disposed: false,
  initialShowPending: false,
  navigating: false,
  navigationSequence: 0,
  runtime: undefined as ReturnType<typeof createPartnerService> | undefined,
  lessonRuntime: undefined as ReturnType<typeof createPartnerLessonService> | undefined,
  accountOwnerKey: '',
  accountStopped: false,
  earningPreviewSequence: 0,
  earningPreviewPending: undefined as Promise<void> | undefined,
  earningAccountSequence: 0,
  earningAccountPending: undefined as Promise<void> | undefined,
  subjectSequence: 0,
  subjectPending: undefined as Promise<void> | undefined,
  accountProfileRead: undefined as Promise<RequestState<PartnerProfile> | undefined> | undefined,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    pageError: '',
    summary: null as PartnerLessonAccountSummaryModel | null,
    items: [] as PartnerLessonContextItemModel[],
    page: 0,
    total: 0,
    hasMore: false,
    loadingMore: false,
    ledgerLoading: false,
    entryType: '' as NonNullable<PartnerLessonQuery['entryType']> | '',
    entryTypeIndex: 0,
    entryTypeOptions: PARTNER_LESSON_FILTERS,
    subjectId: '',
    subjectIndex: 0,
    subjectOptions: baseSubjects(),
    subjectError: '',
    subjectsLoading: false,
    earningPreviewState: 'loading',
    earningPreviewError: '',
    earningPreviewItems: [] as Array<ReturnType<typeof presentPartnerAccountEarning>>,
    earningAccountState: 'loading',
    earningAccountError: '',
    earningAccount: null as ReturnType<typeof presentPartnerEarningSummary> | null,
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.runtime = createPartnerService();
    this.lessonRuntime = createPartnerLessonService();
    this.accountOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    void this.refreshAccount();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    this.navigating = false;
    this.navigationSequence += 1;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.refreshAccount();
  },

  onHide() {
    this.hidden = true;
    this.navigating = false;
    this.navigationSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.earningPreviewSequence += 1;
    this.earningPreviewPending = undefined;
    this.earningAccountSequence += 1;
    this.earningAccountPending = undefined;
    this.subjectSequence += 1;
    this.subjectPending = undefined;
    this.accountProfileRead = undefined;
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    void this.refreshAccount().finally(() => wx.stopPullDownRefresh());
  },

  onRankingForbidden(event: { detail: { message?: string } }) {
    if (this.hidden || this.disposed) return;
    this.invalidateAccount(event.detail.message || '当前账号无权查看月榜，请重新登录');
  },

  invalidateAccount(message: string) {
    this.accountStopped = true;
    this.requestSequence += 1;
    this.navigationSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.navigating = false;
    this.earningPreviewSequence += 1;
    this.earningPreviewPending = undefined;
    this.earningAccountSequence += 1;
    this.earningAccountPending = undefined;
    this.subjectSequence += 1;
    this.subjectPending = undefined;
    this.accountProfileRead = undefined;
    this.campusTimeZone = 'Asia/Shanghai';
    this.setData({
      viewState: 'forbidden', errorMessage: message,
      summary: null, items: [], page: 0, total: 0, hasMore: false,
      refreshError: '', pageError: '', loadingMore: false, ledgerLoading: false,
      earningPreviewState: 'loading', earningPreviewError: '', earningPreviewItems: [],
      earningAccountState: 'loading', earningAccountError: '', earningAccount: null,
      subjectId: '', subjectIndex: 0, subjectOptions: [], subjectError: '', subjectsLoading: false,
    });
  },

  validateOwner() {
    if (this.accountStopped) return false;
    if (!this.accountOwnerKey ||
      getPartnerCampaignDraftService().getSessionKey() === this.accountOwnerKey) return true;
    this.invalidateAccount('登录已更新，请重新登录');
    return false;
  },

  loadLessonAccount(reset: boolean): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() ||
      !this.runtime || !this.lessonRuntime) return Promise.resolve();
    if (this.pendingRequest && (!reset || this.pendingPage === 1)) return this.pendingRequest;
    if (!reset && (!this.data.hasMore || this.data.refreshError || this.data.viewState !== 'ready')) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    const query: PartnerLessonQuery = {
      page, pageSize: PAGE_SIZE,
      ...(this.data.entryType ? { entryType: this.data.entryType } : {}),
      ...(this.data.subjectId ? { subjectId: this.data.subjectId } : {}),
    };
    const runtime = this.runtime;
    const lessonRuntime = this.lessonRuntime;
    const sequence = ++this.requestSequence;
    const current = () => !this.hidden && !this.disposed &&
      sequence === this.requestSequence && this.validateOwner();
    const keepContent = this.data.summary !== null;
    this.pendingPage = page;
    this.setData(
      reset
        ? {
            ...(keepContent
              ? (this.data.items.length === 0 ? { viewState: 'ready' } : {})
              : { viewState: 'loading', items: [], summary: null, page: 0, total: 0, hasMore: false }),
            ledgerLoading: keepContent && this.data.items.length === 0,
            errorMessage: '',
            refreshError: '',
            pageError: '',
            loadingMore: false,
          }
        : { loadingMore: true, pageError: '' },
    );
    const request = Promise.resolve().then(async () => {
      if (!current()) return;
      const rejected = (error: unknown) => ({
        status: 'error' as const,
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
        message: '课时流水加载失败，请重试',
      });
      const read = async <T>(load: () => Promise<RequestState<T>>) => {
        const result = await Promise.resolve().then(() => {
          if (!current()) return;
          return load();
        }).catch(rejected);
        if (!result || !current()) return result;
        if (result.status === 'error' && (result.statusCode === 401 || result.statusCode === 403)) {
          this.invalidateAccount(result.statusCode === 401
            ? '登录已失效，请重新登录' : '当前账号无权查看本校区课时账户');
        }
        return result;
      };
      const profileRead = reset ? read(() => runtime.loadProfile()) : undefined;
      if (profileRead) this.accountProfileRead = profileRead;
      const [profile, state] = await Promise.all([
        profileRead,
        read(() => lessonRuntime.loadLessonAccount(query)),
      ]);
      if (!state || !current()) return;
      const failure = profile?.status === 'error' ? profile : state.status === 'error' ? state : null;
      if (failure) {
        this.setData({
          loadingMore: false,
          ...(keepContent
            ? (reset ? { refreshError: failure.message } : { pageError: failure.message })
            : { viewState: 'error', errorMessage: failure.message }),
        });
        return;
      }
      if (profile?.status === 'success' || profile?.status === 'empty') {
        this.campusTimeZone = profile.data.campus.timezone;
      }
      if (state.status === 'success' || state.status === 'empty') {
        const model = buildPartnerLessonContextPageModel(state.data, this.campusTimeZone);
        const items = mergePartnerLessonAccountItems(this.data.items, model.items, page);
        this.setData({
          summary: model.summary, items,
          page: state.data.meta.page,
          total: state.data.meta.total,
          hasMore: state.data.meta.page < state.data.meta.totalPages,
          loadingMore: false,
          viewState: items.length > 0 ? 'ready' : 'empty',
          errorMessage: '', refreshError: '', pageError: '',
        });
      }
    }).finally(() => {
      if (sequence === this.requestSequence) {
        this.pendingRequest = undefined;
        this.pendingPage = 0;
        if (!this.hidden && !this.disposed) this.setData({ ledgerLoading: false });
      }
    });
    this.pendingRequest = request;
    return request;
  },

  onRetry() {
    void this.loadLessonAccount(true);
  },

  refreshAccount(): Promise<void> {
    const account = this.loadLessonAccount(true);
    return Promise.all([account, this.loadEarningPreview(), this.loadEarningAccount(), this.loadSubjects()]).then(() => undefined);
  },

  loadSubjects(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.lessonRuntime) return Promise.resolve();
    if (this.subjectPending) return this.subjectPending;
    const runtime = this.lessonRuntime;
    const sequence = ++this.subjectSequence;
    const current = () => !this.hidden && !this.disposed &&
      sequence === this.subjectSequence && this.validateOwner();
    this.setData({ subjectsLoading: true, subjectError: '' });
    const pending = Promise.resolve().then(async () => {
      if (!current()) return;
      try {
        const result = await runtime.loadSubjects(current);
        if (!current()) return;
        if (result.status === 'error') {
          if (result.statusCode === 401 || result.statusCode === 403) {
            this.invalidateAccount(result.statusCode === 401
              ? '登录已失效，请重新登录' : '当前账号无权查看本校区科目');
            return;
          }
          throw new Error('Catalog unavailable');
        }
        if (result.status !== 'success' && result.status !== 'empty') return;
        const options = [...baseSubjects(), ...result.data.map((row) => ({
          value: row.id, label: `${row.name}${row.isActive ? '' : '（已归档）'}`,
        }))];
        const selected = options.findIndex((row) => row.value === this.data.subjectId);
        if (selected < 0) throw new Error('Selected subject unavailable');
        this.setData({ subjectOptions: options, subjectIndex: selected, subjectError: '' });
      } catch (error: unknown) {
        if (!current()) return;
        const code = typeof error === 'object' && error !== null &&
          'statusCode' in error ? error.statusCode : undefined;
        if (code === 401 || code === 403) {
          this.invalidateAccount('登录或科目权限已失效，请重新登录');
          return;
        }
        this.setData({ subjectError: '科目加载失败，请重试' });
      }
    }).finally(() => {
      if (sequence === this.subjectSequence) {
        this.subjectPending = undefined;
        if (!this.hidden && !this.disposed) this.setData({ subjectsLoading: false });
      }
    });
    this.subjectPending = pending;
    return pending;
  },

  onSubjectsRetry() {
    void this.loadSubjects();
  },

  onSubjectChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const index = Number(event.detail.value);
    const option = Number.isInteger(index) ? this.data.subjectOptions[index] : undefined;
    if (!option || option.value === this.data.subjectId) return;
    this.setData({ subjectId: option.value, subjectIndex: index });
    this.resetLedgerFilter();
  },

  loadEarningAccount(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime) return Promise.resolve();
    if (this.earningAccountPending) return this.earningAccountPending;
    const runtime = this.runtime;
    const sequence = ++this.earningAccountSequence;
    const current = () => !this.hidden && !this.disposed &&
      sequence === this.earningAccountSequence && this.validateOwner();
    const keepContent = this.data.earningAccount !== null;
    this.setData({
      earningAccountState: keepContent ? 'ready' : 'loading', earningAccountError: '',
    });
    const request = Promise.resolve().then(async () => {
      if (!current()) return;
      try {
        const state = await runtime.loadEarningSummary();
        if (!current()) return;
        if (state.status === 'error') {
          if (state.statusCode === 401 || state.statusCode === 403) {
            this.invalidateAccount(state.statusCode === 401
              ? '登录已失效，请重新登录' : '当前账号无权查看本校区合作收益');
            return;
          }
          throw new Error('Summary unavailable');
        }
        if (state.status !== 'success' && state.status !== 'empty') return;
        this.setData({
          earningAccountState: 'ready',
          earningAccount: presentPartnerEarningSummary(state.data),
          earningAccountError: '',
        });
      } catch (error: unknown) {
        if (!current()) return;
        const code = typeof error === 'object' && error !== null &&
          'statusCode' in error ? error.statusCode : undefined;
        if (code === 401 || code === 403) {
          this.invalidateAccount(code === 401
            ? '登录已失效，请重新登录' : '当前账号无权查看本校区合作收益');
          return;
        }
        this.setData({
          earningAccountState: keepContent ? 'ready' : 'error',
          earningAccountError: '累计收益加载失败，请重试',
        });
      }
    }).finally(() => {
      if (sequence === this.earningAccountSequence) this.earningAccountPending = undefined;
    });
    this.earningAccountPending = request;
    return request;
  },

  onEarningAccountRetry() {
    void this.loadEarningAccount();
  },

  loadEarningPreview(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() ||
      !this.runtime || this.data.viewState === 'forbidden') return Promise.resolve();
    if (this.earningPreviewPending) return this.earningPreviewPending;
    const runtime = this.runtime;
    const sequence = ++this.earningPreviewSequence;
    const current = () => !this.hidden && !this.disposed &&
      sequence === this.earningPreviewSequence && this.validateOwner();
    const keepContent = ['ready', 'empty'].includes(this.data.earningPreviewState);
    this.setData({
      earningPreviewState: keepContent ? this.data.earningPreviewState : 'loading',
      earningPreviewError: '',
    });
    const request = Promise.resolve().then(async () => {
      if (!current()) return;
      const profileRead = this.accountProfileRead;
      try {
        const state = await runtime.loadEarnings({ page: 1, pageSize: 3 });
        if (!current()) return;
        if (state.status === 'error') {
          if (state.statusCode === 401 || state.statusCode === 403) {
            this.invalidateAccount(state.statusCode === 401
              ? '登录已失效，请重新登录' : '当前账号无权查看本校区合作收益');
            return;
          }
          throw new Error('Earning preview unavailable');
        }
        if (state.status !== 'success' && state.status !== 'empty') return;
        const profile = await profileRead;
        if (!current()) return;
        if (profile?.status !== 'success' && profile?.status !== 'empty')
          throw new Error('Campus timezone unavailable');
        const items = state.data.data.map((entry) =>
          presentPartnerAccountEarning(entry, profile.data.campus.timezone));
        this.setData({
          earningPreviewState: items.length ? 'ready' : 'empty',
          earningPreviewItems: items, earningPreviewError: '',
        });
      } catch (error: unknown) {
        if (!current()) return;
        const code = typeof error === 'object' && error !== null &&
          'statusCode' in error ? error.statusCode : undefined;
        if (code === 401 || code === 403) {
          this.invalidateAccount(code === 401
            ? '登录已失效，请重新登录' : '当前账号无权查看本校区合作收益');
          return;
        }
        this.setData({
          earningPreviewState: keepContent ? this.data.earningPreviewState : 'error',
          earningPreviewError: '收益流水加载失败，请重试',
        });
      }
    }).finally(() => {
      if (sequence === this.earningPreviewSequence) this.earningPreviewPending = undefined;
    });
    this.earningPreviewPending = request;
    return request;
  },

  onEarningsRetry() {
    void this.loadEarningPreview();
  },

  onEntryTypeChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const index = Number(event.detail.value);
    const option = Number.isInteger(index) ? PARTNER_LESSON_FILTERS[index] : undefined;
    if (!option || option.value === this.data.entryType) return;
    this.setData({ entryType: option.value, entryTypeIndex: index });
    this.resetLedgerFilter();
  },

  resetLedgerFilter() {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.setData({
      items: [], page: 0, total: 0, hasMore: false,
      viewState: this.data.summary ? 'ready' : 'loading', ledgerLoading: true,
      loadingMore: false, refreshError: '', pageError: '',
    });
    void this.loadLessonAccount(true);
  },

  onLoadMore() {
    void this.loadLessonAccount(false);
  },

  onLedgerReachBottom() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    if (this.data.pageError || this.data.ledgerLoading || this.data.loadingMore) return;
    void this.loadLessonAccount(false);
  },

  onEarningsTap() {
    this.navigateAccountPage('/pages/partner/earnings/index');
  },

  onWithdrawalTap() {
    this.navigateAccountPage('/pages/partner/withdrawals/index');
  },

  navigateAccountPage(url: string) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.navigating ||
      !this.runtime || this.data.viewState === 'forbidden') return;
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    const fail = () => {
      if (sequence !== this.navigationSequence || this.hidden || this.disposed || !this.validateOwner()) return;
      this.navigating = false;
      if (this.data.viewState === 'forbidden') return;
      wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
    };
    try {
      wx.navigateTo({ url, fail });
    } catch {
      fail();
    }
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.invalidateAccount('登录已退出，请重新登录');
    this.runtime = undefined;
    this.lessonRuntime = undefined;
    createSessionService().logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
