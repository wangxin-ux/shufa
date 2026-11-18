import { loadParentPdfDisplayFont } from '../runtime/parent-pdf-font';
import { parentService } from '../../../services/parent-runtime';
import { buildParentUpdatesPageModel, ParentUpdateRecordModel } from '../../../services/parent-updates.presenter';
import { sessionService } from '../../../services/session.service';
import { ParentGrowthStudent, ParentReviewDraft, ParentUpdatesView } from '../../../types/parent';
import { starRatingFills } from '../../../utils/star-rating';
import { RequestState } from '../../../utils/request-state';

const REVIEW_FIELDS = ['teaching', 'communication', 'environment', 'overall'] as const;
const REVIEW_LABELS = ['老师教学', '课后沟通', '教室环境', '整体评价'];
const emptyDraft = (): ParentReviewDraft => ({ teaching: 0, communication: 0, environment: 0, overall: 0, note: '' });
let sequence = 0;
const mutationKey = () => `parent-growth-${Date.now()}-${++sequence}`;
interface PendingPhoto { fileId: string; expectedVersion: number; key: string; conflict: boolean }

function rows(draft: ParentReviewDraft) {
  return REVIEW_FIELDS.map((field, index) => ({
    field, label: REVIEW_LABELS[index], score: draft[field],
    stars: starRatingFills(draft[field]).map((fill, star) => ({ fill, half: star * 2 + 1, full: star * 2 + 2 })),
  }));
}

