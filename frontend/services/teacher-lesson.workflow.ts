import {
  AttendanceItem,
  CompleteLessonResult,
  StudentFeedback,
  TeacherLessonDetail,
} from '../types/teacher';
import { RequestState } from '../utils/request-state';

interface TeacherLessonWorkflowService {
  saveAttendance(
    input: {
      lessonSessionId: string;
      lessonVersion: number;
      attendance: AttendanceItem[];
    },
    idempotencyKey: string,
  ): Promise<RequestState<TeacherLessonDetail>>;
  completeLesson(
    input: {
      lessonSessionId: string;
      lessonVersion: number;
      attendance: AttendanceItem[];
    },
    idempotencyKey: string,
  ): Promise<RequestState<CompleteLessonResult>>;
  reverseLesson(
    input: {
      lessonSessionId: string;
      lessonVersion: number;
      reason: string;
    },
    idempotencyKey: string,
  ): Promise<RequestState<CompleteLessonResult>>;
  saveFeedback(
    input: {
      lessonSessionId: string;
      studentId: string;
      content: string;
      imageFileIds: string[];
    },
    idempotencyKey: string,
  ): Promise<RequestState<StudentFeedback>>;
  loadLessonSession(id: string): Promise<RequestState<TeacherLessonDetail>>;
}

export interface InsufficientStudentModel {
  studentId: string;
  displayName: string;
}

export type TeacherLessonWorkflowOutcome<T> =
  | {
      status: 'success';
      data: T;
      refreshedLesson?: RequestState<TeacherLessonDetail>;
      draft: AttendanceItem[];
    }
  | {
      status: 'validation' | 'error' | 'forbidden' | 'conflict';
      message: string;
      code?: string;
      details?: Record<string, unknown>;
      insufficientStudents?: InsufficientStudentModel[];
      draft: AttendanceItem[];
    };

export interface TeacherLessonWorkflowOptions {
  createIdempotencyKey?: () => string;
}

let idempotencySequence = 0;

function defaultIdempotencyKey(): string {
  idempotencySequence += 1;
  return `teacher-lesson-${Date.now()}-${idempotencySequence}`;
}

export function validateLessonAttendance(
  detail: TeacherLessonDetail,
  attendance: readonly AttendanceItem[],
): string | null {
  const rosterIds = new Set(detail.students.map(({ id }) => id));
  const selectedIds = new Set(attendance.map(({ studentId }) => studentId));
  if (attendance.some(({ studentId }) => !rosterIds.has(studentId))) {
    return '点名名单与当前课次不一致';
  }
  if (
    attendance.length !== detail.students.length ||
    selectedIds.size !== attendance.length ||
    [...rosterIds].some((studentId) => !selectedIds.has(studentId))
  ) {
    return '请为全部学员选择出勤状态';
  }
  return null;
}

export function validateFeedback(content: string, maxLength = 1000): string | null {
  const normalized = content.trim();
  if (!normalized) {
    return '请填写课堂反馈';
  }
  if (normalized.length > maxLength) {
    return `课堂反馈不能超过 ${maxLength} 字`;
  }
  return null;
}

function normalizeAttendance(
  detail: TeacherLessonDetail,
  attendance: readonly AttendanceItem[],
): AttendanceItem[] {
  const byStudentId = new Map(
    attendance.map((item) => [item.studentId, item.status]),
  );
  return detail.students.map((student) => ({
    studentId: student.id,
    status: byStudentId.get(student.id) as AttendanceItem['status'],
  }));
}

function parseInsufficientStudents(
  details: Record<string, unknown> | undefined,
): InsufficientStudentModel[] {
  if (!details) {
    return [];
  }
  const raw = details.insufficientStudents ?? details.students;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((value) => {
    if (typeof value !== 'object' || value === null) {
      return [];
    }
    const item = value as { studentId?: unknown; displayName?: unknown };
    return typeof item.studentId === 'string' && typeof item.displayName === 'string'
      ? [{ studentId: item.studentId, displayName: item.displayName }]
      : [];
  });
}

export class TeacherLessonWorkflow {
  private readonly createIdempotencyKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly inFlight = new Map<
    string,
    Promise<TeacherLessonWorkflowOutcome<unknown>>
  >();

  constructor(
    private readonly service: TeacherLessonWorkflowService,
    options: TeacherLessonWorkflowOptions = {},
  ) {
    this.createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
  }

  saveAttendance(
    detail: TeacherLessonDetail,
    attendance: readonly AttendanceItem[],
  ): Promise<TeacherLessonWorkflowOutcome<TeacherLessonDetail>> {
    const validation = validateLessonAttendance(detail, attendance);
    if (validation) {
      return Promise.resolve(this.validation(validation, attendance));
    }
    const draft = normalizeAttendance(detail, attendance);
    const signature = this.signature('attendance', detail, draft);
    return this.run(
      signature,
      draft,
      (key) =>
        this.service.saveAttendance(
          {
            lessonSessionId: detail.id,
            lessonVersion: detail.version,
            attendance: draft,
          },
          key,
        ),
      false,
    );
  }

