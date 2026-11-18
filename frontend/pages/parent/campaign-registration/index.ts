import { sessionService } from '../../../services/session.service';
import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import {
  FREE_AVAILABILITY_LABELS, freeCampaignTimeLabel, getParentFreeCampaignService, isFreeCampaignId,
  type FreeCampaign, type FreeCampaignReadScope, type FreeCampaignSummary, type FreeRegistration, type FreeRegistrationReceipt,
} from '../runtime/free-campaign.service';

const campaignRow = (row: FreeCampaignSummary) => ({
  ...row, availabilityLabel: FREE_AVAILABILITY_LABELS[row.availability],
  startsAtLabel: freeCampaignTimeLabel(row.startsAt, row.timezone),
  endsAtLabel: freeCampaignTimeLabel(row.endsAt, row.timezone),
});
const registrationRow = (row: FreeRegistration) => ({
  ...row, statusLabel: row.status === 'REGISTERED' ? '已报名' : '已撤销',
  startsAtLabel: freeCampaignTimeLabel(row.startsAt, row.timezone),
  endsAtLabel: freeCampaignTimeLabel(row.endsAt, row.timezone),
  registeredAtLabel: freeCampaignTimeLabel(row.registeredAt, row.timezone),
});
type RegisterIntent = { kind: 'register'; campaignId: string; versionId: string; studentId: string; key: string; sent: boolean };
type CancelIntent = { kind: 'cancel'; registrationId: string; version: number; key: string; sent: boolean };
type Intent = RegisterIntent | CancelIntent;
type Outcome = { receipt: FreeRegistrationReceipt } | { error: unknown };
const statusCode = (error: unknown) => typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
const newKey = () => `freg:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;

Page({
  hidden: false, disposed: false, initialShowPending: false,
  requestSequence: 0, ownerEpoch: 0, ownerKey: '', dialogPending: false,
  target: undefined as { campaignId: string; versionId?: string } | undefined,
  resultId: '', intent: undefined as Intent | undefined, outcome: undefined as Outcome | undefined,
  runtime: undefined as ReturnType<typeof getParentFreeCampaignService> | undefined,
  readScope: undefined as FreeCampaignReadScope | undefined,
  pendingRequest: undefined as Promise<void> | undefined,
  pendingWrite: undefined as Promise<void> | undefined,
  data: {
    tab: 'CAMPAIGNS' as 'CAMPAIGNS' | 'REGISTRATIONS',
    mode: 'list' as 'list' | 'campaign' | 'registration',
    viewState: 'loading', errorMessage: '', actionMessage: '',
    campaigns: [] as Array<ReturnType<typeof campaignRow>>,
    registrations: [] as Array<ReturnType<typeof registrationRow>>,
    campaign: null as FreeCampaign | null,
    registration: null as ReturnType<typeof registrationRow> | null,
    selectedStudentId: '', page: 0, hasMore: false, loadingMore: false, reading: false,
    busy: false, confirming: false, uncertain: false, conflict: false, readbackRequired: false, isMock: false,
    availabilityLabel: '', startsAtLabel: '', endsAtLabel: '', canRegister: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    void loadParentPdfDisplayFont();
    this.runtime = getParentFreeCampaignService();
    this.readScope = this.runtime.createReadScope();
    this.ownerKey = this.runtime.getSessionKey();
    this.initialShowPending = true;
    this.setData({ isMock: this.runtime.isMock });
    if (query.campaignId || query.versionId) {
      if (!isFreeCampaignId(query.campaignId) || (query.versionId !== undefined && !isFreeCampaignId(query.versionId))) {
        this.setData({ viewState: 'error', errorMessage: '活动链接无效，请重新打开活动' });
        return;
      }
      this.target = { campaignId: query.campaignId, versionId: query.versionId };
      this.setData({ mode: 'campaign' });
    }
    void this.load(true);
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.dialogPending = false;
    if (!this.checkOwner()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    this.setData({ confirming: false });
    if (this.pendingWrite) {
      void this.pendingWrite.then(() => { if (this.active()) void this.applyOutcome(); });
      return;
    }
    if (this.outcome) { void this.applyOutcome(); return; }
    this.setData({ busy: false });
    if (this.intent || this.data.conflict) return;
    void this.load(true);
  },
  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.invalidateRead();
    this.dialogPending = false;
  },
  onUnload() { this.disposed = true; this.onHide(); },
  invalidateRead() {
    this.requestSequence += 1;
    this.readScope?.invalidate();
    this.pendingRequest = undefined;
  },
  active() { return !this.hidden && !this.disposed; },
  checkOwner() {
    if (this.runtime?.getSessionKey() === this.ownerKey) return true;
    this.clearPrivate('登录已更新，请重新登录');
    return false;
  },
  clearPrivate(message: string) {
    this.ownerEpoch += 1;
    this.invalidateRead();
    this.intent = undefined;
    this.outcome = undefined;
    this.resultId = '';
    this.dialogPending = false;
    this.setData({
      viewState: 'forbidden', errorMessage: message, actionMessage: '',
      campaigns: [], registrations: [], campaign: null, registration: null, selectedStudentId: '',
      page: 0, hasMore: false, loadingMore: false, reading: false, busy: false, confirming: false,
      uncertain: false, conflict: false, readbackRequired: false, canRegister: false,
    });
  },
  load(reset: boolean): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.runtime || this.pendingWrite || this.intent) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    if (!reset && (this.data.mode !== 'list' || !this.data.hasMore || this.data.loadingMore)) return Promise.resolve();
    const sequence = ++this.requestSequence;
    const runtime = this.runtime;
    const mode = this.data.mode;
    const tab = this.data.tab;
    const page = reset ? 1 : this.data.page + 1;
    const target = this.target;
    const resultId = this.resultId;
    const hadContent = this.data.viewState === 'ready' || this.data.viewState === 'empty';
    this.setData({
      reading: true, loadingMore: !reset, errorMessage: '',
      ...(hadContent ? {} : { viewState: 'loading' }),
    });
    const pending = Promise.resolve().then(async () => {
      if (!this.active() || sequence !== this.requestSequence || !this.checkOwner()) return;
      if (mode === 'campaign' && target) {
        const row = await runtime.getCampaign(target.campaignId, target.versionId, this.readScope);
        if (!this.current(sequence)) return;
        const selected = row.eligibleStudents.some((student) => student.studentId === this.data.selectedStudentId)
          ? this.data.selectedStudentId : '';
        this.setData({
          campaign: row, registration: null, selectedStudentId: selected,
          viewState: 'ready', reading: false, conflict: false,
          availabilityLabel: FREE_AVAILABILITY_LABELS[row.availability],
          startsAtLabel: freeCampaignTimeLabel(row.configuration.startsAt, row.configuration.timezone),
          endsAtLabel: freeCampaignTimeLabel(row.configuration.endsAt, row.configuration.timezone),
        });
        this.syncRegister();
      } else if (mode === 'registration' && resultId) {
        const row = await runtime.getRegistration(resultId, this.readScope);
        if (!this.current(sequence)) return;
        this.setData({
          registration: registrationRow(row), campaign: null, viewState: 'ready',
          reading: false, readbackRequired: false, conflict: false, uncertain: false, actionMessage: '',
        });
      } else if (mode === 'list') {
        const response = tab === 'CAMPAIGNS' ? await runtime.listCampaigns(page, this.readScope)
          : await runtime.listRegistrations(page, this.readScope);
        if (!this.current(sequence)) return;
        if (tab === 'CAMPAIGNS') {
          const rows = (response.data as FreeCampaignSummary[]).map(campaignRow);
          const campaigns = [...new Map([...(reset ? [] : this.data.campaigns), ...rows].map((row) => [row.campaignId, row])).values()];
          this.setData({ campaigns, registrations: [], viewState: campaigns.length ? 'ready' : 'empty' });
        } else {
          const rows = (response.data as FreeRegistration[]).map(registrationRow);
          const registrations = [...new Map([...(reset ? [] : this.data.registrations), ...rows].map((row) => [row.registrationId, row])).values()];
          this.setData({ registrations, campaigns: [], viewState: registrations.length ? 'ready' : 'empty' });
        }
        this.setData({ page: response.meta.page, hasMore: response.meta.page < response.meta.totalPages, reading: false, loadingMore: false });
      } else if (this.current(sequence)) {
        this.setData({ viewState: 'error', reading: false, errorMessage: '活动或报名结果不可访问' });
      }
    }).catch((error: unknown) => {
      if (!this.current(sequence)) return;
      const code = statusCode(error);
      if ([401, 403].includes(code)) { this.clearPrivate('登录已失效或当前无访问权限，请重新登录'); return; }
      if (code === 404) {
        this.resultId = '';
        this.setData({
          viewState: 'error', reading: false, campaign: null, registration: null, selectedStudentId: '',
          canRegister: false, readbackRequired: false, errorMessage: '活动或报名结果不存在或已不可访问',
        });
        return;
      }
      this.setData({
        viewState: hadContent ? this.data.viewState : 'error', reading: false, loadingMore: false,
        errorMessage: this.data.readbackRequired ? '操作已受理，当前报名结果读取失败，请重新读取' : '活动或报名结果读取失败，请重试',
      });
    }).finally(() => { if (sequence === this.requestSequence) this.pendingRequest = undefined; });
    this.pendingRequest = pending;
    return pending;
  },
  current(sequence: number) { return this.active() && sequence === this.requestSequence && this.checkOwner(); },
  syncRegister() {
    const row = this.data.campaign;
    this.setData({ canRegister: Boolean(row && row.availability === 'AVAILABLE' && !this.data.conflict &&
      row.eligibleStudents.some((student) => student.studentId === this.data.selectedStudentId && student.eligibility === 'ELIGIBLE')) });
  },
  onStudentChange(event: WechatMiniprogram.RadioGroupChange) {
    if (!this.active() || !this.checkOwner() || this.pendingWrite || this.pendingRequest || this.intent || this.data.viewState !== 'ready') return;
    if (!this.data.campaign?.eligibleStudents.some((student) => student.studentId === event.detail.value)) return;
    this.setData({ selectedStudentId: event.detail.value, actionMessage: '' });
    this.syncRegister();
  },
  onRegister(): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.runtime) return Promise.resolve();
    if (this.pendingWrite) return this.pendingWrite;
    if (this.intent?.kind === 'register') return this.write(this.intent);
    if (this.data.mode !== 'campaign' || !this.data.canRegister || this.data.reading || this.data.readbackRequired) return Promise.resolve();
    const row = this.data.campaign!;
    return this.write({ kind: 'register', campaignId: row.campaignId, versionId: row.versionId,
      studentId: this.data.selectedStudentId, key: newKey(), sent: false });
  },
  write(intent: Intent): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.runtime || this.pendingWrite) return this.pendingWrite ?? Promise.resolve();
    const runtime = this.runtime;
    const epoch = this.ownerEpoch;
    this.intent = intent;
    this.setData({ busy: true, confirming: false, actionMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || epoch !== this.ownerEpoch || !this.checkOwner()) {
        if (!intent.sent && this.intent === intent) this.intent = undefined;
        return;
      }
      intent.sent = true;
      return intent.kind === 'register'
        ? runtime.register(intent.campaignId, intent.versionId, intent.studentId, intent.key)
        : runtime.cancel(intent.registrationId, intent.version, intent.key);
    }).then((receipt) => {
      if (receipt && !this.disposed && epoch === this.ownerEpoch) this.outcome = { receipt };
    }).catch((error: unknown) => {
      if (!this.disposed && epoch === this.ownerEpoch) this.outcome = { error };
    }).finally(async () => {
      if (this.pendingWrite === pending) this.pendingWrite = undefined;
      if (this.active() && epoch === this.ownerEpoch && this.checkOwner()) {
        if (this.outcome) await this.applyOutcome();
        else this.setData({ busy: false });
      }
    });
    this.pendingWrite = pending;
    return pending;
  },
  async applyOutcome() {
    if (!this.active() || !this.checkOwner() || !this.outcome) return;
    const outcome = this.outcome;
    this.outcome = undefined;
    if ('receipt' in outcome) {
      this.intent = undefined;
      this.resultId = outcome.receipt.registrationId;
      this.setData({
        mode: 'registration', tab: 'REGISTRATIONS', campaign: null, registration: null,
        selectedStudentId: '', canRegister: false, busy: false, uncertain: false, conflict: false,
        readbackRequired: true, viewState: 'loading', actionMessage: '正在读取当前报名结果',
      });
      await this.load(true);
      return;
    }
    const code = statusCode(outcome.error);
    if ([401, 403].includes(code)) { this.clearPrivate('登录已失效或当前无访问权限，请重新登录'); return; }
    const uncertain = code === 0 || code >= 500;
    if (!uncertain) this.intent = undefined;
    this.setData({
      busy: false, uncertain, conflict: code === 409,
      actionMessage: uncertain ? '操作结果暂未确认，请重试原请求'
        : code === 409 ? '活动或报名状态已更新，请重新读取后核对'
          : '报名操作失败，请重试',
    });
    if (code === 404) {
      this.resultId = '';
      this.setData({ campaign: null, registration: null, selectedStudentId: '', canRegister: false,
        viewState: 'error', errorMessage: '活动或报名结果不可访问' });
    } else this.syncRegister();
  },
  onRetryWrite(): Promise<void> { return this.intent ? this.write(this.intent) : Promise.resolve(); },
  onCancel() {
    if (!this.active() || !this.checkOwner() || this.pendingWrite || this.pendingRequest || this.dialogPending ||
      this.data.conflict || this.data.readbackRequired) return;
    if (this.intent?.kind === 'cancel') { void this.write(this.intent); return; }
    const row = this.data.registration;
    if (!row?.canCancel) return;
    const sequence = this.requestSequence;
    this.dialogPending = true;
    this.setData({ confirming: true });
    let consumed = false;
    const current = () => this.active() && sequence === this.requestSequence && this.checkOwner() && this.resultId === row.registrationId;
    const fail = () => {
      if (consumed) return;
      consumed = true;
      if (!current()) return;
      this.dialogPending = false;
      this.setData({ confirming: false, actionMessage: '撤销确认未完成，请重试' });
    };
    try {
      wx.showModal({
        title: '撤销报名？', content: '撤销后保留报名记录，本活动不能再次报名。', confirmText: '确认撤销', cancelText: '保留报名',
        success: (result) => {
          if (consumed) return;
          consumed = true;
          if (!current()) return;
          this.dialogPending = false;
          this.setData({ confirming: false });
          if (result.confirm) void this.write({ kind: 'cancel', registrationId: row.registrationId,
            version: row.version, key: newKey(), sent: false });
        }, fail,
      });
    } catch { fail(); }
  },
  onReload(): Promise<void> { return this.load(true); },
  onRetry(): Promise<void> { return this.load(true); },
  onReachBottom(): Promise<void> { return this.load(false); },
  onPullDownRefresh() { void this.load(true).finally(() => { if (this.active()) wx.stopPullDownRefresh(); }); },
  canMove() {
    return this.active() && this.checkOwner() && !this.pendingWrite && !this.intent && !this.data.readbackRequired && !this.dialogPending;
  },
  resetRead() {
    this.invalidateRead();
    this.resultId = '';
    this.setData({
      campaign: null, registration: null, selectedStudentId: '', campaigns: [], registrations: [],
      viewState: 'loading', page: 0, hasMore: false, loadingMore: false, reading: false,
      conflict: false, actionMessage: '', canRegister: false,
    });
  },
  onTabChange(event: WechatMiniprogram.TouchEvent) {
    const tab = event.currentTarget.dataset.tab;
    if (!this.canMove() || !['CAMPAIGNS', 'REGISTRATIONS'].includes(tab) || (this.data.tab === tab && this.data.mode === 'list')) return;
    this.resetRead();
    this.target = undefined;
    this.setData({ tab, mode: 'list' });
    void this.load(true);
  },
  onOpenCampaign(event: WechatMiniprogram.TouchEvent): Promise<void> {
    if (!this.canMove()) return Promise.resolve();
    const row = this.data.campaigns.find((row) => row.campaignId === event.currentTarget.dataset.id);
    if (!row) return Promise.resolve();
    this.resetRead();
    this.target = { campaignId: row.campaignId, versionId: row.versionId };
    this.setData({ mode: 'campaign' });
    return this.load(true);
  },
  onOpenRegistration(event: WechatMiniprogram.TouchEvent): Promise<void> {
    if (!this.canMove()) return Promise.resolve();
    const id = String(event.currentTarget.dataset.id ?? '');
    if (!this.data.registrations.some((row) => row.registrationId === id) &&
      !this.data.campaign?.eligibleStudents.some((student) => student.registration?.registrationId === id)) return Promise.resolve();
    this.resetRead();
    this.resultId = id;
    this.setData({ mode: 'registration', tab: 'REGISTRATIONS' });
    return this.load(true);
  },
  onLatest(): Promise<void> {
    if (!this.canMove() || !this.target || this.data.campaign?.availability !== 'REPLACED') return Promise.resolve();
    this.target = { campaignId: this.target.campaignId };
    return this.load(true);
  },
  onLogin() {
    if (!this.active() || this.dialogPending) return;
    const login = () => { sessionService.logout(); wx.reLaunch({ url: '/pages/bootstrap/index' }); };
    if (!this.target) { login(); return; }
    const sequence = this.requestSequence;
    const promptOwner = getParentFreeCampaignService().getSessionKey();
    this.dialogPending = true;
    let consumed = false;
    const current = () => {
      if (!this.active() || sequence !== this.requestSequence) return false;
      if (getParentFreeCampaignService().getSessionKey() === promptOwner) return true;
      this.clearPrivate('登录已更新，请重新登录');
      return false;
    };
    const fail = () => {
      if (consumed) return;
      consumed = true;
      if (!current()) return;
      this.dialogPending = false;
      this.setData({ actionMessage: '登录确认未完成，请重试' });
    };
    try {
      wx.showModal({ title: '返回登录', content: '登录完成后，请重新打开原活动链接。', showCancel: false,
        success: (result) => {
          if (consumed) return;
          consumed = true;
          if (!current()) return;
          this.dialogPending = false;
          if (result.confirm) login();
        }, fail });
    } catch { fail(); }
  },
});
