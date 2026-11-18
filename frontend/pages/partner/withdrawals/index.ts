import {
  createPartnerWithdrawalClient, parseWithdrawalYuan, WITHDRAWAL_BLOCK_LABELS, WITHDRAWAL_LABELS,
  type PartnerWithdrawal, type WithdrawalSummary,
} from '../runtime/partner-withdrawal.service';
import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import { logoutPartnerCampaignSession } from '../runtime/campaign-session-runtime';
import { formatDateTimeLabel, formatFenAmount } from '../../../utils/format';

const formatAmount = (fen: number) => formatFenAmount(fen).replace(/^[¥￥]/, '');
type Intent = { owner: string; key: string; kind: 'create' | 'cancel'; body: { amountFen: number; expectedProfileVersion: number }; id?: string; version?: number };
const present = (row: PartnerWithdrawal) => ({ ...row, amountLabel: formatAmount(row.amountFen),
  statusLabel: WITHDRAWAL_LABELS[row.status], requestedLabel: formatDateTimeLabel(row.requestedAt, 'Asia/Shanghai'),
  unresolvedLabel: formatAmount(row.unresolvedFen) });
const empty = () => ({ summary: null as WithdrawalSummary | null, rows: [] as ReturnType<typeof present>[],
  recordsEmpty: true,
  availableLabel: '', reservedLabel: '', paidLabel: '', unresolvedLabel: '', minimumLabel: '', blockLabel: '',
  page: 0, total: 0, hasMore: false, amount: '' });
