import type { SuperAdminStaffAccount, StaffAccountStatus } from '../../../types/super-admin';
import { createMutationKey } from '../../../utils/super-admin-format';
import type { HeadquartersManagementContext } from './headquarters-management.context';
import { headquartersAccount, ManagementError, record, responseInvalid } from './headquarters-management.types';

type Command = Readonly<{ kind: 'status'; target: SuperAdminStaffAccount; key: string;
  input: Readonly<{ expectedVersion: number; status: StaffAccountStatus }> } |
  { kind: 'unbind'; target: SuperAdminStaffAccount; key: string; input: Readonly<{ expectedVersion: number }> }>;
export const lifecycleInitial = {
  lifecycleLocked: false,
  lifecycleBusy: false, lifecycleConfirming: false, lifecycleUncertain: false,
  lifecycleReconciled: false, lifecycleConflict: false, lifecycleStale: false,
  lifecycleMessage: '', lifecycleTarget: null as SuperAdminStaffAccount | null,
};
function targetRow(value: unknown): SuperAdminStaffAccount {
  if (!headquartersAccount(value) || !record(value) ||
    !['BOUND', 'UNBOUND'].includes(String(value.bindingStatus)) ||
    typeof value.campusName !== 'string' || !value.campusName.trim() || value.campusName.length > 200 ||
    typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) ||
    !Number.isSafeInteger(value.version) || Number(value.version) >= Number.MAX_SAFE_INTEGER) responseInvalid();
  return value as unknown as SuperAdminStaffAccount;
}
export class HeadquartersLifecycleWorkflow {
  private pending?: Command; private flight?: object; private reading?: object; private dialog?: object;
  private target?: SuperAdminStaffAccount; private revision = 0; private stale = false; private reconciled = false;
  private receiptConfirmed = false;
  private rejection = '';
  constructor(private readonly context: HeadquartersManagementContext,
    private readonly output: (patch: Record<string, unknown>) => void,
    private readonly install: (row: SuperAdminStaffAccount) => void) {}
  blocked() { return Boolean(this.pending || this.flight || this.reading || this.dialog || this.stale); }
  private active() { return this.context.isActive(); }
  private emit(patch: Record<string, unknown>) { if (this.active()) this.output({ ...patch, lifecycleLocked: this.blocked() }); }
  private confirm(title: string, content: string, action: () => void) {
    if (!this.active() || this.dialog || this.flight || this.reading) return;
    const dialog = this.dialog = {}, revision = this.revision;
    this.emit({ lifecycleConfirming: true });
    const finish = (confirmed: boolean) => {
      if (this.dialog !== dialog || revision !== this.revision) return;
      this.dialog = undefined;
      if (!this.active()) return;
      this.emit({ lifecycleConfirming: false });
      if (confirmed) action();
    };
    wx.showModal({ title, content, confirmText: '确认', success: value => finish(value.confirm), fail: () => finish(false) });
  }
  start(value: unknown, kind: 'status' | 'unbind') {
    if (!this.active() || this.blocked()) return;
    let row: SuperAdminStaffAccount;
    try { row = targetRow(value); } catch { return; }
    if (kind === 'unbind' && row.bindingStatus !== 'BOUND') return;
    const target = Object.freeze({ ...row }), status: StaffAccountStatus = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    const command: Command = kind === 'status'
      ? { kind, target, key: createMutationKey('hq-status'), input: Object.freeze({ status, expectedVersion: row.version }) }
      : { kind, target, key: createMutationKey('hq-unbind'), input: Object.freeze({ expectedVersion: row.version }) };
    this.confirm(kind === 'unbind' ? '确认解除微信绑定' : status === 'DISABLED' ? '确认停用账号' : '确认启用账号',
      row.displayName + ' · ' + row.maskedPhone + ' · 版本 ' + row.version + '。' +
      (kind === 'unbind' ? '解除微信绑定，保留账号、其他登录身份及校区读取授权。' :
        status === 'DISABLED' ? '停用后现有登录立即失效，保留校区读取授权。' : '启用后恢复现有校区读取授权。'), () => {
        if (this.blocked()) return;
        this.target = target; this.pending = Object.freeze(command); void this.execute(command);
      });
  }
  private async execute(command: Command) {
    if (!this.active() || this.pending !== command || this.flight || this.reading) return;
    const flight = this.flight = {}, revision = this.revision;
    this.reconciled = false; this.stale = true; this.receiptConfirmed = false; this.rejection = '';
    this.emit({ lifecycleBusy: true, lifecycleStale: true, lifecycleReconciled: false,
      lifecycleConflict: false, lifecycleMessage: '', lifecycleTarget: command.target });
    try {
      const result = command.kind === 'status'
        ? await this.context.staff.updateStaffAccountStatus(command.target.id, command.input, command.key)
        : await this.context.staff.unbindStaffWechat(command.target.id, command.input, command.key);
      if (!this.active() || revision !== this.revision || this.pending !== command) return;
      if (result.status === 'error') throw new ManagementError(Number(result.statusCode) || 0, 'LIFECYCLE_FAILED', result.message);
      if (result.status !== 'success') responseInvalid();
      const receipt = targetRow(result.data);
      if (receipt.id !== command.target.id || receipt.version !== command.input.expectedVersion + 1 ||
        (command.kind === 'status' ? receipt.status !== command.input.status || receipt.bindingStatus !== command.target.bindingStatus
          : receipt.bindingStatus !== 'UNBOUND' || receipt.status !== command.target.status)) responseInvalid();
      this.pending = undefined;
      this.receiptConfirmed = true;
      this.emit({ lifecycleUncertain: false, lifecycleMessage: '原操作已确认，正在读取最新状态' });
    } catch (error) {
      if (!this.active() || revision !== this.revision || this.pending !== command) return;
      const failure = error instanceof ManagementError ? error : new ManagementError(0, 'LIFECYCLE_NETWORK_FAILED');
      const known = failure.statusCode >= 400 && failure.statusCode < 500 && ![408, 429].includes(failure.statusCode);
      if (known) this.pending = undefined;
      this.rejection = known ? failure.message : '';
      this.emit({ lifecycleUncertain: !known, lifecycleConflict: failure.statusCode === 409,
        lifecycleMessage: known ? failure.message : '操作结果待核对，请先读取最新状态' });
    } finally {
      if (this.flight === flight) {
        this.flight = undefined;
        if (this.active() && this.target) await this.reconcile();
      }
    }
  }
  async reconcile() {
    if (!this.active() || !this.target || this.flight || this.reading || this.dialog) return;
    const reading = this.reading = {}, revision = this.revision, pending = this.pending, id = this.target.id;
    this.stale = true; this.reconciled = false;
    this.emit({ lifecycleBusy: true, lifecycleStale: true, lifecycleReconciled: false, lifecycleUncertain: Boolean(pending) });
    try {
      const rows = await this.context.service.accounts(), target = targetRow(rows.find(row => record(row) && row.id === id));
      if (!this.active() || this.reading !== reading || revision !== this.revision || this.pending !== pending) return;
      this.target = target; this.stale = false; this.reconciled = Boolean(pending);
      this.install(target);
      this.emit({ lifecycleTarget: target, lifecycleStale: false, lifecycleReconciled: Boolean(pending),
        ...(pending ? { lifecycleMessage: '已读取最新状态；原操作回执仍待确认，可重试原操作' } :
          { lifecycleMessage: this.receiptConfirmed ? '原操作已确认，已读取最新状态' :
            '已读取最新状态；' + (this.rejection || '请重新确认操作') }) });
    } catch (error) {
      if (!this.active() || this.reading !== reading || revision !== this.revision) return;
      const message = error instanceof Error ? error.message : '账号数据读取失败，请重试';
      this.emit({ lifecycleMessage: message, lifecycleStale: true, lifecycleReconciled: false });
    } finally {
      if (this.reading === reading) { this.reading = undefined; this.emit({ lifecycleBusy: false }); }
    }
  }
  retry() {
    const command = this.pending;
    if (!this.active() || !command || !this.reconciled || this.stale || this.flight || this.reading || this.dialog) return;
    this.confirm('确认重试原操作', command.target.displayName + '。保留原操作内容和版本，重新获取确认回执。', () => {
      if (this.pending === command && this.reconciled && !this.stale) void this.execute(command);
    });
  }
  show() {
    if (!this.active() || !this.target || !this.blocked()) return;
    this.emit({ lifecycleTarget: this.target, lifecycleUncertain: Boolean(this.pending),
      lifecycleBusy: Boolean(this.flight), lifecycleStale: this.stale, lifecycleReconciled: false });
    if (!this.flight) void this.reconcile();
  }
  hide() {
    this.revision++; this.dialog = undefined; this.reading = undefined; this.reconciled = false;
    if (this.pending) this.stale = true;
    this.output({ ...lifecycleInitial });
  }
  clear() { this.pending = undefined; this.flight = undefined; this.target = undefined; this.stale = false; this.hide(); }
}
