import {
  buildTeacherFeedbackStudentModels,
  TeacherFeedbackStudentModel,
} from '../../../services/teacher-feedback.presenter';
import { TeacherLessonWorkflow } from '../../../services/teacher-lesson.workflow';
import { teacherService } from '../../../services/teacher-runtime';
import { TeacherLessonDetail } from '../../../types/teacher';
import { parseZonedDateTime } from '../../../utils/format';

const workflow = new TeacherLessonWorkflow(teacherService);
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
  data: {
    lessonId: '',
    viewState: 'loading',
    errorMessage: '',
    mutationMessage: '',
    detail: null as TeacherLessonDetail | null,
    courseName: '',
    detailLabel: '',
    statusLabel: '',
    progressLabel: '',
    students: [] as TeacherFeedbackStudentModel[],
    feedbackSubmittingId: '',
    feedbackUploadingId: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const lessonId = options.id?.trim() ?? '';
    this.setData({ lessonId });
    if (!lessonId) {
      this.setData({ viewState: 'empty' });
      return;
    }
    void this.loadFeedback(false);
  },

  onPullDownRefresh() {
    void this.loadFeedback(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadFeedback(preserveDraft: boolean) {
    if (!this.data.lessonId) {
      this.setData({ viewState: 'empty' });
      return;
    }
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await teacherService.loadLessonSession(this.data.lessonId);
    if (state.status === 'success' || state.status === 'empty') {
      this.applyLesson(state.data, preserveDraft);
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看该课次反馈'
            : state.message,
      });
    }
  },

  applyLesson(detail: TeacherLessonDetail, preserveDraft: boolean) {
    if (detail.status !== 'COMPLETED' && detail.status !== 'REVERSED') {
      this.setData({
        viewState: 'error',
        errorMessage: '课次完成后才能填写课堂反馈',
      });
      return;
    }
    const previous = new Map(
      preserveDraft
        ? this.data.students.map((student) => [
            student.id,
            {
              feedbackDraft: student.feedbackDraft,
              feedbackImages: student.feedbackImages,
            },
          ])
        : [],
    );
    const students = buildTeacherFeedbackStudentModels(detail).map((student) => ({
      ...student,
      feedbackDraft:
        previous.get(student.id)?.feedbackDraft ?? student.feedbackDraft,
      feedbackImages:
        previous.get(student.id)?.feedbackImages ?? student.feedbackImages,
    }));
    const completed = students.filter(({ hasFeedback }) => hasFeedback).length;
    this.setData({
      viewState: 'ready',
      detail,
      courseName: detail.courseName,
      detailLabel: `${detail.className} · ${formatTimeRange(detail.startsAt, detail.endsAt)}`,
      statusLabel: detail.status === 'COMPLETED' ? '可填写反馈' : '课次已撤销 · 仅查看',
      progressLabel: `已反馈 ${completed}/${students.length} 人`,
      students,
      mutationMessage: '',
      errorMessage: '',
    });
  },

  onFeedbackInput(event: WechatMiniprogram.Input) {
    const studentId = String(event.currentTarget.dataset.id ?? '');
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

  async onSaveFeedback(event: WechatMiniprogram.TouchEvent) {
    const detail = this.data.detail;
    const studentId = String(event.currentTarget.dataset.id ?? '');
    const student = this.data.students.find(({ id }) => id === studentId);
    if (
      !detail ||
      !student ||
      student.readOnly ||
      this.data.feedbackSubmittingId
    ) {
      return;
    }
    this.setData({ feedbackSubmittingId: studentId, mutationMessage: '' });
    const outcome = await workflow.feedback(
      detail,
      studentId,
      student.feedbackDraft,
      student.feedbackImages.map(({ id }) => id),
    );
    if (outcome.status === 'success') {
      const students = this.data.students.map((item) =>
        item.id === studentId
          ? {
              ...item,
              feedback: outcome.data.content,
              feedbackDraft: outcome.data.content,
              feedbackImages: outcome.data.images,
              hasFeedback: true,
            }
          : item,
      );
      this.setData({
        students,
        progressLabel: `已反馈 ${students.filter(({ hasFeedback }) => hasFeedback).length}/${students.length} 人`,
      });
      wx.showToast({ title: '反馈已保存', icon: 'success' });
    } else if (outcome.status === 'forbidden') {
      this.setData({
        viewState: 'forbidden',
        errorMessage: outcome.message,
      });
    } else {
      this.setData({ mutationMessage: outcome.message });
    }
    this.setData({ feedbackSubmittingId: '' });
  },

  async onChooseImages(event: WechatMiniprogram.TouchEvent) {
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

    let selected: Array<{ tempFilePath: string; size: number }>;
    try {
      selected = await chooseFeedbackImages(remaining);
    } catch (error) {
      const message =
        typeof error === 'object' &&
        error !== null &&
        'errMsg' in error &&
        String((error as { errMsg: unknown }).errMsg).includes('cancel')
          ? ''
          : '选择图片失败，请重试';
      if (message) {
        this.setData({ mutationMessage: message });
      }
      return;
    }
    if (selected.some(({ size }) => size > MAX_FEEDBACK_IMAGE_BYTES)) {
      this.setData({ mutationMessage: '单张图片不能超过 2 MiB' });
      return;
    }

    this.setData({ feedbackUploadingId: studentId, mutationMessage: '' });
    let images = [...student.feedbackImages];
    for (const file of selected) {
      const state = await teacherService.uploadFeedbackImage({
        lessonSessionId: detail.id,
        studentId,
        filePath: file.tempFilePath,
      });
      if (state.status === 'error') {
        this.setData({ mutationMessage: state.message });
        break;
      }
      if (state.status === 'success' || state.status === 'empty') {
        images = [...images, state.data];
        this.setData({
          students: this.data.students.map((item) =>
            item.id === studentId ? { ...item, feedbackImages: images } : item,
          ),
        });
      }
    }
    this.setData({ feedbackUploadingId: '' });
  },

  onRemoveImage(event: WechatMiniprogram.TouchEvent) {
    const studentId = String(event.currentTarget.dataset.id ?? '');
    const imageId = String(event.currentTarget.dataset.imageId ?? '');
    this.setData({
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
    const studentId = String(event.currentTarget.dataset.id ?? '');
    const current = String(event.currentTarget.dataset.url ?? '');
    const student = this.data.students.find(({ id }) => id === studentId);
    if (!student || !current) {
      return;
    }
    wx.previewImage({
      current,
      urls: student.feedbackImages.map(({ accessUrl }) => accessUrl),
    });
  },

  onRetry() {
    void this.loadFeedback(true);
  },
});
