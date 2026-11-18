import { getPartnerReviewRuntime } from '../runtime/partner-application-review-runtime';
import type { BankInformation, ReviewDetail, ReviewPort, ReviewSummary } from '../runtime/partner-application-review.service';
import { createMutationKey } from '../../../utils/super-admin-format';
const statuses = [
  { value: 'SUBMITTED', label: '待审核' }, { value: 'REJECTED', label: '已驳回' },
  { value: 'DRAFT', label: '补交中' }, { value: 'APPROVED', label: '已通过' }, { value: '', label: '全部' },
];
const labels: Record<string, string> = { DRAFT: '补交中', SUBMITTED: '待审核', REJECTED: '已驳回', APPROVED: '已通过' };
const materialLabels: Record<string, string> = { BUSINESS_LICENSE: '营业执照', INSTITUTION_LOGO: '机构标志',
  LEGAL_ID_FRONT: '法人证件正面', LEGAL_ID_BACK: '法人证件反面', STORE_FRONT: '门头照片', ENVIRONMENT: '环境照片' };
const code = (error: unknown) => error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
const displayTime = (value: string) => new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
Page({
  hidden: false, disposed: false, initial: true, generation: 0, owner: '',
  service: undefined as ReviewPort | undefined,
  selected: undefined as { aid: string; sid: string } | undefined,
  working: undefined as Promise<void> | undefined,
  intent: undefined as { action: 'APPROVED' | 'REJECTED'; aid: string; sid: string; version: number; reason: string; key: string } | undefined,
  dialog: false,
  filters: { status: 'SUBMITTED', query: '' },
  data: { viewState: 'loading', message: '', rows: [] as Array<ReviewSummary & { statusLabel: string; submittedLabel: string }>,
    statuses, statusIndex: 0, keyword: '', page: 0, more: false, loading: false, detail: null as ReviewDetail | null,
    detailMaterials: [] as Array<ReviewDetail['materials'][number] & { label: string }>,
    bankInformation: null as BankInformation | null, privateLoading: false, reason: '',
    submitting: false, uncertain: false, uncertainAction: '', canReject: false, submittedLabel: '', reviewedLabel: '' },
  onLoad() { this.initial = true; void this.refresh(); },
  onShow() {
    this.hidden = false;
    if (this.initial) { this.initial = false; return; }
    if (this.service?.getSessionKey() !== this.owner) { this.clear(); this.working = undefined; this.intent = undefined; this.selected = undefined; }
    if (this.working) { void this.working.then(() => { if (this.active()) void this.refresh(); }); return; }
    void this.refresh();
  },
  onHide() { this.hidden = true; ++this.generation; this.dialog = false; this.service?.invalidateReads();
    this.setData({ rows: [], detail: null, detailMaterials: [], bankInformation: null, reason: '', loading: false, privateLoading: false }); },
  onUnload() { this.disposed = true; this.onHide(); },
  active() { return !this.hidden && !this.disposed; },
  current(generation: number, owner: string) {
    if (!this.active() || generation !== this.generation) return false;
    if (this.service?.getSessionKey() !== owner) { this.clear(); return false; }
    return true;
  },
  clear() {
    ++this.generation; this.dialog = false;
    this.intent = undefined; this.selected = undefined; this.working = undefined;
    this.setData({ viewState: 'forbidden', rows: [], detail: null, detailMaterials: [], bankInformation: null,
      reason: '', canReject: false, loading: false, privateLoading: false, submitting: false, uncertain: false, uncertainAction: '',
      message: '当前登录无入驻审核权限，请重新登录' });
  },
  error(error: unknown, generation: number, owner: string) {
    if (!this.current(generation, owner)) return;
    if ([401, 403].includes(code(error))) { this.clear(); this.intent = undefined; return; }
    this.setData({ message: code(error) === 409 ? '申请已更新，请重新读取' : '读取失败，请重试',
      viewState: this.data.detail || this.data.rows.length ? 'ready' : 'error' });
  },
  async refresh(more = false) {
    if (!this.active()) return;
    const service = getPartnerReviewRuntime(); const nextOwner = service.getSessionKey();
    if (this.owner && (this.owner !== nextOwner || this.service !== service)) this.clear();
    if (this.working || this.data.loading || this.dialog) return;
    this.service = service; this.owner = nextOwner;
    const owner = this.owner; const generation = ++this.generation;
    if (!owner) { this.clear(); return; }
    this.service.invalidateReads();
    this.setData({ loading: true, privateLoading: false, bankInformation: null, message: '', viewState: 'loading' });
    try {
      if (this.selected) {
        const detail = await this.service.detail(this.selected.aid, this.selected.sid);
        if (!this.current(generation, owner)) return;
        const terminal = this.intent && detail.submissionId === this.intent.sid &&
          (Boolean(detail.review) || !detail.latest ||
            (detail.status !== 'SUBMITTED' && detail.version > this.intent.version));
        if (terminal) this.intent = undefined;
        this.setData({ detail, detailMaterials: detail.materials.map((file) => ({ ...file, label: materialLabels[file.kind] })),
          submittedLabel: displayTime(detail.submittedAt), reviewedLabel: detail.review ? displayTime(detail.review.reviewedAt) : '',
          bankInformation: null, reason: this.intent?.reason ?? '',
          uncertain: Boolean(this.intent), uncertainAction: this.intent?.action ?? '', submitting: false,
          canReject: detail.latest && detail.status === 'SUBMITTED' && detail.version === detail.submissionVersion && !detail.review,
          viewState: 'ready' });
      } else {
        const page = more ? this.data.page + 1 : 1;
        const filters = more ? this.filters : { status: statuses[this.data.statusIndex].value, query: this.data.keyword.trim() };
        const list = await this.service.list(page, filters.status, filters.query);
        if (!this.current(generation, owner)) return;
        if (!more) this.filters = filters;
        const rows = [...(more ? this.data.rows : []), ...list.data.map((row) => ({ ...row, statusLabel: labels[row.status], submittedLabel: displayTime(row.submittedAt) }))];
        this.setData({ rows: rows.filter((row, i) => rows.findIndex((item) => item.applicationId === row.applicationId) === i),
          page, more: page < list.meta.totalPages, viewState: rows.length ? 'ready' : 'empty' });
      }
    } catch (error) { this.error(error, generation, owner); }
    finally { if (this.current(generation, owner)) this.setData({ loading: false }); }
  },
  onKeywordInput(event: WechatMiniprogram.Input) { if (this.current(this.generation, this.owner)) this.setData({ keyword: event.detail.value }); },
  onStatus(event: WechatMiniprogram.PickerChange) { if (!this.current(this.generation, this.owner) || this.data.loading) return; this.setData({ statusIndex: Number(event.detail.value) }); void this.refresh(); },
  onSearch() { void this.refresh(); },
  onMore() { if (this.data.more) return this.refresh(true); return Promise.resolve(); },
  onOpen(event: WechatMiniprogram.BaseEvent) {
    if (!this.current(this.generation, this.owner) || this.data.loading || this.working || this.intent || this.dialog) return Promise.resolve();
    this.selected = { aid: String(event.currentTarget.dataset.aid), sid: String(event.currentTarget.dataset.sid) };
    this.setData({ rows: [], detail: null, bankInformation: null }); return this.refresh();
  },
  onClose() {
    if (!this.current(this.generation, this.owner) || this.working || this.intent || this.dialog) return;
    ++this.generation; this.service?.invalidateReads(); this.selected = undefined;
    this.setData({ detail: null, detailMaterials: [], bankInformation: null, reason: '', loading: false, privateLoading: false, canReject: false });
    void this.refresh();
  },
  async onBank() {
    if (!this.current(this.generation, this.owner)) return;
    const detail = this.data.detail;
    if (!detail || this.data.privateLoading || this.working || this.dialog) return;
    if (this.data.bankInformation) { this.setData({ bankInformation: null }); return; }
    const generation = this.generation; const owner = this.owner;
    this.setData({ privateLoading: true });
    try {
      const result = await this.service!.bank(detail.applicationId, detail.submissionId);
      if (this.current(generation, owner)) this.setData({ bankInformation: result.bankInformation });
    } catch (error) { this.error(error, generation, owner); }
    finally { if (this.current(generation, owner)) this.setData({ privateLoading: false }); }
  },
  async onPreview(event: WechatMiniprogram.BaseEvent) {
    if (!this.current(this.generation, this.owner)) return;
    const detail = this.data.detail; const id = String(event.currentTarget.dataset.id);
    if (!detail || !detail.materials.some((file) => file.storedFileId === id) ||
        this.data.privateLoading || this.working || this.dialog) return;
    const generation = this.generation; const owner = this.owner;
    this.setData({ privateLoading: true });
    try {
      const path = await this.service!.image(detail.applicationId, detail.submissionId, id);
      if (this.current(generation, owner)) wx.previewImage({ urls: [path], current: path,
        fail: () => { if (this.current(generation, owner)) this.setData({ message: '材料预览失败，请重试' }); } });
    } catch (error) { this.error(error, generation, owner); }
    finally { if (this.current(generation, owner)) this.setData({ privateLoading: false }); }
  },
  onReasonInput(event: WechatMiniprogram.Input) { if (this.current(this.generation, this.owner) && !this.working && !this.intent && !this.dialog) this.setData({ reason: event.detail.value }); },
  onReject() {
    if (!this.current(this.generation, this.owner)) return;
    const detail = this.data.detail;
    if (!detail || !this.data.canReject || this.working || this.dialog || this.data.privateLoading || this.data.loading ||
        (this.intent && this.intent.action !== 'REJECTED')) return;
    const reason = this.intent?.reason ?? this.data.reason.trim();
    if (!reason || reason.length > 1000) { this.setData({ message: '请填写驳回原因' }); return; }
    const generation = this.generation; const owner = this.owner; this.dialog = true;
    try { wx.showModal({ title: '确认驳回', content: '保留此次送审资料及审核意见，申请人可修改后补交。', confirmText: '驳回',
      success: ({ confirm }) => {
        if (!this.current(generation, owner) || !this.dialog) return;
        this.dialog = false; if (confirm) void this.reject(generation, owner, detail, reason);
      }, fail: () => { if (this.current(generation, owner)) this.dialog = false; } });
    } catch { this.dialog = false; }
  },
  onApprove() {
    if (!this.current(this.generation, this.owner)) return;
    const detail = this.data.detail;
    if (!detail || !this.data.canReject || this.working || this.dialog || this.data.privateLoading || this.data.loading ||
        (this.intent && this.intent.action !== 'APPROVED')) return;
    const generation = this.generation; const owner = this.owner; this.dialog = true;
    try { wx.showModal({ title: '确认批准入驻', content: '将为此申请人开通合作方账号并创建所属校区。校区暂不公开。', confirmText: '批准',
      success: ({ confirm }) => {
        if (!this.current(generation, owner) || !this.dialog) return;
        this.dialog = false; if (confirm) void this.decide('APPROVED', generation, owner, detail, '');
      }, fail: () => { if (this.current(generation, owner)) this.dialog = false; } });
    } catch { this.dialog = false; }
  },
  reject(generation: number, owner: string, detail: ReviewDetail, reason: string) {
    return this.decide('REJECTED', generation, owner, detail, reason);
  },
  decide(action: 'APPROVED' | 'REJECTED', generation: number, owner: string, detail: ReviewDetail, reason: string) {
    if (!this.current(generation, owner) || this.working || (this.intent && this.intent.action !== action)) return Promise.resolve();
    this.intent ??= { action, aid: detail.applicationId, sid: detail.submissionId, version: detail.version, reason,
      key: createMutationKey(action === 'APPROVED' ? 'partner-application-approve' : 'partner-application-reject') };
    const intent = this.intent;
    const label = intent.action === 'APPROVED' ? '批准' : '驳回';
    this.setData({ submitting: true, uncertainAction: intent.action, message: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.current(generation, owner)) return;
      return intent.action === 'APPROVED' ? this.service!.approve(intent.aid, intent.sid, intent.version, intent.key)
        : this.service!.reject(intent.aid, intent.sid, intent.version, intent.reason, intent.key);
    })
      .then((receipt) => {
        if (!receipt) return;
        if (this.owner !== owner || this.service?.getSessionKey() !== owner) return;
        if (receipt.applicationId !== intent.aid || receipt.submissionId !== intent.sid || receipt.status !== intent.action ||
            receipt.version !== intent.version + 1) throw Object.assign(new Error('无效回执'), { statusCode: 502 });
        if (this.intent === intent) this.intent = undefined;
        if (this.current(generation, owner)) this.setData({ uncertain: false, uncertainAction: '', canReject: false,
          detail: { ...detail, status: receipt.status, version: receipt.version }, bankInformation: null,
          message: intent.action === 'APPROVED' ? '已批准，申请人可用原微信正式登录' : '已驳回，等待申请人补交' });
      }).catch((error: unknown) => {
        const known = code(error) >= 400 && code(error) < 500;
        if (known && this.intent === intent && this.owner === owner) this.intent = undefined;
        if (!this.current(generation, owner)) return;
        if ([401, 403].includes(code(error))) { this.clear(); return; }
        this.setData({ uncertain: Boolean(this.intent), uncertainAction: this.intent?.action ?? '',
          canReject: code(error) === 409 ? false : this.data.canReject,
          message: known ? `${label}未完成，请重新读取申请状态` : `${label}结果尚未确认，请重试或重新读取状态` });
      }).finally(() => {
        if (this.working === pending) this.working = undefined;
        if (this.current(generation, owner)) this.setData({ submitting: false });
      });
    this.working = pending; return pending;
  },
  onRetry() { return this.refresh(); },
  onLogin() { wx.reLaunch({ url: '/pages/bootstrap/index' }); },
});
