import { newMaterialRequestKey } from './partner-application-material.service';
import type { PartnerApplicationSubmissionService } from './partner-application-submission.service';

export const submissionEditorData = () => ({ submitting: false, submitUncertain: false });
interface Host {
  data: ReturnType<typeof submissionEditorData> & {
    readonly: boolean; formalArchive: boolean; applicationId: string; version: number; dirty: boolean;
    bankDirty: boolean; materialsDirty: boolean; materialsPending: boolean; needsVersionRefresh: boolean;
    bankNeedsRefresh: boolean; materialsNeedsRefresh: boolean;
  };
  runtime?: { submissions?: PartnerApplicationSubmissionService; sessions: { getSessionKey(): string } };
  ownerKey: string; dialogPending: boolean;
  active(): boolean; submissionBlocked(): boolean; syncUnloadAlert(): void; clearPrivate(message?: string): void;
  refreshReviewHistory?(): void;
  setData(patch: Record<string, unknown>): void;
}
const status = (error: unknown) => error && typeof error === 'object' && 'statusCode' in error ? Number(error.statusCode) : 0;

export class PartnerApplicationSubmissionEditor {
  private generation = 0;
  private working?: Promise<void>;
  private intent?: { owner: string; version: number; key: string };
  constructor(private readonly host: Host) {}
  get busy() { return Boolean(this.working); }
  get locked() { return this.busy || this.host.data.submitUncertain; }
  invalidate() { ++this.generation; }
  clear() {
    this.invalidate(); this.working = undefined; this.intent = undefined;
    this.host.setData(submissionEditorData());
  }
  loaded() {
    if (this.host.data.readonly) {
      this.intent = undefined;
      this.host.setData({ submitUncertain: false });
    }
  }
  resume(): Promise<void> {
    if (this.working) return this.working.then(() => this.resume());
    if (this.host.active()) this.host.setData({ submitting: false, submitUncertain: Boolean(this.intent) });
    return Promise.resolve();
  }
  confirm() {
    const host = this.host;
    if (!host.active() || this.busy || host.submissionBlocked() || host.dialogPending ||
        host.data.readonly || host.data.formalArchive || !host.runtime?.submissions) return;
    if (!this.owned(host.ownerKey)) return;
    if (host.data.dirty || host.data.bankDirty || host.data.materialsDirty || host.data.materialsPending) {
      host.setData({ message: '请先保存各分区的修改后送审' }); return;
    }
    if (!host.data.version || host.data.needsVersionRefresh || host.data.bankNeedsRefresh || host.data.materialsNeedsRefresh) {
      host.setData({ message: '请先保存草稿或读取最新版本后送审' }); return;
    }
    const generation = ++this.generation;
    const owner = host.ownerKey;
    host.dialogPending = true;
    const done = () => { host.dialogPending = false; };
    try {
      wx.showModal({
        title: '确认送审', content: '送审后资料将冻结，等待审核。', confirmText: '提交',
        success: (result) => {
          if (!this.current(generation, owner) || !host.dialogPending) return;
          done(); if (result.confirm) void this.submit(generation, owner);
        },
        fail: () => {
          if (!this.current(generation, owner) || !host.dialogPending) return;
          done(); host.setData({ message: '确认未完成，请重试' });
        },
      });
    } catch {
      if (this.current(generation, owner)) { done(); host.setData({ message: '确认未完成，请重试' }); }
    }
  }
  private submit(generation: number, owner: string) {
    const host = this.host;
    let operationIntent: typeof this.intent;
    host.setData({ submitting: true, message: '' });
    const pending = Promise.resolve().then(async () => {
      if (!this.current(generation, owner)) return;
      if (!this.intent) {
        const version = host.data.version;
        const key = await newMaterialRequestKey();
        if (!this.current(generation, owner)) return;
        this.intent = { owner, version, key };
      }
      const intent = this.intent;
      operationIntent = intent;
      const result = await host.runtime!.submissions!.submit(intent.version, intent.key);
      if (!this.owned(owner)) return;
      if (result.applicationId !== host.data.applicationId) throw Object.assign(new Error('送审响应与当前申请不符'), { statusCode: 502 });
      if (this.intent === intent) this.intent = undefined;
      if (!this.current(generation, owner)) return;
      host.setData({ readonly: true, version: result.version, statusLabel: '待审核', submitting: false,
        submitUncertain: false, message: '资料已送审，等待审核' });
      host.syncUnloadAlert();
      host.refreshReviewHistory?.();
    }).catch((error: unknown) => {
      const knownFailure = status(error) >= 400 && status(error) < 500;
      // Settle the owned request even while hidden; visibility only controls UI delivery.
      if (knownFailure && operationIntent && this.intent === operationIntent &&
          owner === host.ownerKey && owner === host.runtime?.sessions.getSessionKey()) this.intent = undefined;
      if (!this.current(generation, owner)) return;
      if ([401, 403].includes(status(error))) { host.clearPrivate('申请登录已失效，请重新登录'); return; }
      host.setData({ submitUncertain: !knownFailure && Boolean(this.intent),
        needsVersionRefresh: status(error) === 409,
        message: status(error) === 409 ? '申请已更新，请读取最新版本'
          : status(error) >= 500 || !status(error) ? '送审结果尚未确认，请重试或读取最新状态'
          : error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '送审未完成，请检查资料后重试' });
    }).finally(() => {
      if (this.working === pending) this.working = undefined;
      if (this.current(generation, owner)) host.setData({ submitting: false });
    });
    this.working = pending;
  }
  private owned(owner: string) {
    if (!owner || owner !== this.host.ownerKey) return false;
    if (owner !== this.host.runtime?.sessions.getSessionKey()) {
      this.host.clearPrivate('申请登录已更新，请重新登录'); return false;
    }
    return true;
  }
  private current(generation: number, owner: string) {
    return generation === this.generation && this.host.active() && this.owned(owner);
  }
}
