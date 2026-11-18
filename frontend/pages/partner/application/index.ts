import { getPartnerApplicationRuntime } from '../runtime/partner-application-runtime';
import type { PartnerApplication } from '../runtime/partner-application.service';
import type { PartnerApplicantIdentity } from '../runtime/partner-applicant-session.service';
import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import { bankEditorData, PartnerApplicationBankEditor } from '../runtime/partner-application-bank-editor';
import { materialEditorData, PartnerApplicationMaterialEditor } from '../runtime/partner-application-material-editor';
import { submissionEditorData, PartnerApplicationSubmissionEditor } from '../runtime/partner-application-submission-editor';
import { reviewEditorData, PartnerApplicationReviewEditor } from '../runtime/partner-application-review-editor';

const blank = () => ({
  institutionName: '', province: '', city: '', district: '', detailedAddress: '', contactPhone: '',
});
type Form = ReturnType<typeof blank>;
const fingerprint = (form: Form) => JSON.stringify(
  Object.values(form).map((value) => value.trim() || null),
);
const statusLabels = {
  DRAFT: '草稿', SUBMITTED: '待审核', REJECTED: '已驳回', APPROVED: '已通过',
};
function statusCode(error: unknown): number {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number(error.statusCode) : 0;
}
function message(error: unknown, fallback: string): string {
  if (statusCode(error) >= 500) return '入驻服务暂时不可用，请稍后重试';
  return error instanceof Error && /[\u3400-\u9fff]/.test(error.message)
    ? error.message : fallback;
}

