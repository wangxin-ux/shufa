import { createMutationKey } from '../../../utils/super-admin-format';
import { getFreeCampaignReviewRuntime, logoutFreeCampaignReviewer } from '../runtime/free-campaign-review-runtime';
import { normalizeFreeCampaignReviewReason, type FreeCampaignReviewDetail,
  type FreeCampaignReviewPort, type FreeCampaignReviewSummary,
  type FreeCampaignLifecycleReceipt } from '../runtime/free-campaign-review.service';
import { freeCampaignErrorStatus, freeCampaignStatusLabel, freeCampaignTimeLabel } from '../runtime/free-campaign-review-presenter';
import { freeCampaignHeaderTopPx } from '../runtime/free-campaign-navigation';

type Action = 'approve' | 'reject' | 'close';
interface Intent {
  action: Action; versionId: string; campaignId: string; version: number; reason: string;
  key: string; owner: string; sent: boolean;
}
const actionLabels = { approve: '批准活动', reject: '驳回活动', close: '关闭活动' };

Page({
  hidden: false, disposed: false, initial: true, generation: 0, mutationSequence: 0, dialogSequence: 0,
  owner: '', versionId: '', reasonDraft: '', pullSequence: 0,
  service: undefined as FreeCampaignReviewPort | undefined,
  pendingLoad: undefined as Promise<void> | undefined,
  working: undefined as Promise<void> | undefined,
  intent: undefined as Intent | undefined,
  data: {
    viewState: 'loading', message: '', detail: null as FreeCampaignReviewDetail | null,
    reason: '', loading: false, submitting: false, dialogPending: false, uncertain: false,
    uncertainAction: '', needsRefresh: false, simulated: false, canApprove: false, canReject: false, canClose: false,
    statusLabel: '', startsLabel: '', endsLabel: '', submittedLabel: '', reviewedLabel: '', capacityLabel: '', headerTopPx: 28,
  },
  onLoad(query: Record<string, string | undefined>) {
    this.setData({ headerTopPx: freeCampaignHeaderTopPx() });
    this.initial = true; this.versionId = String(query.id ?? '');
    void this.load();
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    const service = getFreeCampaignReviewRuntime(); const nextOwner = service.getSessionKey();
    if (this.owner && (nextOwner !== this.owner || service !== this.service)) {
      this.clear('登录已更新，请重新读取'); this.initial = false;
    }
    this.service = service; this.owner = nextOwner;
    if (!nextOwner) { this.clear('当前登录无活动审核权限，请重新登录'); return; }
    if (this.initial) { this.initial = false; return; }
    this.setData({ reason: this.reasonDraft, submitting: Boolean(this.working),
      uncertain: Boolean(this.intent?.sent), uncertainAction: this.intent?.action ?? '' });
    this.syncActions();
    if (!this.working) void this.load();
  },
  onHide() {
    this.hidden = true; this.initial = false; ++this.generation; ++this.mutationSequence; ++this.dialogSequence; ++this.pullSequence;
    this.pendingLoad = undefined; this.service?.invalidateReads();
    this.setData({ detail: null, reason: '', loading: false, submitting: false, dialogPending: false,
      canApprove: false, canReject: false, canClose: false, message: '', statusLabel: '',
      startsLabel: '', endsLabel: '', submittedLabel: '', reviewedLabel: '', capacityLabel: '' });
  },
  onUnload() {
    this.disposed = true; this.onHide(); this.intent = undefined; this.working = undefined; this.reasonDraft = '';
  },
  active() { return !this.hidden && !this.disposed; },
  clear(message: string, forbidden = true) {
    ++this.generation; ++this.mutationSequence; ++this.dialogSequence;
    this.pendingLoad = undefined; this.working = undefined; this.intent = undefined; this.reasonDraft = '';
    this.setData({ viewState: forbidden ? 'forbidden' : 'error', message, detail: null, reason: '',
      loading: false, submitting: false, dialogPending: false, uncertain: false, uncertainAction: '', needsRefresh: false,
      canApprove: false, canReject: false, canClose: false, statusLabel: '', startsLabel: '', endsLabel: '',
      submittedLabel: '', reviewedLabel: '', capacityLabel: '' });
  },
  currentOwner(owner: string) {
    if (!this.active() || this.owner !== owner) return false;
    if (this.service?.getSessionKey() !== owner) { this.clear('登录已更新，请重新登录'); return false; }
    return true;
  },
  validateOwner() {
    const service = getFreeCampaignReviewRuntime();
    if (service !== this.service || service.getSessionKey() !== this.owner) { this.clear('登录已更新，请重新登录'); return false; }
    return Boolean(this.owner);
  },
  syncActions() {
    const row = this.data.detail;
    const available = Boolean(row) && !this.data.loading && !this.data.submitting &&
      !this.data.dialogPending && !this.data.needsRefresh && !this.intent;
    this.setData({
      canApprove: available && row?.status === 'SUBMITTED' && row.lifecycle === 'OPEN' && row.version < 2_147_483_647,
      canReject: available && row?.status === 'SUBMITTED' && row.version < 2_147_483_647,
      canClose: available && row?.lifecycle === 'OPEN' && row.campaignVersion < 2_147_483_647,
    });
  },
  load(resolveRefresh = false): Promise<void> {
    if (!this.active()) return Promise.resolve();
    const service = getFreeCampaignReviewRuntime(); const owner = service.getSessionKey();
    if (this.owner && (owner !== this.owner || service !== this.service)) this.clear('登录已更新，请重新读取');
    this.service = service; this.owner = owner;
    if (!owner) { this.clear('当前登录无活动审核权限，请重新登录'); return Promise.resolve(); }
    if (this.working || this.data.dialogPending) return Promise.resolve();
    if (this.pendingLoad) return this.pendingLoad;
    const generation = ++this.generation;
    service.invalidateReads();
    this.setData({ loading: true, simulated: service.isMock, reason: this.reasonDraft,
      message: this.data.needsRefresh && !resolveRefresh ? '活动状态已更新，请重读后核对原因' : '',
      ...(this.data.detail ? {} : { viewState: 'loading' }) });
    this.syncActions();
    const pending = Promise.resolve().then(() => {
      if (generation === this.generation && this.currentOwner(owner)) return service.detail(this.versionId);
      return undefined;
    }).then((row) => {
      if (!row || generation !== this.generation || !this.currentOwner(owner)) return;
      const needsRefresh = this.data.needsRefresh && !resolveRefresh;
      this.setData({ detail: row, viewState: 'ready', needsRefresh, reason: this.reasonDraft,
        message: needsRefresh ? '活动状态已更新，请重读后核对原因' : '',
        statusLabel: freeCampaignStatusLabel(row.status),
        startsLabel: freeCampaignTimeLabel(row.configuration.startsAt, row.configuration.timezone),
        endsLabel: freeCampaignTimeLabel(row.configuration.endsAt, row.configuration.timezone),
        submittedLabel: freeCampaignTimeLabel(row.submittedAt, row.configuration.timezone),
        reviewedLabel: row.reviewedAt ? freeCampaignTimeLabel(row.reviewedAt, row.configuration.timezone) : '',
        capacityLabel: row.configuration.capacityMode === 'UNLIMITED' ? '不限名额' : `${row.configuration.maxRegistrations} 人`,
        uncertain: Boolean(this.intent?.sent), uncertainAction: this.intent?.action ?? '',
      });
    }).catch((error: unknown) => {
      if (generation !== this.generation || !this.currentOwner(owner)) return;
      const status = freeCampaignErrorStatus(error);
      if ([401, 403, 404].includes(status)) {
        this.clear(status === 404 ? '活动版本不存在或已不可访问' : '当前登录无活动审核权限，请重新登录', status !== 404);
      } else this.setData({ viewState: this.data.detail ? 'ready' : 'error', message: '冻结详情读取失败，请重试' });
    }).finally(() => {
      if (this.pendingLoad === pending) this.pendingLoad = undefined;
      if (generation === this.generation && this.currentOwner(owner)) { this.setData({ loading: false }); this.syncActions(); }
    });
    this.pendingLoad = pending;
    return pending;
  },
  onReload() { return this.load(true); },
  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    const pending = this.load(true); const owner = this.owner;
    void pending.finally(() => {
      if (this.active() && sequence === this.pullSequence && this.owner === owner &&
        this.service?.getSessionKey() === owner) wx.stopPullDownRefresh();
    });
  },
  onReasonInput(event: WechatMiniprogram.Input) {
    if (!this.active() || !this.validateOwner() || this.working || this.intent || this.data.dialogPending) return;
    this.reasonDraft = String(event.detail.value ?? '');
    this.setData({ reason: this.reasonDraft });
  },
  onApprove() { this.requestAction('approve'); },
  onReject() { this.requestAction('reject'); },
  onCloseCampaign() { this.requestAction('close'); },
  onRetryAction() { if (this.intent) this.requestAction(this.intent.action); },
  requestAction(action: Action) {
    if (!this.active() || !this.validateOwner() || this.working || this.data.loading || this.data.dialogPending ||
      this.intent && this.intent.action !== action) return;
    let intent = this.intent;
    if (!intent) {
      const row = this.data.detail;
      if (!row || this.data.needsRefresh || !(action === 'approve' ? this.data.canApprove
        : action === 'reject' ? this.data.canReject : this.data.canClose)) return;
      let reason = '';
      try { if (action !== 'approve') reason = normalizeFreeCampaignReviewReason(this.reasonDraft); } catch {
        this.setData({ message: '请填写有效原因，最多1000个字符' }); return;
      }
      intent = { action, versionId: row.versionId, campaignId: row.campaignId,
        version: action === 'close' ? row.campaignVersion : row.version, reason,
        key: createMutationKey(`free-campaign-${action}`), owner: this.owner, sent: false };
    }
    const snapshot = intent; const sequence = ++this.dialogSequence;
    this.setData({ dialogPending: true }); this.syncActions();
    let consumed = false;
    const fail = () => {
      if (consumed) return; consumed = true;
      if (!this.active() || sequence !== this.dialogSequence || !this.currentOwner(snapshot.owner)) return;
      this.setData({ dialogPending: false, message: '确认未完成，请重试' }); this.syncActions();
    };
    try {
      wx.showModal({
        title: `确认${actionLabels[action]}`,
        content: action === 'approve' ? '批准后家长可在活动有效期内免费登记，不自动发放课时。'
          : action === 'close' ? `关闭后不能重新开启，已有报名保留。原因：${snapshot.reason}` : `驳回原因：${snapshot.reason}`,
        confirmText: action === 'approve' ? '批准' : action === 'reject' ? '驳回' : '关闭',
        success: ({ confirm }) => {
          if (consumed) return; consumed = true;
          if (!this.active() || sequence !== this.dialogSequence || !this.currentOwner(snapshot.owner)) return;
          this.setData({ dialogPending: false });
          if (confirm) { this.intent = snapshot; void this.performIntent(); } else this.syncActions();
        }, fail,
      });
    } catch { fail(); }
  },
  performIntent(): Promise<void> {
    const intent = this.intent; const service = this.service;
    if (!intent || !service || this.working || !this.currentOwner(intent.owner)) return Promise.resolve();
    const sequence = ++this.mutationSequence;
    let refresh = false;
    this.setData({ submitting: true, uncertain: false, uncertainAction: intent.action, message: '' }); this.syncActions();
    const current = () => sequence === this.mutationSequence && this.currentOwner(intent.owner);
    const pending = Promise.resolve().then<FreeCampaignReviewSummary | FreeCampaignLifecycleReceipt | undefined>(() => {
      if (!current()) {
        if (!intent.sent && this.intent === intent) this.intent = undefined;
        return undefined;
      }
      intent.sent = true;
      return intent.action === 'approve' ? service.approve(intent.versionId, intent.version, intent.key)
        : intent.action === 'reject' ? service.reject(intent.versionId, intent.version, intent.reason, intent.key)
          : service.close(intent.campaignId, intent.version, intent.reason, intent.key);
    }).then((receipt) => {
      if (!receipt || !current()) return;
      this.intent = undefined; refresh = true;
      this.setData({ uncertain: false, uncertainAction: '', needsRefresh: true,
        message: `${service.isMock ? '合成演示：' : ''}${actionLabels[intent.action]}请求已完成，请重读当前状态` });
    }).catch((error: unknown) => {
      if (!current()) return;
      const status = freeCampaignErrorStatus(error);
      if ([401, 403, 404].includes(status)) {
        this.clear(status === 404 ? '活动版本不存在或已不可访问' : '当前登录无活动审核权限，请重新登录', status !== 404); return;
      }
      const uncertain = status === 0 || status >= 500;
      if (!uncertain) this.intent = undefined;
      this.setData({ uncertain, uncertainAction: uncertain ? intent.action : '', needsRefresh: status === 409,
        message: uncertain ? '操作结果暂未确认，请重试原操作'
          : status === 409 ? '活动状态已更新，请重读后核对原因' : '操作失败，请核对后重试' });
    }).finally(async () => {
      if (this.working !== pending) return;
      this.working = undefined;
      if (!this.currentOwner(intent.owner)) return;
      this.setData({ submitting: false, uncertain: Boolean(this.intent?.sent), uncertainAction: this.intent?.action ?? '' });
      this.syncActions();
      if (refresh && sequence === this.mutationSequence) await this.load(true);
    });
    this.working = pending;
    return pending;
  },
  onLogin() {
    if (!this.active()) return;
    ++this.pullSequence;
    this.clear('请重新登录'); logoutFreeCampaignReviewer();
    const generation = this.generation; const owner = this.service?.getSessionKey();
    const fail = () => {
      if (this.active() && generation === this.generation && this.service?.getSessionKey() === owner)
        this.setData({ message: '登录页打开失败，请重试' });
    };
    try { wx.reLaunch({ url: '/pages/bootstrap/index', fail }); } catch { fail(); }
  },
});
