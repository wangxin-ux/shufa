import { createMutationKey } from '../../../utils/super-admin-format';
import { HeadquartersManagementContext } from './headquarters-management.context';
import { headquartersAccount, ManagementError, normalizeCreation, type CampusChoice, type CampusGrant,
  type GrantInput, type HeadquartersAccount, type HeadquartersCreation } from './headquarters-management.types';

type Command = { kind: 'create'; key: string; input: HeadquartersCreation } |
  { kind: 'grant'; key: string; targetId: string; campusId: string; input: GrantInput; expectedReceiptVersion: number };
interface GrantView extends CampusGrant { name: string }
export const headquartersInitial = {
  hqBusy: false, hqConfirming: false, hqUncertain: false, hqReconciled: false, hqConflict: false,
  hqMessage: '', hqTarget: null as HeadquartersAccount | null, hqRows: [] as GrantView[],
  hqRetained: [] as GrantView[], hqGrantTotal: 0, hqSelectedIndex: 0, hqSelected: null as GrantView | null,
  hqDesired: false, hqReady: false,
};
export class HeadquartersWorkflow {
  private target?: HeadquartersAccount;
  private campuses: CampusChoice[] = []; private grants: CampusGrant[] = []; private rows: GrantView[] = [];
  private selected = 0; private desired = false; private ready = false; private loading = false;
  private dialog?: object; private flight?: object; private pending?: Command; private unknown = false;
  private reconciled = false; private revision = 0;
  constructor(readonly context: HeadquartersManagementContext, private readonly output: (patch: Record<string, unknown>) => void,
    private readonly refreshAccounts: () => Promise<void>) {}
  private emit(patch: Record<string, unknown>) {
    for (const name of ['hqRows', 'hqRetained']) {
      const rows = patch[name];
      if (!Array.isArray(rows)) continue;
      this.output({ [name]: rows.slice(0, 50) });
      for (let start = 50; start < rows.length; start += 50) {
        const batch: Record<string, unknown> = {};
        for (let index = start; index < Math.min(start + 50, rows.length); index++) batch[`${name}[${index}]`] = rows[index];
        this.output(batch);
      }
      delete patch[name];
    }
    this.output(patch);
  }
  blocked() { return Boolean(this.pending || this.flight || this.dialog || this.loading); }
  private active() { return this.context.isActive(); }
  private error(error: unknown) { return error instanceof ManagementError ? error : new ManagementError(0, 'MANAGEMENT_NETWORK_FAILED'); }
  private notice(message: string) { if (this.active()) this.emit({ hqMessage: message }); }
  private confirm(title: string, content: string, action: () => void) {
    if (!this.active() || this.dialog || this.flight || this.loading) return;
    const dialog = this.dialog = {}; this.emit({ hqConfirming: true });
    const finish = (confirmed: boolean) => {
      if (this.dialog !== dialog) return;
      this.dialog = undefined;
      if (!this.active()) return;
      this.emit({ hqConfirming: false });
      if (confirmed) action();
    };
    wx.showModal({ title, content, confirmText: '确认', success: value => finish(value.confirm), fail: () => finish(false) });
  }
  create(name: string, phone: string) {
    if (!this.active() || this.blocked()) return;
    let input: HeadquartersCreation;
    try { input = normalizeCreation(name, phone); } catch (error) { this.notice(this.error(error).message); return; }
    this.confirm('确认创建总部运营账号', input.displayName + '，手机号尾号' + input.phone.slice(-4) + '。新账号尚无可读校区。', () => {
      if (this.blocked()) return;
      const command: Command = { kind: 'create', input: Object.freeze({ ...input }), key: createMutationKey('hq-create') };
      this.pending = command; void this.execute(command);
    });
  }
  select(value: unknown) {
    if (!this.active() || this.blocked()) return;
    const target = headquartersAccount(value);
    if (!target) return;
    this.target = target; this.selected = 0; this.desired = false;
    this.emit({ ...headquartersInitial, hqTarget: target }); void this.refresh();
  }
  private install(target: HeadquartersAccount, campuses: CampusChoice[], grants: CampusGrant[]) {
    const selectedId = this.rows[this.selected]?.campusId;
    const known = new Set(campuses.map(row => row.id));
    if (grants.some(row => !known.has(row.campusId))) throw new ManagementError(502, 'MANAGEMENT_RESPONSE_INVALID', '授权校区资料不完整，请重新核对');
    this.target = target; this.campuses = campuses; this.grants = grants;
    this.rows = campuses.map(campus => ({ name: campus.name, ...(grants.find(row => row.campusId === campus.id) ??
      { userId: target.id, campusId: campus.id, isActive: false, version: 0 }) }));
    this.selected = Math.max(0, this.rows.findIndex(row => row.campusId === selectedId));
    this.desired = this.rows[this.selected]?.isActive ?? false; this.ready = true;
    this.emit({ hqTarget: target, hqRows: this.rows, hqRetained: grants.map(row =>
      ({ ...row, name: campuses.find(campus => campus.id === row.campusId)!.name })),
      hqGrantTotal: grants.length, hqReady: true, hqSelectedIndex: this.selected,
      hqSelected: this.rows[this.selected] ?? null, hqDesired: this.desired });
  }
  async refresh() {
    if (!this.active() || !this.target || this.loading || this.flight) return;
    const revision = ++this.revision, id = this.target.id;
    this.loading = true; this.ready = false; this.emit({ hqBusy: true, hqReady: false });
    try {
      const target = await this.context.service.target(id);
      const campuses = await this.context.service.campuses();
      const grants = await this.context.service.grants(id);
      if (!this.active() || revision !== this.revision) return;
      this.install(target, campuses, grants);
    } catch (error) {
      if (this.active() && revision === this.revision) this.notice(this.error(error).message);
    } finally {
      if (revision === this.revision) {
        this.loading = false;
        if (this.active()) this.emit({ hqBusy: Boolean(this.flight) });
      }
    }
  }
  choose(index: number) {
    if (!this.active() || this.blocked() || !this.ready || !Number.isInteger(index) || !this.rows[index]) return;
    this.selected = index; this.desired = this.rows[index].isActive;
    this.emit({ hqSelectedIndex: index, hqSelected: this.rows[index], hqDesired: this.desired, hqConflict: false, hqMessage: '' });
  }
  setDesired(value: unknown) {
    if (!this.active() || this.blocked() || !this.ready || typeof value !== 'boolean') return;
    this.desired = value; this.emit({ hqDesired: value, hqConflict: false });
  }
  grant() {
    const row = this.rows[this.selected], target = this.target;
    if (!this.active() || this.blocked() || !this.ready || !row || !target || row.isActive === this.desired ||
      this.desired && target.status !== 'ACTIVE') return;
    const command: Command = { kind: 'grant', targetId: target.id, campusId: row.campusId, key: createMutationKey('hq-grant'),
      input: Object.freeze({ isActive: this.desired, expectedVersion: row.version }), expectedReceiptVersion: row.version + 1 };
    this.confirm(this.desired ? '确认授权校区读取' : '确认撤销校区读取',
      target.displayName + '：' + row.name + '。' + (this.desired ? '可读取该校区汇总。' : '确认后立即停止该校区读取。'), () => {
        if (this.blocked()) return;
        this.pending = command; void this.execute(command);
      });
  }
  private async execute(command: Command) {
    if (!this.active() || this.flight || this.pending !== command) return;
    const flight = this.flight = {}; let reconcile = false;
    this.emit({ hqBusy: true, hqMessage: '', hqConflict: false, hqReconciled: false });
    try {
      if (command.kind === 'create') {
        const target = await this.context.service.create(command.input, command.key);
        if (!this.active() || this.pending !== command) return;
        this.target = target; this.emit({ hqTarget: target, createName: '', createPhone: '', createOpen: false });
      } else {
        const receipt = await this.context.service.update(command.targetId, command.campusId, command.input, command.key);
        if (receipt.version !== command.expectedReceiptVersion)
          throw new ManagementError(502, 'MANAGEMENT_RESPONSE_INVALID', '操作回执不完整，请核对原操作');
        if (!this.active() || this.pending !== command) return;
      }
      this.pending = undefined; this.unknown = false; this.reconciled = false;
      this.emit({ hqUncertain: false, hqReconciled: false, hqMessage: '原操作已确认，正在读取最新状态' });
    } catch (error) {
      if (!this.active() || this.pending !== command) return;
      const failure = this.error(error);
      if (failure.statusCode >= 400 && failure.statusCode < 500 && ![408, 429].includes(failure.statusCode)) {
        this.pending = undefined; this.unknown = false; this.reconciled = false;
        this.emit({ hqUncertain: false, hqReconciled: false, hqConflict: failure.statusCode === 409, hqMessage: failure.message });
      } else {
        this.unknown = true; reconcile = true;
        this.emit({ hqUncertain: true, hqReconciled: false, hqMessage: '操作结果待核对，请先读取最新状态' });
      }
    } finally {
      if (this.flight === flight) {
        this.flight = undefined;
        if (this.active()) {
          this.emit({ hqBusy: false });
          if (reconcile || this.pending && this.unknown) await this.reconcile();
          else if (!this.pending && this.target) { await this.refresh(); await this.refreshAccounts(); }
        }
      }
    }
  }
  async reconcile() {
    if (!this.active() || this.flight || this.loading) return;
    if (!this.pending) { await this.refresh(); return; }
    const command = this.pending, revision = ++this.revision;
    this.loading = true; this.reconciled = false; this.ready = false;
    this.emit({ hqBusy: true, hqReady: false, hqUncertain: true, hqReconciled: false });
    try {
      if (command.kind === 'create') await this.context.service.accounts(command.input.phone);
      else {
        const target = await this.context.service.target(command.targetId);
        const campuses = await this.context.service.campuses(), grants = await this.context.service.grants(command.targetId);
        if (!this.active() || this.pending !== command || revision !== this.revision) return;
        this.install(target, campuses, grants);
      }
      if (!this.active() || this.pending !== command || revision !== this.revision) return;
      this.reconciled = true;
      this.emit({ hqReconciled: true, hqMessage: '已读取最新状态；原操作回执仍待确认，可重试原操作' });
    } catch (error) {
      if (this.active() && revision === this.revision) this.notice(this.error(error).message);
    } finally {
      if (revision === this.revision) { this.loading = false; if (this.active()) this.emit({ hqBusy: false }); }
    }
  }
  retryOriginal() {
    const command = this.pending;
    if (!this.active() || !command || !this.unknown || !this.reconciled || this.flight || this.loading) return;
    this.confirm('确认重试原操作', '保留原操作内容，重新获取其确认回执。', () => {
      if (this.pending === command && this.reconciled) void this.execute(command);
    });
  }
  close() {
    if (!this.active() || this.blocked()) return;
    this.revision++; this.target = undefined; this.rows = []; this.grants = []; this.campuses = []; this.ready = false;
    this.emit({ ...headquartersInitial });
  }
  show() {
    if (!this.active()) return;
    if (this.pending) {
      this.unknown = true; this.reconciled = false;
      this.emit({ hqUncertain: true, hqBusy: Boolean(this.flight), hqTarget: this.target ?? null });
      if (!this.flight) void this.reconcile();
    } else if (this.target) void this.refresh();
  }
  hide() {
    this.revision++; this.dialog = undefined; this.loading = false; this.ready = false; this.reconciled = false;
    if (this.pending) this.unknown = true;
    this.output({ ...headquartersInitial });
  }
  clear() { this.pending = undefined; this.flight = undefined; this.unknown = false; this.target = undefined; this.rows = []; this.hide(); }
}