Page({
  hidden: false,
  disposed: false,
  initialShowPending: false,
  sequence: 0,
  navigationSequence: 0,
  pullSequence: 0,
  navigating: false,
  dialogPending: false,
  unloadAlertEnabled: false as boolean | undefined,
  unloadAlertSequence: 0,
  ownerKey: '',
  savedFingerprint: fingerprint(blank()),
  runtime: undefined as ReturnType<typeof getPartnerApplicationRuntime> | undefined,
  pendingLoad: undefined as Promise<void> | undefined,
  pendingSave: undefined as Promise<void> | undefined,
  pendingLogin: undefined as Promise<void> | undefined,
  bankEditor: undefined as PartnerApplicationBankEditor | undefined,
  materialEditor: undefined as PartnerApplicationMaterialEditor | undefined,
  submissionEditor: undefined as PartnerApplicationSubmissionEditor | undefined,
  reviewEditor: undefined as PartnerApplicationReviewEditor | undefined,
  data: {
    ...bankEditorData(),
    ...materialEditorData(),
    ...submissionEditorData(),
    ...reviewEditorData(),
    viewState: 'loading', errorMessage: '', message: '',
    form: blank(), region: [] as string[], regionLabel: '',
    applicationId: '', version: 0, statusLabel: '', identityLabel: '',
    readonly: false, archiveEmpty: false, formalArchive: false, approvalReady: false, dirty: false, saving: false, loggingIn: false,
    needsVersionRefresh: false, headerTopPx: 32, headerRightPx: 100,
  },

  onLoad() {
    this.bankEditor = new PartnerApplicationBankEditor(this);
    this.materialEditor = new PartnerApplicationMaterialEditor(this);
    this.submissionEditor = new PartnerApplicationSubmissionEditor(this);
    this.reviewEditor = new PartnerApplicationReviewEditor(this);
    void loadPartnerPdfDisplayFont();
    this.initialShowPending = true;
    try {
      const info = wx.getWindowInfo();
      const capsule = wx.getMenuButtonBoundingClientRect();
      this.setData({
        headerTopPx: capsule.height > 0 ? capsule.top : (info.statusBarHeight ?? 24) + 8,
        headerRightPx: capsule.height > 0 ? info.windowWidth - capsule.left + 8 : 100,
      });
    } catch { /* Keep the safe-area fallback when native metrics are unavailable. */ }
    void this.loadDraft();
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    this.navigating = false;
    this.dialogPending = false;
    this.syncUnloadAlert();
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    if (this.ownerKey && this.runtime?.sessions.getSessionKey() !== this.ownerKey) {
      this.clearPrivate('申请登录已更新，请重新登录');
    }
    const pending = this.pendingSave ?? this.pendingLogin;
    if (pending) {
      void pending.then(() => {
        if (!this.hidden && !this.disposed) void this.loadDraft(true);
      });
      return;
    }
    const interrupted = this.data.saving || this.data.bankSaving || this.data.viewState === 'loading';
    this.setData({ saving: false, loggingIn: false });
    if (this.submissionEditor?.busy) {
      void this.submissionEditor.resume().then(() => {
        if (this.active()) void this.loadDraft(true);
      });
      return;
    }
    void this.submissionEditor?.resume();
    if (this.reviewEditor?.busy) {
      void this.reviewEditor.resume().then(() => { if (this.active()) void this.loadDraft(true); });
      return;
    }
    void this.reviewEditor?.resume();
    if (this.bankEditor?.busy) {
      void this.bankEditor.resume().then(() => {
        if (this.active()) void this.loadDraft(true);
      });
      return;
    }
    if (this.materialEditor?.busy) {
      void this.materialEditor.resume().then(() => {
        if (this.active()) void this.loadDraft(true);
      });
      return;
    }
    if (this.data.dirty && this.runtime?.sessions.getSessionKey() === this.ownerKey) {
      if (interrupted) void this.loadDraft(true);
      else {
        void this.bankEditor?.resume();
        void this.materialEditor?.resume();
        this.reviewEditor?.loaded();
      }
      return;
    }
    void this.loadDraft();
  },
  onHide() {
    this.hidden = true;
    this.pullSequence += 1;
    this.setData({ approvalReady: false });
    this.bankEditor?.invalidate();
    this.materialEditor?.invalidate();
    this.submissionEditor?.invalidate();
    this.reviewEditor?.invalidate();
    this.syncUnloadAlert();
    this.runtime?.sessions.invalidateReads();
    this.initialShowPending = false;
    this.sequence += 1;
    this.navigationSequence += 1;
    this.pendingLoad = undefined;
    this.dialogPending = false;
    this.navigating = false;
  },
  onUnload() { this.disposed = true; this.onHide(); },
  onPullDownRefresh() {
    if (!this.active()) return;
    const sequence = ++this.pullSequence;
    if (this.data.dirty || this.data.bankDirty || this.data.materialsDirty || this.bankEditor?.busy ||
        this.materialEditor?.busy || this.submissionEditor?.busy || this.pendingSave || this.pendingLogin) {
      wx.stopPullDownRefresh();
      return;
    }
    void this.loadDraft().finally(() => {
      if (this.active() && sequence === this.pullSequence) wx.stopPullDownRefresh();
    });
  },
  active() { return !this.hidden && !this.disposed && !this.navigating; },
  syncUnloadAlert() {
    if (typeof wx.enableAlertBeforeUnload !== 'function' ||
        typeof wx.disableAlertBeforeUnload !== 'function') return;
    const enabled = this.active() && (this.data.dirty || this.data.bankDirty || this.data.materialsDirty) && !this.data.readonly &&
      !this.data.formalArchive && Boolean(this.ownerKey) &&
      this.runtime?.sessions.getSessionKey() === this.ownerKey;
    if (enabled === this.unloadAlertEnabled) return;
    const sequence = ++this.unloadAlertSequence;
    this.unloadAlertEnabled = enabled;
    const fail = () => {
      if (this.active() && sequence === this.unloadAlertSequence) {
        this.unloadAlertEnabled = undefined;
      }
    };
    try {
      if (enabled) {
        wx.enableAlertBeforeUnload({
          message: '修改尚未保存，离开后将丢弃本次修改。', fail,
        });
      } else wx.disableAlertBeforeUnload({ fail });
    } catch { fail(); }
  },
  current(sequence: number, key: string) {
    if (!this.active() || sequence !== this.sequence) return false;
    if (this.runtime?.sessions.getSessionKey() !== key) {
      this.clearPrivate(this.data.formalArchive
        ? '正式会话已更新，请返回重新登录' : '申请登录已更新，请重新登录');
      return false;
    }
    return true;
  },
  clearPrivate(errorMessage = '') {
    this.sequence += 1;
    this.navigationSequence += 1;
    this.pendingLoad = undefined;
    this.pendingSave = undefined;
    this.pendingLogin = undefined;
    this.dialogPending = false;
    this.runtime?.sessions.invalidateReads();
    this.bankEditor?.clear();
    this.materialEditor?.clear();
    this.submissionEditor?.clear();
    this.reviewEditor?.clear();
    this.ownerKey = '';
    this.savedFingerprint = fingerprint(blank());
    this.setData({
      viewState: this.data.formalArchive ? 'forbidden' : 'login', form: blank(), region: [], regionLabel: '',
      applicationId: '', version: 0, identityLabel: '', statusLabel: '', readonly: this.data.formalArchive, archiveEmpty: false,
      approvalReady: false, dirty: false, saving: false, loggingIn: false,
      needsVersionRefresh: false, message: '', errorMessage: errorMessage ||
        (this.data.formalArchive ? '正式登录已失效，请返回重新登录' : ''),
    });
    this.syncUnloadAlert();
  },
  loadDraft(preserve = false): Promise<void> {
    if (!this.active() || this.pendingSave || this.pendingLogin || this.bankEditor?.busy || this.materialEditor?.busy || this.submissionEditor?.busy || this.reviewEditor?.busy) return Promise.resolve();
    if (this.pendingLoad) return this.pendingLoad;
    const sequence = ++this.sequence;
    let key: string;
    try {
      this.runtime = getPartnerApplicationRuntime();
      this.setData({ formalArchive: Boolean(this.runtime.formalArchive) });
      this.syncUnloadAlert();
      key = this.runtime.sessions.getSessionKey();
      if (this.data.formalArchive || (this.ownerKey && this.ownerKey !== key)) {
        this.bankEditor?.clear();
        this.materialEditor?.clear();
        this.submissionEditor?.clear();
        this.reviewEditor?.clear();
      }
      if (!key) { this.clearPrivate(); return Promise.resolve(); }
    } catch (error) {
      this.setData({ viewState: 'error', errorMessage: message(error, '入驻服务连接失败，请重试') });
      return Promise.resolve();
    }
    const retain = preserve && this.ownerKey === key && this.data.dirty;
    this.setData({ viewState: 'loading', approvalReady: false, errorMessage: '', message: '' });
    const readError = (error: unknown): never => {
      if (this.active() && sequence === this.sequence && [401, 403].includes(statusCode(error))) {
        this.clearPrivate(statusCode(error) === 401
          ? this.data.formalArchive ? '正式登录已失效，请返回重新登录' : '申请登录已失效，请重新登录'
          : message(error, '当前账号无权查看入驻档案'));
      }
      throw error;
    };
    const pending = Promise.resolve().then(() => {
      if (!this.current(sequence, key)) return;
      return Promise.all([
        this.runtime!.sessions.loadMe().catch(readError), this.runtime!.applications.load().catch(readError),
      ]);
    }).then((result) => {
      if (!result) return;
      const [identity, application] = result;
      if (!this.current(sequence, key)) return;
      this.ownerKey = key;
      this.applyDraft(application, identity, retain);
    }).catch((error: unknown) => {
      if (!this.active() || sequence !== this.sequence) return;
      if (statusCode(error) === 401 || this.runtime?.sessions.getSessionKey() !== key) {
        this.clearPrivate(this.data.formalArchive
          ? '正式登录已失效，请返回重新登录' : '申请登录已失效，请重新登录');
        return;
      }
      if (statusCode(error) === 403) {
        this.clearPrivate(message(error, '当前账号无权查看入驻档案'));
        return;
      }
      this.setData({
        viewState: statusCode(error) === 403 ? 'forbidden' : 'error',
        errorMessage: message(error, '读取草稿失败，请重试'),
      });
    }).finally(() => {
      if (this.pendingLoad === pending) this.pendingLoad = undefined;
      if (this.current(sequence, key) && ['ready', 'empty'].includes(this.data.viewState)) {
        void this.bankEditor?.resume();
        void this.materialEditor?.resume();
      }
    });
    this.pendingLoad = pending;
    return pending;
  },
  applyDraft(application: PartnerApplication | null,
    identity: Pick<PartnerApplicantIdentity, 'displayName' | 'formalAccountReady'>, preserve: boolean) {
    const serverForm: Form = application ? {
      institutionName: application.basicInformation.institutionName ?? '',
      province: application.basicInformation.province ?? '',
      city: application.basicInformation.city ?? '',
      district: application.basicInformation.district ?? '',
      detailedAddress: application.basicInformation.detailedAddress ?? '',
      contactPhone: application.basicInformation.contactPhone ?? '',
    } : blank();
    const readonly = this.data.formalArchive || identity.formalAccountReady ||
      Boolean(application && application.status !== 'DRAFT');
    const form = preserve && !readonly ? { ...this.data.form } : serverForm;
    this.savedFingerprint = fingerprint(serverForm);
    this.setData({
      viewState: application ? 'ready' : 'empty', applicationId: application?.applicationId ?? '', version: application?.version ?? 0,
      statusLabel: application ? statusLabels[application.status] : readonly ? '暂无档案' : '尚未保存',
      identityLabel: identity.displayName, readonly, archiveEmpty: readonly && !application, form,
      approvalReady: !this.data.formalArchive && application?.status === 'APPROVED' && identity.formalAccountReady,
      region: [form.province, form.city, form.district],
      regionLabel: [form.province, form.city, form.district].filter(Boolean).join(' / '),
      dirty: fingerprint(form) !== this.savedFingerprint,
      saving: false, loggingIn: false, needsVersionRefresh: false, errorMessage: '', message: '',
    });
    this.syncUnloadAlert();
    this.submissionEditor?.loaded();
    this.reviewEditor?.loaded();
  },
  onFormalLogin() {
    if (!this.active() || !this.data.approvalReady || this.data.formalArchive || this.data.viewState !== 'ready') return;
    if (!this.ownerKey || this.runtime?.sessions.getSessionKey() !== this.ownerKey) {
      this.clearPrivate('申请登录已更新，请重新登录');
      return;
    }
    this.navigating = true;
    const sequence = ++this.navigationSequence;
    const owner = this.ownerKey;
    let consumed = false;
    const fail = () => {
      if (consumed) return;
      consumed = true;
      if (this.hidden || this.disposed || sequence !== this.navigationSequence) return;
      this.navigating = false;
      if (this.ownerKey !== owner || this.runtime?.sessions.getSessionKey() !== owner) {
        this.clearPrivate('申请登录已更新，请重新登录');
        return;
      }
      this.setData({ message: '打开登录失败，请重试' });
      const { bankLoading, materialsLoading, historyLoading } = this.data;
      if (bankLoading || materialsLoading || historyLoading) this.runtime?.sessions.invalidateReads();
      if (bankLoading) {
        this.bankEditor?.invalidate();
        void this.bankEditor?.load(true);
      }
      if (materialsLoading) {
        this.materialEditor?.invalidate();
        void this.materialEditor?.load(true);
      }
      if (historyLoading) {
        this.reviewEditor?.invalidate();
        this.reviewEditor?.loaded();
      }
    };
    try { wx.navigateTo({ url: '/pages/partner/login/index', fail }); } catch { fail(); }
  },
  onApplicantLogin(): Promise<void> {
    if (!this.active() || this.data.formalArchive || this.pendingLogin ||
        this.pendingSave || this.data.viewState !== 'login') {
      return Promise.resolve();
    }
    const sequence = ++this.sequence;
    this.setData({ loggingIn: true, errorMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || sequence !== this.sequence) return;
      this.runtime = getPartnerApplicationRuntime();
      return this.runtime.sessions.login();
    }).then((identity) => {
      if (!identity || !this.active() || sequence !== this.sequence) return;
      this.pendingLogin = undefined;
      this.setData({ loggingIn: false });
      return this.loadDraft();
    }).catch((error: unknown) => {
      if (!this.active() || sequence !== this.sequence) return;
      this.setData({
        viewState: 'login',
        errorMessage: statusCode(error) === 409
          ? '当前微信已有正式账号，不能重复申请入驻'
          : message(error, '申请登录失败，请重试'),
      });
    }).finally(() => {
      if (this.pendingLogin === pending) this.pendingLogin = undefined;
      if (this.active() && sequence === this.sequence) this.setData({ loggingIn: false });
    });
    this.pendingLogin = pending;
    return pending;
  },
  editable() {
    if (!this.active() || this.pendingLoad || this.pendingSave || this.pendingLogin || this.bankEditor?.busy || this.materialEditor?.busy || this.submissionEditor?.locked || this.reviewEditor?.busy ||
        this.dialogPending || this.data.readonly ||
        !['ready', 'empty'].includes(this.data.viewState)) return false;
    if (!this.ownerKey || this.runtime?.sessions.getSessionKey() !== this.ownerKey) {
      this.clearPrivate('申请登录已失效，请重新登录');
      return false;
    }
    return true;
  },
  updateForm(form: Form) {
    this.setData({
      form, dirty: fingerprint(form) !== this.savedFingerprint, message: '',
      region: [form.province, form.city, form.district],
      regionLabel: [form.province, form.city, form.district].filter(Boolean).join(' / '),
    });
    this.syncUnloadAlert();
  },
  onFieldInput(event: WechatMiniprogram.Input) {
    if (!this.editable()) return;
    const field = event.currentTarget.dataset.field as keyof Form;
    const value = event.detail.value;
    const limits = { institutionName: 200, detailedAddress: 300, contactPhone: 30 };
    if (!Object.prototype.hasOwnProperty.call(limits, field) || typeof value !== 'string') return;
    if (Array.from(value).length > limits[field as keyof typeof limits]) return;
    this.updateForm({ ...this.data.form, [field]: value });
  },
  onRegionChange(event: { detail: { value: unknown } }) {
    if (!this.editable()) return;
    const region = event.detail.value;
    if (!Array.isArray(region) || region.length !== 3 ||
        !region.every((value) => typeof value === 'string' && value.trim() && Array.from(value).length <= 100)) return;
    this.updateForm({ ...this.data.form, province: region[0], city: region[1], district: region[2] });
  },
  onClearRegion() {
    if (this.editable()) this.updateForm({ ...this.data.form, province: '', city: '', district: '' });
  },
  onSave(): Promise<void> {
    if (!this.editable() || this.data.needsVersionRefresh || !this.runtime) return Promise.resolve();
    const sequence = ++this.sequence;
    const key = this.ownerKey;
    this.setData({ saving: true, message: '' });
    let saved = false;
    const pending = Promise.resolve().then(() => {
      if (!this.current(sequence, key)) return;
      return this.runtime!.applications.saveBasics(this.data.version, { ...this.data.form });
    }).then((application) => {
      if (!application || !this.current(sequence, key)) return;
      this.applyDraft(application, {
        displayName: this.data.identityLabel, formalAccountReady: false,
      }, false);
      this.setData({ message: '草稿已保存' });
      saved = true;
    }).catch((error: unknown) => {
      if (!this.active() || sequence !== this.sequence) return;
      if ([401, 403].includes(statusCode(error)) || this.runtime?.sessions.getSessionKey() !== key) {
        this.clearPrivate('申请登录已失效，请重新登录');
        return;
      }
      this.setData({
        needsVersionRefresh: statusCode(error) === 409,
        message: statusCode(error) === 409
          ? '草稿已更新，当前修改尚未保存'
          : message(error, '保存失败，请重试'),
      });
    }).finally(() => {
      if (this.pendingSave === pending) this.pendingSave = undefined;
      if (this.active() && sequence === this.sequence) this.setData({ saving: false });
      if (saved && this.current(sequence, key)) {
        void this.bankEditor?.resume();
        void this.materialEditor?.resume();
      }
    });
    this.pendingSave = pending;
    return pending;
  },
  onConflictReload() {
    return this.data.needsVersionRefresh ? this.loadDraft(true) : Promise.resolve();
  },
  bankBlocked() {
    return Boolean(this.pendingLoad || this.pendingSave || this.pendingLogin || this.materialEditor?.busy || this.submissionEditor?.locked || this.dialogPending ||
      !['ready', 'empty'].includes(this.data.viewState));
  },
  materialsBlocked() {
    return Boolean(this.pendingLoad || this.pendingSave || this.pendingLogin || this.bankEditor?.busy || this.submissionEditor?.locked || this.dialogPending ||
      !['ready', 'empty'].includes(this.data.viewState));
  },
  submissionBlocked() {
    return Boolean(this.pendingLoad || this.pendingSave || this.pendingLogin || this.bankEditor?.busy ||
      this.materialEditor?.busy || this.data.bankLoading || this.data.materialsLoading ||
      !['ready', 'empty'].includes(this.data.viewState));
  },
  onSubmit() { this.submissionEditor?.confirm(); },
  refreshReviewHistory() { this.reviewEditor?.invalidate(); this.reviewEditor?.loaded(); },
  onReopen() { this.reviewEditor?.confirm(); },
  onHistoryRetry() {
    return this.data.historyNeedsRefresh ? this.loadDraft(true) : this.reviewEditor?.load() ?? Promise.resolve();
  },
  onHistoryMore() { return this.reviewEditor?.load(true) ?? Promise.resolve(); },
  onSubmissionReload() { return this.loadDraft(true); },
  onMaterialsToggle() { this.materialEditor?.toggle(); },
  onMaterialsRetry() { return this.materialEditor?.load(true) ?? Promise.resolve(); },
  onMaterialChoose(event: WechatMiniprogram.BaseEvent) {
    return this.materialEditor?.choose(event.currentTarget.dataset.kind as string) ?? Promise.resolve();
  },
  onMaterialRecover(event: WechatMiniprogram.BaseEvent) {
    return this.materialEditor?.recover(event.currentTarget.dataset.id as string) ?? Promise.resolve();
  },
  onMaterialRetryUpload() { return this.materialEditor?.retry() ?? Promise.resolve(); },
  onMaterialRemove(event: WechatMiniprogram.BaseEvent) {
    this.materialEditor?.remove(event.currentTarget.dataset.id as string);
  },
  onMaterialPreview(event: WechatMiniprogram.BaseEvent) {
    return this.materialEditor?.preview(event.currentTarget.dataset.id as string) ?? Promise.resolve();
  },
  onMaterialsSave() { return this.materialEditor?.save() ?? Promise.resolve(); },
  onBankToggle() { this.bankEditor?.toggle(); },
  onBankFieldInput(event: WechatMiniprogram.Input) {
    this.bankEditor?.input(event.currentTarget.dataset.field as string, event.detail.value);
  },
  onBankSave() { return this.bankEditor?.save() ?? Promise.resolve(); },
  onBankConflictReload() { return this.bankEditor?.reloadConflict() ?? Promise.resolve(); },
  onBankRetry() { return this.bankEditor?.load(true) ?? Promise.resolve(); },
  onRetry() { void this.loadDraft(this.data.dirty); },
  confirmDiscard(action: () => void) {
    if (!this.active() || this.dialogPending || this.pendingSave || this.pendingLogin || this.bankEditor?.busy || this.materialEditor?.busy || this.submissionEditor?.busy || this.reviewEditor?.busy) return;
    if (!this.data.dirty && !this.data.bankDirty && !this.data.materialsDirty) { action(); return; }
    this.dialogPending = true;
    const sequence = ++this.navigationSequence;
    const key = this.ownerKey;
    const current = () => {
      if (!this.active() || sequence !== this.navigationSequence) return false;
      if (key !== this.runtime?.sessions.getSessionKey()) {
        this.dialogPending = false;
        this.clearPrivate('申请登录已更新，请重新登录');
        return false;
      }
      return true;
    };
    const fail = () => {
      if (!current()) return;
      this.dialogPending = false;
      this.setData({ message: '确认未完成，请重试' });
    };
    try {
      wx.showModal({
        title: '修改尚未保存', content: '离开后将丢弃本次未保存的修改。',
        confirmText: '丢弃修改', cancelText: '继续填写',
        success: (result) => {
          if (!current()) return;
          this.dialogPending = false;
          if (result.confirm) action();
        },
        fail,
      });
    } catch { fail(); }
  },
  onBack() {
    this.confirmDiscard(() => {
      this.navigating = true;
      this.bankEditor?.invalidate();
      this.materialEditor?.invalidate();
      this.reviewEditor?.invalidate();
      this.syncUnloadAlert();
      this.runtime?.sessions.invalidateReads();
      this.sequence += 1;
      this.pendingLoad = undefined;
      const sequence = ++this.navigationSequence;
      const owner = this.ownerKey;
      let settled = false;
      let fallbackStarted = false;
      const current = () => {
        if (settled || this.disposed || this.hidden || sequence !== this.navigationSequence) return false;
        if (owner && (this.ownerKey !== owner || this.runtime?.sessions.getSessionKey() !== owner)) {
          settled = true;
          this.navigating = false;
          this.clearPrivate(this.data.formalArchive
            ? '正式会话已更新，请返回重新登录' : '申请登录已更新，请重新登录');
          return false;
        }
        return true;
      };
      const fail = () => {
        if (!current()) return;
        settled = true;
        this.navigating = false;
        this.setData(this.data.viewState === 'loading'
          ? { viewState: 'error', errorMessage: '返回失败，请重试' }
          : { message: '返回失败，请重试' });
        this.syncUnloadAlert();
        void this.bankEditor?.resume();
        void this.materialEditor?.resume();
        if (['ready', 'empty'].includes(this.data.viewState)) this.reviewEditor?.loaded();
      };
      const fallback = () => {
        if (fallbackStarted || !current()) return;
        fallbackStarted = true;
        try { wx.reLaunch({ url: '/pages/bootstrap/index', fail }); } catch { fail(); }
      };
      if (getCurrentPages().length > 1) {
        try { wx.navigateBack({ delta: 1, fail: fallback }); } catch { fallback(); }
      } else fallback();
    });
  },
  onApplicantLogout(): Promise<void> {
    if (!this.active() || this.data.formalArchive || !this.ownerKey) return Promise.resolve();
    if (this.runtime?.sessions.getSessionKey() !== this.ownerKey) {
      this.clearPrivate('申请登录已更新，请重新登录');
      return Promise.resolve();
    }
    let pending = Promise.resolve();
    this.confirmDiscard(() => {
      const runtime = this.runtime;
      this.pendingLoad = undefined;
      this.clearPrivate();
      const sequence = this.sequence;
      pending = runtime?.sessions.logout().catch(() => {
        if (this.active() && sequence === this.sequence) {
          this.setData({ errorMessage: '已退出，服务器暂未响应' });
        }
      }) ?? Promise.resolve();
    });
    return pending;
  },
});
