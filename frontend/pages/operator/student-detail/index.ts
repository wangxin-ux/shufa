import {
  buildOperatorStudentArchive, buildOperatorStudentGrowth,
  OperatorStudentArchiveModel, OperatorStudentGrowthModel,
} from '../runtime/services/operator-students.presenter';
import { OperatorPageContext } from '../runtime/operator-page-context';
import { createSessionService } from '../../../services/session.service';
import type { OperatorStudentGrowth, OperatorStudentMedia } from '../runtime/types/operator';
import type { OperatorStudentMediaReader } from '../runtime/services/operator-student-media';

interface ImageModel { id: string; localPath: string; loading: boolean; errorMessage: string }
type GrowthModel = OperatorStudentGrowthModel & { images: ImageModel[] };
const imageModel = (id: string): ImageModel => ({ id, localPath: '', loading: true, errorMessage: '' });

Page({
  context: undefined as OperatorPageContext | undefined,
  pendingRequest: undefined as Promise<void> | undefined,
  refreshRequest: undefined as Promise<void> | undefined,
  growthRequest: undefined as Promise<void> | undefined,
  reader: undefined as OperatorStudentMediaReader | undefined,
  mediaFiles: new Map<string, OperatorStudentMedia>(),
  growthRecords: [] as OperatorStudentGrowth[],
  archiveSequence: 0,
  growthSequence: 0,
  growthRetryReset: true,
  mediaSequence: 0,
  initialShowPending: true,
  pullSequence: 0,
  data: {
    viewState: 'loading', toolsOpen: false,
    errorMessage: '',
    studentId: '',
    detail: null as OperatorStudentArchiveModel | null,
    photo: null as ImageModel | null,
    growthItems: [] as GrowthModel[],
    growthState: 'loading',
    growthPage: 0,
    growthHasMore: false,
    growthLoading: false,
    growthError: '',
    previewBusy: false,
    refreshing: false,
    refreshError: '',
  },

  onToggleTools() { if (this.context?.isActive()) this.setData({ toolsOpen: !this.data.toolsOpen }); },

  onLoad(options: Record<string, string | undefined> = {}) {
    this.mediaFiles = new Map();
    this.growthRecords = [];
    this.context = new OperatorPageContext((errorMessage) => {
      this.resetMedia();
      this.archiveSequence += 1;
      this.growthSequence += 1;
      this.pendingRequest = undefined;
      this.refreshRequest = undefined;
      this.growthRequest = undefined;
      this.growthRecords = [];
      this.setData({
        viewState: 'forbidden', toolsOpen: false, errorMessage, studentId: '', detail: null,
        photo: null, growthItems: [], growthState: 'error', growthPage: 0,
        growthHasMore: false, growthLoading: false, growthError: '', previewBusy: false,
        refreshing: false, refreshError: '',
      });
    });
    this.setData({ studentId: options.id ?? '' });
    if (this.data.studentId) this.reader = this.context.studentMediaReader(this.data.studentId);
    void this.refresh();
  },

  onShow() {
    if (!this.context?.show()) return;
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    void this.refresh();
  },

  onHide() {
    this.setData({ toolsOpen: false });
    this.context?.hide();
    this.clearImagePaths();
    this.archiveSequence += 1;
    this.growthSequence += 1;
    this.pendingRequest = undefined;
    this.refreshRequest = undefined;
    this.growthRequest = undefined;
    this.initialShowPending = false;
    this.pullSequence += 1;
  },

  onUnload() {
    this.context?.dispose();
    this.resetMedia();
    this.growthRecords = [];
    this.pendingRequest = undefined;
    this.refreshRequest = undefined;
    this.growthRequest = undefined;
  },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.refresh().finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  resetMedia() {
    this.mediaSequence += 1;
    this.reader?.invalidate();
    this.mediaFiles.clear();
  },

  clearImagePaths() {
    this.resetMedia();
    this.setData({
      photo: this.data.photo ? { ...this.data.photo, localPath: '', loading: false } : null,
      growthItems: this.data.growthItems.map((item) => ({
        ...item, images: item.images.map((image) => ({ ...image, localPath: '', loading: false })),
      })),
      previewBusy: false,
    });
  },

  refresh(): Promise<void> {
    if (!this.context?.isActive()) return Promise.resolve();
    if (this.refreshRequest) return this.refreshRequest;
    this.clearImagePaths();
    const request = Promise.all([this.loadStudent(), this.loadGrowth(true)]).then(() => undefined).finally(() => {
      if (this.refreshRequest === request) this.refreshRequest = undefined;
    });
    this.refreshRequest = request;
    return request;
  },

  readDenied(state: { statusCode?: number; message?: string }): boolean {
    if (!this.context?.isCurrent()) return true;
    if (state.statusCode !== 401 && state.statusCode !== 403) return false;
    this.context.invalidate(state.message ?? '当前账号无权查看学员档案');
    return true;
  },

  unavailable(message: string) {
    this.resetMedia();
    this.archiveSequence += 1;
    this.growthSequence += 1;
    this.growthRecords = [];
    this.setData({
      viewState: 'error', errorMessage: message, detail: null, photo: null, growthItems: [],
      refreshing: false, growthLoading: false, growthHasMore: false, growthError: '', previewBusy: false,
    });
  },

  loadStudent(): Promise<void> {
    const context = this.context;
    if (!context?.isActive()) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    if (!this.data.studentId) {
      this.setData({
        viewState: 'error',
        errorMessage: '缺少学员标识，请返回后重新进入',
        detail: null,
      });
      return Promise.resolve();
    }
    const studentId = this.data.studentId;
    const sequence = ++this.archiveSequence;
    const keepContent = this.data.viewState === 'ready';
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading' }),
      errorMessage: '', refreshing: true, refreshError: '',
    });
    const request = Promise.resolve().then(() => {
      if (context.isActive() && sequence === this.archiveSequence) return context.service.loadStudentArchive(studentId);
    }).then((state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === 'error' && this.readDenied(state)) return;
      if (!context.isActive() || sequence !== this.archiveSequence) return;
      if (state.status === 'success') {
        this.setData({
          viewState: 'ready', errorMessage: '',
          detail: buildOperatorStudentArchive(state.data),
          photo: state.data.photo ? imageModel(state.data.photo.id) : null,
          refreshing: false, refreshError: '',
        });
        this.reconcileMedia();
        if (state.data.photo) this.loadImage(state.data.photo);
      } else if (state.status === 'error') {
        if (state.statusCode === 404) return this.unavailable(state.message);
        this.setData({
          ...(keepContent && state.statusCode !== 404
            ? { refreshError: state.message }
            : { viewState: 'error', errorMessage: state.message, detail: null }),
          refreshing: false,
        });
      }
    }).finally(() => {
      if (this.pendingRequest === request) this.pendingRequest = undefined;
    });
    this.pendingRequest = request;
    return request;
  },

  loadGrowth(reset: boolean): Promise<void> {
    const context = this.context;
    if (!context?.isActive() || !this.data.studentId || (!reset && !this.data.growthHasMore)) return Promise.resolve();
    if (this.growthRequest && !reset) return this.growthRequest;
    this.growthRetryReset = reset;
    const sequence = ++this.growthSequence;
    const page = reset ? 1 : this.data.growthPage + 1;
    this.setData({ growthLoading: true, growthError: '',
      ...(this.data.growthItems.length ? {} : { growthState: 'loading' }) });
    const request = Promise.resolve().then(() => {
      if (context.isActive() && sequence === this.growthSequence) {
        return context.service.loadStudentGrowth(this.data.studentId, { page, pageSize: 5 });
      }
    }).then((state) => {
      if (!state || !context.isCurrent()) return;
      if (state.status === 'error' && this.readDenied(state)) return;
      if (!context.isActive() || sequence !== this.growthSequence) return;
      if (state.status === 'success' || state.status === 'empty') {
        const byId = new Map((reset ? [] : this.growthRecords).map((item) => [item.lessonSessionId, item]));
        for (const item of state.data.data) byId.set(item.lessonSessionId, item);
        this.growthRecords = [...byId.values()];
        const previous = new Map(this.data.growthItems.flatMap((item) => item.images.map((image) => [image.id, image] as const)));
        const models = buildOperatorStudentGrowth(this.growthRecords).map((item, index) => ({
          ...item, images: this.growthRecords[index].feedbackImages.map((file) =>
            (!reset && previous.get(file.id)) || imageModel(file.id)),
        }));
        this.setData({
          growthItems: models, growthState: models.length ? 'ready' : 'empty',
          growthPage: state.data.meta.page, growthHasMore: state.data.meta.page < state.data.meta.totalPages,
          growthLoading: false, growthError: '',
        });
        this.reconcileMedia();
        for (const item of state.data.data) for (const file of item.feedbackImages) this.loadImage(file);
      } else if (state.status === 'error') {
        if (state.statusCode === 404) return this.unavailable(state.message);
        this.setData({ growthState: this.data.growthItems.length ? 'ready' : 'error',
          growthError: state.message, growthLoading: false });
      }
    }).finally(() => {
      if (this.growthRequest === request) this.growthRequest = undefined;
    });
    this.growthRequest = request;
    return request;
  },

  reconcileMedia() {
    const ids = new Set(this.growthRecords.flatMap((item) => item.feedbackImages.map((file) => file.id)));
    if (this.data.photo) ids.add(this.data.photo.id);
    for (const id of this.mediaFiles.keys()) if (!ids.has(id)) this.mediaFiles.delete(id);
    this.reader?.retain(ids);
  },

  updateImage(id: string, patch: Partial<ImageModel>) {
    this.setData({
      photo: this.data.photo?.id === id ? { ...this.data.photo, ...patch } : this.data.photo,
      growthItems: this.data.growthItems.map((item) => ({
        ...item, images: item.images.map((image) => image.id === id ? { ...image, ...patch } : image),
      })),
    });
  },

  loadImage(file: OperatorStudentMedia) {
    const reader = this.reader;
    if (!reader || !this.context?.isActive()) return;
    this.mediaFiles.set(file.id, file);
    const sequence = this.mediaSequence;
    void reader.load(file).then((localPath) => {
      if (this.context?.isActive() && sequence === this.mediaSequence) {
        this.updateImage(file.id, { localPath, loading: false, errorMessage: '' });
      }
    }).catch((error: { statusCode?: number; message?: string }) => {
      if (sequence !== this.mediaSequence || this.readDenied(error) || !this.context?.isActive()) return;
      this.updateImage(file.id, { localPath: '', loading: false, errorMessage: error.message ?? '图片读取失败，请重试' });
    });
  },

  onImageError(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    if (this.context?.isActive() && this.mediaFiles.has(id)) {
      this.updateImage(id, { localPath: '', loading: false, errorMessage: '图片显示失败，请刷新档案' });
    }
  },

  onMediaRetry() { void this.refresh(); },

  onPreviewImage(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? '');
    const selected = this.mediaFiles.get(id);
    if (!this.context?.isActive() || !this.reader || !selected || this.data.previewBusy) return;
    const group = this.growthRecords.find((item) => item.feedbackImages.some((file) => file.id === id));
    const photoPreview = this.data.photo?.id === id;
    if (!photoPreview && !group) return;
    const files = photoPreview ? [selected] : group!.feedbackImages;
    const associated = () => photoPreview ? this.data.photo?.id === id
      : files.every((file) => this.growthRecords.some((item) => item.lessonSessionId === group!.lessonSessionId &&
        item.feedbackImages.some((current) => current.id === file.id && current.accessUrl === file.accessUrl)));
    const sequence = this.mediaSequence;
    this.setData({ previewBusy: true });
    const current = () => sequence === this.mediaSequence && this.context?.isActive();
    const release = () => { if (current()) this.setData({ previewBusy: false }); };
    const failed = () => {
      if (!current() || !associated()) { release(); return; }
      release();
      wx.showToast({ title: '图片预览失败，请重试', icon: 'none' });
    };
    void Promise.all(files.map((file) => this.reader!.load(file).catch((error: { statusCode?: number; message?: string }) => {
      if (sequence === this.mediaSequence) this.readDenied(error);
      throw error;
    }))).then((paths) => {
      if (!current() || !associated()) { release(); return; }
      try {
        wx.previewImage({
          current: paths[files.findIndex((file) => file.id === id)], urls: paths,
          fail: failed, complete: release,
        });
      } catch { failed(); }
    }).catch((error: { statusCode?: number; message?: string }) => {
      if (sequence !== this.mediaSequence || this.readDenied(error) || !current()) return;
      release();
      if (!associated()) return;
      this.updateImage(id, { localPath: '', loading: false, errorMessage: error.message ?? '图片读取失败，请重试' });
    });
  },

  onGrowthRetry() { void this.loadGrowth(this.growthRetryReset); },
  onGrowthLoadMore() { void this.loadGrowth(false); },

  onLogin() {
    if (!this.context) return;
    if (this.context.ownsRuntime()) createSessionService().logout();
    this.context.invalidate('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },

  onRetry() {
    void this.refresh();
  },
});
