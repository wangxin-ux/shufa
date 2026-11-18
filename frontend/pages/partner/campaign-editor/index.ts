import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import { campaignImageSlot, type CampaignImages, type CampaignImageSlot } from '../runtime/campaign-image';
import { cropRectangle } from '../runtime/campaign-image-crop';
import { normalizeRegistrationForm, type RegistrationQuestion } from '../runtime/campaign-registration-form';
import {
  CAMPAIGN_TYPES, getPartnerCampaignDraftService, normalizeCampaignBasics, normalizeCampaignContent,
  type CampaignBasics, type CampaignDraftReceipt, type CampaignType,
} from '../runtime/partner-campaign-draft.service';
import { logoutPartnerCampaignSession } from '../runtime/campaign-session-runtime';
import {
  getPartnerFreeCampaignService, normalizeFreeSettings,
  type FreeSettings, type FreeConfiguration, type FreeReview, type FreeRegistration,
} from '../runtime/free-campaign.service';
import { formatDateTimeLabel } from '../../../utils/format';
import {
  blankCampaignTime, campaignTimeFromInstant, campaignTimeToInstant, CampaignTimeInputError,
} from '../runtime/campaign-time-input';

const blank = () => ({
  title: '', campaignType: '' as CampaignType | '', shareDescription: '', contactPhone: '',
});
type Form = ReturnType<typeof blank>;
const fields = (form: Form): CampaignBasics => normalizeCampaignBasics({
  ...form, campaignType: form.campaignType || null,
});
const fingerprint = (form: Form) => JSON.stringify(
  [form.title.trim() || null, form.campaignType || null, form.shareDescription.trim() || null, form.contactPhone.trim() || null],
);
const toForm = (value: CampaignBasics): Form => ({
  title: value.title ?? '', campaignType: value.campaignType ?? '',
  shareDescription: value.shareDescription ?? '', contactPhone: value.contactPhone ?? '',
});
const statusCode = (error: unknown): number => typeof error === 'object' && error !== null &&
  'statusCode' in error ? Number(error.statusCode) : 0;
type Outcome = { receipt: CampaignDraftReceipt; fields: CampaignBasics } | { error: unknown };
const freeBlank = () => ({ startsAt: '', endsAt: '', capacityMode: '' as '' | 'UNLIMITED' | 'LIMITED', maxRegistrations: '' });
type FreeForm = ReturnType<typeof freeBlank>;
const freeTimeBlank = () => ({ startsAt: blankCampaignTime(), endsAt: blankCampaignTime() });
type FreeTimes = ReturnType<typeof freeTimeBlank>;
const freeFingerprint = (form: FreeForm, times: FreeTimes) => JSON.stringify([form, times]);
const freeTimes = (form: FreeForm, zone: string): FreeTimes => ({
  startsAt: campaignTimeFromInstant(form.startsAt, zone), endsAt: campaignTimeFromInstant(form.endsAt, zone),
});
const freeForm = (settings: FreeSettings): FreeForm => ({
  startsAt: settings.startsAt ?? '', endsAt: settings.endsAt ?? '',
  capacityMode: settings.capacityMode ?? '', maxRegistrations: settings.maxRegistrations === null ? '' : String(settings.maxRegistrations),
});
const freeFields = (form: FreeForm, times: FreeTimes, zone: string): FreeSettings => {
  if (form.maxRegistrations && !/^[1-9]\d*$/.test(form.maxRegistrations)) throw new Error('invalid capacity');
  return normalizeFreeSettings({
    startsAt: campaignTimeToInstant(times.startsAt, zone, form.startsAt.trim()),
    endsAt: campaignTimeToInstant(times.endsAt, zone, form.endsAt.trim()),
    capacityMode: form.capacityMode || null, maxRegistrations: form.maxRegistrations ? Number(form.maxRegistrations) : null,
  });
};
const freeValidationMessage = (error: unknown): string => {
  if (error instanceof CampaignTimeInputError) {
    if (error.code === 'INCOMPLETE') return '请完整选择日期与时间，或清空该时间';
    if (error.code === 'NONEXISTENT') return '所选时间在校区时区不存在，请调整';
    if (error.code === 'AMBIGUOUS') return '所选时间在校区时区重复，请调整';
  }
  return '时间或名额不符合要求，请核对';
};
const reviewLabel = (v: FreeReview, zone: string) => ({
  ...v, statusLabel: { SUBMITTED: '待审核', APPROVED: '已批准', REJECTED: '已驳回' }[v.status],
  submittedLabel: formatDateTimeLabel(v.submittedAt, zone),
  reviewedLabel: v.reviewedAt ? formatDateTimeLabel(v.reviewedAt, zone) : '',
});
const registrationLabel = (v: FreeRegistration, zone: string) => ({
  ...v, statusLabel: v.status === 'REGISTERED' ? '已报名' : '已撤销',
  studentLabel: v.studentName ?? '信息不可见', registeredLabel: formatDateTimeLabel(v.registeredAt, zone),
  cancelledLabel: v.cancelledAt ? formatDateTimeLabel(v.cancelledAt, zone) : '',
});
const FREE_SHARE_IMAGE = '/pages/partner/assets/profile-mark.png';
const REGISTRATION_FILTERS: Array<{ label: string; value: 'ALL' | FreeRegistration['status'] }> = [
  { label: '全部', value: 'ALL' }, { label: '已报名', value: 'REGISTERED' }, { label: '已撤销', value: 'CANCELLED' },
];

