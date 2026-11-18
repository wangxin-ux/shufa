import { BANK_LIMITS, type BankInformation, type PartnerApplicationBankService } from './partner-application-bank.service';

export const blankBank = () => ({ bankName: '', accountHolder: '', accountNumber: '' });
type BankForm = ReturnType<typeof blankBank>;
const fingerprint = (form: BankForm) => JSON.stringify(Object.values(form).map((value) => value.trim() || null));
export const bankEditorData = () => ({
  bankOpen: false, bankLoading: false, bankSaving: false, bankLoaded: false,
  bankForm: blankBank(), bankVersion: 0, bankDirty: false, bankReadonly: false,
  bankNeedsRefresh: false, bankMessage: '',
});
interface Host {
  data: ReturnType<typeof bankEditorData> & { formalArchive: boolean; readonly: boolean };
  runtime?: { banks?: PartnerApplicationBankService; sessions: { getSessionKey(): string } };
  ownerKey: string;
  active(): boolean;
  bankBlocked(): boolean;
  setData(patch: Partial<ReturnType<typeof bankEditorData>>): void;
  clearPrivate(message?: string): void;
  syncUnloadAlert(): void;
  loadDraft(preserve?: boolean): Promise<void>;
}
const status = (error: unknown) => error && typeof error === 'object' && 'statusCode' in error
  ? Number(error.statusCode) : 0;
const errorMessage = (error: unknown, fallback: string) => status(error) >= 500
  ? '银行信息服务暂时不可用，请稍后重试'
  : error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : fallback;

export class PartnerApplicationBankEditor {
  private generation = 0;
  private saved = fingerprint(blankBank());
  private reading?: Promise<void>;
  private writing?: Promise<void>;
  constructor(private readonly host: Host) {}
  get busy() { return Boolean(this.writing); }

  invalidate() { ++this.generation; this.reading = undefined; }
  clear() {
    this.invalidate();
    this.writing = undefined;
    this.saved = fingerprint(blankBank());
    this.host.setData(bankEditorData());
  }
  resume(): Promise<void> {
    if (this.writing) return this.writing.then(() => this.resume());
    if (!this.host.active()) return Promise.resolve();
    this.host.setData({ bankSaving: false, bankLoading: false });
    return this.host.data.bankOpen ? this.load(true) : Promise.resolve();
  }
  toggle() {
    const host = this.host;
    if (!host.active() || host.bankBlocked() || this.busy || host.data.formalArchive ||
        !host.runtime?.banks || !this.checkOwner()) return;
    if (this.reading) return;
    host.setData({ bankOpen: !host.data.bankOpen });
    if (host.data.bankOpen) void this.load(true);
  }
  input(field: string, value: unknown) {
    const host = this.host;
    if (!host.active() || host.bankBlocked() || this.busy || this.reading || !host.data.bankLoaded ||
        host.data.bankReadonly || host.data.readonly || !host.data.bankOpen || !this.checkOwner()) return;
    if (!Object.prototype.hasOwnProperty.call(BANK_LIMITS, field) || typeof value !== 'string' ||
        Array.from(value).length > BANK_LIMITS[field as keyof typeof BANK_LIMITS]) return;
    const bankForm = { ...host.data.bankForm, [field]: value };
    host.setData({ bankForm, bankDirty: fingerprint(bankForm) !== this.saved, bankMessage: '' });
    host.syncUnloadAlert();
  }
  reloadConflict() { return this.host.data.bankNeedsRefresh ? this.load(true) : Promise.resolve(); }

  load(preserve = false): Promise<void> {
    const host = this.host;
    if (!host.active() || host.bankBlocked() || this.busy || !host.runtime?.banks ||
        host.data.formalArchive || !this.checkOwner()) return Promise.resolve();
    if (this.reading) return this.reading;
    const generation = ++this.generation;
    const key = host.ownerKey;
    const retain = preserve && host.data.bankDirty;
    host.setData({ bankLoading: true, bankMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.current(generation, key)) return;
      return host.runtime!.banks!.load();
    }).then((view) => {
      if (!view || !this.current(generation, key)) return;
      const serverForm: BankForm = {
        bankName: view.bankInformation?.bankName ?? '',
        accountHolder: view.bankInformation?.accountHolder ?? '',
        accountNumber: view.bankInformation?.accountNumber ?? '',
      };
      this.saved = fingerprint(serverForm);
      const bankForm = retain && !view.readonly && !host.data.readonly ? { ...host.data.bankForm } : serverForm;
      host.setData({
        bankForm, bankVersion: view.version, bankLoaded: true, bankReadonly: view.readonly,
        bankDirty: fingerprint(bankForm) !== this.saved, bankNeedsRefresh: false, bankMessage: '',
      });
      host.syncUnloadAlert();
    }).catch((error: unknown) => {
      if (this.current(generation, key)) this.failure(error, false);
    }).finally(() => {
      if (this.reading === pending) this.reading = undefined;
      if (this.current(generation, key)) host.setData({ bankLoading: false });
    });
    this.reading = pending;
    return pending;
  }

  save(): Promise<void> {
    const host = this.host;
    if (!host.active() || host.bankBlocked() || this.busy || this.reading || !host.runtime?.banks ||
        !host.data.bankLoaded || host.data.bankReadonly || host.data.readonly || host.data.formalArchive ||
        host.data.bankNeedsRefresh || !this.checkOwner()) return Promise.resolve();
    const generation = ++this.generation;
    const key = host.ownerKey;
    const form = { ...host.data.bankForm };
    host.setData({ bankSaving: true, bankMessage: '' });
    let saved = false;
    const pending = Promise.resolve().then(() => {
      if (!this.current(generation, key)) return;
      return host.runtime!.banks!.save(host.data.bankVersion, form as BankInformation);
    }).then((receipt) => {
      if (!receipt || !this.current(generation, key)) return;
      this.saved = fingerprint(form);
      saved = true;
      host.setData({
        bankVersion: receipt.version, bankForm: form, bankDirty: false,
        bankNeedsRefresh: false, bankMessage: '银行信息已保存',
      });
      host.syncUnloadAlert();
    }).catch((error: unknown) => {
      if (this.current(generation, key)) this.failure(error, true);
    }).finally(() => {
      if (this.writing === pending) this.writing = undefined;
      if (this.current(generation, key)) host.setData({ bankSaving: false });
    });
    this.writing = pending;
    return pending.then(async () => {
      // Refresh basics from their own response, preserving unsaved institution fields.
      if (saved && this.current(generation, key)) await host.loadDraft(true);
    });
  }

  private checkOwner() {
    if (!this.host.ownerKey) return false;
    if (this.host.ownerKey !== this.host.runtime?.sessions.getSessionKey()) {
      this.host.clearPrivate('申请登录已更新，请重新登录');
      return false;
    }
    return true;
  }
  private current(generation: number, key: string) {
    return this.host.active() && generation === this.generation &&
      key === this.host.ownerKey && this.checkOwner();
  }
  private failure(error: unknown, write: boolean) {
    if ([401, 403].includes(status(error))) {
      this.host.clearPrivate(status(error) === 401 ? '申请登录已失效，请重新登录' : '当前账号无权查看银行信息');
      return;
    }
    this.host.setData({
      bankNeedsRefresh: write && status(error) === 409 || this.host.data.bankNeedsRefresh,
      bankMessage: write && status(error) === 409 ? '草稿已更新，银行修改尚未保存'
        : errorMessage(error, write ? '银行信息保存失败，请重试' : '银行信息读取失败，请重试'),
    });
  }
}
