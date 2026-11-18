import type { ApplicationHistory, PartnerApplicationReviewService } from './partner-application-review.service';
import { newMaterialRequestKey } from './partner-application-material.service';
type Rows = ApplicationHistory['data'];
const displayTime = (value: string) => new Date(Date.parse(value) + 8 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
export const reviewEditorData = () => ({
  reviewHistory: [] as Rows, historyLoading: false, historyMore: false, historyMessage: '', historyNeedsRefresh: false,
  canReopen: false, reopening: false, reopenUncertain: false,
});
interface Host {
  data: ReturnType<typeof reviewEditorData> & { version: number; applicationId: string; formalArchive: boolean; readonly: boolean };
  ownerKey: string; dialogPending: boolean;
  runtime?: { reviews?: PartnerApplicationReviewService; sessions: { getSessionKey(): string } };
  active(): boolean; submissionBlocked(): boolean; clearPrivate(message?: string): void; loadDraft(preserve?: boolean): Promise<void>;
  setData(patch: Record<string, unknown>): void;
}
const code = (error: unknown) => error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;
export class PartnerApplicationReviewEditor {
  private generation = 0;
  private page = 0;
  private working?: Promise<void>;
  private reading?: Promise<void>;
  private intent?: { owner: string; submissionId: string; version: number; key: string };
  constructor(private readonly host: Host) {}
  get busy() { return Boolean(this.working); }
  invalidate() {
    ++this.generation; this.reading = undefined;
    this.host.setData({ reviewHistory: [], canReopen: false, historyLoading: false, historyMore: false });
    this.page = 0;
  }
  clear() { this.invalidate(); this.working = undefined; this.intent = undefined; this.host.setData(reviewEditorData()); }
  loaded() { void this.load(); }
  resume(): Promise<void> {
    if (this.working) return this.working.then(() => this.resume());
    if (this.host.active()) this.host.setData({ reopening: false, reopenUncertain: Boolean(this.intent) });
    return Promise.resolve();
  }
  load(more = false): Promise<void> {
    const host = this.host;
    if (!host.active() || host.data.formalArchive || !host.runtime?.reviews || !host.ownerKey ||
        this.busy || this.reading || (more && !host.data.historyMore)) return Promise.resolve();
    const generation = ++this.generation; const owner = host.ownerKey;
    const page = more ? this.page + 1 : 1;
    host.setData({ historyLoading: true, historyMessage: '', historyNeedsRefresh: false });
    const pending = Promise.resolve().then(() => {
      if (!this.current(generation, owner)) return;
      return host.runtime!.reviews!.history(page);
    }).then((result) => {
      if (!result || !this.current(generation, owner)) return;
      if (result.applicationId !== (host.data.applicationId || null) || result.version !== host.data.version) {
        host.setData({ canReopen: false, historyNeedsRefresh: true, historyMessage: '申请已更新，请重新读取草稿' }); return;
      }
      const rows = more ? [...host.data.reviewHistory, ...result.data] : result.data;
      this.page = page;
      const first = rows[0];
      if (result.status === 'DRAFT' && this.intent && result.editSourceSubmissionId === this.intent.submissionId) this.intent = undefined;
      host.setData({ reviewHistory: rows.filter((row, i) => rows.findIndex((item) => item.submissionId === row.submissionId) === i)
        .map((row) => ({ ...row, submittedLabel: displayTime(row.submittedAt), reviewedLabel: row.review ? displayTime(row.review.reviewedAt) : '' })),
        historyMore: result.meta.page < result.meta.totalPages,
        canReopen: result.status === 'REJECTED' && first?.review?.decision === 'REJECTED',
        reopenUncertain: Boolean(this.intent) });
    }).catch((error: unknown) => {
      if (!this.current(generation, owner)) return;
      if ([401, 403].includes(code(error))) { host.clearPrivate('申请登录已失效，请重新登录'); return; }
      host.setData({ historyMessage: '审核记录读取失败，请重试' });
    }).finally(() => {
      if (this.reading === pending) this.reading = undefined;
      if (this.current(generation, owner)) host.setData({ historyLoading: false });
    });
    this.reading = pending; return pending;
  }
  confirm() {
    const host = this.host;
    if (!host.active() || this.busy || this.reading || host.data.historyLoading || host.dialogPending || host.submissionBlocked() ||
        host.data.formalArchive || !host.runtime?.reviews || (!host.data.canReopen && !this.intent)) return;
    const generation = ++this.generation; const owner = host.ownerKey;
    if (!this.owned(owner)) return;
    host.dialogPending = true;
    try {
      wx.showModal({ title: '开始补交', content: '保留原审核记录，复制资料为可修改的新草稿。', confirmText: '补交',
        success: (result) => {
          if (!this.current(generation, owner) || !host.dialogPending) return;
          host.dialogPending = false;
          if (result.confirm) void this.reopen(generation, owner);
        }, fail: () => { if (this.current(generation, owner)) host.dialogPending = false; } });
    } catch { if (this.current(generation, owner)) host.dialogPending = false; }
  }
  private reopen(generation: number, owner: string) {
    const host = this.host; let complete = false; let operationIntent: typeof this.intent;
    host.setData({ reopening: true, historyMessage: '' });
    const pending = Promise.resolve().then(async () => {
      if (!this.current(generation, owner)) return;
      if (!this.intent) {
        const row = host.data.reviewHistory[0];
        const version = host.data.version;
        const key = await newMaterialRequestKey();
        if (!row || !this.current(generation, owner)) return;
        this.intent = { owner, submissionId: row.submissionId, version, key };
      }
      const intent = this.intent; operationIntent = intent;
      const result = await host.runtime!.reviews!.reopen(intent.submissionId, intent.version, intent.key);
      if (!this.owned(owner)) return;
      if (result.applicationId !== host.data.applicationId || result.status !== 'DRAFT' ||
          result.version !== intent.version + 1 || result.sourceSubmissionId !== intent.submissionId)
        throw Object.assign(new Error('无效回执'), { statusCode: 502 });
      if (this.intent === intent) this.intent = undefined;
      complete = true;
    }).catch((error: unknown) => {
      const known = code(error) >= 400 && code(error) < 500;
      if (known && operationIntent === this.intent && owner === host.ownerKey) this.intent = undefined;
      if (!this.current(generation, owner)) return;
      if ([401, 403].includes(code(error))) { host.clearPrivate('申请登录已失效，请重新登录'); return; }
      host.setData({ reopenUncertain: Boolean(this.intent),
        canReopen: code(error) === 409 ? false : host.data.canReopen,
        historyMessage: known ? '补交未开始，请重新读取申请状态' : '补交结果尚未确认，请用原请求重试或读取最新状态' });
    }).finally(() => {
      if (this.working === pending) this.working = undefined;
      if (this.current(generation, owner)) {
        host.setData({ reopening: false, reopenUncertain: Boolean(this.intent) });
        if (complete) void host.loadDraft();
      }
    });
    this.working = pending;
  }
  private owned(owner: string) {
    if (!owner || owner !== this.host.ownerKey) return false;
    if (owner !== this.host.runtime?.sessions.getSessionKey()) { this.host.clearPrivate('申请登录已更新，请重新登录'); return false; }
    return true;
  }
  private current(generation: number, owner: string) { return generation === this.generation && this.host.active() && this.owned(owner); }
}
