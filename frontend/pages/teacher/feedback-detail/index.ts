import { loadTeacherDisplayFont } from '../runtime/teacher-display-font';

import {
  buildTeacherFeedbackStudentModels,
  TeacherFeedbackStudentModel,
} from '../../../services/teacher-feedback.presenter';
import { TeacherLessonWorkflow } from '../../../services/teacher-lesson.workflow';
import { createSessionService } from '../../../services/session.service';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from '../runtime/teacher-read-context';
import { StudentFeedback, TeacherLessonDetail } from '../../../types/teacher';
import { parseZonedDateTime } from '../../../utils/format';
import { starRatingLabel } from '../../../utils/star-rating';
import {
  emptyTeacherRatings, teacherRatingRows, TEACHER_RATING_FIELDS, TEACHER_RATING_OPTIONS,
} from '../../../utils/teacher-ratings';

const MAX_FEEDBACK_IMAGES = 3;
const MAX_FEEDBACK_IMAGE_BYTES = 2 * 1024 * 1024;

function chooseFeedbackImages(
  count: number,
): Promise<Array<{ tempFilePath: string; size: number }>> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (result) =>
        resolve(
          result.tempFiles.map(({ tempFilePath, size }) => ({
            tempFilePath,
            size,
          })),
        ),
      fail: reject,
    });
  });
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  const start = parseZonedDateTime(startsAt);
  const end = parseZonedDateTime(endsAt);
  return start && end
    ? `${start.month}月${start.day}日 ${start.time}-${end.time}`
    : '时间待定';
}

