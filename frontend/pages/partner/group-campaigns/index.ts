import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import { presentPartnerPromotionCampaign } from '../runtime/group-promotion';
import { createPartnerService } from '../../../services/partner-runtime';
import type { PartnerService } from '../../../services/partner.service';
import { logoutPartnerCampaignSession } from '../runtime/campaign-session-runtime';
import type { PartnerCampaignPhase } from '../../../types/group-buying';
import {
  getPartnerFreeCampaignService, presentOwnedFreeCampaign,
  type FreePage, type OwnedFreeCampaign,
} from '../runtime/free-campaign.service';
import {
  CAMPAIGN_TYPES, getPartnerCampaignDraftService, presentCampaignDraftSummary,
  type CampaignDraftPage,
} from '../runtime/partner-campaign-draft.service';

const PAGE_SIZE = 20;
type ListResult =
  | (Awaited<ReturnType<PartnerService['loadGroupPromotionCampaigns']>> & { draft: false; free?: false })
  | { status: 'success' | 'empty'; data: CampaignDraftPage; draft: true; free?: false }
  | { status: 'success' | 'empty'; data: FreePage<OwnedFreeCampaign>; draft: false; free: true };

Page({
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingPage: 0,
  hidden: false,
  disposed: false,
  loginStopped: false,
  pullSequence: 0,
  initialShowPending: false,
  draftOwnerKey: '',
  draftNavigationPending: false,
  editorNavigationSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    paginationError: '',
    campaigns: [] as Array<ReturnType<typeof presentPartnerPromotionCampaign>>,
    drafts: [] as Array<ReturnType<typeof presentCampaignDraftSummary>>,
    freeCampaigns: [] as Array<ReturnType<typeof presentOwnedFreeCampaign>>,
    campaignKinds: CAMPAIGN_TYPES.map((type) => type.label),
    campaignKindIndex: 0,
    draftKinds: ['全部', ...CAMPAIGN_TYPES.map((type) => type.label)],
    draftKindIndex: 0,
    page: 0,
    hasMore: false,
    loadingMore: false,
    phase: 'ONGOING' as PartnerCampaignPhase | 'DRAFT',
  },

  onLoad() {
    void loadPartnerPdfDisplayFont();
    this.initialShowPending = true;
    void this.load(true);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.draftNavigationPending = false;
    if (!this.validateDraftOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.load(true);
  },

  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.draftNavigationPending = false;
    this.editorNavigationSequence += 1;
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed || this.loginStopped) return;
    const sequence = ++this.pullSequence;
    const pending = this.load(true);
    const owner = this.draftOwnerKey;
    void pending.finally(() => {
      if (!this.hidden && !this.disposed && !this.loginStopped && sequence === this.pullSequence &&
        getPartnerCampaignDraftService().getSessionKey() === owner) wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    void this.load(false);
  },

  onPhaseTap(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateDraftOwner()) return;
    const phase = String(event.currentTarget.dataset.phase ?? '');
    if ((phase !== 'ONGOING' && phase !== 'ENDED' && phase !== 'DRAFT') || phase === this.data.phase) return;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.setData({
      phase, viewState: 'loading', campaigns: [], drafts: [], freeCampaigns: [], page: 0, hasMore: false,
      loadingMore: false, errorMessage: '', refreshError: '', paginationError: '',
    });
    void this.load(true);
  },

  onCampaignKindChange(event: WechatMiniprogram.PickerChange) {
    if (this.hidden || this.disposed ||
      this.data.viewState === 'forbidden' || !this.validateDraftOwner()) return;
    const draft = this.data.phase === 'DRAFT';
    const kinds = draft ? this.data.draftKinds : this.data.campaignKinds;
    const raw: unknown = event.detail.value;
    if (!kinds.some((_, index) => raw === index || raw === String(index))) return;
    const index = Number(raw);
    if (index === (draft ? this.data.draftKindIndex : this.data.campaignKindIndex)) return;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.setData({
      ...(draft ? { draftKindIndex: index } : { campaignKindIndex: index }),
      viewState: 'loading', campaigns: [], drafts: [], freeCampaigns: [],
      page: 0, hasMore: false, loadingMore: false, errorMessage: '', refreshError: '', paginationError: '',
    });
    void this.load(true);
  },

  load(reset: boolean): Promise<void> {
    if (this.hidden || this.disposed) return Promise.resolve();
    if (!this.validateDraftOwner()) return Promise.resolve();
    if (!reset && (
      this.pendingRequest || !this.data.hasMore || this.data.loadingMore ||
      this.data.refreshError || this.data.viewState !== 'ready'
    )) return Promise.resolve();
    const page = reset ? 1 : this.data.page + 1;
    if (this.pendingRequest && this.pendingPage === page) return this.pendingRequest;
    const sequence = ++this.requestSequence;
    const phase = this.data.phase;
    const type = CAMPAIGN_TYPES[this.data.campaignKindIndex]?.value;
    this.draftOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    if (phase !== 'DRAFT' && type !== 'REGULAR_GROUP' && type !== 'FREE_REGISTRATION') {
      this.pendingRequest = undefined;
      this.pendingPage = 0;
      this.setData({
        viewState: 'draftOnly', campaigns: [], drafts: [], freeCampaigns: [], page: 0,
        hasMore: false, loadingMore: false, errorMessage: '', refreshError: '', paginationError: '',
      });
      return Promise.resolve();
    }
    const draftService = phase === 'DRAFT' ? getPartnerCampaignDraftService() : undefined;
    const draftType = CAMPAIGN_TYPES[this.data.draftKindIndex - 1]?.value;
    const freeService = phase !== 'DRAFT' && type === 'FREE_REGISTRATION' ? getPartnerFreeCampaignService() : undefined;
    const keepContent = this.data.viewState === 'ready' || this.data.viewState === 'empty';
    this.pendingPage = page;
    this.setData(
      reset
        ? {
            ...(keepContent ? {} : {
              viewState: 'loading', campaigns: [], drafts: [], freeCampaigns: [], page: 0, hasMore: false,
            }),
            errorMessage: '',
            refreshError: '',
            paginationError: '',
            loadingMore: false,
          }
        : { loadingMore: true, paginationError: '' },
    );

    const request = Promise.resolve()
      .then(async (): Promise<ListResult | undefined> => {
        if (this.hidden || this.disposed || sequence !== this.requestSequence ||
          !this.validateDraftOwner()) return;
        if (draftService) return (draftType ? draftService.list(page, draftType) : draftService.list(page)).then((result) => ({
          status: result.data.length ? 'success' as const : 'empty' as const,
          data: result, draft: true as const,
        }));
        if (freeService) return freeService.published(page, phase as PartnerCampaignPhase).then((result) => ({
          status: result.data.length ? 'success' as const : 'empty' as const,
          data: result, draft: false as const, free: true as const,
        }));
        return createPartnerService().loadGroupPromotionCampaigns({
          page, pageSize: PAGE_SIZE, phase: phase as PartnerCampaignPhase,
        }).then((state) => ({ ...state, draft: false as const }));
      })
      .catch((error: unknown) => ({
        status: 'error' as const,
        statusCode: typeof error === 'object' && error !== null &&
          'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode : undefined,
        message: '活动加载失败，请稍后重试',
        draft: false as const,
      }))
      .then((state) => {
        if (!state || this.hidden || this.disposed || sequence !== this.requestSequence ||
          !this.validateDraftOwner()) return;
        if (state.status === 'success' || state.status === 'empty') {
          if (state.free) {
            const next = state.data.data.map(presentOwnedFreeCampaign);
            const freeCampaigns = Array.from(new Map(
              [...(reset ? [] : this.data.freeCampaigns), ...next].map((item) => [item.campaignId, item]),
            ).values());
            this.setData({
              freeCampaigns, drafts: [], campaigns: [], page: state.data.meta.page,
              hasMore: state.data.meta.page < state.data.meta.totalPages, loadingMore: false,
              viewState: freeCampaigns.length ? 'ready' : 'empty', errorMessage: '', refreshError: '', paginationError: '',
            });
            return;
          }
          if (state.draft) {
            const next = state.data.data.map(presentCampaignDraftSummary);
            const drafts = Array.from(new Map(
              [...(reset ? [] : this.data.drafts), ...next].map((item) => [item.draftId, item]),
            ).values());
            this.setData({
              drafts, campaigns: [], freeCampaigns: [], page: state.data.meta.page,
              hasMore: state.data.meta.page < state.data.meta.totalPages, loadingMore: false,
              viewState: drafts.length ? 'ready' : 'empty', errorMessage: '', refreshError: '', paginationError: '',
            });
            return;
          }
          const next = state.data.data.map(presentPartnerPromotionCampaign);
          const campaigns = Array.from(new Map(
            [...(reset ? [] : this.data.campaigns), ...next].map((item) => [item.id, item]),
          ).values());
          this.setData({
            campaigns,
            drafts: [],
            freeCampaigns: [],
            page: state.data.meta.page,
            hasMore: state.data.meta.page < state.data.meta.totalPages,
            loadingMore: false,
            viewState: campaigns.length ? 'ready' : 'empty',
            errorMessage: '',
            refreshError: '',
            paginationError: '',
          });
          return;
        }
        if (state.status !== 'error') return;
        if (state.statusCode === 401 || state.statusCode === 403) {
          this.setData({
            viewState: 'forbidden',
            campaigns: [],
            drafts: [],
            freeCampaigns: [],
            page: 0,
            hasMore: false,
            loadingMore: false,
            refreshError: '',
            paginationError: '',
            errorMessage: state.statusCode === 401
              ? '登录已失效，请重新登录'
              : '当前账号无权查看本校区活动',
          });
          return;
        }
        this.setData({
          loadingMore: false,
          ...(keepContent
            ? reset ? { refreshError: state.message } : { paginationError: state.message }
            : { viewState: 'error', errorMessage: state.message }),
        });
      })
      .finally(() => {
        if (sequence === this.requestSequence) {
          this.pendingRequest = undefined;
          this.pendingPage = 0;
        }
      });
    this.pendingRequest = request;
    return request;
  },

  onOpen(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateDraftOwner() || this.data.viewState !== 'ready') return;
    const id = String(event.currentTarget.dataset.id ?? '');
    if (this.data.phase === 'DRAFT') {
      if (!this.data.drafts.some((draft) => draft.draftId === id)) return;
      this.openEditor(`?id=${encodeURIComponent(id)}`);
      return;
    }
    if (CAMPAIGN_TYPES[this.data.campaignKindIndex]?.value === 'FREE_REGISTRATION') {
      const item = this.data.freeCampaigns.find((row) => row.campaignId === id);
      if (item) this.openEditor(`?id=${encodeURIComponent(item.draftId)}`);
      return;
    }
    if (!id || !this.data.campaigns.some((campaign) => campaign.id === id)) return;
    this.openPage(`/pages/partner/group-detail/index?id=${encodeURIComponent(id)}`, '活动详情打开失败，请重试');
  },

  onCreate() {
    if (this.hidden || this.disposed || this.data.viewState === 'forbidden') return;
    if (!this.validateDraftOwner()) return;
    const type = CAMPAIGN_TYPES[this.data.phase === 'DRAFT' && this.data.draftKindIndex > 0
      ? this.data.draftKindIndex - 1 : this.data.campaignKindIndex]?.value;
    if (type) this.openEditor(`?type=${type}`);
  },

  openEditor(query: string) {
    this.openPage(`/pages/partner/campaign-editor/index${query}`, '编辑页打开失败，请重试');
  },

  openPage(url: string, errorMessage: string) {
    if (this.hidden || this.disposed || !this.validateDraftOwner() || this.draftNavigationPending) return;
    this.draftNavigationPending = true;
    const sequence = ++this.editorNavigationSequence;
    const fail = () => {
      if (this.hidden || this.disposed || sequence !== this.editorNavigationSequence ||
        !this.validateDraftOwner()) return;
      this.draftNavigationPending = false;
      this.setData({ refreshError: errorMessage });
    };
    try { wx.navigateTo({ url, fail }); } catch { fail(); }
  },

  validateDraftOwner() {
    if (this.loginStopped) return false;
    if (!this.draftOwnerKey ||
      getPartnerCampaignDraftService().getSessionKey() === this.draftOwnerKey) return true;
    this.clearPrivate('登录已更新，请重新登录');
    return false;
  },

  clearPrivate(message: string) {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingPage = 0;
    this.draftNavigationPending = false;
    this.editorNavigationSequence += 1;
    this.setData({
      viewState: 'forbidden', campaigns: [], drafts: [], freeCampaigns: [], page: 0, hasMore: false,
      loadingMore: false, errorMessage: message, refreshError: '', paginationError: '',
    });
  },

  onRetry() {
    void this.load(true);
  },

  onRetryMore() {
    void this.load(false);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.loginStopped = true;
    this.pullSequence += 1;
    this.clearPrivate('登录已失效，请重新登录');
    logoutPartnerCampaignSession();
    const sequence = this.editorNavigationSequence;
    const owner = getPartnerCampaignDraftService().getSessionKey();
    const fail = () => {
      if (!this.hidden && !this.disposed && sequence === this.editorNavigationSequence &&
        getPartnerCampaignDraftService().getSessionKey() === owner)
        this.setData({ errorMessage: '登录页打开失败，请重试' });
    };
    try { wx.reLaunch({ url: '/pages/bootstrap/index', fail }); } catch { fail(); }
  },
});