Page({
  hidden: false, disposed: false, navigating: false, dialogPending: false,
  loginStopped: false, pullSequence: 0,
  initialShowPending: false, sequence: 0, navigationSequence: 0, alertSequence: 0,
  alertEnabled: false as boolean | undefined,
  ownerKey: '', savedFingerprint: fingerprint(blank()),
  runtime: undefined as ReturnType<typeof getPartnerCampaignDraftService> | undefined,
  pendingLoad: undefined as Promise<void> | undefined,
  pendingSave: undefined as Promise<void> | undefined,
  pendingSaveAll: undefined as Promise<void> | undefined, saveAllSequence: 0,
  outcome: undefined as Outcome | undefined,
  createAttempt: undefined as { key: string; fields: CampaignBasics; sent: boolean } | undefined,
  savedContent: null as string | null,
  savedRegistrationForm: '[]',
  registrationSaveAttempt: undefined as {
    id: string; version: number; questions: RegistrationQuestion[]; sent: boolean;
  } | undefined,
  imageEdits: {} as Partial<Record<CampaignImageSlot, string | null>>,
  pendingImageChoice: undefined as Promise<void> | undefined,
  imageSaveAttempt: undefined as { id: string; version: number; slot: CampaignImageSlot; path: string | null; key: string; sent: boolean } | undefined,
  contentSaveAttempt: undefined as { id: string; version: number; content: string | null; sent: boolean } | undefined,
  freeRuntime: undefined as ReturnType<typeof getPartnerFreeCampaignService> | undefined,
  freeOwnerKey: '', freeSavedFingerprint: freeFingerprint(freeBlank(), freeTimeBlank()),
  freePending: undefined as Promise<void> | undefined,
  freeSaveAttempt: undefined as { id: string; version: number; settings: FreeSettings; sent: boolean } | undefined,
  submitAttempt: undefined as {
    id: string; version: number; key: string; sent: boolean;
    receipt?: Pick<FreeReview, 'campaignId' | 'versionId'>;
  } | undefined,
  submissionReadPending: undefined as Promise<void> | undefined,
  submissionReadGeneration: 0,
  freeConfiguration: undefined as FreeConfiguration | undefined,
  listSequence: 0, listPending: undefined as Promise<void> | undefined,
  copySequence: 0, copying: false,
  shareMenuEnabled: undefined as boolean | undefined,
  publishedImage: undefined as {
    versionId: string; imageId: string; path: string; pending: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | undefined,
  hiddenPrivateDenied: false,
  data: {
    viewState: 'loading', message: '', form: blank(), types: CAMPAIGN_TYPES, editorTab: 'edit' as 'edit' | 'preview',
    draftId: '', version: 0, dirty: false, saving: false, reading: false, savingAll: false,
    needsVersionRefresh: false, createUncertain: false, titleCount: 0,
    content: '', contentCount: 0, contentDirty: false, contentSaveUnknown: false,
    registrationQuestions: [] as RegistrationQuestion[], registrationDirty: false, registrationSaveUnknown: false,
    imagePreviews: { cover: '', share: '' }, imageDirty: false, imageSaveUnknown: false, imageChoosing: false,
    imageCropSource: '', imageCropSlot: 'cover' as CampaignImageSlot,
    imageSlots: [{ key: 'cover', label: '活动封面', size: '750×1125' }, { key: 'share', label: '转发图', size: '4:3' }],
    headerTopPx: 32, headerRightPx: 100,
    freeForm: freeBlank(), freeTimes: freeTimeBlank(), freeReady: false, freeDirty: false, freeSaving: false, freeSaveUnknown: false,
    submitting: false, submitUncertain: false, submitRefreshNeeded: false, freeMessage: '', campusTimezone: '',
    startsLabel: '', endsLabel: '', publishedPath: '', lifecycle: '', canSharePublished: false, hasFreeCampaign: false,
    shareImageMessage: '',
    freeTab: 'history' as 'history' | 'registrations',
    history: [] as Array<ReturnType<typeof reviewLabel>>,
    registrations: [] as Array<ReturnType<typeof registrationLabel>>,
    historyPage: 0, historyHasMore: false, registrationPage: 0, registrationHasMore: false,
    registrationTotal: 0, registrationFilters: REGISTRATION_FILTERS, registrationFilterIndex: 0, registrationCountLabel: '',
    listLoading: false, listError: '', hasPendingReview: false,
  },
  onLoad(query: Record<string, string | undefined>) {
    void loadPartnerPdfDisplayFont();
    this.initialShowPending = true;
    this.runtime = getPartnerCampaignDraftService();
    this.ownerKey = this.runtime.getSessionKey();
    this.freeRuntime = getPartnerFreeCampaignService();
    this.freeOwnerKey = this.freeRuntime.getSessionKey();
    this.syncShareMenu();
    try {
      const info = wx.getWindowInfo();
      const capsule = wx.getMenuButtonBoundingClientRect();
      this.setData({
        headerTopPx: capsule.height > 0 ? capsule.top : (info.statusBarHeight ?? 24) + 8,
        headerRightPx: capsule.height > 0 ? info.windowWidth - capsule.left + 8 : 100,
      });
    } catch { /* Preserve safe-area defaults if native measurements fail. */ }
    if (query.id) {
      this.setData({ draftId: query.id });
      void this.load(false);
    } else {
      const type = CAMPAIGN_TYPES.find((item) => item.value === query.type);
      const form = { ...blank(), ...(type ? { campaignType: type.value } : {}) };
      this.setData({ viewState: 'ready', form, dirty: fingerprint(form) !== this.savedFingerprint });
      this.syncAlert();
    }
  },
  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (this.loginStopped) return;
    this.navigating = false;
    this.dialogPending = false;
    if (!this.checkOwner()) return;
    if (this.hiddenPrivateDenied) {
      this.clearPrivate('登录失效或活动已不可访问，请重新登录');
      return;
    }
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    if (this.pendingImageChoice) {
      void this.pendingImageChoice.then(() => { if (this.active()) this.onShow(); });
      return;
    }
    this.setData({ imageChoosing: Boolean(this.data.imageCropSource) });
    if (this.data.imageCropSource) return;
    if (this.pendingSaveAll) {
      void this.pendingSaveAll.then(() => { if (this.active()) this.onShow(); });
      return;
    }
    this.setData({ savingAll: false });
    if (this.freePending) {
      void this.freePending.then(() => { if (this.active()) this.onShow(); });
      return;
    }
    if (this.submitAttempt?.receipt) {
      this.setData({ freeSaving: false, submitting: false, reading: Boolean(this.submissionReadPending), listLoading: false,
        submitUncertain: false, submitRefreshNeeded: true, freeMessage: '送审已确认，请读取最新审核状态' });
      this.syncAlert();
      return;
    }
    if (this.submitAttempt?.sent || this.freeSaveAttempt?.sent || this.contentSaveAttempt?.sent ||
      this.imageSaveAttempt?.sent || this.registrationSaveAttempt?.sent) {
      this.setData({
        saving: false, freeSaving: false, submitting: false, reading: false,
        submitUncertain: Boolean(this.submitAttempt?.sent), freeSaveUnknown: Boolean(this.freeSaveAttempt?.sent),
        contentSaveUnknown: Boolean(this.contentSaveAttempt?.sent),
        imageSaveUnknown: Boolean(this.imageSaveAttempt?.sent),
        registrationSaveUnknown: Boolean(this.registrationSaveAttempt?.sent),
        message: this.registrationSaveAttempt?.sent ? '表单保存结果暂未确认，请重试原保存'
          : this.imageSaveAttempt?.sent ? '图片保存结果暂未确认，请重试原保存'
          : this.contentSaveAttempt?.sent ? '正文保存结果暂未确认，请重试原保存' : this.data.message,
        freeMessage: '操作结果暂未确认，请重试原操作',
      });
      this.syncAlert();
      return;
    }
    if (this.pendingSave) {
      void this.pendingSave.then(() => { if (this.active()) this.applyOutcome(); });
      return;
    }
    if (this.outcome) { this.applyOutcome(); return; }
    this.setData({ saving: false, reading: false, freeSaving: false, submitting: false, listLoading: false });
    this.syncAlert();
    if (this.data.needsVersionRefresh) return;
    if (this.data.draftId) void this.load(this.data.dirty || this.data.freeDirty);
  },
  onHide() {
    this.hidden = true;
    this.saveAllSequence += 1;
    this.pullSequence += 1;
    this.freeConfiguration = undefined;
    this.resetPublishedImage();
    this.initialShowPending = false;
    this.sequence += 1;
    this.navigationSequence += 1;
    this.pendingLoad = undefined;
    this.submissionReadPending = undefined;
    this.listSequence += 1;
    this.listPending = undefined;
    this.copySequence += 1;
    this.copying = false;
    this.dialogPending = false;
    this.syncAlert();
  },
  onUnload() { this.disposed = true; this.onHide(); },
  active() { return !this.hidden && !this.disposed && !this.navigating && !this.loginStopped; },
  checkOwner() {
    if (this.runtime?.getSessionKey() === this.ownerKey && this.freeRuntime?.getSessionKey() === this.freeOwnerKey) return true;
    this.clearPrivate('登录已更新，请重新登录');
    return false;
  },
  clearPrivate(message: string) {
    this.sequence += 1;
    this.saveAllSequence += 1;
    this.navigationSequence += 1;
    this.navigating = false;
    this.dialogPending = false;
    this.pendingLoad = undefined;
    this.createAttempt = undefined;
    this.contentSaveAttempt = undefined;
    this.registrationSaveAttempt = undefined;
    this.savedRegistrationForm = '[]';
    this.imageEdits = {};
    this.imageSaveAttempt = undefined;
    this.savedContent = null;
    this.outcome = undefined;
    this.freeSaveAttempt = undefined;
    this.submitAttempt = undefined;
    this.submissionReadPending = undefined;
    this.freeConfiguration = undefined;
    this.resetPublishedImage();
    this.freeSavedFingerprint = freeFingerprint(freeBlank(), freeTimeBlank());
    this.listSequence += 1;
    this.listPending = undefined;
    this.copySequence += 1;
    this.copying = false;
    this.hiddenPrivateDenied = false;
    this.savedFingerprint = fingerprint(blank());
    this.setData({
      viewState: 'forbidden', message, form: blank(), draftId: '', version: 0, editorTab: 'edit',
      dirty: false, saving: false, reading: false, savingAll: false, titleCount: 0,
      needsVersionRefresh: false, createUncertain: false,
      content: '', contentCount: 0, contentDirty: false, contentSaveUnknown: false,
      registrationQuestions: [], registrationDirty: false, registrationSaveUnknown: false,
      imagePreviews: { cover: '', share: '' }, imageDirty: false, imageSaveUnknown: false, imageChoosing: false,
      imageCropSource: '', imageCropSlot: 'cover',
      freeForm: freeBlank(), freeTimes: freeTimeBlank(), freeDirty: false, freeReady: false, freeSaving: false, freeSaveUnknown: false,
      submitting: false, submitUncertain: false, submitRefreshNeeded: false, freeMessage: '', campusTimezone: '',
      startsLabel: '', endsLabel: '', history: [], registrations: [], publishedPath: '', lifecycle: '', hasFreeCampaign: false,
      shareImageMessage: '',
      historyPage: 0, historyHasMore: false, registrationPage: 0, registrationHasMore: false,
      registrationTotal: 0, registrationFilterIndex: 0, registrationCountLabel: '',
      listLoading: false, listError: '', hasPendingReview: false,
    });
    this.syncAlert();
  },
  load(preserve: boolean, explicit = false): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.runtime || !this.data.draftId) return Promise.resolve();
    if (this.pendingLoad) return this.pendingLoad;
    if (this.pendingSave || this.freePending || this.data.imageChoosing || this.data.imageSaveUnknown ||
      this.data.createUncertain || this.data.freeSaveUnknown || this.data.contentSaveUnknown || this.data.registrationSaveUnknown ||
      this.data.submitUncertain || this.data.submitRefreshNeeded || (this.data.needsVersionRefresh && !explicit)) return Promise.resolve();
    const sequence = ++this.sequence;
    const id = this.data.draftId;
    const hadContent = this.data.viewState === 'ready';
    this.resetPublishedImage();
    this.setData({ reading: true, message: '', ...(hadContent ? {} : { viewState: 'loading' }) });
    this.syncShareMenu();
    const pending = Promise.resolve().then(async () => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      const draft = await this.freeRuntime!.getBasicDraft(id);
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      const config = await this.freeRuntime!.getConfiguration(id);
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      const images = await this.freeRuntime!.getImages(id);
      return { draft, config, images };
    }).then((loaded) => {
      if (!loaded || !this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      const { draft, config, images } = loaded;
      if (config.version !== draft.version || images.version !== draft.version || draft.version < this.data.version) {
        this.freeConfiguration = undefined;
        this.resetPublishedImage();
        this.setData({ reading: false, needsVersionRefresh: true, viewState: hadContent ? 'ready' : 'error',
          message: '草稿在读取时已更新，请重新读取最新版本', freeReady: false, publishedPath: '' });
        return;
      }
      const serverForm = toForm(draft.basicInformation);
      const content = preserve || this.data.contentDirty ? this.data.content : draft.activityContent ?? '';
      this.savedRegistrationForm = JSON.stringify(draft.registrationForm ?? []);
      const registrationQuestions = preserve || this.data.registrationDirty
        ? this.data.registrationQuestions : draft.registrationForm ?? [];
      this.savedContent = draft.activityContent ?? null;
      this.savedFingerprint = fingerprint(serverForm);
      const form = preserve || this.data.dirty ? this.data.form : serverForm;
      this.setData({
        form, version: draft.version, viewState: 'ready', reading: false,
        dirty: fingerprint(form) !== this.savedFingerprint, titleCount: Array.from(form.title).length,
        content, contentCount: Array.from(content).length, contentDirty: (content.trim() || null) !== this.savedContent,
        registrationQuestions, registrationDirty: JSON.stringify(registrationQuestions) !== this.savedRegistrationForm,
        needsVersionRefresh: false, message: preserve ? '已读取最新版本，保留你的修改，请核对后保存' : '',
      });
      this.applyConfiguration(config, preserve || this.data.freeDirty,
        draft.basicInformation.campaignType === 'FREE_REGISTRATION');
      this.applyImages(images);
      this.syncAlert();
      void this.loadFreeList(true);
    }).catch((error: unknown) => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      if ([401, 403, 404].includes(statusCode(error))) {
        this.clearPrivate(statusCode(error) === 404 ? '活动草稿不存在或已不可访问' : '登录已失效或无访问权限，请重新登录');
      } else {
        this.freeConfiguration = undefined;
        this.resetPublishedImage();
        this.setData({
          reading: false, viewState: hadContent ? 'ready' : 'error',
          needsVersionRefresh: hadContent || this.data.needsVersionRefresh,
          message: '草稿读取失败，请重试', publishedPath: '',
        });
      }
    }).finally(() => {
      if (sequence === this.sequence) {
        this.pendingLoad = undefined;
        this.syncShareMenu();
      }
    });
    this.pendingLoad = pending;
    return pending;
  },
  onEditorTab(event: WechatMiniprogram.TouchEvent) {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.writesBlocked() || this.data.reading || this.data.createUncertain) return;
    const tab: unknown = event.currentTarget.dataset.tab;
    if ((tab !== 'edit' && tab !== 'preview') || tab === this.data.editorTab) return;
    this.setData({ editorTab: tab });
    try { if (typeof wx.pageScrollTo === 'function') wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch { /* Keep the selected view if scrolling is unavailable. */ }
  },
  onInput(event: WechatMiniprogram.Input) {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.writesBlocked() || this.data.reading || this.data.createUncertain) return;
    const field = String(event.currentTarget.dataset.field);
    if (!['title', 'shareDescription', 'contactPhone'].includes(field)) return;
    const form = { ...this.data.form, [field]: String(event.detail.value ?? '') };
    this.setData({ form, dirty: fingerprint(form) !== this.savedFingerprint, titleCount: Array.from(form.title).length, message: '' });
    this.syncAlert();
  },
  onTypeChange(event: WechatMiniprogram.RadioGroupChange) {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.writesBlocked() || this.data.reading || this.data.createUncertain) return;
    const value = event.detail.value;
    if (value !== '' && !CAMPAIGN_TYPES.some((type) => type.value === value)) return;
    const form = { ...this.data.form, campaignType: value as CampaignType | '' };
    this.setData({ form, dirty: fingerprint(form) !== this.savedFingerprint, message: '' });
    this.syncAlert();
  },
  onContentInput(event: WechatMiniprogram.Input) {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.writesBlocked() || this.data.reading || this.data.createUncertain) return;
    const content = String(event.detail.value ?? '');
    this.setData({ content, contentCount: Array.from(content).length,
      contentDirty: (content.trim() || null) !== this.savedContent, message: '' });
    this.syncAlert();
  },
  onRegistrationFormChange(event: WechatMiniprogram.CustomEvent<{ questions: RegistrationQuestion[] }>) {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' || this.data.editorTab !== 'edit' ||
      this.writesBlocked() || this.data.reading || this.data.createUncertain) return;
    const questions = event.detail.questions;
    if (!Array.isArray(questions) || questions.length > 20) return;
    this.setData({ registrationQuestions: questions,
      registrationDirty: JSON.stringify(questions) !== this.savedRegistrationForm, message: '' });
    this.syncAlert();
  },
  applyImages(value: CampaignImages) {
    this.setData({ imagePreviews: {
      cover: Object.prototype.hasOwnProperty.call(this.imageEdits, 'cover') ? this.imageEdits.cover ?? '' : value.images.cover?.accessUrl ?? '',
      share: Object.prototype.hasOwnProperty.call(this.imageEdits, 'share') ? this.imageEdits.share ?? '' : value.images.share?.accessUrl ?? '',
    }, imageDirty: Object.keys(this.imageEdits).length > 0 });
  },
  onImageChoose(event: WechatMiniprogram.TouchEvent): Promise<void> {
    const slot: unknown = event.currentTarget.dataset.slot;
    if (!campaignImageSlot(slot) || !this.active() || !this.checkOwner() || this.writesBlocked() ||
      this.data.reading || this.data.createUncertain || this.data.viewState !== 'ready') return Promise.resolve();
    const owner = this.ownerKey, freeOwner = this.freeOwnerKey;
    // The native picker may finish before the page's onShow callback.
    const current = () => !this.disposed && !this.navigating && !this.loginStopped &&
      this.ownerKey === owner && this.freeOwnerKey === freeOwner && this.checkOwner();
    this.setData({ imageChoosing: true, message: '' });
    const pending = new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve, reject) => {
      try { wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['original'], success: resolve, fail: reject }); }
      catch (error) { reject(error); }
    }).then(async result => {
      if (!current()) return;
      const file = result.tempFiles[0];
      if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > 3145728) {
        this.setData({ message: '请选择不超过3MB的图片' }); return;
      }
      const info = await new Promise<WechatMiniprogram.GetImageInfoSuccessCallbackResult>((resolve, reject) => {
        try { wx.getImageInfo({ src: file.tempFilePath, success: resolve, fail: reject }); } catch (error) { reject(error); }
      });
      if (!current()) return;
      if (!['png', 'jpeg', 'jpg'].includes(info.type)) {
        this.setData({ message: '请选择JPEG或PNG图片' }); return;
      }
      try { cropRectangle(info.width, info.height, slot, 1, .5, .5); }
      catch { this.setData({ message: '图片像素过大或无效，请换一张图片' }); return; }
      if ((info.orientation && info.orientation !== 'up') ||
        (slot === 'cover' ? info.width !== 750 || info.height !== 1125 : info.width * 3 !== info.height * 4)) {
        this.setData({ imageCropSource: file.tempFilePath, imageCropSlot: slot }); return;
      }
      this.imageEdits[slot] = file.tempFilePath;
      this.setData({ imagePreviews: { ...this.data.imagePreviews, [slot]: file.tempFilePath }, imageDirty: true, message: '' });
      this.syncAlert();
    }).catch((error: unknown) => {
      if (!current()) return;
      const cancelled = typeof error === 'object' && error !== null && 'errMsg' in error && String(error.errMsg).includes('cancel');
      if (!cancelled) this.setData({ message: '图片选择失败，请重试' });
    }).finally(() => {
      if (this.pendingImageChoice === pending) this.pendingImageChoice = undefined;
      if (current()) this.setData({ imageChoosing: Boolean(this.data.imageCropSource) });
    });
    this.pendingImageChoice = pending;
    return pending;
  },
  onImageCrop(event: WechatMiniprogram.TouchEvent) {
    const slot: unknown = event.currentTarget.dataset.slot;
    if (!campaignImageSlot(slot) || !this.active() || !this.checkOwner() || this.writesBlocked() ||
      this.data.reading || this.data.createUncertain || this.data.viewState !== 'ready') return;
    const source = this.data.imagePreviews[slot];
    if (source) this.setData({ imageChoosing: true, imageCropSource: source, imageCropSlot: slot, message: '' });
  },
  onImageCropCancel(event: WechatMiniprogram.CustomEvent<{ source: string }>) {
    if (!this.active() || !this.checkOwner() || !this.data.imageCropSource ||
      event.detail.source !== this.data.imageCropSource) return;
    this.setData({ imageChoosing: false, imageCropSource: '' });
  },
  onImageCropConfirm(event: WechatMiniprogram.CustomEvent<{ source: string; slot: CampaignImageSlot; path: string }>) {
    if (!this.active() || !this.checkOwner() || !this.data.imageChoosing || !this.data.imageCropSource ||
      event.detail.source !== this.data.imageCropSource || event.detail.slot !== this.data.imageCropSlot ||
      typeof event.detail.path !== 'string' || !event.detail.path) return;
    const { slot, path } = event.detail;
    this.imageEdits[slot] = path;
    this.setData({ imageChoosing: false, imageCropSource: '',
      imagePreviews: { ...this.data.imagePreviews, [slot]: path }, imageDirty: true, message: '' });
    this.syncAlert();
  },
  onImageClear(event: WechatMiniprogram.TouchEvent) {
    const slot: unknown = event.currentTarget.dataset.slot;
    if (!campaignImageSlot(slot) || !this.active() || !this.checkOwner() || this.writesBlocked() || this.data.reading) return;
    this.imageEdits[slot] = null;
    this.setData({ imagePreviews: { ...this.data.imagePreviews, [slot]: '' }, imageDirty: true, message: '' });
    this.syncAlert();
  },
  onImagePreview(event: WechatMiniprogram.TouchEvent) {
    const slot: unknown = event.currentTarget.dataset.slot;
    if (!campaignImageSlot(slot) || !this.active() || !this.checkOwner() || this.writesBlocked()) return;
    const url = this.data.imagePreviews[slot];
    if (!url) return;
    const owner = this.ownerKey;
    try { wx.previewImage({ current: url, urls: [url], fail: () => {
      if (this.active() && this.ownerKey === owner && this.checkOwner()) this.setData({ message: '图片预览失败，请重试或重新读取' });
    } }); } catch { if (this.active()) this.setData({ message: '图片预览失败，请重试' }); }
  },
  onSave(insideSaveAll = false): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.runtime || this.data.viewState !== 'ready' ||
      (this.data.savingAll && insideSaveAll !== true) ||
      this.data.reading || this.data.needsVersionRefresh || this.freePending ||
      this.data.submitUncertain || this.data.submitRefreshNeeded || this.data.freeSaveUnknown ||
      this.data.contentSaveUnknown || this.data.registrationSaveUnknown ||
      this.data.imageSaveUnknown || this.data.imageChoosing || this.dialogPending) return Promise.resolve();
    if (this.pendingSave) return this.pendingSave;
    let input: CampaignBasics;
    try { input = this.createAttempt?.fields ?? fields(this.data.form); } catch {
      this.setData({ message: '活动基础信息格式或长度不符合要求，请修改后保存' });
      return Promise.resolve();
    }
    const runtime = this.runtime;
    const sequence = this.sequence;
    const id = this.data.draftId;
    const version = this.data.version;
    if (!id && !this.createAttempt) this.createAttempt = {
      key: `cdraft:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`, fields: input, sent: false,
    };
    const attempt = this.createAttempt;
    this.setData({ saving: true, message: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) {
        if (!id && !attempt?.sent && this.createAttempt === attempt) this.createAttempt = undefined;
        return;
      }
      if (attempt) attempt.sent = true;
      return id ? this.freeRuntime!.saveBasics(id, version, input) : runtime.create(input, attempt!.key);
    }).then((receipt) => {
      if (!this.disposed && !this.loginStopped && receipt) this.outcome = { receipt, fields: input };
    }).catch((error: unknown) => { if (!this.disposed && !this.loginStopped) this.outcome = { error }; })
      .finally(() => {
        this.pendingSave = undefined;
        if (this.active() && this.checkOwner()) {
          if (this.outcome) return this.applyOutcome();
          else {
            this.setData({ saving: false });
            if (sequence !== this.sequence && this.data.draftId)
              return this.load(this.data.dirty || this.data.freeDirty);
          }
        }
      });
    this.pendingSave = pending;
    return pending;
  },
  applyOutcome() {
    if (!this.active() || !this.checkOwner() || !this.outcome) return;
    const outcome = this.outcome;
    this.outcome = undefined;
    if ('receipt' in outcome) {
      const form = toForm(outcome.fields);
      this.savedFingerprint = fingerprint(form);
      this.createAttempt = undefined;
      if (this.freeConfiguration) this.freeConfiguration = { ...this.freeConfiguration, version: outcome.receipt.version };
      this.setData({
        draftId: outcome.receipt.draftId, version: outcome.receipt.version,
        form, dirty: false, saving: false, titleCount: Array.from(form.title).length,
        createUncertain: false, needsVersionRefresh: false, message: '草稿已保存',
        ...(form.campaignType !== 'FREE_REGISTRATION' ? { freeReady: false } : {}),
      });
    } else {
      const code = statusCode(outcome.error);
      if ([401, 403, 404].includes(code)) {
        this.clearPrivate(code === 404 ? '活动草稿不存在或已不可访问' : '登录已失效或无访问权限，请重新登录');
        return;
      }
      const uncertain = !this.data.draftId && (code === 0 || code >= 500);
      if (!uncertain && code !== 409) this.createAttempt = undefined;
      this.setData({
        saving: false, createUncertain: uncertain,
        needsVersionRefresh: Boolean(this.data.draftId) && code === 409,
        message: uncertain ? '保存结果暂未确认，请重试原保存'
          : code === 409 ? '草稿已更新，请读取最新版本后核对修改' : '草稿保存失败，请重试',
      });
    }
    this.syncAlert();
    if ('receipt' in outcome && (this.data.hasFreeCampaign ||
      this.data.form.campaignType === 'FREE_REGISTRATION')) return this.refreshAfterSave();
  },
  refreshAfterSave(): Promise<void> {
    // A partition receipt does not establish the current contents of the other partition.
    this.freeConfiguration = undefined;
    this.resetPublishedImage();
    this.setData({ needsVersionRefresh: true, publishedPath: '' });
    this.syncAlert();
    return this.load(true, true);
  },
  onSaveAll(): Promise<void> {
    if (this.pendingSaveAll) return this.pendingSaveAll;
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.data.reading || this.data.imageChoosing ||
      this.data.needsVersionRefresh || this.pendingSave || this.freePending || this.dialogPending ||
      this.data.submitUncertain || this.data.submitRefreshNeeded) return Promise.resolve();
    try { fields(this.data.form); } catch {
      this.setData({ message: '活动基础信息格式或长度不符合要求，请修改后保存' });
      return Promise.resolve();
    }
    try { normalizeCampaignContent(this.contentSaveAttempt?.content ?? this.data.content); } catch {
      this.setData({ message: '活动正文最多10000字，请核对内容后保存' });
      return Promise.resolve();
    }
    try { normalizeRegistrationForm(this.registrationSaveAttempt?.questions ?? this.data.registrationQuestions); } catch {
      this.setData({ message: '请核对报名表单：题目最多80字、备注200字，选择题至少两项且不可重复' });
      return Promise.resolve();
    }
    try {
      for (const time of this.data.form.campaignType === 'FREE_REGISTRATION' ? Object.values(this.data.freeTimes) : []) {
        if (Boolean(time.date) !== Boolean(time.time)) throw new CampaignTimeInputError('INCOMPLETE');
      }
      if (this.data.form.campaignType === 'FREE_REGISTRATION' && this.data.campusTimezone) freeFields(this.data.freeForm, this.data.freeTimes, this.data.campusTimezone);
      else if (this.data.form.campaignType === 'FREE_REGISTRATION') {
        const max = this.data.freeForm.maxRegistrations;
        if (max && !/^[1-9]\d*$/.test(max)) throw new Error('invalid capacity');
        normalizeFreeSettings({
          startsAt: null, endsAt: null, capacityMode: this.data.freeForm.capacityMode || null,
          maxRegistrations: max ? Number(max) : null,
        });
      }
    } catch (error) {
      this.setData({ freeMessage: freeValidationMessage(error) });
      return Promise.resolve();
    }
    const sequence = ++this.saveAllSequence;
    const current = () => sequence === this.saveAllSequence && this.active() && this.checkOwner();
    this.setData({ savingAll: true, message: '', freeMessage: '' });
    const pending = Promise.resolve().then(async () => {
      if (!current()) return;
      if (this.data.registrationSaveUnknown) await this.onRegistrationFormSave();
      if (!current() || this.data.registrationSaveUnknown || this.data.needsVersionRefresh) return;
      if (!this.data.freeSaveUnknown && !this.data.contentSaveUnknown && !this.data.imageSaveUnknown &&
        (!this.data.draftId || this.data.dirty || this.data.createUncertain))
        await this.onSave(true);
      if (!current() || !this.data.draftId || this.data.dirty || this.data.createUncertain ||
        this.data.needsVersionRefresh) return;
      if (!this.data.imageSaveUnknown && (this.data.contentDirty || this.data.contentSaveUnknown)) await this.onContentSave();
      if (!current() || this.data.contentDirty || this.data.contentSaveUnknown || this.data.needsVersionRefresh) return;
      const slots: CampaignImageSlot[] = this.imageSaveAttempt?.slot === 'share'
        ? ['share', 'cover'] : ['cover', 'share'];
      for (const slot of slots) {
        if (!current()) return;
        if (this.imageSaveAttempt?.slot === slot || Object.prototype.hasOwnProperty.call(this.imageEdits, slot))
          await this.onImageSave(slot);
        if (!current() || this.data.imageSaveUnknown || this.data.needsVersionRefresh ||
          Object.prototype.hasOwnProperty.call(this.imageEdits, slot)) return;
      }
      if (this.data.registrationDirty) await this.onRegistrationFormSave();
      if (!current() || this.data.registrationDirty || this.data.registrationSaveUnknown || this.data.needsVersionRefresh) return;
      // Each receipt is reread before the next partition can write.
      if (this.data.form.campaignType === 'FREE_REGISTRATION') {
        if (!this.data.freeReady) return;
        if (this.data.freeDirty || this.data.freeSaveUnknown) await this.onFreeSave(true);
      }
      if (current() && !this.data.dirty && !this.data.registrationDirty && !this.data.registrationSaveUnknown &&
        !this.data.contentDirty && !this.data.contentSaveUnknown && !this.data.imageDirty && !this.data.imageSaveUnknown &&
        !this.data.freeSaveUnknown && !this.data.needsVersionRefresh &&
        (this.data.form.campaignType !== 'FREE_REGISTRATION' || (!this.data.freeDirty && this.freeConfiguration)))
        this.setData({ message: this.data.freeDirty
          ? '当前草稿已保存，免费报名配置尚未保存' : '全部草稿已保存', freeMessage: '' });
    }).finally(() => {
      if (this.pendingSaveAll === pending) this.pendingSaveAll = undefined;
      if (current()) this.setData({ savingAll: false });
    });
    this.pendingSaveAll = pending;
    return pending;
  },
  onContentSave(): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.freeRuntime || !this.data.draftId ||
      this.data.viewState !== 'ready' || this.data.reading || this.data.needsVersionRefresh ||
      this.pendingSave || this.data.registrationSaveUnknown || this.data.freeSaveUnknown ||
      this.data.imageSaveUnknown || this.data.imageChoosing || this.data.submitUncertain ||
      this.data.submitRefreshNeeded || this.dialogPending) return Promise.resolve();
    if (this.freePending) return this.freePending;
    const content = this.contentSaveAttempt ? this.contentSaveAttempt.content : normalizeCampaignContent(this.data.content);
    this.contentSaveAttempt ??= { id: this.data.draftId, version: this.data.version, content, sent: false };
    const attempt = this.contentSaveAttempt, sequence = this.sequence, runtime = this.freeRuntime;
    this.setData({ saving: true, message: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      attempt.sent = true;
      this.setData({ contentSaveUnknown: true });
      this.syncAlert();
      return runtime.saveContent(attempt.id, attempt.version, attempt.content);
    }).then((result) => {
      if (!result || !this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      this.savedContent = attempt.content;
      this.contentSaveAttempt = undefined;
      this.setData({ version: result.version, content: attempt.content ?? '', contentCount: Array.from(attempt.content ?? '').length,
        contentDirty: false, contentSaveUnknown: false, saving: false, message: '活动正文已保存' });
      if (this.freePending === pending) this.freePending = undefined;
      this.syncAlert();
      return this.refreshAfterSave();
    }).catch((error: unknown) => {
      const code = statusCode(error);
      if (this.hidden && !this.disposed && [401, 403, 404].includes(code)) this.hiddenPrivateDenied = true;
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      if ([401, 403, 404].includes(code)) { this.clearPrivate('活动草稿不存在或当前登录无访问权限'); return; }
      const unknown = code === 0 || code >= 500;
      if (!unknown) this.contentSaveAttempt = undefined;
      this.setData({ saving: false, contentSaveUnknown: unknown, needsVersionRefresh: code === 409,
        message: unknown ? '正文保存结果暂未确认，请重试原保存'
          : code === 409 ? '草稿已更新，请读取最新版本后核对正文' : '活动正文保存失败，请重试' });
      this.syncAlert();
    }).finally(() => {
      if (this.freePending === pending) this.freePending = undefined;
      if (!attempt.sent && this.contentSaveAttempt === attempt) this.contentSaveAttempt = undefined;
      if (this.active() && sequence === this.sequence && this.checkOwner()) this.setData({ saving: false });
    });
    this.freePending = pending;
    return pending;
  },
  onRegistrationFormSave(): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.freeRuntime || !this.data.draftId ||
      this.data.viewState !== 'ready' || this.data.reading || this.data.needsVersionRefresh ||
      this.pendingSave || this.data.freeSaveUnknown || this.data.contentSaveUnknown || this.data.imageSaveUnknown ||
      this.data.imageChoosing || this.data.submitUncertain || this.data.submitRefreshNeeded || this.dialogPending) return Promise.resolve();
    if (this.freePending) return this.freePending;
    this.registrationSaveAttempt ??= { id: this.data.draftId, version: this.data.version,
      questions: normalizeRegistrationForm(this.data.registrationQuestions), sent: false };
    const attempt = this.registrationSaveAttempt, sequence = this.sequence, runtime = this.freeRuntime;
    this.setData({ saving: true, message: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      attempt.sent = true;
      this.setData({ registrationSaveUnknown: true });
      this.syncAlert();
      return runtime.saveRegistrationForm(attempt.id, attempt.version, attempt.questions);
    }).then(result => {
      if (!result || !this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      this.savedRegistrationForm = JSON.stringify(attempt.questions);
      this.registrationSaveAttempt = undefined;
      this.setData({ version: result.version, registrationQuestions: attempt.questions,
        registrationDirty: false, registrationSaveUnknown: false, saving: false, message: '报名表单草稿已保存' });
      if (this.freePending === pending) this.freePending = undefined;
      this.syncAlert();
      return this.refreshAfterSave();
    }).catch((error: unknown) => {
      const code = statusCode(error);
      if (this.hidden && !this.disposed && [401, 403, 404].includes(code)) this.hiddenPrivateDenied = true;
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      if ([401, 403, 404].includes(code)) { this.clearPrivate('活动草稿不存在或当前登录无访问权限'); return; }
      const unknown = code === 0 || code >= 500;
      if (!unknown) this.registrationSaveAttempt = undefined;
      this.setData({ saving: false, registrationSaveUnknown: unknown, needsVersionRefresh: code === 409,
        message: unknown ? '表单保存结果暂未确认，请重试原保存'
          : code === 409 ? '草稿已更新，请读取最新版本后核对表单' : '报名表单保存失败，请重试' });
      this.syncAlert();
    }).finally(() => {
      if (this.freePending === pending) this.freePending = undefined;
      if (!attempt.sent && this.registrationSaveAttempt === attempt) this.registrationSaveAttempt = undefined;
      if (this.active() && sequence === this.sequence && this.checkOwner()) this.setData({ saving: false });
    });
    this.freePending = pending;
    return pending;
  },
  onImageSave(slot: CampaignImageSlot): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.freeRuntime || !this.data.draftId ||
      this.data.reading || this.data.needsVersionRefresh || this.pendingSave || this.data.freeSaveUnknown ||
      this.data.contentSaveUnknown || this.data.registrationSaveUnknown ||
      this.data.submitUncertain || this.data.submitRefreshNeeded || this.dialogPending ||
      this.data.imageChoosing || this.imageSaveAttempt && this.imageSaveAttempt.slot !== slot) return Promise.resolve();
    if (this.freePending) return this.freePending;
    this.imageSaveAttempt ??= { id: this.data.draftId, version: this.data.version, slot,
      path: this.imageEdits[slot] ?? null, key: `cimage:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`, sent: false };
    const attempt = this.imageSaveAttempt, sequence = this.sequence, runtime = this.freeRuntime;
    this.setData({ saving: true, message: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      attempt.sent = true;
      this.setData({ imageSaveUnknown: true }); this.syncAlert();
      return attempt.path === null ? runtime.clearImage(attempt.id, attempt.version, attempt.slot)
        : runtime.uploadImage(attempt.id, attempt.version, attempt.slot, attempt.path, attempt.key);
    }).then(result => {
      if (!result || !this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      delete this.imageEdits[attempt.slot];
      this.imageSaveAttempt = undefined;
      this.setData({ version: result.version, imageDirty: Object.keys(this.imageEdits).length > 0,
        imageSaveUnknown: false, saving: false });
      if (this.freePending === pending) this.freePending = undefined;
      this.syncAlert();
      return this.refreshAfterSave();
    }).catch((error: unknown) => {
      const code = statusCode(error);
      if (this.hidden && !this.disposed && [401, 403, 404].includes(code)) this.hiddenPrivateDenied = true;
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      if ([401, 403, 404].includes(code)) { this.clearPrivate('活动草稿不存在或当前登录无访问权限'); return; }
      const unknown = code === 0 || code >= 500;
      if (!unknown) this.imageSaveAttempt = undefined;
      this.setData({ saving: false, imageSaveUnknown: unknown, needsVersionRefresh: code === 409,
        message: unknown ? '图片保存结果暂未确认，请重试原保存'
          : code === 409 ? '草稿已更新，请读取最新版本后核对图片' : '图片保存失败，请核对尺寸或重新选择' });
      this.syncAlert();
    }).finally(() => {
      if (this.freePending === pending) this.freePending = undefined;
      if (!attempt.sent && this.imageSaveAttempt === attempt) this.imageSaveAttempt = undefined;
      if (this.active() && sequence === this.sequence && this.checkOwner()) this.setData({ saving: false });
    });
    this.freePending = pending;
    return pending;
  },
  onReload() {
    if (this.data.savingAll) return Promise.resolve();
    return this.data.submitRefreshNeeded ? this.onSubmissionRefresh() : this.load(true, true);
  },
  onRetry() {
    if (this.data.savingAll) return Promise.resolve();
    return this.data.submitRefreshNeeded ? this.onSubmissionRefresh() : this.load(this.data.dirty || this.data.freeDirty, true);
  },
  onPullDownRefresh() {
    if (!this.active()) return;
    const sequence = ++this.pullSequence;
    if (this.unsaved() || this.pendingSave || this.freePending || this.data.savingAll || this.data.needsVersionRefresh) { wx.stopPullDownRefresh(); return; }
    const owner = this.ownerKey;
    const freeOwner = this.freeOwnerKey;
    void this.load(false).finally(() => {
      if (this.active() && sequence === this.pullSequence && this.runtime?.getSessionKey() === owner &&
        this.freeRuntime?.getSessionKey() === freeOwner) wx.stopPullDownRefresh();
    });
  },
  syncAlert() {
    this.syncShareMenu();
    if (typeof wx.enableAlertBeforeUnload !== 'function' || typeof wx.disableAlertBeforeUnload !== 'function') return;
    const enabled = this.active() && this.data.viewState === 'ready' && this.unsaved();
    if (this.alertEnabled === enabled) return;
    const sequence = ++this.alertSequence;
    this.alertEnabled = enabled;
    const fail = () => { if (this.active() && sequence === this.alertSequence) this.alertEnabled = undefined; };
    try {
      if (enabled) wx.enableAlertBeforeUnload({ message: '修改尚未保存，离开将丢弃本次修改。', fail });
      else wx.disableAlertBeforeUnload({ fail });
    } catch { fail(); }
  },
  onBack() {
    if (!this.active() || !this.checkOwner() || this.pendingSave || this.freePending ||
      this.data.savingAll || this.data.imageChoosing || this.dialogPending) return;
    const navigate = () => {
      if (!this.active() || !this.checkOwner()) return;
      const interruptedLoad = Boolean(this.pendingLoad);
      this.navigating = true;
      if (this.publishedImage?.pending) this.resetPublishedImage();
      this.sequence += 1;
      this.pendingLoad = undefined;
      this.submissionReadPending = undefined;
      this.listSequence += 1;
      this.listPending = undefined;
      this.copySequence += 1;
      this.copying = false;
      const sequence = ++this.navigationSequence;
      this.syncAlert();
      const current = () => this.navigating && !this.hidden && !this.disposed && sequence === this.navigationSequence && this.checkOwner();
      const fail = () => {
        if (!current()) return;
        this.navigating = false;
        if (interruptedLoad) {
          this.freeConfiguration = undefined;
          this.resetPublishedImage();
        }
        this.setData({
          reading: false, message: '返回失败，请重试', listLoading: false,
          ...(interruptedLoad ? { needsVersionRefresh: true, publishedPath: '' } : {}),
          ...(this.data.listLoading ? { listError: '列表读取中断，请重试' } : {}),
          ...(this.data.viewState === 'loading' ? { viewState: 'error' } : {}),
        });
        if (!this.publishedImage) this.preparePublishedImage();
        this.syncAlert();
      };
      const fallback = () => {
        if (!current()) return;
        try { wx.reLaunch({ url: '/pages/partner/group-campaigns/index', fail }); } catch { fail(); }
      };
      if (getCurrentPages().length > 1) {
        try { wx.navigateBack({ delta: 1, fail: fallback }); } catch { fallback(); }
      } else fallback();
    };
    if (!this.unsaved()) { navigate(); return; }
    this.dialogPending = true;
    const sequence = ++this.navigationSequence;
    let consumed = false;
    const fail = () => {
      if (consumed) return;
      consumed = true;
      if (!this.active() || sequence !== this.navigationSequence || !this.checkOwner()) return;
      this.dialogPending = false;
      this.setData({ message: '返回确认未完成，请重试' });
    };
    try {
      wx.showModal({
        title: '离开编辑？',
        content: this.data.submitRefreshNeeded ? '送审已确认，审核状态尚未更新。离开后请从审核历史核对。'
          : this.data.submitUncertain ? '送审结果暂未确认，离开后请从审核历史核对，避免重复送审。'
          : this.data.createUncertain || this.data.freeSaveUnknown || this.data.contentSaveUnknown ||
            this.data.imageSaveUnknown || this.data.registrationSaveUnknown ? '保存结果暂未确认，草稿可能已经保存。离开后可从草稿列表查看。'
          : '修改尚未保存，离开将丢弃本次修改。',
        confirmText: '离开', cancelText: '继续编辑',
        success: (result) => {
          if (consumed) return;
          consumed = true;
          if (!this.active() || sequence !== this.navigationSequence || !this.checkOwner()) return;
          this.dialogPending = false;
          if (result.confirm) navigate();
        }, fail,
      });
    } catch { fail(); }
  },
  unsaved() {
    return this.data.dirty || this.data.registrationDirty || this.data.registrationSaveUnknown ||
      this.data.imageDirty || this.data.imageSaveUnknown ||
      this.data.contentDirty || this.data.contentSaveUnknown || this.data.createUncertain || this.data.freeDirty ||
      this.data.freeSaveUnknown || this.data.submitUncertain || this.data.submitRefreshNeeded;
  },
  writesBlocked() {
    return Boolean(this.dialogPending || this.pendingSave || this.freePending || this.data.savingAll || this.data.saving ||
      this.data.freeSaving || this.data.imageChoosing || this.data.imageSaveUnknown ||
      this.data.submitting || this.data.freeSaveUnknown || this.data.contentSaveUnknown || this.data.registrationSaveUnknown ||
      this.data.submitUncertain || this.data.submitRefreshNeeded);
  },
  applyConfiguration(config: FreeConfiguration, preserve: boolean, editable = true) {
    this.freeConfiguration = config;
    const server = freeForm(config.freeRegistration);
    const serverTimes = freeTimes(server, config.campusTimezone);
    this.freeSavedFingerprint = freeFingerprint(server, serverTimes);
    const form = preserve ? this.data.freeForm : server;
    const times = preserve ? this.data.freeTimes : serverTimes;
    this.setData({
      freeForm: form, freeTimes: times, freeReady: editable, freeDirty: freeFingerprint(form, times) !== this.freeSavedFingerprint,
      hasFreeCampaign: config.campaignId !== null,
      campusTimezone: config.campusTimezone, lifecycle: config.lifecycle ?? '',
      startsLabel: config.freeRegistration.startsAt ? formatDateTimeLabel(config.freeRegistration.startsAt, config.campusTimezone) : '',
      endsLabel: config.freeRegistration.endsAt ? formatDateTimeLabel(config.freeRegistration.endsAt, config.campusTimezone) : '',
      publishedPath: '',
    });
    this.preparePublishedImage();
    this.updatePublishedPath();
    this.syncAlert();
  },
  onFreeInput(event: WechatMiniprogram.Input) {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.data.form.campaignType !== 'FREE_REGISTRATION' || this.writesBlocked() || this.data.reading) return;
    const field = String(event.currentTarget.dataset.field);
    if (!['startsAt', 'endsAt', 'maxRegistrations'].includes(field)) return;
    const form = { ...this.data.freeForm, [field]: String(event.detail.value ?? '') };
    const times = { ...this.data.freeTimes };
    if (field === 'startsAt' || field === 'endsAt') {
      try { times[field] = campaignTimeFromInstant(form[field], this.data.campusTimezone); }
      catch { times[field] = blankCampaignTime(); }
    }
    this.setData({ freeForm: form, freeTimes: times, freeDirty: freeFingerprint(form, times) !== this.freeSavedFingerprint, freeMessage: '' });
    this.syncAlert();
  },
  onFreeTimeChange(event: WechatMiniprogram.PickerChange): void {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.data.form.campaignType !== 'FREE_REGISTRATION' || this.writesBlocked() || this.data.reading) return;
    const field: unknown = event.currentTarget.dataset.field;
    const part: unknown = event.currentTarget.dataset.part;
    const value = event.detail.value;
    if ((field !== 'startsAt' && field !== 'endsAt') || (part !== 'date' && part !== 'time') || typeof value !== 'string' ||
      !(part === 'date' ? /^\d{4}-\d{2}-\d{2}$/ : /^(?:[01]\d|2[0-3]):[0-5]\d$/).test(value)) return;
    const times = { ...this.data.freeTimes, [field]: { ...this.data.freeTimes[field], [part]: value } };
    this.setData({ freeTimes: times, freeDirty: freeFingerprint(this.data.freeForm, times) !== this.freeSavedFingerprint, freeMessage: '' });
    this.syncAlert();
  },
  onFreeTimeClear(event: WechatMiniprogram.TouchEvent): void {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.data.form.campaignType !== 'FREE_REGISTRATION' || this.writesBlocked() || this.data.reading) return;
    const field: unknown = event.currentTarget.dataset.field;
    if (field !== 'startsAt' && field !== 'endsAt') return;
    const form = { ...this.data.freeForm, [field]: '' };
    const times = { ...this.data.freeTimes, [field]: blankCampaignTime() };
    this.setData({ freeForm: form, freeTimes: times, freeDirty: freeFingerprint(form, times) !== this.freeSavedFingerprint, freeMessage: '' });
    this.syncAlert();
  },
  onCapacityChange(event: WechatMiniprogram.RadioGroupChange) {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' ||
      this.data.form.campaignType !== 'FREE_REGISTRATION' || this.writesBlocked() || this.data.reading) return;
    const mode = event.detail.value;
    if (!['', 'UNLIMITED', 'LIMITED'].includes(mode)) return;
    const form = { ...this.data.freeForm, capacityMode: mode as FreeForm['capacityMode'],
      maxRegistrations: mode === 'UNLIMITED' ? '' : this.data.freeForm.maxRegistrations };
    this.setData({ freeForm: form, freeDirty: freeFingerprint(form, this.data.freeTimes) !== this.freeSavedFingerprint, freeMessage: '' });
    this.syncAlert();
  },
  onFreeSave(insideSaveAll = false): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.freeRuntime || this.data.viewState !== 'ready' ||
      (this.data.savingAll && insideSaveAll !== true) ||
      !this.data.freeReady || !this.data.draftId || this.data.form.campaignType !== 'FREE_REGISTRATION' ||
      this.data.reading || this.data.needsVersionRefresh || this.pendingSave || this.data.submitUncertain ||
      this.data.submitRefreshNeeded || this.data.contentSaveUnknown || this.data.registrationSaveUnknown || this.data.imageSaveUnknown ||
      this.data.imageChoosing || this.dialogPending) return Promise.resolve();
    if (this.freePending) return this.freePending;
    let settings: FreeSettings;
    try { settings = this.freeSaveAttempt?.settings ?? freeFields(this.data.freeForm, this.data.freeTimes, this.data.campusTimezone); } catch (error) {
      this.setData({ freeMessage: freeValidationMessage(error) });
      return Promise.resolve();
    }
    this.freeSaveAttempt ??= { id: this.data.draftId, version: this.data.version, settings, sent: false };
    const attempt = this.freeSaveAttempt, sequence = this.sequence, runtime = this.freeRuntime;
    this.setData({ freeSaving: true, freeMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      attempt.sent = true;
      this.setData({ freeSaveUnknown: true });
      this.syncAlert();
      return runtime.saveConfiguration(attempt.id, attempt.version, attempt.settings);
    }).then((result) => {
      if (!result || !this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      const form = freeForm(attempt.settings);
      const times = freeTimes(form, this.data.campusTimezone);
      this.freeSavedFingerprint = freeFingerprint(form, times);
      this.freeSaveAttempt = undefined;
      if (this.freeConfiguration) this.freeConfiguration = { ...this.freeConfiguration, version: result.version, freeRegistration: attempt.settings };
      this.setData({ version: result.version, freeForm: form, freeTimes: times, freeDirty: false, freeSaveUnknown: false,
        freeSaving: false, needsVersionRefresh: result.version > attempt.version + 1,
        freeMessage: result.version > attempt.version + 1 ? '配置已保存，草稿其他分区已更新，请读取最新版本后核对' : '免费配置已保存',
        startsLabel: settings.startsAt ? formatDateTimeLabel(settings.startsAt, this.data.campusTimezone) : '',
        endsLabel: settings.endsAt ? formatDateTimeLabel(settings.endsAt, this.data.campusTimezone) : '' });
      this.syncAlert();
      if (this.freePending === pending) this.freePending = undefined;
      return this.refreshAfterSave();
    }).catch((error: unknown) => {
      if (this.hidden && !this.disposed && [401, 403, 404].includes(statusCode(error))) this.hiddenPrivateDenied = true;
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      this.freeWriteError(error, 'save');
    }).finally(() => {
      if (this.freePending === pending) this.freePending = undefined;
      if (!attempt.sent && this.freeSaveAttempt === attempt) this.freeSaveAttempt = undefined;
      if (this.active() && sequence === this.sequence && this.checkOwner()) {
        this.setData({ freeSaving: false });
      }
    });
    this.freePending = pending;
    return pending;
  },
  onSubmit(): Promise<void> {
    if (this.data.savingAll) return Promise.resolve();
    if (this.data.submitRefreshNeeded) return this.onSubmissionRefresh();
    if (!this.active() || !this.checkOwner() || !this.freeRuntime || this.data.viewState !== 'ready' ||
      !this.data.freeReady || this.data.form.campaignType !== 'FREE_REGISTRATION' || this.data.reading ||
      this.data.needsVersionRefresh || this.pendingSave || this.data.freeSaveUnknown || this.dialogPending ||
      this.data.dirty || this.data.imageDirty || this.data.imageSaveUnknown || this.data.imageChoosing ||
      this.data.registrationDirty || this.data.registrationSaveUnknown ||
      this.data.contentDirty || this.data.contentSaveUnknown || this.data.freeDirty || this.data.lifecycle === 'CLOSED' ||
      (this.data.hasPendingReview && !this.submitAttempt)) return Promise.resolve();
    if (this.freePending) return this.freePending;
    if (!this.submitAttempt) {
      try {
        const settings = freeFields(this.data.freeForm, this.data.freeTimes, this.data.campusTimezone);
        if (!this.data.form.title.trim() || !this.data.form.shareDescription.trim() ||
          !settings.startsAt || !settings.endsAt || !settings.capacityMode ||
          (settings.capacityMode === 'LIMITED' && !settings.maxRegistrations)) throw new Error('incomplete');
      } catch {
        this.setData({ freeMessage: '送审前请保存完整名称、描述、时间和名额' });
        return Promise.resolve();
      }
      this.submitAttempt = { id: this.data.draftId, version: this.data.version,
        key: `free:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`, sent: false };
    }
    const attempt = this.submitAttempt, sequence = this.sequence, runtime = this.freeRuntime;
    this.setData({ submitting: true, freeMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      attempt.sent = true;
      this.setData({ submitUncertain: true });
      this.syncAlert();
      return runtime.submit(attempt.id, attempt.version, attempt.key);
    }).then((result) => {
      if (!result || !this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      attempt.receipt = { campaignId: result.campaignId, versionId: result.versionId };
      if (this.freePending === pending) this.freePending = undefined;
      this.setData({ submitting: false, submitUncertain: false, submitRefreshNeeded: true, freeTab: 'history' });
      this.syncAlert();
      return this.onSubmissionRefresh();
    }).catch((error: unknown) => {
      if (this.hidden && !this.disposed && [401, 403, 404].includes(statusCode(error))) this.hiddenPrivateDenied = true;
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      this.freeWriteError(error, 'submit');
    }).finally(() => {
      if (this.freePending === pending) this.freePending = undefined;
      if (!attempt.sent && this.submitAttempt === attempt) this.submitAttempt = undefined;
      if (this.active() && sequence === this.sequence && this.checkOwner()) {
        this.setData({ submitting: false });
      }
    });
    this.freePending = pending;
    return pending;
  },
  onSubmissionRefresh(): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.freeRuntime || !this.submitAttempt?.receipt ||
      this.data.viewState !== 'ready' || this.pendingSave || this.dialogPending) return Promise.resolve();
    if (this.submissionReadPending) return this.submissionReadPending;
    const attempt = this.submitAttempt, receipt = attempt.receipt!, runtime = this.freeRuntime, sequence = this.sequence;
    const owner = this.ownerKey, freeOwner = this.freeOwnerKey, generation = ++this.submissionReadGeneration;
    const current = () => !this.disposed && this.freeRuntime === runtime &&
      this.ownerKey === owner && this.freeOwnerKey === freeOwner &&
      this.submitAttempt === attempt && this.submissionReadGeneration === generation;
    const handleDenied = (error: unknown) => {
      if (![401, 403, 404].includes(statusCode(error)) || !current()) return;
      if (this.hidden) {
        if (this.runtime?.getSessionKey() === owner && runtime.getSessionKey() === freeOwner)
          this.hiddenPrivateDenied = true;
        return;
      }
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      this.clearPrivate('登录失效或活动已不可访问，请重新登录');
    };
    const readError = (error: unknown): never => { handleDenied(error); throw error; };
    this.listSequence += 1;
    this.listPending = undefined;
    this.resetPublishedImage();
    this.setData({ reading: true, listLoading: false, publishedPath: '', submitRefreshNeeded: true,
      freeMessage: '送审已确认，正在读取审核状态' });
    // A replay is an execution receipt; only fresh private reads establish the current review/publication state.
    const pending = Promise.resolve().then(async () => {
      if (!this.active() || sequence !== this.sequence || !this.checkOwner()) return;
      // Each GET must observe access loss even after an ordinary sibling failure rejects the aggregate.
      const [config, history] = await Promise.all([
        runtime.getConfiguration(attempt.id).catch(readError), runtime.versions(attempt.id, 1).catch(readError),
      ]);
      if (!this.active() || sequence !== this.sequence || !current() || !this.checkOwner()) return;
      if (config.campaignId !== receipt.campaignId || history.data.some((v) => v.campaignId !== receipt.campaignId))
        throw new Error('inconsistent campaign state');
      const changedVersion = config.version !== this.data.version;
      const rows = history.data.map((v) => reviewLabel(v, config.campusTimezone));
      this.applyConfiguration(config, true);
      this.setData({
        history: rows, historyPage: 1, historyHasMore: history.meta.totalPages > 1,
        hasPendingReview: rows.some((v) => v.status === 'SUBMITTED'), listError: '',
        reading: false, submitRefreshNeeded: false, submitUncertain: false,
        needsVersionRefresh: this.data.needsVersionRefresh || changedVersion,
        freeMessage: changedVersion ? '草稿已更新，请读取最新版本后核对修改'
          : rows.some((v) => v.versionId === receipt.versionId && v.status === 'SUBMITTED')
            ? '已送审，等待总端审核' : '审核历史已更新',
      });
      this.submitAttempt = undefined;
      this.updatePublishedPath();
      this.syncAlert();
    }).catch((error: unknown) => {
      if ([401, 403, 404].includes(statusCode(error))) { handleDenied(error); return; }
      if (!this.active() || sequence !== this.sequence || !current() || !this.checkOwner()) return;
      this.setData({ reading: false, submitRefreshNeeded: true, freeMessage: '送审已确认，审核状态读取失败，请重试' });
      this.syncAlert();
    }).finally(() => {
      if (this.submissionReadPending === pending) this.submissionReadPending = undefined;
    });
    this.submissionReadPending = pending;
    return pending;
  },
  freeWriteError(error: unknown, kind: 'save' | 'submit') {
    const code = statusCode(error);
    if ([401, 403, 404].includes(code)) {
      this.clearPrivate('登录失效或活动已不可访问，请重新登录');
      return;
    }
    const unknown = code === 0 || code >= 500;
    if (!unknown) {
      if (kind === 'submit') this.submitAttempt = undefined; else this.freeSaveAttempt = undefined;
    }
    this.setData({
      freeSaving: false, submitting: false,
      ...(kind === 'submit' ? { submitUncertain: unknown } : { freeSaveUnknown: unknown }),
      needsVersionRefresh: code === 409,
      freeMessage: unknown ? '操作结果暂未确认，请重试原操作'
        : code === 409 ? '草稿或审核状态已更新，请读取最新版本后核对' : '操作失败，请核对后重试',
    });
    this.syncAlert();
  },
  onFreeTab(event: WechatMiniprogram.TouchEvent) {
    if (!this.active() || !this.checkOwner() || !this.hasFreeManagement() || this.data.submitRefreshNeeded) return;
    const tab = event.currentTarget.dataset.tab;
    if (tab !== 'history' && tab !== 'registrations') return;
    if (tab === this.data.freeTab) return;
    this.listSequence += 1; this.listPending = undefined;
    this.setData({ freeTab: tab, listLoading: false, listError: '' });
    void this.loadFreeList(true);
  },
  onRegistrationFilterChange(event: WechatMiniprogram.PickerChange): void {
    if (!this.active() || !this.checkOwner() || this.data.viewState !== 'ready' || !this.hasFreeManagement() ||
      this.data.freeTab !== 'registrations' || this.data.submitRefreshNeeded) return;
    const value: unknown = event.detail.value;
    const index = typeof value === 'number' ? value
      : typeof value === 'string' && /^[0-2]$/.test(value) ? Number(value) : -1;
    if (!Number.isInteger(index) || index < 0 || index >= REGISTRATION_FILTERS.length ||
      index === this.data.registrationFilterIndex) return;
    this.listSequence += 1;
    this.listPending = undefined;
    this.setData({ registrationFilterIndex: index, registrations: [], registrationPage: 0,
      registrationTotal: 0, registrationCountLabel: '', registrationHasMore: false, listLoading: false, listError: '' });
    void this.loadFreeList(true);
  },
  loadFreeList(reset: boolean): Promise<void> {
    if (!this.active() || !this.checkOwner() || !this.freeRuntime || !this.hasFreeManagement() ||
      !this.data.draftId || this.data.submitRefreshNeeded) return Promise.resolve();
    if (this.listPending) return this.listPending;
    const history = this.data.freeTab === 'history';
    if (!reset && (this.data.listError || !(history ? this.data.historyHasMore : this.data.registrationHasMore))) return Promise.resolve();
    const page = reset ? 1 : (history ? this.data.historyPage : this.data.registrationPage) + 1;
    const filter = REGISTRATION_FILTERS[this.data.registrationFilterIndex];
    const sequence = ++this.listSequence, runtime = this.freeRuntime, id = this.data.draftId;
    this.setData({ listLoading: true, listError: '' });
    this.syncShareMenu();
    const pending = Promise.resolve().then(async () => {
      if (!this.active() || sequence !== this.listSequence || !this.checkOwner()) return;
      if (history) {
        const result = await runtime.versions(id, page);
        if (!this.active() || sequence !== this.listSequence || !this.checkOwner()) return;
        const next = result.data.map((v) => reviewLabel(v, this.data.campusTimezone));
        const rows = [...(reset ? [] : this.data.history), ...next];
        const unique = Array.from(new Map(rows.map((v) => [v.versionId, v])).values());
        this.setData({ history: unique, historyPage: page, historyHasMore: page < result.meta.totalPages,
          hasPendingReview: unique.some((v) => v.status === 'SUBMITTED') });
        this.updatePublishedPath();
      } else {
        const result = filter.value === 'ALL' ? await runtime.registrations(id, page)
          : await runtime.registrations(id, page, filter.value);
        if (!this.active() || sequence !== this.listSequence || !this.checkOwner()) return;
        const rows = [...(reset ? [] : this.data.registrations), ...result.data.map((v) => registrationLabel(v, this.data.campusTimezone))];
        this.setData({ registrations: Array.from(new Map(rows.map((v) => [v.registrationId, v])).values()),
          registrationPage: page, registrationHasMore: page < result.meta.totalPages, registrationTotal: result.meta.total,
          registrationCountLabel: `${filter.value === 'ALL' ? '报名记录' : filter.label}：${result.meta.total}` });
      }
    }).catch((error: unknown) => {
      if (!this.active() || sequence !== this.listSequence || !this.checkOwner()) return;
      if ([401, 403, 404].includes(statusCode(error))) this.clearPrivate('登录失效或活动已不可访问，请重新登录');
      else this.setData({ listError: '列表读取失败，请重试', ...(history ? { publishedPath: '' } : {}) });
    }).finally(() => {
      if (sequence === this.listSequence) {
        this.listPending = undefined;
        if (this.active()) this.setData({ listLoading: false });
        this.syncShareMenu();
      }
    });
    this.listPending = pending;
    return pending;
  },
  onListRetry() { return this.data.submitRefreshNeeded ? this.onSubmissionRefresh() : this.loadFreeList(true); },
  onListMore() { return this.loadFreeList(false); },
  hasFreeManagement() {
    return this.data.hasFreeCampaign || (this.data.freeReady && this.data.form.campaignType === 'FREE_REGISTRATION');
  },
  publishedReview() {
    const config = this.freeConfiguration, approved = config?.publishedVersion;
    if (config?.lifecycle === 'OPEN' && approved?.status === 'APPROVED' &&
      config.draftId === this.data.draftId && approved.draftId === this.data.draftId &&
      approved.versionId === config.publishedVersionId && approved.campaignId === config.campaignId) return approved;
  },
  resetPublishedImage() {
    if (this.publishedImage?.timer !== undefined) clearTimeout(this.publishedImage.timer);
    this.publishedImage = undefined;
  },
  preparePublishedImage() {
    this.resetPublishedImage();
    this.setData({ shareImageMessage: '' });
    const approved = this.publishedReview(), image = this.freeConfiguration?.publishedShareImage;
    if (!approved || !image) return;
    const prepared = { versionId: approved.versionId, imageId: image.id, path: '', pending: true,
      timer: undefined as ReturnType<typeof setTimeout> | undefined };
    this.publishedImage = prepared;
    const finish = (path: string) => {
      if (!prepared.pending || this.publishedImage !== prepared) return;
      if (!this.active() || !this.checkOwner() ||
        this.publishedReview()?.versionId !== prepared.versionId ||
        this.freeConfiguration?.publishedShareImage?.id !== prepared.imageId) return;
      prepared.pending = false;
      if (prepared.timer !== undefined) clearTimeout(prepared.timer);
      prepared.path = path;
      this.setData({ shareImageMessage: path ? '' : '转发图读取失败，将使用默认图' });
      this.syncShareMenu();
    };
    this.setData({ shareImageMessage: '转发图准备中' });
    prepared.timer = setTimeout(() => finish(''), 8000);
    if (Date.parse(image.accessUrlExpiresAt) <= Date.now()) { finish(''); return; }
    try {
      wx.getImageInfo({
        src: image.accessUrl,
        success: result => finish(typeof result.path === 'string' &&
          /^(wxfile:\/\/|https?:\/\/(?:tmp|usr)\/)/.test(result.path) &&
          Number.isInteger(result.width) && result.width > 0 && result.width * 3 === result.height * 4
          ? result.path : ''),
        fail: () => finish(''),
      });
    } catch { finish(''); }
  },
  updatePublishedPath() {
    const approved = this.publishedReview();
    this.setData({ publishedPath: approved
      ? `/pages/parent/campaign-registration/index?campaignId=${approved.campaignId}&versionId=${approved.versionId}` : '' });
    this.syncShareMenu();
  },
  publishedShare(): WechatMiniprogram.Page.ICustomShareContent | undefined {
    if (!this.active() || this.data.viewState !== 'ready' || !this.data.hasFreeCampaign || this.data.reading ||
      this.data.needsVersionRefresh || this.data.submitRefreshNeeded ||
      (this.data.freeTab === 'history' && this.data.listLoading) ||
      this.runtime?.getSessionKey() !== this.ownerKey ||
      this.freeRuntime?.getSessionKey() !== this.freeOwnerKey) return;
    const approved = this.publishedReview();
    if (!approved) return;
    const path = `/pages/parent/campaign-registration/index?campaignId=${approved.campaignId}&versionId=${approved.versionId}`;
    if (path !== this.data.publishedPath) return;
    const image = this.publishedImage;
    return { title: approved.title, path, imageUrl: image?.versionId === approved.versionId &&
      image.imageId === this.freeConfiguration?.publishedShareImage?.id && !image.pending && image.path
      ? image.path : FREE_SHARE_IMAGE };
  },
  syncShareMenu(): void {
    const enabled = Boolean(this.publishedShare()) && !this.publishedImage?.pending;
    if (this.data.canSharePublished !== enabled) this.setData({ canSharePublished: enabled });
    if (this.shareMenuEnabled === enabled) return;
    try {
      if (enabled) wx.showShareMenu?.({ menus: ['shareAppMessage'] });
      else wx.hideShareMenu?.({});
      this.shareMenuEnabled = enabled;
    } catch { this.shareMenuEnabled = undefined; }
  },
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const fallback = { title: '免费报名活动', path: '/pages/parent/campaign-registration/index', imageUrl: FREE_SHARE_IMAGE };
    if (!this.active() || !this.checkOwner()) return fallback;
    this.syncShareMenu();
    return this.data.canSharePublished ? this.publishedShare() ?? fallback : fallback;
  },
  onCopyPath() {
    if (!this.active() || !this.checkOwner() || this.copying) return;
    const share = this.publishedShare();
    if (!share?.path) return;
    this.copying = true;
    const sequence = ++this.copySequence, read = this.sequence, path = share.path;
    let consumed = false;
    const finish = (success: boolean) => {
      if (consumed) return;
      consumed = true;
      if (!this.active() || sequence !== this.copySequence || !this.checkOwner()) return;
      this.copying = false;
      if (read !== this.sequence || this.publishedShare()?.path !== path) return;
      this.setData({ freeMessage: success ? '家长报名路径已复制' : '复制失败，请重试' });
    };
    try { wx.setClipboardData({ data: path, success: () => finish(true), fail: () => finish(false) }); } catch { finish(false); }
  },
  onLogin() {
    if (this.hidden || this.disposed || this.navigating) return;
    this.loginStopped = true;
    this.pullSequence += 1;
    this.clearPrivate('登录已失效，请重新登录');
    logoutPartnerCampaignSession();
    const sequence = this.navigationSequence;
    const owner = getPartnerCampaignDraftService().getSessionKey();
    const fail = () => {
      if (!this.hidden && !this.disposed && sequence === this.navigationSequence &&
        getPartnerCampaignDraftService().getSessionKey() === owner)
        this.setData({ message: '登录页打开失败，请重试' });
    };
    try { wx.reLaunch({ url: '/pages/bootstrap/index', fail }); } catch { fail(); }
  },
});