Page({
  context: undefined as TeacherReadContext | undefined,
  runtime: undefined as ReturnType<typeof createTeacherPageService> | undefined,
  workflow: undefined as TeacherLessonWorkflow | undefined,
  requestSequence: 0,
  pullSequence: 0,
  hidden: false,
  disposed: false,
  blocked: false,
  initialShowPending: false,
  pendingRequest: undefined as Promise<void> | undefined,
  mutationPending: undefined as Promise<void> | undefined,
  resumeImageSelection: undefined as (() => void) | undefined,
  pendingFeedbackDenial: '',
  pendingFeedbackConflict: undefined as {
    lessonId: string; studentId: string;
  } | undefined,
  pendingFeedbackReceipt: undefined as {
    lessonId: string; studentId: string; feedback: StudentFeedback;
  } | undefined,

  data: {
    lessonId: '',
    viewState: 'loading',
    errorMessage: '',
    mutationMessage: '',
    refreshError: '',
    refreshing: false,
    imageError: '',
    draftImageUrls: {} as Record<string, string>,
    detail: null as TeacherLessonDetail | null,
    courseName: '',
    detailLabel: '',
    statusLabel: '',
    progressLabel: '',
    students: [] as TeacherFeedbackStudentModel[],
    feedbackSubmittingId: '',
    feedbackUploadingId: '',
    feedbackReloadingId: '',
    performanceOptions: ['未评分', '0.5 星', '1 星', '1.5 星', '2 星', '2.5 星', '3 星', '3.5 星', '4 星', '4.5 星', '5 星'],
    teacherRatingOptions: TEACHER_RATING_OPTIONS,
  },

  onLoad(options: Record<string, string | undefined>) {
    void loadTeacherDisplayFont();
    this.context = readTeacherReadContext();
    this.initialShowPending = true;
    if (!this.validateOwner()) return;
    try {
      this.runtime = createTeacherPageService(this.context);
      this.workflow = new TeacherLessonWorkflow(this.runtime);
    } catch {
      this.setData({ viewState: 'error', errorMessage: '教师端配置不可用，请重新登录' });
      return;
    }
    const lessonId = options.id?.trim() ?? '';
    this.setData({ lessonId });
    if (!lessonId) {
      this.setData({ viewState: 'empty' });
      return;
    }
    void this.loadFeedback(false);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.pendingFeedbackDenial) {
      this.invalidateOwner(this.pendingFeedbackDenial);
      return;
    }
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    if (this.mutationPending) {
      const sequence = ++this.requestSequence;
      this.resumeImageSelection?.();
      this.resumeImageSelection = undefined;
      void this.mutationPending.then(() => {
        if (this.canReceive(sequence)) {
          this.applyPendingFeedbackReceipt();
          void this.loadFeedback(true);
        }
      });
      return;
    }
    this.applyPendingFeedbackReceipt();
    void this.loadFeedback(true);
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pullSequence += 1;
    this.pendingRequest = undefined;
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
    this.resumeImageSelection?.();
    this.resumeImageSelection = undefined;
    this.pendingFeedbackDenial = '';
    this.pendingFeedbackReceipt = undefined;
    this.pendingFeedbackConflict = undefined;
  },

  invalidateOwner(message: string) {
    this.blocked = true;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingFeedbackDenial = '';
    this.pendingFeedbackReceipt = undefined;
    this.pendingFeedbackConflict = undefined;
    this.setData({
      viewState: 'forbidden', errorMessage: message, detail: null, students: [],
      lessonId: '', courseName: '', detailLabel: '', statusLabel: '', progressLabel: '',
      mutationMessage: '', refreshError: '', feedbackSubmittingId: '', feedbackUploadingId: '',
      feedbackReloadingId: '',
      refreshing: false,
      imageError: '',
      draftImageUrls: {},
    });
  },

  validateOwner(): boolean {
    if (this.blocked || !this.context) return false;
    if (isCurrentTeacherReadContext(this.context)) return true;
    this.invalidateOwner('登录已更新，请重新登录');
    return false;
  },

  handleWriteAccessDenied(message: string) {
    if (this.disposed || !this.validateOwner()) return;
    this.pendingFeedbackReceipt = undefined;
    this.pendingFeedbackConflict = undefined;
    if (this.hidden) this.pendingFeedbackDenial = message;
    else this.invalidateOwner(message);
  },

  canReceive(sequence: number): boolean {
    return !this.hidden && !this.disposed && sequence === this.requestSequence && this.validateOwner();
  },

  canEdit(duringRead = false): boolean {
    return !this.hidden && !this.disposed && this.validateOwner() &&
      this.data.viewState === 'ready' && (duringRead || !this.pendingRequest) && !this.mutationPending;
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed) return;
    if (!this.validateOwner()) { wx.stopPullDownRefresh(); return; }
    const pull = ++this.pullSequence;
    void this.loadFeedback(true).finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  loadFeedback(preserveDraft: boolean, reloadStudentId = ''): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime ||
        this.mutationPending) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    if (!this.data.lessonId) {
      this.setData({ viewState: 'empty' });
      return Promise.resolve();
    }
    const sequence = ++this.requestSequence;
    const keepContent = this.data.viewState === 'ready';
    this.setData({
      ...(!keepContent ? { viewState: 'loading' } : {}),
      errorMessage: '', refreshError: '', refreshing: keepContent,
      feedbackReloadingId: reloadStudentId,
    });
    const pending = this.runtime.loadLessonSession(this.data.lessonId).then((state) => {
      if (!this.canReceive(sequence)) return;
      if (state.status === 'success' || state.status === 'empty') this.applyLesson(state.data, preserveDraft, reloadStudentId);
      else if (state.status === 'error') this.applyReadFailure(state.statusCode, keepContent);
    }).catch(() => {
      if (this.canReceive(sequence)) this.applyReadFailure(undefined, keepContent);
    }).finally(() => {
      if (sequence === this.requestSequence) {
        this.pendingRequest = undefined;
        if (!this.hidden && !this.disposed) this.setData({ refreshing: false, feedbackReloadingId: '' });
      }
    });
    this.pendingRequest = pending;
    return pending;
  },

  applyReadFailure(code: number | undefined, keepContent: boolean) {
    if (code === 401 || code === 403) {
      this.invalidateOwner('登录已失效或无权查看该课次反馈，请重新登录');
      return;
    }
    this.setData(keepContent
      ? { refreshError: '反馈刷新失败，请重试', feedbackSubmittingId: '', feedbackUploadingId: '' }
      : { viewState: 'error', errorMessage: '反馈详情加载失败，请稍后重试' });
  },

  applyLesson(detail: TeacherLessonDetail, preserveDraft: boolean, reloadStudentId = '') {
    if (detail.status !== 'COMPLETED' && detail.status !== 'REVERSED') {
      this.setData({
        viewState: 'error',
        errorMessage: '课次完成后才能填写课堂反馈',
      });
      return;
    }
    const previous = new Map(
      preserveDraft && detail.status === 'COMPLETED'
        ? this.data.students.filter((student) => student.id !== reloadStudentId).map((student) => [
            student.id,
            {
              feedbackDraft: student.feedbackDraft,
              feedbackImages: student.feedbackImages,
              performanceRatingDraft: student.performanceRatingDraft,
              teacherRatingsDraft: student.teacherRatingsDraft,
              feedbackVersion: student.feedbackVersion,
              ratingConflict: student.ratingConflict,
            },
          ])
        : [],
    );
    const models = buildTeacherFeedbackStudentModels(detail);
    for (const student of models) {
      if (student.readOnly) previous.delete(student.id);
    }
    const students = models.map((student) => ({
      ...student,
      feedbackDraft:
        previous.get(student.id)?.feedbackDraft ?? student.feedbackDraft,
      feedbackImages: previous.has(student.id)
        ? previous.get(student.id)!.feedbackImages.map((image) =>
          student.feedbackImages.find((saved) => saved.id === image.id) ?? image)
        : student.feedbackImages,
      performanceRatingDraft: previous.has(student.id)
        ? previous.get(student.id)!.performanceRatingDraft
        : student.performanceRatingDraft,
      ...(previous.has(student.id) ? {
        teacherRatingsDraft: previous.get(student.id)!.teacherRatingsDraft,
        teacherRatingRows: teacherRatingRows(previous.get(student.id)!.teacherRatingsDraft),
        feedbackVersion: previous.get(student.id)!.feedbackVersion,
        ratingConflict: previous.get(student.id)!.ratingConflict,
      } : {}),
    }));
    const savedImageIds = new Set(models.flatMap((student) =>
      student.feedbackImages.map((image) => image.id)));
    const draftImageUrls: Record<string, string> = {};
    for (const student of students) {
      for (const image of student.feedbackImages) {
        const localUrl = this.data.draftImageUrls[image.id];
        if (!student.readOnly && !savedImageIds.has(image.id) && localUrl) {
          draftImageUrls[image.id] = localUrl;
        }
      }
    }
    const completed = students.filter(({ hasFeedback }) => hasFeedback).length;
    this.setData({
      viewState: 'ready',
      detail,
      courseName: detail.courseName,
      detailLabel: `${detail.className} · ${formatTimeRange(detail.startsAt, detail.endsAt)}`,
      statusLabel: detail.status === 'REVERSED' ? '课次已撤销 · 仅查看'
        : students.some((student) => !student.readOnly) ? '可填写反馈' : '仅查看',
      progressLabel: `已反馈 ${completed}/${students.length} 人`,
      students,
      draftImageUrls,
      imageError: '',
      mutationMessage: '',
      errorMessage: '',
      refreshError: '',
      feedbackSubmittingId: '',
      feedbackUploadingId: '',
    });
  },

  onFeedbackInput(event: WechatMiniprogram.Input) {
    if (!this.canEdit(true)) return;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    if (studentId === this.data.feedbackReloadingId) return;
    const feedbackDraft = event.detail.value;
    this.setData({
      students: this.data.students.map((student) =>
        student.id === studentId && !student.readOnly
          ? { ...student, feedbackDraft }
          : student,
      ),
      mutationMessage: '',
    });
  },

  onPerformanceChange(event: WechatMiniprogram.PickerChange) {
    if (!this.canEdit(true)) return;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    if (studentId === this.data.feedbackReloadingId) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index > 10) return;
    this.setData({
      students: this.data.students.map((student) =>
        student.id === studentId && !student.readOnly
          ? { ...student, performanceRatingDraft: index || null }
          : student,
      ),
      mutationMessage: '',
    });
  },

  onTeacherRatingChange(event: WechatMiniprogram.PickerChange) {
    if (!this.canEdit(true)) return;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    if (studentId === this.data.feedbackReloadingId) return;
    const field = TEACHER_RATING_FIELDS.find(
      (item) => item.field === event.currentTarget.dataset.field,
    )?.field;
    const index = Number(event.detail.value);
    if (!field || !Number.isInteger(index) || index < 0 || index > 11) return;
    this.setData({
      students: this.data.students.map((student) => {
        if (student.id !== studentId || student.readOnly) return student;
        const teacherRatingsDraft = { ...student.teacherRatingsDraft, [field]: index === 0 ? null : index - 1 };
        return { ...student, teacherRatingsDraft, teacherRatingRows: teacherRatingRows(teacherRatingsDraft) };
      }),
      mutationMessage: '',
    });
  },

  onReloadFeedback(event?: WechatMiniprogram.TouchEvent) {
    if (!this.canEdit()) return;
    const id = String(event?.currentTarget.dataset.id ?? '');
    void this.loadFeedback(Boolean(id), id);
  },

  applyPendingFeedbackReceipt() {
    const receipt = this.pendingFeedbackReceipt;
    this.pendingFeedbackReceipt = undefined;
    if (receipt?.lessonId === this.data.lessonId) {
      this.applySavedFeedback(receipt.studentId, receipt.feedback);
    }
    const conflict = this.pendingFeedbackConflict;
    this.pendingFeedbackConflict = undefined;
    if (conflict?.lessonId === this.data.lessonId &&
        this.data.students.some((item) => item.id === conflict.studentId && !item.readOnly)) {
      this.setData({
        students: this.data.students.map((item) => item.id === conflict.studentId
          ? { ...item, ratingConflict: true } : item),
        feedbackSubmittingId: '',
        mutationMessage: '反馈已在其他位置更新，草稿已保留，请重新加载该学员反馈后再保存',
      });
    }
  },

  applySavedFeedback(studentId: string, feedback: StudentFeedback) {
    const detail = this.data.detail;
    const student = this.data.students.find((item) => item.id === studentId);
    if (!detail || !student || student.readOnly) return;
    const savedImageIds = new Set(student.feedbackImages.map(({ id }) => id));
    const draftImageUrls = Object.fromEntries(
      Object.entries(this.data.draftImageUrls).filter(([id]) => !savedImageIds.has(id)),
    );
    const students = this.data.students.map((item) =>
      item.id === studentId
        ? {
            ...item,
            feedback: feedback.content,
            feedbackDraft: feedback.content,
            feedbackImages: feedback.images,
            performanceRating: feedback.performanceRating ?? null,
            performanceRatingDraft: feedback.performanceRating ?? null,
            performanceRatingLabel: starRatingLabel(feedback.performanceRating),
            teacherRatingsDraft: { ...(feedback.teacherRatings ?? emptyTeacherRatings()) },
            teacherRatingRows: teacherRatingRows(feedback.teacherRatings),
            feedbackVersion: feedback.version ?? item.feedbackVersion,
            ratingConflict: false,
            hasFeedback: true,
          }
        : item,
    );
    this.setData({
      students, draftImageUrls, feedbackSubmittingId: '',
      detail: { ...detail, students: detail.students.map((item) => item.id === studentId
        ? { ...item, feedback: feedback.content, feedbackImages: feedback.images,
            performanceRating: feedback.performanceRating ?? null,
            teacherRatings: feedback.teacherRatings ?? null,
            feedbackVersion: feedback.version ?? student.feedbackVersion }
        : item) },
      progressLabel: `已反馈 ${students.filter(({ hasFeedback }) => hasFeedback).length}/${students.length} 人`,
    });
  },

  async onSaveFeedback(event: WechatMiniprogram.TouchEvent) {
    if (!this.canEdit() || !this.workflow) return;
    const detail = this.data.detail;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    const student = this.data.students.find(({ id }) => id === studentId);
    if (
      !detail ||
      !student ||
      student.readOnly ||
      student.ratingConflict ||
      this.data.feedbackSubmittingId
    ) {
      return;
    }
    const sequence = ++this.requestSequence;
    this.setData({ feedbackSubmittingId: studentId, mutationMessage: '' });
    const pending = this.workflow.feedback(
      detail,
      studentId,
      student.feedbackDraft,
      student.feedbackImages.map(({ id }) => id),
      student.performanceRatingDraft,
      { teacherRatings: student.teacherRatingsDraft, expectedVersion: student.feedbackVersion },
    ).then((outcome) => {
      if (outcome.status === 'forbidden') {
        this.handleWriteAccessDenied('登录已失效或无权保存课堂反馈，请重新登录');
        return;
      }
      if (!this.canReceive(sequence)) {
        // Keep confirmed outcomes off-screen until the same Page owner returns.
        if (!this.disposed && this.validateOwner()) {
          if (outcome.status === 'success') {
            this.pendingFeedbackReceipt = { lessonId: detail.id, studentId, feedback: outcome.data };
          } else if (outcome.code === 'FEEDBACK_VERSION_CONFLICT') {
            this.pendingFeedbackConflict = { lessonId: detail.id, studentId };
          }
        }
        return;
      }
      if (outcome.status === 'success') {
        this.applySavedFeedback(studentId, outcome.data);
        wx.showToast({ title: '反馈已保存', icon: 'success' });
      } else if (outcome.code === 'FEEDBACK_VERSION_CONFLICT') {
        this.setData({
          students: this.data.students.map((item) => item.id === studentId
            ? { ...item, ratingConflict: true } : item),
          mutationMessage: '反馈已在其他位置更新，草稿已保留，请重新加载该学员反馈后再保存',
        });
      } else {
        this.setData({ mutationMessage: /[\u3400-\u9fff]/.test(outcome.message)
          ? outcome.message : '反馈保存失败，请重试' });
      }
      if (!this.blocked) this.setData({ feedbackSubmittingId: '' });
    }).catch(() => {
      if (this.canReceive(sequence)) this.setData({
        feedbackSubmittingId: '', mutationMessage: '反馈保存失败，请重试',
      });
    }).finally(() => {
      if (this.mutationPending === pending) this.mutationPending = undefined;
    });
    this.mutationPending = pending;
    await pending;
  },

  async onChooseImages(event: WechatMiniprogram.TouchEvent) {
    if (!this.canEdit() || !this.runtime) return;
    const detail = this.data.detail;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    const student = this.data.students.find(({ id }) => id === studentId);
    if (
      !detail ||
      !student ||
      student.readOnly ||
      this.data.feedbackUploadingId ||
      this.data.feedbackSubmittingId
    ) {
      return;
    }
    const remaining = MAX_FEEDBACK_IMAGES - student.feedbackImages.length;
    if (remaining <= 0) {
      this.setData({ mutationMessage: '每位学员最多添加 3 张图片' });
      return;
    }

    this.setData({ feedbackUploadingId: studentId, mutationMessage: '' });
    const runtime = this.runtime;
    const pending = (async () => {
      let selected: Array<{ tempFilePath: string; size: number }>;
      try {
        selected = await chooseFeedbackImages(remaining);
      } catch (error) {
        const cancelled = typeof error === 'object' && error !== null && 'errMsg' in error &&
          String((error as { errMsg: unknown }).errMsg).includes('cancel');
        if (!cancelled && !this.hidden && !this.disposed && this.validateOwner()) {
          this.setData({ mutationMessage: '选择图片失败，请重试' });
        }
        return;
      }
      // Native media may hide the Page; continue only after returning to its owner.
      if (this.hidden && !this.disposed) {
        await new Promise<void>((resolve) => { this.resumeImageSelection = resolve; });
      }
      if (this.hidden || this.disposed || !this.validateOwner()) return;
      const sequence = this.requestSequence;
      if (selected.some(({ size }) => size > MAX_FEEDBACK_IMAGE_BYTES)) {
        this.setData({ mutationMessage: '单张图片不能超过 2 MiB' });
        return;
      }
      let images = [...student.feedbackImages];
      for (const file of selected.slice(0, remaining)) {
        if (!this.canReceive(sequence)) return;
        const state = await runtime.uploadFeedbackImage({
          lessonSessionId: detail.id, studentId, filePath: file.tempFilePath,
        });
        if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
          this.handleWriteAccessDenied('登录已失效或无权上传反馈图片，请重新登录');
          return;
        }
        if (!this.canReceive(sequence)) return;
        if (state.status === 'error') {
          this.setData({ mutationMessage: '反馈图片上传失败，请重试' });
          break;
        }
        if (state.status === 'success' || state.status === 'empty') {
          images = [...images, state.data];
          this.setData({
            // Unbound uploads cannot renew their signed URLs through lesson reads.
            draftImageUrls: { ...this.data.draftImageUrls, [state.data.id]: file.tempFilePath },
            students: this.data.students.map((item) =>
              item.id === studentId ? { ...item, feedbackImages: images } : item,
            ),
          });
        }
      }
    })().catch(() => {
      if (!this.hidden && !this.disposed && this.validateOwner()) {
        this.setData({ mutationMessage: '反馈图片上传失败，请重试' });
      }
    }).finally(() => {
      if (!this.hidden && !this.disposed && this.validateOwner()) this.setData({ feedbackUploadingId: '' });
      this.resumeImageSelection = undefined;
      if (this.mutationPending === pending) this.mutationPending = undefined;
    });
    this.mutationPending = pending;
    await pending;
  },

  onRemoveImage(event: WechatMiniprogram.TouchEvent) {
    if (!this.canEdit(true)) return;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    if (studentId === this.data.feedbackReloadingId) return;
    const imageId = String(event.currentTarget.dataset.imageId ?? '');
    if (!this.data.students.some((student) => student.id === studentId && !student.readOnly &&
      student.feedbackImages.some((image) => image.id === imageId))) return;
    const draftImageUrls = { ...this.data.draftImageUrls };
    delete draftImageUrls[imageId];
    this.setData({
      draftImageUrls,
      students: this.data.students.map((student) =>
        student.id === studentId && !student.readOnly
          ? {
              ...student,
              feedbackImages: student.feedbackImages.filter(
                ({ id }) => id !== imageId,
              ),
            }
          : student,
      ),
      mutationMessage: '',
    });
  },

  onPreviewImages(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner() || this.mutationPending) return;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    const current = String(event.currentTarget.dataset.url ?? '');
    const student = this.data.students.find(({ id }) => id === studentId);
    const urls = student?.feedbackImages.map((image) =>
      this.data.draftImageUrls[image.id] || image.accessUrl) ?? [];
    if (!urls.includes(current)) {
      return;
    }
    wx.previewImage({
      current,
      urls,
      fail: () => {
        if (!this.hidden && !this.disposed && this.validateOwner()) {
          this.setData({ imageError: '图片预览失败，请重新加载图片' });
        }
      },
    });
  },

  onFeedbackImageError(event: WechatMiniprogram.TouchEvent) {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const { id, imageId, url } = event.currentTarget.dataset;
    if (!this.data.students.some((student) => student.id === id &&
      student.feedbackImages.some((image) => image.id === imageId &&
        (this.data.draftImageUrls[image.id] || image.accessUrl) === url))) return;
    this.setData({ imageError: '图片加载失败，请重新加载图片' });
  },

  onRetryImages() { void this.loadFeedback(true); },

  onRetry() {
    void this.loadFeedback(true);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    createSessionService().logout();
    this.invalidateOwner('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