Page({
  _visible: true,
  _unloaded: false,
  _readSequence: 0,
  _timer: null as ReturnType<typeof setInterval> | null,
  _drafts: {} as Record<string, ParentReviewDraft>,
  _reviewKeys: {} as Record<string, { signature: string; key: string }>,
  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    mutationMessage: '',
    student: null as ParentGrowthStudent | null,
    nameFontSize: 95,
    records: [] as ParentUpdateRecordModel[],
    current: null as ParentUpdateRecordModel | null,
    lessonOptions: [] as string[],
    lessonIndex: 0,
    isEmpty: true,
    reviewDraft: emptyDraft(),
    reviewRows: rows(emptyDraft()),
    reviewSubmitting: false,
    photoBusy: false,
    pendingPhoto: null as PendingPhoto | null,
  },

  onLoad() {
    void loadParentPdfDisplayFont();
    this._visible = true;
    this._unloaded = false;
  },

  onShow() {
    this._visible = true;
    void this.loadUpdates(this.data.viewState === 'ready');
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      if (!this.data.reviewSubmitting && !this.data.photoBusy) void this.loadUpdates(true);
    }, 30000);
  },

  onHide() {
    this._visible = false;
    this._readSequence += 1;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  },

  onUnload() {
    this._unloaded = true;
    this.onHide();
  },

  onPullDownRefresh() {
    void this.loadUpdates(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadUpdates(silent = false) {
    const request = ++this._readSequence;
    if (!silent) this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await parentService.loadUpdates();
    if (this._unloaded || !this._visible || request !== this._readSequence) return;
    if (state.status === 'success' || state.status === 'empty') {
      this.applyView(state.data);
      return;
    }
    if (state.status === 'error' && !this.handleExpired(state)) {
      if (silent && this.data.viewState === 'ready') this.setData({ refreshError: state.message });
      else this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message });
    }
  },

  applyView(view: ParentUpdatesView) {
    const model = buildParentUpdatesPageModel(view);
    const selectedId = this.data.current?.lessonSessionId;
    const index = Math.max(0, model.records.findIndex((record) => record.lessonSessionId === selectedId));
    const student = view.student ?? null;
    if (this.data.student && this.data.student.id !== student?.id) {
      this._drafts = {};
      this._reviewKeys = {};
      this.setData({ pendingPhoto: null });
    }
    this.setData({ ...model, student, viewState: 'ready', errorMessage: '', refreshError: '',
      nameFontSize: Math.max(24, Math.min(95, Math.floor(440 / Math.max(1, Array.from(student?.name ?? '').length)))),
      lessonOptions: model.records.map((record) => `${record.lessonTimeLabel} · ${record.courseName}`),
    });
    this.selectLesson(index);
  },

  selectLesson(index: number) {
    const current = this.data.records[index] ?? null;
    const reviewDraft = current?.review
      ? { teaching: current.review.teaching, communication: current.review.communication,
          environment: current.review.environment, overall: current.review.overall, note: current.review.note }
      : this._drafts[current?.lessonSessionId ?? ''] ?? emptyDraft();
    this.setData({ current, lessonIndex: index, reviewDraft, reviewRows: rows(reviewDraft) });
  },

  onLessonChange(event: WechatMiniprogram.PickerChange) {
    if (this.data.reviewSubmitting || this.data.photoBusy) return;
    const index = Number(event.detail.value);
    if (Number.isInteger(index) && index >= 0 && index < this.data.records.length) {
      this.selectLesson(index);
      this.setData({ mutationMessage: '' });
    }
  },

  onRate(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.current?.canReview || this.data.reviewSubmitting || this.data.photoBusy) return;
    const field = String(event.currentTarget.dataset.field ?? '');
    const score = Number(event.currentTarget.dataset.score);
    if (!REVIEW_FIELDS.includes(field as typeof REVIEW_FIELDS[number]) || !Number.isInteger(score) || score < 1 || score > 10) return;
    this.updateDraft({ ...this.data.reviewDraft, [field]: score });
  },

  onReviewNote(event: WechatMiniprogram.Input) {
    if (!this.data.current?.canReview || this.data.reviewSubmitting || this.data.photoBusy) return;
    this.updateDraft({ ...this.data.reviewDraft, note: event.detail.value });
  },

  updateDraft(draft: ParentReviewDraft) {
    if (!this.data.current) return;
    this._drafts[this.data.current.lessonSessionId] = { ...draft };
    this.setData({ reviewDraft: draft, reviewRows: rows(draft), mutationMessage: '' });
  },

  async onSubmitReview() {
    const current = this.data.current;
    const student = this.data.student;
    if (!current?.canReview || !student || this.data.reviewSubmitting || this.data.photoBusy) return;
    const draft = { ...this.data.reviewDraft, note: this.data.reviewDraft.note.trim() };
    if (REVIEW_FIELDS.some((field) => !Number.isInteger(draft[field]) || draft[field] < 1 || draft[field] > 10)) {
      this.setData({ mutationMessage: '请填写全部四项评分' }); return;
    }
    if (Array.from(draft.note).length > 500) { this.setData({ mutationMessage: '备注不能超过 500 字' }); return; }
    const signature = JSON.stringify(draft);
    let attempt = this._reviewKeys[current.lessonSessionId];
    if (!attempt || attempt.signature !== signature) {
      attempt = { signature, key: mutationKey() };
      this._reviewKeys[current.lessonSessionId] = attempt;
    }
    this.setData({ reviewSubmitting: true, mutationMessage: '' });
    this._readSequence += 1;
    const state = await parentService.submitLessonReview(current.lessonSessionId, student.id, draft, attempt.key);
    if (this._unloaded) return;
    this.setData({ reviewSubmitting: false });
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({ records: this.data.records.map((record) => record.lessonSessionId === current.lessonSessionId
        ? { ...record, review: state.data, canReview: false } : record) });
      this.selectLesson(this.data.lessonIndex);
      wx.showToast({ title: '评价已提交', icon: 'success' });
    } else if (state.status === 'error' && !this.handleExpired(state)) {
      this.setData({ mutationMessage: state.message });
      if (state.statusCode === 409) await this.loadUpdates(true);
    }
  },

  onPhotoLongPress() {
    if (!this.data.student || this.data.photoBusy || this.data.reviewSubmitting || this._unloaded) return;
    wx.showActionSheet({
      itemList: ['更换学员照片'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0 && !this._unloaded) void this.onChoosePhoto();
      },
    });
  },

  async onChoosePhoto() {
    const student = this.data.student;
    if (!student || this.data.photoBusy || this.data.reviewSubmitting) return;
    this.setData({ photoBusy: true, mutationMessage: '' });
    let selected: { tempFilePath: string; size: number } | undefined;
    try {
      const result = await new Promise<WechatMiniprogram.ChooseMediaSuccessCallbackResult>((resolve, reject) => {
        wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: resolve, fail: reject });
      });
      selected = result.tempFiles[0];
    } catch (error) {
      if (!this._unloaded) this.setData({ photoBusy: false });
      const canceled = typeof error === 'object' && error !== null && 'errMsg' in error && String(error.errMsg).includes('cancel');
      if (!canceled && !this._unloaded) this.setData({ mutationMessage: '选择照片失败，请重试' });
      return;
    }
    if (this._unloaded) return;
    if (!selected) { this.setData({ photoBusy: false }); return; }
    if (selected.size > 3 * 1024 * 1024) { this.setData({ photoBusy: false, mutationMessage: '照片不能超过 3 MB' }); return; }
    this.setData({ photoBusy: true, mutationMessage: '' });
    const state = await parentService.uploadStudentPhoto(student.id, selected.tempFilePath);
    if (this._unloaded) return;
    this.setData({ photoBusy: false });
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({ pendingPhoto: { fileId: state.data.id, expectedVersion: student.profileVersion, key: mutationKey(), conflict: false } });
      await this.savePendingPhoto();
    } else if (state.status === 'error' && !this.handleExpired(state)) this.setData({ mutationMessage: state.message });
  },

  async onRetryPhoto() {
    const pending = this.data.pendingPhoto;
    if (!pending || !this.data.student || this.data.photoBusy || this.data.reviewSubmitting) return;
    if (pending.conflict) {
      const answer = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => wx.showModal({
        title: '资料已经更新', content: '是否仍要用本次选择的照片替换当前照片？', success: resolve,
      }));
      if (!answer.confirm || this._unloaded) return;
      this.setData({ pendingPhoto: { ...pending, expectedVersion: this.data.student.profileVersion, key: mutationKey(), conflict: false } });
    }
    await this.savePendingPhoto();
  },

  async savePendingPhoto() {
    const pending = this.data.pendingPhoto;
    const student = this.data.student;
    if (!pending || !student || this.data.photoBusy || this.data.reviewSubmitting) return;
    this.setData({ photoBusy: true, mutationMessage: '' });
    this._readSequence += 1;
    const state = await parentService.replaceStudentPhoto(student.id,
      { fileId: pending.fileId, expectedVersion: pending.expectedVersion }, pending.key);
    if (this._unloaded) return;
    this.setData({ photoBusy: false });
    if (state.status === 'success' || state.status === 'empty') {
      this.setData({ student: state.data, pendingPhoto: null });
      wx.showToast({ title: '照片已更新', icon: 'success' });
    } else if (state.status === 'error' && !this.handleExpired(state)) {
      this.setData({ mutationMessage: state.message });
      if (state.statusCode === 409) {
        this.setData({ pendingPhoto: { ...pending, conflict: true } });
        await this.loadUpdates(true);
      }
    }
  },

  handleExpired(state: RequestState<unknown>) {
    if (state.status !== 'error' || state.statusCode !== 401) return false;
    sessionService.logout();
    this._drafts = {};
    this._reviewKeys = {};
    this.setData({ student: null, current: null, records: [], isEmpty: true, pendingPhoto: null });
    wx.reLaunch({ url: '/pages/bootstrap/index' });
    return true;
  },

  onRetry() {
    void this.loadUpdates(this.data.viewState === 'ready');
  },

  onPreviewImages(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.url ?? '');
    const record = this.data.current;
    if (!record || !current) {
      return;
    }
    wx.previewImage({
      current,
      urls: record.feedbackImages.map(({ accessUrl }) => accessUrl),
    });
  },

  onPreviewPhoto() {
    const url = this.data.student?.photo?.accessUrl;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },
});
