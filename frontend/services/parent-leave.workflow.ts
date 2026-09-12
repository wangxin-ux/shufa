import { LeaveDraft, LeavePageView, LeaveRecord, LeaveStatus } from '../types/parent';
import { RequestState } from '../utils/request-state';
import { ParentService } from './parent.service';

export type LeaveSubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

export type LeaveSubmitOutcome =
  | {
      status: 'success';
      record: LeaveRecord;
      refreshedPage: RequestState<LeavePageView>;
      nextDraft: LeaveDraft;
    }
  | {
      status: 'error';
      message: string;
      nextDraft: LeaveDraft;
    };

export interface ParentLeaveWorkflowOptions {
  now?: () => Date;
  createIdempotencyKey?: () => string;
  reasonMaxLength?: number;
}

const EMPTY_LEAVE_DRAFT: Readonly<LeaveDraft> = Object.freeze({
  studentId: '',
  lessonId: '',
  reason: '',
});

let idempotencySequence = 0;

function defaultIdempotencyKey(): string {
  idempotencySequence += 1;
  return `parent-leave-${Date.now()}-${idempotencySequence}`;
}

export function validateLeaveDraft(
  draft: LeaveDraft,
  page: LeavePageView,
  now: Date,
  reasonMaxLength = 200,
): string | null {
  if (!draft.studentId.trim()) {
    return '请选择孩子';
  }
  if (!page.students.some((student) => student.id === draft.studentId)) {
    return '请选择有效的孩子';
  }
  if (!draft.lessonId.trim()) {
    return '请选择请假课程';
  }

  const lesson = page.lessons.find((item) => item.id === draft.lessonId);
  if (!lesson) {
    return '请选择有效的请假课程';
  }

  const reason = draft.reason.trim();
  if (!reason) {
    return '请填写请假原因';
  }
  if (reason.length > reasonMaxLength) {
    return `请假原因不能超过 ${reasonMaxLength} 字`;
  }

  const startsAt = new Date(lesson.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return '课程时间无效';
  }
  const cutoffAt = startsAt.getTime() - page.cutoffHours * 60 * 60 * 1000;
  if (now.getTime() >= cutoffAt) {
    return '该课程已超过请假截止时间';
  }

  return null;
}

export function getLeaveStatusLabel(status: LeaveStatus): string {
  const labels: Record<LeaveStatus, string> = {
    pending: '待审核',
    approved: '已批准',
    rejected: '已驳回',
  };
  return labels[status];
}

export class ParentLeaveWorkflow {
  private readonly now: () => Date;
  private readonly createIdempotencyKey: () => string;
  private readonly reasonMaxLength: number;
  private currentStatus: LeaveSubmitStatus = 'idle';
  private inFlight: Promise<LeaveSubmitOutcome> | null = null;

  constructor(
    private readonly parentService: ParentService,
    options: ParentLeaveWorkflowOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createIdempotencyKey = options.createIdempotencyKey ?? defaultIdempotencyKey;
    this.reasonMaxLength = options.reasonMaxLength ?? 200;
  }

  get status(): LeaveSubmitStatus {
    return this.currentStatus;
  }

  submit(draft: LeaveDraft, page: LeavePageView): Promise<LeaveSubmitOutcome> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const validationMessage = validateLeaveDraft(
      draft,
      page,
      this.now(),
      this.reasonMaxLength,
    );
    if (validationMessage) {
      this.currentStatus = 'error';
      return Promise.resolve({
        status: 'error',
        message: validationMessage,
        nextDraft: { ...draft },
      });
    }

    const normalizedDraft: LeaveDraft = {
      studentId: draft.studentId,
      lessonId: draft.lessonId,
      reason: draft.reason.trim(),
    };
    this.currentStatus = 'submitting';
    const operation = this.execute(normalizedDraft, this.createIdempotencyKey());
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) {
        this.inFlight = null;
      }
    });
    return operation;
  }

  private async execute(
    draft: LeaveDraft,
    idempotencyKey: string,
  ): Promise<LeaveSubmitOutcome> {
    const submitted = await this.parentService.submitLeave(draft, idempotencyKey);
    if (submitted.status !== 'success') {
      const message = submitted.status === 'error' ? submitted.message : '请假提交失败';
      this.currentStatus = 'error';
      return { status: 'error', message, nextDraft: { ...draft } };
    }

    const refreshedPage = await this.parentService.loadLeavePage();
    this.currentStatus = 'success';
    return {
      status: 'success',
      record: submitted.data,
      refreshedPage,
      nextDraft: { ...EMPTY_LEAVE_DRAFT },
    };
  }
}
