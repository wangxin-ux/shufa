import {
  createManagedPartnerWithdrawalClient, parseManagedWithdrawalYuan,
  type ManagedPartnerWithdrawal, type ManagedSettlementSummary, type SettlementSource,
} from '../runtime/partner-withdrawal.service';
import { formatDateTimeLabel, formatFenAmount } from '../../../utils/format';
import { logoutFreeCampaignReviewer } from '../runtime/free-campaign-review-runtime';

const formatAmount = (fen: number) => formatFenAmount(fen).replace(/^[¥￥]/, '');
const labels: Record<string, string> = { SUBMITTED: '待审核', APPROVED: '已批准', PAYING: '模拟出款中',
  RECONCILING: '到账待核对', PAID: '模拟已付款', CANCELLED: '已撤回', REJECTED: '已驳回', FAILED: '已确认未付款', INVALIDATED: '来源失效已停止' };
const actions: Record<string, string[]> = { SUBMITTED: ['approve', 'reject'], APPROVED: ['mark-paying', 'mock-proof', 'mark-failed'],
  PAYING: ['mock-proof', 'mark-unknown', 'mark-paid', 'mark-failed'], RECONCILING: ['mock-proof', 'mark-paid', 'mark-failed'] };
const present = (w: ManagedPartnerWithdrawal) => ({ ...w, amountLabel: formatAmount(w.amountFen),
  statusLabel: labels[w.status], timeLabel: formatDateTimeLabel(w.requestedAt, 'Asia/Shanghai'),
  proofLabel: w.proofOutcome === 'PAID' ? '模拟已付证据' : w.proofOutcome === 'UNPAID' ? '模拟未付证据' : '旧凭证待核对',
  unresolvedLabel: formatAmount(w.unresolvedFen) });
