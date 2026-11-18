import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  buildPartnerStudentDetailPageModel,
} from '../../../services/partner-student-detail.presenter';
import { createPartnerService } from '../../../services/partner-runtime';
import { sessionService } from '../../../services/session.service';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';
import {
  buildPartnerGrowthItems,
  mergePartnerGrowthItems,
  type PartnerGrowthItem,
} from '../../../services/partner-student-growth.presenter';
import type { PartnerStudentPhoto } from '../../../types/partner';
import type { RequestState } from '../../../utils/request-state';
import { presentPartnerEnrollment } from '../runtime/partner-enrollment.presenter';
import { presentPartnerLedgerPayment } from '../runtime/partner-lesson-context.presenter';

function mediaExpired(file: PartnerStudentPhoto): boolean {
  const expiresAt = Date.parse(file.accessUrlExpiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 5_000;
}

type StudentDetailModel = ReturnType<
  typeof buildPartnerStudentDetailPageModel
> & { enrollment: ReturnType<typeof presentPartnerEnrollment> };

Page({
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  hidden: false,
  disposed: false,
  initialShowPending: false,
  growthSequence: 0,
  growthPending: undefined as Promise<void> | undefined,
  growthPage: 0,
  growthRequestedPage: 1,
  timeZone: 'Asia/Shanghai',
  previewSequence: 0,
  mediaRequests: null as Map<string, Promise<void>> | null,
  runtime: undefined as ReturnType<typeof createPartnerService> | undefined,
  detailOwnerKey: '',

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    studentId: '',
    detail: null as StudentDetailModel | null,
    growthItems: [] as PartnerGrowthItem[],
    growthState: 'idle',
    growthError: '',
    growthHasMore: false,
    growthTotal: 0,
  },

  onLoad(options: Record<string, string | undefined>) {
    void loadPartnerPdfDisplayFont();
    this.mediaRequests = new Map();
    this.runtime = createPartnerService();
    this.detailOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    this.initialShowPending = true;
    this.setData({ studentId: options.id ?? '' });
    void this.loadStudent();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.loadStudent(true);
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.growthSequence += 1;
    this.growthPending = undefined;
    this.previewSequence += 1;
    this.mediaRequests?.clear();
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    void this.loadStudent(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    this.onMoreGrowth();
  },

  validateOwner() {
    if (!this.detailOwnerKey ||
      getPartnerCampaignDraftService().getSessionKey() === this.detailOwnerKey) return true;
    this.requestSequence += 1;
    this.growthSequence += 1;
    this.previewSequence += 1;
    this.pendingRequest = undefined;
    this.growthPending = undefined;
    this.mediaRequests?.clear();
    this.growthPage = 0;
    this.growthRequestedPage = 1;
    this.setData({
      viewState: 'forbidden', studentId: '', detail: null,
      errorMessage: '登录已更新，请重新登录', refreshError: '',
      growthItems: [], growthState: 'idle', growthError: '', growthTotal: 0, growthHasMore: false,
    });
    return false;
  },

  loadStudent(silent = false): Promise<void> {
    if (this.disposed || this.hidden || !this.validateOwner() || !this.runtime) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    if (!this.data.studentId) {
      this.setData({
        viewState: 'error',
        errorMessage: '缺少学员标识，请返回后重新进入',
        refreshError: '',
        detail: null,
      });
      return Promise.resolve();
    }
    const sequence = ++this.requestSequence;
    const runtime = this.runtime;
    const read = async <T>(pending: Promise<RequestState<T>>): Promise<RequestState<T>> => {
      const state = await pending;
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403) &&
        !this.hidden && !this.disposed && sequence === this.requestSequence && this.validateOwner())
        this.onMediaError(state.statusCode, state.message);
      return state;
    };
    this.previewSequence += 1;
    this.mediaRequests?.clear();
    this.growthSequence += 1;
    this.growthPending = undefined;
    const keepContent = silent && this.data.viewState === 'ready';
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading', detail: null, growthItems: [], growthState: 'idle', growthError: '', growthTotal: 0, growthHasMore: false }),
      ...(keepContent && this.data.growthState === 'loading'
        ? { growthState: 'error', growthError: '成长记录加载已中断，请重试' } : {}),
      errorMessage: '',
      refreshError: '',
    });
    const request = (async () => {
      try {
        const [profile, student] = await Promise.all([
          read(runtime.loadProfile().catch(() => ({
            status: 'error' as const,
            statusCode: undefined,
            message: '学员详情加载失败，请重试',
          }))),
          read(runtime.loadStudent(this.data.studentId).catch(() => ({
            status: 'error' as const,
            statusCode: undefined,
            message: '学员详情加载失败，请重试',
          }))),
        ]);
        if (this.disposed || this.hidden || sequence !== this.requestSequence || !this.validateOwner()) return;
        if (student.status === 'empty' || (student.status === 'error' && student.statusCode === 404)) {
          this.setData({ viewState: 'empty', detail: null, errorMessage: '', refreshError: '', growthItems: [], growthState: 'idle', growthError: '', growthTotal: 0, growthHasMore: false });
          return;
        }
        const failure = profile.status === 'error' ? profile : student.status === 'error' ? student : null;
        if (failure) {
          this.setData(keepContent
            ? { refreshError: failure.message }
            : { viewState: 'error', errorMessage: failure.message, detail: null });
          return;
        }
        if ((profile.status === 'success' || profile.status === 'empty') && student.status === 'success') {
          this.timeZone = profile.data.campus.timezone;
          const detail = buildPartnerStudentDetailPageModel(student.data, this.timeZone);
          this.setData({
            viewState: 'ready',
            errorMessage: '',
            refreshError: '',
            detail: {
              ...detail,
              recentLessonLedger: detail.recentLessonLedger.map((item, index) => ({
                ...item,
                paymentLabel: presentPartnerLedgerPayment(student.data.recentLessonLedger[index], this.timeZone),
              })),
              enrollment: presentPartnerEnrollment(student.data),
            },
          });
          void this.loadGrowth(1, true);
        }
      } catch {
        if (this.disposed || this.hidden || sequence !== this.requestSequence || !this.validateOwner()) return;
        this.setData(keepContent
          ? { refreshError: '学员详情刷新失败，请重试' }
          : { viewState: 'error', errorMessage: '学员详情加载失败，请重试', detail: null });
      } finally {
        if (sequence === this.requestSequence) this.pendingRequest = undefined;
      }
    })();
    this.pendingRequest = request;
    return request;
  },

  onRetry() {
    void this.loadStudent(true);
  },

  loadGrowth(page: number, reset = false): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime || this.data.viewState !== 'ready' ||
      !Number.isInteger(page) || page < 1) return Promise.resolve();
    if (this.growthPending) return this.growthPending;
    if (!reset && this.pendingRequest) return Promise.resolve();
    const sequence = ++this.growthSequence;
    this.growthRequestedPage = page;
    this.setData({ growthState: 'loading', growthError: '' });
    const request = (async () => {
      try {
        const result = await this.runtime!.loadStudentGrowth(this.data.studentId, { page, pageSize: 5 });
        if (this.hidden || this.disposed || sequence !== this.growthSequence || !this.validateOwner()) return;
        if (result.status === 'error') {
          if (result.statusCode === 401 || result.statusCode === 403) {
            this.requestSequence += 1;
            this.pendingRequest = undefined;
            this.setData({
              viewState: 'forbidden',
              detail: null,
              refreshError: '',
              errorMessage: result.statusCode === 401 ? '登录已失效，请重新登录' : '当前账号无权查看该学员',
              growthItems: [], growthState: 'idle', growthError: '', growthTotal: 0, growthHasMore: false,
            });
          } else if (result.statusCode === 404) {
            this.setData({
              viewState: 'empty', detail: null, refreshError: '', errorMessage: '',
              growthItems: [], growthState: 'idle', growthError: '', growthTotal: 0, growthHasMore: false,
            });
          } else {
            this.setData({ growthState: 'error', growthError: result.message });
          }
          return;
        }
        if (result.status === 'success' || result.status === 'empty') {
          this.growthPage = result.data.meta.page;
          this.setData({
            growthState: 'ready',
            growthError: '',
            growthItems: mergePartnerGrowthItems(
              this.data.growthItems,
              buildPartnerGrowthItems(result.data.items, this.timeZone, page),
              page,
            ),
            growthTotal: result.data.meta.total,
            growthHasMore: result.data.meta.page < result.data.meta.totalPages,
          });
        }
      } catch {
        if (this.hidden || this.disposed || sequence !== this.growthSequence || !this.validateOwner()) return;
        this.setData({ growthState: 'error', growthError: '成长记录加载失败，请重试' });
      } finally {
        if (sequence === this.growthSequence) this.growthPending = undefined;
      }
    })();
    this.growthPending = request;
    return request;
  },

  onRetryGrowth() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    if (this.data.growthState !== 'error' || !this.data.growthError) return;
    void this.loadGrowth(this.growthRequestedPage);
  },

  onMoreGrowth() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    if (!this.data.growthHasMore || this.data.growthState !== 'ready' || this.data.growthError) return;
    void this.loadGrowth(this.growthPage + 1);
  },

  renewMedia(kind: 'photo' | 'feedback', sourcePage = 1): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime || this.data.viewState !== 'ready') return Promise.resolve();
    const key = `${kind}:${sourcePage}`;
    const pending = this.mediaRequests?.get(key);
    if (pending) return pending;
    const sequence = this.requestSequence;
    const studentId = this.data.studentId;
    const current = () => !this.hidden && !this.disposed
      && sequence === this.requestSequence
      && studentId === this.data.studentId && this.data.viewState === 'ready' && this.validateOwner();
    const request = (async () => {
      try {
        if (kind === 'photo') {
          const result = await this.runtime!.loadStudent(studentId);
          if (!current()) return;
          if (result.status === 'success' && this.data.detail) {
            this.setData({ detail: { ...this.data.detail, photo: result.data.photo }, refreshError: '' });
          } else if (result.status === 'error') {
            this.onMediaError(result.statusCode, result.message);
          }
        } else {
          const result = await this.runtime!.loadStudentGrowth(studentId, { page: sourcePage, pageSize: 5 });
          if (!current()) return;
          if (result.status === 'success' || result.status === 'empty') {
            const records = new Map(result.data.items.map((item) => [item.lessonSessionId, item]));
            this.setData({
              growthItems: this.data.growthItems.map((item) => item.sourcePage === sourcePage
                ? { ...item, images: records.get(item.id)?.feedbackImages ?? [] } : item),
              refreshError: '',
            });
          } else if (result.status === 'error') {
            this.onMediaError(result.statusCode, result.message);
          }
        }
      } catch {
        if (current()) this.onMediaError(undefined, '图片加载失败，请重试');
      } finally {
        if (sequence === this.requestSequence) this.mediaRequests?.delete(key);
      }
    })();
    this.mediaRequests?.set(key, request);
    return request;
  },

  onMediaError(statusCode: number | undefined, message: string) {
    if (statusCode !== 401 && statusCode !== 403 && statusCode !== 404) {
      this.setData({ refreshError: message });
      return;
    }
    this.requestSequence += 1;
    this.growthSequence += 1;
    this.previewSequence += 1;
    this.pendingRequest = undefined;
    this.growthPending = undefined;
    this.mediaRequests?.clear();
    this.setData({
      viewState: statusCode === 404 ? 'empty' : 'forbidden',
      detail: null, refreshError: '',
      errorMessage: statusCode === 401 ? '登录已失效，请重新登录' : statusCode === 403 ? '当前账号无权查看该学员' : '',
      growthItems: [], growthState: 'idle', growthError: '', growthTotal: 0, growthHasMore: false,
    });
  },

  openMediaPreview(current: string, urls: string[], preview: number, studentId: string) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const fail = () => {
      if (preview !== this.previewSequence || this.hidden || this.disposed ||
        this.data.viewState !== 'ready' || this.data.studentId !== studentId || !this.validateOwner()) return;
      this.setData({ refreshError: '图片预览失败，请重试' });
    };
    try {
      wx.previewImage({ current, urls, fail });
    } catch {
      fail();
    }
  },

  async onPreviewPhoto() {
    if (this.hidden || this.disposed || !this.validateOwner() || this.data.viewState !== 'ready' || !this.data.detail?.photo) return;
    const preview = ++this.previewSequence;
    const studentId = this.data.studentId;
    const fileId = this.data.detail.photo.id;
    if (mediaExpired(this.data.detail.photo)) await this.renewMedia('photo');
    if (preview !== this.previewSequence || this.hidden || this.disposed || !this.validateOwner() || this.data.viewState !== 'ready' || this.data.studentId !== studentId) return;
    const photo = this.data.detail?.photo;
    if (!photo || photo.id !== fileId || mediaExpired(photo)) return;
    const url = photo.accessUrl;
    this.openMediaPreview(url, [url], preview, studentId);
  },

  async onPreviewFeedback(event: WechatMiniprogram.BaseEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.data.viewState !== 'ready') return;
    const { id, index } = event.currentTarget.dataset;
    const record = this.data.growthItems.find((item) => item.id === id);
    const image = record?.images[Number(index)];
    if (!record || !image) return;
    const preview = ++this.previewSequence;
    const studentId = this.data.studentId;
    if (record.images.some(mediaExpired)) await this.renewMedia('feedback', record.sourcePage);
    if (preview !== this.previewSequence || this.hidden || this.disposed || !this.validateOwner() || this.data.viewState !== 'ready' || this.data.studentId !== studentId) return;
    const images = this.data.growthItems.find((item) => item.id === id)?.images.filter((file) => !mediaExpired(file));
    const current = images?.find((file) => file.id === image.id);
    if (!images || !current) return;
    this.openMediaPreview(current.accessUrl, images.map((file) => file.accessUrl), preview, studentId);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    sessionService.logout();
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
