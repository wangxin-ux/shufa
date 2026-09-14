import { TeacherLessonWorkflow } from '../../../services/teacher-lesson.workflow';
import { teacherService } from '../../../services/teacher-runtime';
import {
  AttendanceItem,
  AttendanceStatus,
  TeacherLessonDetail,
  TeacherLessonStudent,
} from '../../../types/teacher';
import { parseZonedDateTime } from '../../../utils/format';

interface LessonStudentView extends TeacherLessonStudent {
  selectedStatus: AttendanceStatus | '';
}

const workflow = new TeacherLessonWorkflow(teacherService);

const STATUS_LABELS: Record<TeacherLessonDetail['status'], string> = {
  SCHEDULED: '待上课',
  IN_PROGRESS: '上课中',
  COMPLETED: '已完成',
  REVERSED: '已撤销',
  CANCELLED: '已取消',
};

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
    detail: null as TeacherLessonDetail | null,
    courseName: '',
    className: '',
    campusName: '',
    timeLabel: '',
    statusLabel: '',
    students: [] as LessonStudentView[],
    canEditAttendance: false,
    canComplete: false,
    canReverse: false,
    allMarked: false,
    submitting: false,
    mutationMessage: '',
    conflictCode: '',
    insufficientStudents: [] as Array<{ studentId: string; displayName: string }>,
    balanceBlocked: false,
    reverseReason: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    const lessonId = options.id?.trim() ?? '';
    this.setData({ lessonId });
    if (!lessonId) {
      this.setData({ viewState: 'empty' });
      return;
    }
    void this.loadLesson(false);
  },

  onPullDownRefresh() {
    void this.loadLesson(true).finally(() => wx.stopPullDownRefresh());
  },

  async loadLesson(preserveDraft: boolean) {
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
          state.statusCode === 403 ? '当前账号无权处理该课次' : state.message,
      });
    }
  },

  applyLesson(detail: TeacherLessonDetail, preserveDraft: boolean) {
    const previous = new Map(
      preserveDraft
        ? this.data.students.map((student) => [student.id, student])
        : [],
    );
    const students: LessonStudentView[] = detail.students.map((student) => {
      const draft = previous.get(student.id);
      return {
        ...student,
        selectedStatus:
          draft?.selectedStatus ?? student.attendanceStatus ?? '',
      };
    });
    const canEditAttendance =
      detail.status === 'SCHEDULED' || detail.status === 'IN_PROGRESS';
    this.setData({
      viewState: 'ready',
      detail,
      courseName: detail.courseName,
      className: detail.className,
      campusName: detail.campusName,
      timeLabel: formatTimeRange(detail.startsAt, detail.endsAt),
      statusLabel: STATUS_LABELS[detail.status],
      students,
      canEditAttendance,
      canComplete: detail.canComplete,
      canReverse: detail.canReverse,
      allMarked: students.every(({ selectedStatus }) => Boolean(selectedStatus)),
      conflictCode: '',
      insufficientStudents: [],
      balanceBlocked: false,
      mutationMessage: '',
      errorMessage: '',
    });
  },

  attendanceDraft(): AttendanceItem[] {
    return this.data.students.flatMap((student) =>
      student.selectedStatus
        ? [{ studentId: student.id, status: student.selectedStatus }]
        : [],
    );
  },

  onAttendanceTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canEditAttendance || this.data.submitting) {
      return;
    }
    const studentId = String(event.currentTarget.dataset.id ?? '');
    const status = String(
      event.currentTarget.dataset.status ?? '',
    ) as AttendanceStatus;
    if (!['PRESENT', 'LEAVE', 'ABSENT'].includes(status)) {
      return;
    }
    const students = this.data.students.map((student) =>
      student.id === studentId ? { ...student, selectedStatus: status } : student,
    );
    this.setData({
      students,
      allMarked: students.every(({ selectedStatus }) => Boolean(selectedStatus)),
      mutationMessage: '',
      conflictCode: '',
      insufficientStudents: [],
      balanceBlocked: false,
    });
  },

  async onSaveAttendance() {
    const detail = this.data.detail;
    if (!detail || this.data.submitting) {
      return;
    }
    this.setData({ submitting: true, mutationMessage: '' });
    const outcome = await workflow.saveAttendance(detail, this.attendanceDraft());
    if (outcome.status === 'success') {
      this.applyLesson(outcome.data, true);
      wx.showToast({ title: '点名已保存', icon: 'success' });
    } else {
      this.applyMutationFailure(outcome);
    }
    this.setData({ submitting: false });
  },

  async onCompleteLesson() {
    const detail = this.data.detail;
    if (
      !detail ||
      this.data.submitting ||
      !this.data.allMarked ||
      this.data.balanceBlocked
    ) {
      return;
    }
    this.setData({ submitting: true, mutationMessage: '' });
    const outcome = await workflow.complete(detail, this.attendanceDraft());
    if (outcome.status === 'success') {
      if (
        outcome.refreshedLesson?.status === 'success' ||
        outcome.refreshedLesson?.status === 'empty'
      ) {
        this.applyLesson(outcome.refreshedLesson.data, false);
      } else {
        await this.loadLesson(false);
      }
      wx.showToast({ title: '课次已完成', icon: 'success' });
    } else {
      this.applyMutationFailure(outcome);
    }
    this.setData({ submitting: false });
  },

  applyMutationFailure(outcome: {
    status: string;
    message: string;
    code?: string;
    insufficientStudents?: Array<{ studentId: string; displayName: string }>;
  }) {
    if (outcome.status === 'forbidden') {
      this.setData({ viewState: 'forbidden', errorMessage: outcome.message });
      return;
    }
    const insufficientStudents = outcome.insufficientStudents ?? [];
    this.setData({
      mutationMessage: outcome.message,
      conflictCode: outcome.status === 'conflict' ? outcome.code ?? 'CONFLICT' : '',
      insufficientStudents,
      balanceBlocked: outcome.code === 'INSUFFICIENT_LESSON_BALANCE',
    });
  },

  onRefreshConflict() {
    void this.loadLesson(true);
  },

  onFeedbackTap() {
    const detail = this.data.detail;
    if (
      !detail ||
      (detail.status !== 'COMPLETED' && detail.status !== 'REVERSED')
    ) {
      return;
    }
    wx.navigateTo({
      url: `/pages/teacher/feedback-detail/index?id=${encodeURIComponent(detail.id)}`,
    });
  },

  onReverseReasonInput(event: WechatMiniprogram.Input) {
    this.setData({ reverseReason: event.detail.value, mutationMessage: '' });
  },

  async onReverseLesson() {
    const detail = this.data.detail;
    if (!detail || this.data.submitting) {
      return;
    }
    this.setData({ submitting: true, mutationMessage: '' });
    const outcome = await workflow.reverse(detail, this.data.reverseReason);
    if (outcome.status === 'success') {
      if (
        outcome.refreshedLesson?.status === 'success' ||
        outcome.refreshedLesson?.status === 'empty'
      ) {
        this.applyLesson(outcome.refreshedLesson.data, false);
      } else {
        await this.loadLesson(false);
      }
      this.setData({ reverseReason: '' });
      wx.showToast({ title: '撤销已完成', icon: 'success' });
    } else {
      this.applyMutationFailure(outcome);
      if (outcome.code === 'LESSON_REVERSAL_WINDOW_EXPIRED') {
        this.setData({ canReverse: false });
      }
    }
    this.setData({ submitting: false });
  },

  onRetry() {
    void this.loadLesson(true);
  },
});