const empty = () => ({
  campuses: [] as Array<{ id: string; name: string }>, campusId: '', campusName: '', campusIndex: 0,
  campusPage: 0, campusHasMore: false, campusQuery: '',
  summary: null as ManagedSettlementSummary | null, availableLabel: '', reservedLabel: '', paidLabel: '', unresolvedLabel: '',
  rows: [] as ReturnType<typeof present>[], sources: [] as Array<SettlementSource & { amountLabel: string; timeLabel: string }>,
  recordsEmpty: true, sourcesEmpty: true,
  selected: null as ReturnType<typeof present> | null, page: 0, hasMore: false, total: 0, sourcePage: 0, sourceHasMore: false,
  payerName: '', beneficiaryName: '', accountLastFour: '', minimumAmount: '100', dailyLimit: '1', reason: '', payoutReference: '', confirmedUnpaid: false,
});
interface Intent {
  owner: string; key: string; campusId: string; campusName: string; kind: 'configure' | 'confirm' | 'action';
  id: string; action: string; body: { expectedVersion: number; [key: string]: unknown };
}
Page({
  client: undefined as ReturnType<typeof createManagedPartnerWithdrawalClient> | undefined,
  owner: '', sequence: 0, hidden: false, disposed: false, skipShow: false, pending: undefined as Promise<void> | undefined,
  intent: undefined as Intent | undefined,
  data: { ...empty(), viewState: 'loading', errorMessage: '', actionMessage: '', busy: false, refreshing: false, unknown: false },
  onLoad() { this.skipShow = true; void this.loadCampuses(1); },
  onShow() {
    if (this.disposed) return; this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.skipShow) { this.skipShow = false; return; }
    this.setData({ unknown: !!this.intent, busy: false }); void this.loadCampuses(1);
  },
  onHide() { this.hidden = true; this.skipShow = false; this.sequence++; this.pending = undefined;
    this.setData({ ...empty(), viewState: this.data.viewState === 'forbidden' ? 'forbidden' : 'loading', busy: false, refreshing: false, unknown: !!this.intent }); },
  onUnload() { this.onHide(); this.disposed = true; this.intent = undefined; this.client = undefined; },
  clearPrivate(message: string) {
    this.sequence++; this.pending = undefined; this.intent = undefined;
    this.setData({ ...empty(), viewState: 'forbidden', errorMessage: message, actionMessage: '', busy: false, refreshing: false, unknown: false });
  },
  validateOwner(): boolean {
    if (this.data.viewState === 'forbidden') return false;
    try {
      const client = createManagedPartnerWithdrawalClient(), owner = client.getSessionKey();
      if (!owner || this.owner && this.owner !== owner || this.client && this.client.getSessionKey() !== owner) {
        this.clearPrivate('登录已更新，请重新登录'); return false;
      }
      if (!this.client) { this.client = client; this.owner = owner; }
      return true;
    } catch { this.clearPrivate('登录不可用，请重新登录'); return false; }
  },
  active() { return !this.hidden && !this.disposed && this.validateOwner(); },
  async loadCampuses(page: number) {
    if (!this.active() || !this.client || this.data.busy) return;
    if (this.client.isMock) { this.setData({ viewState: 'disabled', errorMessage: '' }); return; }
    const sequence = ++this.sequence, query = this.data.campusQuery;
    this.setData({ refreshing: true, errorMessage: '' });
    try {
      const result = await this.client.campuses(page, query);
      if (!this.active() || sequence !== this.sequence) return;
      const selected = this.intent ? { id: this.intent.campusId, name: this.intent.campusName }
        : result.data.find(c => c.id === this.data.campusId) ?? result.data[0];
      this.setData({ ...empty(), campusQuery: query, campuses: result.data, campusPage: page,
        campusHasMore: page < result.meta.totalPages, campusId: selected?.id ?? '', campusName: selected?.name ?? '',
        campusIndex: Math.max(0, result.data.findIndex(c => c.id === selected?.id)), refreshing: false, viewState: 'ready' });
      if (selected) await this.load(true);
    } catch (error) { if (this.active() && sequence === this.sequence) this.readError(error); }
  },
  readError(error: unknown) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 401 || status === 403) this.clearPrivate('当前登录无权处理提现，请重新登录');
    else this.setData({ viewState: this.data.summary ? 'ready' : 'error', errorMessage: status === 409 ? '模拟提现未启用或状态已变化' : '读取失败，请重试', refreshing: false });
  },
  load(reset: boolean): Promise<void> {
    if (!this.active() || !this.client || !this.data.campusId || this.data.busy) return Promise.resolve();
    if (this.pending) return this.pending;
    const sequence = ++this.sequence, campusId = this.data.campusId, page = reset ? 1 : this.data.page + 1;
    const current = () => this.active() && this.sequence === sequence && this.data.campusId === campusId;
    const selectedId = this.data.selected?.id;
    this.setData({ refreshing: true, errorMessage: '' });
    const checked = <T>(promise: Promise<T>) => promise.catch((error: unknown) => {
      if (current() && [401, 403].includes((error as { statusCode: number })?.statusCode)) this.clearPrivate('当前登录无权处理提现，请重新登录');
      throw error;
    });
    const pending = Promise.resolve().then(async () => {
      if (!current()) return;
      const [s, list, sourcePage] = await Promise.all([checked(this.client!.summary(campusId)), checked(this.client!.list(campusId, page)), checked(this.client!.sources(campusId, 1))]);
      if (!current()) return;
      const rows = reset ? list.data.map(present) : [...this.data.rows, ...list.data.map(present)];
      this.setData({ summary: s, availableLabel: formatAmount(s.availableFen), reservedLabel: formatAmount(s.reservedFen),
        paidLabel: formatAmount(s.paidFen), unresolvedLabel: formatAmount(s.unresolvedFen),
        rows, selected: rows.find(w => w.id === selectedId) ?? null, page, hasMore: page < list.meta.totalPages, total: list.meta.total,
        recordsEmpty: list.meta.total === 0, sourcesEmpty: sourcePage.meta.total === 0,
        sources: sourcePage.data.map(w => ({ ...w, amountLabel: formatAmount(w.amountFen), timeLabel: formatDateTimeLabel(w.createdAt, 'Asia/Shanghai') })),
        sourcePage: 1, sourceHasMore: sourcePage.meta.totalPages > 1, viewState: 'ready',
        payerName: s.profile?.payerName ?? '', beneficiaryName: s.profile?.beneficiaryName ?? '',
        accountLastFour: s.profile?.accountLabel.slice(-4) ?? '',
        minimumAmount: s.profile ? formatAmount(s.profile.minimumAmountFen) : '100', dailyLimit: String(s.profile?.dailyRequestLimit ?? 1) });
    }).catch(error => { if (current()) this.readError(error); }).finally(() => {
      if (current()) { this.pending = undefined; this.setData({ refreshing: false }); }
    });
    this.pending = pending; return pending;
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) {
    if (!this.active() || this.intent || this.data.busy || this.data.refreshing) return;
    const index = Number(event.detail.value), campus = this.data.campuses[index];
    if (!Number.isInteger(index) || !campus || campus.id === this.data.campusId) return;
    this.sequence++; this.pending = undefined;
    this.setData({ summary: null, rows: [], sources: [], recordsEmpty: true, sourcesEmpty: true, selected: null, campusIndex: index, campusId: campus.id, campusName: campus.name, reason: '', actionMessage: '' });
    void this.load(true);
  },
  onField(event: WechatMiniprogram.Input) {
    if (!this.active() || this.intent || this.data.busy || this.data.refreshing) return;
    const field = String(event.currentTarget.dataset.field);
    if (['payerName', 'beneficiaryName', 'accountLastFour', 'minimumAmount', 'dailyLimit', 'reason', 'payoutReference', 'campusQuery'].includes(field))
      this.setData({ [field]: event.detail.value });
  },
  onUnpaidChange(event: WechatMiniprogram.CheckboxGroupChange) {
    if (this.active() && !this.intent && !this.data.busy) this.setData({ confirmedUnpaid: event.detail.value.includes('unpaid') });
  },
  onSelect(event: WechatMiniprogram.TouchEvent) {
    if (!this.active() || this.intent || this.data.busy || this.data.refreshing) return;
    const row = this.data.rows.find(w => w.id === event.currentTarget.dataset.id);
    if (row) this.setData({ selected: row, payoutReference: '', reason: '', confirmedUnpaid: false, actionMessage: '' });
  },
  beginIntent(kind: Intent['kind'], id: string, action: string, body: Intent['body']) {
    this.intent = { owner: this.owner, key: `mpw-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`, campusId: this.data.campusId, campusName: this.data.campusName, kind, id, action, body };
    return this.performIntent();
  },
  onConfigure() {
    if (!this.active() || !this.data.summary || this.intent || this.data.busy || this.data.refreshing) return;
    const minimumAmountFen = parseManagedWithdrawalYuan(this.data.minimumAmount), dailyRequestLimit = Number(this.data.dailyLimit);
    if (!minimumAmountFen || !/^\d{1,3}$/.test(this.data.dailyLimit) || dailyRequestLimit < 1 || dailyRequestLimit > 100 ||
      !/^模拟\S.{0,97}$/u.test(this.data.payerName) || !/^模拟\S.{0,97}$/u.test(this.data.beneficiaryName) ||
      !/^\d{4}$/.test(this.data.accountLastFour) || !this.data.reason.trim()) {
      this.setData({ actionMessage: '请填写模拟主体、四位账户尾号、有效门槛、每日次数和确认原因' }); return;
    }
    void this.beginIntent('configure', '', '', { expectedVersion: this.data.summary.profile?.version ?? 0,
      payerName: this.data.payerName, beneficiaryName: this.data.beneficiaryName, accountLastFour: this.data.accountLastFour,
      minimumAmountFen, dailyRequestLimit, reason: this.data.reason.trim() });
  },
  onConfirmSource(event: WechatMiniprogram.TouchEvent) {
    if (!this.active() || this.intent || this.data.busy || this.data.refreshing || !this.data.summary?.profile) return;
    const source = this.data.sources.find(s => s.id === event.currentTarget.dataset.id);
    if (!source || source.confirmed) return;
    if (!this.data.reason.trim()) { this.setData({ actionMessage: '请填写本次结算确认原因' }); return; }
    void this.beginIntent('confirm', source.id, '', { expectedVersion: source.version,
      expectedProfileVersion: this.data.summary.profile.version, reason: this.data.reason.trim() });
  },
  onAction(event: WechatMiniprogram.TouchEvent): Promise<void> {
    if (!this.active() || this.intent || this.data.busy || this.data.refreshing) return Promise.resolve();
    const selected = this.data.selected, action = String(event.currentTarget.dataset.action);
    if (!selected || !actions[selected.status]?.includes(action) || event.currentTarget.dataset.id && event.currentTarget.dataset.id !== selected.id) return Promise.resolve();
    if (action === 'mark-paying' && selected.proofFileId) {
      this.setData({ actionMessage: '已有未付或待核对证据，不得再开始出款' }); return Promise.resolve();
    }
    const body: Intent['body'] = { expectedVersion: selected.version };
    if (action === 'mark-failed' && (!this.data.confirmedUnpaid || !selected.proofFileId || selected.proofOutcome !== 'UNPAID' || !this.data.reason.trim())) {
      this.setData({ actionMessage: '需有本单模拟凭证、原因，并勾选已确认未付款' }); return Promise.resolve();
    }
    if (['reject', 'mark-unknown', 'mark-failed'].includes(action)) {
      if (!this.data.reason.trim()) { this.setData({ actionMessage: '请填写处理原因' }); return Promise.resolve(); }
      body.reason = this.data.reason.trim();
    }
    if (action === 'mock-proof') {
      const outcome = event.currentTarget.dataset.outcome;
      if (outcome === 'PAID' && selected.status === 'APPROVED') {
        this.setData({ actionMessage: '请先开始模拟出款，再核对已付证据' }); return Promise.resolve();
      }
      if (!['PAID', 'UNPAID'].includes(outcome) || !this.data.reason.trim()) {
        this.setData({ actionMessage: '请选择模拟已付或未付结果，并填写核对原因' }); return Promise.resolve();
      }
      body.evidenceOutcome = outcome; body.reason = this.data.reason.trim();
    }
    if (action === 'mark-failed') { body.confirmedUnpaid = true; body.proofFileId = selected.proofFileId; }
    if (action === 'mark-paid') {
      if (!selected.proofFileId || selected.proofOutcome !== 'PAID' || !/^SIM-\S+$/.test(this.data.payoutReference) || this.data.payoutReference.length > 128) {
        this.setData({ actionMessage: '请先生成本单模拟凭证，并填写以SIM-开头的唯一参考号' }); return Promise.resolve();
      }
      Object.assign(body, { amountFen: selected.amountFen, accountVersion: selected.profile.version,
        payoutReference: this.data.payoutReference, proofFileId: selected.proofFileId, paidAt: new Date().toISOString() });
    }
    return this.beginIntent('action', selected.id, action, body);
  },
  async performIntent() {
    if (!this.active() || !this.client || !this.intent || this.intent.owner !== this.owner || this.data.busy) return;
    const intent = this.intent, sequence = this.sequence;
    const current = () => this.active() && sequence === this.sequence && this.intent === intent;
    this.setData({ busy: true, unknown: false, actionMessage: '' });
    try {
      if (!current()) return;
      if (intent.kind === 'configure') await this.client.configure(intent.campusId, intent.body, intent.key);
      else if (intent.kind === 'confirm') await this.client.confirm(intent.campusId, intent.id, intent.body, intent.key);
      else await this.client.action(intent.id, intent.action, intent.body, intent.key);
      if (!current()) return;
      this.intent = undefined; this.setData({ busy: false, unknown: false, actionMessage: '模拟处理已记录', reason: '', confirmedUnpaid: false });
      await this.load(true);
    } catch (error) {
      if (!current()) return;
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 401 || status === 403) { this.clearPrivate('登录已失效，请重新登录'); return; }
      const unknown = !status || status >= 500;
      if (!unknown) this.intent = undefined;
      this.setData({ busy: false, unknown, actionMessage: unknown ? '结果尚未确认，请重试原请求' : '资料或状态不符，请重新读取后核对' });
      if (!unknown) await this.load(true);
    }
  },
  onRetryAction() { return this.performIntent(); },
  onRetry() { if (!this.data.campusId) void this.loadCampuses(1); else void this.load(true); },
  onCampusSearch() { if (this.active() && !this.intent) void this.loadCampuses(1); },
  onCampusNext() { if (this.active() && !this.intent && this.data.campusHasMore) void this.loadCampuses(this.data.campusPage + 1); },
  onCampusPrevious() { if (this.active() && !this.intent && this.data.campusPage > 1) void this.loadCampuses(this.data.campusPage - 1); },
  onLoadMore() { if (this.data.hasMore) void this.load(false); },
  async onMoreSources() {
    if (!this.active() || !this.client || this.data.refreshing || this.data.busy || !this.data.sourceHasMore) return;
    const sequence = this.sequence, campusId = this.data.campusId;
    this.setData({ refreshing: true });
    try {
      const result = await this.client.sources(campusId, this.data.sourcePage + 1);
      if (!this.active() || sequence !== this.sequence) return;
      this.setData({ sources: [...this.data.sources, ...result.data.map(w => ({ ...w, amountLabel: formatAmount(w.amountFen),
        timeLabel: formatDateTimeLabel(w.createdAt, 'Asia/Shanghai') }))], sourcePage: result.meta.page, sourceHasMore: result.meta.page < result.meta.totalPages });
    } catch (error) { if (this.active() && sequence === this.sequence) this.readError(error); }
    finally { if (this.active() && sequence === this.sequence) this.setData({ refreshing: false }); }
  },
  onPullDownRefresh() { void this.load(true).finally(() => { if (this.active()) wx.stopPullDownRefresh(); }); },
  onLogin() { if (this.hidden || this.disposed) return; this.clearPrivate('登录已退出'); logoutFreeCampaignReviewer(); wx.reLaunch({ url: '/pages/bootstrap/index' }); },
});
