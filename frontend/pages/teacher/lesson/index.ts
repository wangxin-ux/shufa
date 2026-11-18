import {
  TeacherLessonWorkflow, TeacherLessonWorkflowOutcome,
} from '../../../services/teacher-lesson.workflow';
import { loadTeacherDisplayFont } from '../runtime/teacher-display-font';

import { createSessionService } from '../../../services/session.service';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from '../runtime/teacher-read-context';
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

type LessonOperation = 'attendance' | 'complete' | 'reverse';
type MutationFailure = Exclude<TeacherLessonWorkflowOutcome<unknown>, { status: 'success' }>;

interface PendingLessonCommand {
  operation: LessonOperation;
  detail: TeacherLessonDetail;
  draft: AttendanceItem[];
  reason: string;
  phase: 'sending' | 'unknown' | 'retryable' | 'accepted';
  attendanceReceipt?: { detail: TeacherLessonDetail; preserveDraft: boolean };
  receiptVersion?: number;
}

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
  context: undefined as TeacherReadContext | undefined,
  runtime: undefined as ReturnType<typeof createTeacherPageService> | undefined,
  workflow: undefined as TeacherLessonWorkflow | undefined,
  requestSequence: 0,
  pullSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  mutationPending: undefined as Promise<void> | undefined,
  initialShowPending: false,
  hidden: false,
  disposed: false,
  blocked: false,
  pendingDenial: '',
  minimumLessonVersion: 0,
  pendingCommand: undefined as PendingLessonCommand | undefined,
  pendingFailure: undefined as MutationFailure | undefined,

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
    refreshError: '',
    needsReconcile: false,
    retryOriginalAvailable: false,
    refreshing: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    void loadTeacherDisplayFont();
    this.context = readTeacherReadContext();
    this.initialShowPending = true;
    if (!this.validateOwner()) return;
    try {
      this.runtime = createTeacherPageService(this.context);
      // The Page retains the write receipt before starting a separate authority read.
      this.workflow = new TeacherLessonWorkflow(this.runtime, { refreshLessonAfterMutation: false });
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
    void this.loadLesson(false);
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.pendingDenial) {
      this.invalidateOwner(this.pendingDenial);
      return;
    }
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    if (this.mutationPending) {
      const sequence = ++this.requestSequence;
      void this.mutationPending.then(() => {
        if (this.canReceive(sequence)) {
          this.resumeCommand();
          void this.loadLesson(true);
        }
      });
      return;
    }
    this.resumeCommand();
    void this.loadLesson(true);
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
    this.pendingCommand = undefined;
    this.pendingFailure = undefined;
    this.pendingDenial = '';
    this.runtime = undefined;
    this.workflow = undefined;
  },

  validateOwner(): boolean {
    if (this.disposed || this.blocked || !this.context) return false;
    if (isCurrentTeacherReadContext(this.context)) return true;
    this.invalidateOwner('登录已更新，请重新登录');
    return false;
  },

  invalidateOwner(message: string) {
    this.blocked = true;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.pendingDenial = '';
    this.pendingCommand = undefined;
    this.pendingFailure = undefined;
    this.runtime = undefined;
    this.workflow = undefined;
    this.setData({
      viewState: 'forbidden', errorMessage: message, detail: null, students: [],
      lessonId: '', courseName: '', className: '', campusName: '', timeLabel: '', statusLabel: '',
      reverseReason: '', insufficientStudents: [], conflictCode: '', balanceBlocked: false,
      mutationMessage: '', refreshError: '', needsReconcile: false, submitting: false,
      retryOriginalAvailable: false, refreshing: false,
      canEditAttendance: false, canComplete: false, canReverse: false, allMarked: false,
    });
  },

  canReceive(sequence: number): boolean {
    return !this.hidden && !this.disposed && sequence === this.requestSequence &&
      !this.pendingDenial && this.validateOwner();
  },

  handleAccessDenied() {
    if (this.disposed || !this.validateOwner()) return;
    this.pendingCommand = undefined;
    this.pendingFailure = undefined;
    if (this.hidden) {
      this.pendingDenial = '登录已失效或无权处理该课次，请重新登录';
      this.requestSequence += 1;
      this.pendingRequest = undefined;
    } else this.invalidateOwner('登录已失效或无权处理该课次，请重新登录');
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    const pull = ++this.pullSequence;
    void this.loadLesson(true).finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence) wx.stopPullDownRefresh();
    });
  },

  loadLesson(preserveDraft: boolean): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner() || !this.runtime ||
        this.mutationPending) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    if (!this.data.lessonId) {
      this.setData({ viewState: 'empty' });
      return Promise.resolve();
    }
    const sequence = ++this.requestSequence;
    const keepContent = this.data.viewState === 'ready';
    if (this.pendingCommand?.phase === 'retryable') this.pendingCommand.phase = 'unknown';
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading' }), errorMessage: '', refreshError: '',
      refreshing: true, retryOriginalAvailable: false,
    });
    const runtime = this.runtime;
    const pending = (async () => runtime.loadLessonSession(this.data.lessonId))().then((state) => {
      // A same-owner denial outranks visibility and stale-success sequence checks.
      if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
        this.handleAccessDenied();
        return;
      }
      if (!this.canReceive(sequence)) return;
      if (state.status === 'success' || state.status === 'empty') {
        this.reconcileLesson(state.data, preserveDraft);
      } else if (state.status === 'error') {
        this.setData(keepContent
          ? { refreshError: '课次刷新失败，请重试' }
          : { viewState: 'error', errorMessage: '课次加载失败，请稍后重试' });
      }
    }).catch(() => {
      if (!this.canReceive(sequence)) return;
      this.setData(keepContent
        ? { refreshError: '课次刷新失败，请重试' }
        : { viewState: 'error', errorMessage: '课次加载失败，请稍后重试' });
    }).finally(() => {
      if (sequence === this.requestSequence) {
        this.pendingRequest = undefined;
        if (this.canReceive(sequence)) this.setData({ refreshing: false });
      }
    });
    this.pendingRequest = pending;
    return pending;
  },

  reconcileLesson(detail: TeacherLessonDetail, preserveDraft: boolean) {
    const command = this.pendingCommand;
    if (detail.id !== this.data.lessonId || detail.version < this.minimumLessonVersion) {
      this.setData({ refreshError: '课次版本尚未更新，请重试' });
      return;
    }
    if (command) {
      const terminal = command.operation === 'reverse'
        ? detail.status === 'REVERSED'
        : ['COMPLETED', 'REVERSED', 'CANCELLED'].includes(detail.status);
      if (command.phase === 'accepted' && (!terminal ||
          detail.version < (command.receiptVersion ?? command.detail.version + 1))) {
        this.setData({ refreshError: '操作已受理，课次状态尚未更新，请重试' });
        return;
      }
      if (terminal && detail.version >= command.detail.version) {
        this.pendingCommand = undefined;
        if (command.operation === 'reverse') this.setData({ reverseReason: '' });
      } else {
        command.phase = detail.version >= command.detail.version ? 'retryable' : 'unknown';
      }
    }
    this.applyLesson(detail, command ? false : preserveDraft);
  },

  applyLesson(detail: TeacherLessonDetail, preserveDraft: boolean) {
    this.minimumLessonVersion = Math.max(this.minimumLessonVersion, detail.version);
    const previous = new Map(
      preserveDraft
        ? this.data.students.map((student) => [student.id, student])
        : [],
    );
    const students: LessonStudentView[] = detail.students.map((student) => {
      const draft = detail.status === 'SCHEDULED' || detail.status === 'IN_PROGRESS'
        ? previous.get(student.id) : undefined;
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
      mutationMessage: this.pendingCommand
        ? '操作结果尚未确认，可继续刷新核对或按原操作重试' : '',
      errorMessage: '',
      refreshError: '',
      needsReconcile: Boolean(this.pendingCommand),
      retryOriginalAvailable: this.pendingCommand?.phase === 'retryable',
      submitting: false,
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
    if (this.hidden || this.disposed || !this.validateOwner() ||
        !this.data.canEditAttendance || this.data.submitting || this.data.needsReconcile ||
        this.pendingRequest) {
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

  onSaveAttendance(): Promise<void> {
    return this.submitLessonMutation('attendance');
  },

  onCompleteLesson(): Promise<void> {
    return this.submitLessonMutation('complete');
  },

  submitLessonMutation(operation: LessonOperation): Promise<void> {
    const detail = this.data.detail;
    if (this.hidden || this.disposed || !this.validateOwner() || !this.workflow ||
        !detail || this.data.submitting || this.pendingRequest || this.mutationPending ||
        this.data.needsReconcile || this.data.viewState !== 'ready') return Promise.resolve();
    if (operation !== 'reverse' && (!this.data.canEditAttendance || !this.data.allMarked)) return Promise.resolve();
    if (operation === 'complete' && (!this.data.canComplete || this.data.balanceBlocked)) return Promise.resolve();
    if (operation === 'reverse' && !this.data.canReverse) return Promise.resolve();
    const command: PendingLessonCommand = {
      operation, detail: { ...detail, students: detail.students.map(student => ({ ...student })) },
      draft: this.attendanceDraft().map(item => ({ ...item })),
      reason: this.data.reverseReason, phase: 'sending',
    };
    this.pendingCommand = command;
    return this.executeCommand(command);
  },

  executeCommand(command: PendingLessonCommand): Promise<void> {
    const workflow = this.workflow;
    if (!workflow) return Promise.resolve();
    const sequence = this.requestSequence;
    const retryingOriginal = command.phase === 'retryable';
    command.phase = 'sending';
    this.setData({ submitting: true, mutationMessage: '' });
    const pending = Promise.resolve().then(async () => {
      if (!this.canReceive(sequence)) {
        if (this.pendingCommand === command) {
          if (retryingOriginal) command.phase = 'unknown';
          else this.pendingCommand = undefined;
        }
        return;
      }
      if (command.operation === 'attendance') {
        const outcome = await workflow.saveAttendance(command.detail, command.draft);
        if (outcome.status === 'forbidden') { this.handleAccessDenied(); return; }
        if (!this.validateOwner() || this.pendingCommand !== command) return;
        if (outcome.status === 'success') {
          command.phase = 'accepted';
          command.attendanceReceipt = { detail: outcome.data, preserveDraft: !retryingOriginal };
          command.receiptVersion = outcome.data.version;
        } else this.recordMutationFailure(command, outcome);
        return;
      }
      const outcome = command.operation === 'complete'
        ? await workflow.complete(command.detail, command.draft)
        : await workflow.reverse(command.detail, command.reason);
      if (outcome.status === 'forbidden') { this.handleAccessDenied(); return; }
      if (!this.validateOwner() || this.pendingCommand !== command) return;
      if (outcome.status === 'success') {
        command.phase = 'accepted';
        command.receiptVersion = outcome.data.lessonVersion;
      } else this.recordMutationFailure(command, outcome);
    }).catch(() => {
      if (this.validateOwner() && this.pendingCommand === command) command.phase = 'unknown';
    }).finally(() => {
      if (this.mutationPending === pending) this.mutationPending = undefined;
      if (this.hidden || this.disposed || !this.validateOwner() || this.pendingDenial) return;
      this.resumeCommand();
      if (this.pendingCommand?.phase === 'accepted') void this.loadLesson(false);
    });
    this.mutationPending = pending;
    return pending;
  },

  recordMutationFailure(command: PendingLessonCommand, outcome: MutationFailure) {
    if (outcome.status === 'validation' || outcome.status === 'conflict' ||
        [400, 404, 422].includes(outcome.statusCode ?? 0)) {
      this.pendingCommand = undefined;
      this.pendingFailure = outcome;
    } else command.phase = 'unknown';
  },

  resumeCommand() {
    if (this.hidden || this.disposed || !this.validateOwner() || this.pendingDenial) return;
    const command = this.pendingCommand;
    if (command?.phase === 'accepted' && command.attendanceReceipt) {
      const receipt = command.attendanceReceipt;
      this.pendingCommand = undefined;
      if (receipt.detail.version >= this.minimumLessonVersion) {
        this.applyLesson(receipt.detail, receipt.preserveDraft);
      } else {
        // A cached success confirms the original command without replacing a newer read.
        this.setData({ submitting: false, needsReconcile: false,
          retryOriginalAvailable: false, mutationMessage: '' });
      }
      wx.showToast({ title: '点名已保存', icon: 'success' });
      return;
    }
    this.setData({
      submitting: false, needsReconcile: Boolean(command),
      retryOriginalAvailable: command?.phase === 'retryable',
      ...(command ? { mutationMessage: command.phase === 'accepted'
        ? '操作已受理，请刷新课次核对最新状态'
        : '操作结果尚未确认，请刷新课次核对后再继续' } : {}),
    });
    if (this.pendingFailure) {
      const failure = this.pendingFailure;
      this.pendingFailure = undefined;
      this.applyMutationFailure(failure);
      if (failure.code === 'LESSON_REVERSAL_WINDOW_EXPIRED') this.setData({ canReverse: false });
    }
  },

  onRetryOriginal(): Promise<void> {
    const command = this.pendingCommand;
    if (this.hidden || this.disposed || !this.validateOwner() || !command ||
        command.phase !== 'retryable' || this.pendingRequest || this.mutationPending ||
        this.data.submitting || !this.data.retryOriginalAvailable) return Promise.resolve();
    this.setData({ retryOriginalAvailable: false });
    return this.executeCommand(command);
  },

  applyMutationFailure(outcome: MutationFailure) {
    if (outcome.status === 'forbidden') {
      this.invalidateOwner('登录已失效或无权处理该课次，请重新登录');
      return;
    }
    if (this.data.viewState === 'ready' && this.data.canEditAttendance &&
        this.data.detail && ['SCHEDULED', 'IN_PROGRESS'].includes(this.data.detail.status)) {
      const draft = new Map(outcome.draft
        .filter(item => ['PRESENT', 'LEAVE', 'ABSENT'].includes(item.status))
        .map(item => [item.studentId, item.status]));
      const students = this.data.students.map(student => ({
        ...student, selectedStatus: draft.get(student.id) ?? student.selectedStatus,
      }));
      this.setData({ students, allMarked: students.every(({ selectedStatus }) => Boolean(selectedStatus)) });
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
    if (this.hidden || this.disposed || !this.validateOwner() ||
        this.data.submitting || this.data.needsReconcile) return;
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
    if (this.hidden || this.disposed || !this.validateOwner() ||
        this.data.submitting || this.data.needsReconcile) return;
    this.setData({ reverseReason: event.detail.value, mutationMessage: '' });
  },

  onReverseLesson(): Promise<void> {
    return this.submitLessonMutation('reverse');
  },

  onRetry() {
    void this.loadLesson(true);
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    createSessionService().logout();
    this.invalidateOwner('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