  complete(
    detail: TeacherLessonDetail,
    attendance: readonly AttendanceItem[],
  ): Promise<TeacherLessonWorkflowOutcome<CompleteLessonResult>> {
    const validation = validateLessonAttendance(detail, attendance);
    if (validation) {
      return Promise.resolve(this.validation(validation, attendance));
    }
    if (!detail.canComplete) {
      return Promise.resolve(this.validation('当前课次不可确认完成', attendance));
    }
    const draft = normalizeAttendance(detail, attendance);
    const signature = this.signature('complete', detail, draft);
    return this.run(
      signature,
      draft,
      (key) =>
        this.service.completeLesson(
          {
            lessonSessionId: detail.id,
            lessonVersion: detail.version,
            attendance: draft,
          },
          key,
        ),
      true,
      detail.id,
    );
  }

  reverse(
    detail: TeacherLessonDetail,
    reason: string,
  ): Promise<TeacherLessonWorkflowOutcome<CompleteLessonResult>> {
    const normalizedReason = reason.trim();
    if (!detail.canReverse || detail.status !== 'COMPLETED') {
      return Promise.resolve(this.validation('当前课次不可撤销', []));
    }
    if (!normalizedReason) {
      return Promise.resolve(this.validation('请填写撤销原因', []));
    }
    if (normalizedReason.length > 200) {
      return Promise.resolve(this.validation('撤销原因不能超过 200 字', []));
    }
    const signature = `reverse:${detail.id}:${detail.version}:${normalizedReason}`;
    return this.run(
      signature,
      [],
      (key) =>
        this.service.reverseLesson(
          {
            lessonSessionId: detail.id,
            lessonVersion: detail.version,
            reason: normalizedReason,
          },
          key,
        ),
      true,
      detail.id,
    );
  }

  feedback(
    detail: TeacherLessonDetail,
    studentId: string,
    content: string,
    imageFileIds: readonly string[] = [],
  ): Promise<TeacherLessonWorkflowOutcome<StudentFeedback>> {
    const validation = validateFeedback(content);
    if (validation) {
      return Promise.resolve(this.validation(validation, []));
    }
    if (!detail.students.some(({ id }) => id === studentId)) {
      return Promise.resolve(this.validation('请选择当前课次学员', []));
    }
    const normalizedContent = content.trim();
    const normalizedImageFileIds = [...imageFileIds];
    const signature = `feedback:${detail.id}:${studentId}:${normalizedContent}:${normalizedImageFileIds.join(',')}`;
    return this.run(
      signature,
      [],
      (key) =>
        this.service.saveFeedback(
          {
            lessonSessionId: detail.id,
            studentId,
            content: normalizedContent,
            imageFileIds: normalizedImageFileIds,
          },
          key,
        ),
      false,
    );
  }

  private signature(
    operation: string,
    detail: TeacherLessonDetail,
    attendance: readonly AttendanceItem[],
  ): string {
    return `${operation}:${detail.id}:${detail.version}:${JSON.stringify(attendance)}`;
  }

  private validation<T>(
    message: string,
    draft: readonly AttendanceItem[],
  ): TeacherLessonWorkflowOutcome<T> {
    return { status: 'validation', message, draft: [...draft] };
  }

  private run<T>(
    signature: string,
    draft: readonly AttendanceItem[],
    operation: (key: string) => Promise<RequestState<T>>,
    refreshLesson: boolean,
    lessonId?: string,
  ): Promise<TeacherLessonWorkflowOutcome<T>> {
    const existing = this.inFlight.get(signature);
    if (existing) {
      return existing as Promise<TeacherLessonWorkflowOutcome<T>>;
    }
    const key = this.keys.get(signature) ?? this.createIdempotencyKey();
    this.keys.set(signature, key);
    const promise = this.execute(
      signature,
      [...draft],
      key,
      operation,
      refreshLesson,
      lessonId,
    );
    this.inFlight.set(
      signature,
      promise as Promise<TeacherLessonWorkflowOutcome<unknown>>,
    );
    void promise.finally(() => {
      if (this.inFlight.get(signature) === promise) {
        this.inFlight.delete(signature);
      }
    });
    return promise;
  }

  private async execute<T>(
    signature: string,
    draft: AttendanceItem[],
    key: string,
    operation: (key: string) => Promise<RequestState<T>>,
    refreshLesson: boolean,
    lessonId?: string,
  ): Promise<TeacherLessonWorkflowOutcome<T>> {
    const state = await operation(key);
    if (state.status === 'success') {
      this.keys.delete(signature);
      const refreshedLesson =
        refreshLesson && lessonId
          ? await this.service.loadLessonSession(lessonId)
          : undefined;
      return {
        status: 'success',
        data: state.data,
        ...(refreshedLesson ? { refreshedLesson } : {}),
        draft,
      };
    }
    if (state.status !== 'error') {
      return { status: 'error', message: '操作未完成，请重试', draft };
    }
    if (state.statusCode === 403) {
      return {
        status: 'forbidden',
        message: state.message,
        code: state.code,
        details: state.details,
        draft,
      };
    }
    if (state.statusCode === 409) {
      return {
        status: 'conflict',
        message: state.message,
        code: state.code,
        details: state.details,
        insufficientStudents: parseInsufficientStudents(state.details),
        draft,
      };
    }
    return {
      status: 'error',
      message: state.message,
      code: state.code,
      details: state.details,
      draft,
    };
  }
}