Page({
  runtime: undefined as ReturnType<typeof createPartnerWithdrawalClient> | undefined,
  owner: '', hidden: false, disposed: false, sequence: 0, skipShow: false,
  intent: undefined as Intent | undefined, pending: undefined as Promise<void> | undefined,
  data: { ...empty(), viewState: 'loading', errorMessage: '', actionMessage: '', busy: false, refreshing: false, unknown: false },
  onLoad() { void loadPartnerPdfDisplayFont(); this.skipShow = true; void this.load(true); },
  onShow() {
    if (this.disposed) return; this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.skipShow) { this.skipShow = false; return; }
    this.setData({ unknown: !!this.intent, busy: false }); void this.load(true);
  },
  onHide() {
    this.hidden = true; this.skipShow = false; this.sequence++; this.pending = undefined;
    this.setData({ ...empty(), viewState: this.data.viewState === 'forbidden' ? 'forbidden' : 'loading',
      busy: false, refreshing: false, unknown: !!this.intent });
  },
  onUnload() { this.onHide(); this.disposed = true; this.runtime = undefined; this.intent = undefined; },
  clearPrivate(message: string) {
    this.sequence++; this.pending = undefined; this.intent = undefined;
    this.setData({ ...empty(), viewState: 'forbidden', errorMessage: message, actionMessage: '', unknown: false, busy: false, refreshing: false });
  },
  validateOwner(): boolean {
    if (this.data.viewState === 'forbidden') return false;
    try {
      const runtime = createPartnerWithdrawalClient(), owner = runtime.getSessionKey();
      if (!owner || this.owner && this.owner !== owner || this.runtime && this.runtime.getSessionKey() !== owner) {
        this.clearPrivate('登录已更新，请重新登录'); return false;
      }
      if (!this.runtime) { this.runtime = runtime; this.owner = owner; }
      return true;
    } catch { this.clearPrivate('登录状态不可用，请重新登录'); return false; }
  },
  active() { return !this.hidden && !this.disposed && this.validateOwner(); },
  load(reset: boolean): Promise<void> {
    if (!this.active() || !this.runtime || this.data.busy) return Promise.resolve();
    if (this.pending) return this.pending;
    if (!reset && !this.data.hasMore) return Promise.resolve();
    const sequence = ++this.sequence, page = reset ? 1 : this.data.page + 1, runtime = this.runtime;
    const current = () => this.active() && this.sequence === sequence;
    this.setData({ refreshing: true, errorMessage: '' });
    const checked = <T>(promise: Promise<T>) => promise.catch((error: unknown) => {
      const status = (error as { statusCode?: number })?.statusCode;
      if (current() && (status === 401 || status === 403)) this.clearPrivate('当前登录无权查看提现，请重新登录');
      throw error;
    });
    const pending = Promise.resolve().then(async () => {
      if (!current()) return;
      const s = await checked(runtime.summary());
      if (!current()) return;
      if (!s.enabled) {
        this.setData({ ...empty(), summary: s, viewState: 'ready', errorMessage: '', actionMessage: '' });
        return;
      }
      const list = await checked(runtime.list(page));
      if (!current()) return;
      if (list.data.some(w => w.campusId !== s.campusId)) throw new Error('Campus mismatch');
      this.setData({ summary: s, rows: reset ? list.data.map(present) : [...this.data.rows, ...list.data.map(present)],
        availableLabel: formatAmount(s.availableFen), reservedLabel: formatAmount(s.reservedFen),
        paidLabel: formatAmount(s.paidFen), unresolvedLabel: formatAmount(s.unresolvedFen),
        minimumLabel: s.profile ? formatAmount(s.profile.minimumAmountFen) : '',
        blockLabel: WITHDRAWAL_BLOCK_LABELS[s.blockReason] ?? '', page, total: list.meta.total,
        recordsEmpty: list.meta.total === 0,
        hasMore: page < list.meta.totalPages, viewState: 'ready', errorMessage: '' });
    }).catch(() => {
      if (current()) this.setData({ viewState: this.data.summary ? 'ready' : 'error', errorMessage: '提现记录读取失败，请重试' });
    }).finally(() => {
      if (current()) { this.pending = undefined; this.setData({ refreshing: false }); }
    });
    this.pending = pending; return pending;
  },
  onAmountInput(event: WechatMiniprogram.Input) {
    if (this.active() && !this.intent && !this.data.busy) this.setData({ amount: event.detail.value, actionMessage: '' });
  },
  onSubmit(): Promise<void> {
    if (!this.active() || this.data.busy || this.data.refreshing || this.intent || !this.data.summary?.canApply || !this.data.summary.profile) return Promise.resolve();
    const amountFen = parseWithdrawalYuan(this.data.amount), s = this.data.summary;
    if (amountFen === null || amountFen < s.profile!.minimumAmountFen || amountFen > s.availableFen) {
      this.setData({ actionMessage: '请填写最低金额至可申请额度之间的金额，最多两位小数' }); return Promise.resolve();
    }
    this.intent = { owner: this.owner, key: `pw-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
      kind: 'create', body: { amountFen, expectedProfileVersion: s.profile!.version } };
    return this.performIntent();
  },
  onCancel(event: WechatMiniprogram.TouchEvent) {
    if (!this.active() || this.intent || this.data.busy || this.data.refreshing) return;
    const row = this.data.rows.find(w => w.id === event.currentTarget.dataset.id);
    if (!row || row.status !== 'SUBMITTED') return;
    this.intent = { owner: this.owner, key: `pw-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
      kind: 'cancel', id: row.id, version: row.version, body: { amountFen: row.amountFen, expectedProfileVersion: row.profile.version } };
    void this.performIntent();
  },
  async performIntent() {
    if (!this.active() || !this.runtime || !this.intent || this.data.busy || this.intent.owner !== this.owner) return;
    const intent = this.intent, sequence = this.sequence;
    const current = () => this.active() && this.intent === intent && this.sequence === sequence;
    this.setData({ busy: true, unknown: false, actionMessage: '' });
    try {
      if (!current()) return;
      if (intent.kind === 'create') await this.runtime.create(intent.body, intent.key);
      else await this.runtime.cancel(intent.id!, intent.version!, intent.key);
      if (!current()) return;
      this.intent = undefined; this.setData({ busy: false, unknown: false, amount: '', actionMessage: intent.kind === 'create' ? '模拟申请已提交' : '申请已撤回' });
      await this.load(true);
    } catch (error) {
      if (!current()) return;
      const status = (error as { statusCode?: number })?.statusCode;
      if (status === 401 || status === 403) { this.clearPrivate('登录已失效，请重新登录'); return; }
      const unknown = !status || status >= 500;
      if (!unknown) this.intent = undefined;
      this.setData({ busy: false, unknown, actionMessage: unknown ? '结果尚未确认，请重试原请求' : '额度、资料或状态已变化，请重新读取后再办理' });
      if (!unknown) await this.load(true);
    }
  },
  onRetryAction() { return this.performIntent(); },
  onRetry() { void this.load(true); },
  onLoadMore() { void this.load(false); },
  async onProof(event: WechatMiniprogram.TouchEvent) {
    if (!this.active() || !this.runtime || this.data.busy) return;
    const row = this.data.rows.find(w => w.id === event.currentTarget.dataset.id);
    if (!row?.proofFileId) return;
    const sequence = this.sequence;
    try {
      const filePath = await this.runtime.proof(row.id);
      if (!this.active() || sequence !== this.sequence) return;
      wx.openDocument({ filePath, fileType: 'pdf', showMenu: false, fail: () => {
        if (this.active() && sequence === this.sequence) this.setData({ actionMessage: '凭证打开失败，请重试' });
      } });
    } catch (error) {
      if (!this.active() || sequence !== this.sequence) return;
      if ([401, 403].includes((error as { statusCode: number })?.statusCode)) this.clearPrivate('登录已失效，请重新登录');
      else this.setData({ actionMessage: '凭证读取失败，请重试' });
    }
  },
  onPullDownRefresh() {
    const sequence = this.sequence;
    void this.load(true).finally(() => { if (this.active() && this.sequence >= sequence) wx.stopPullDownRefresh(); });
  },
  onLogin() { if (this.hidden || this.disposed) return; this.clearPrivate('登录已退出'); logoutPartnerCampaignSession(); wx.reLaunch({ url: '/pages/bootstrap/index' }); },
});
