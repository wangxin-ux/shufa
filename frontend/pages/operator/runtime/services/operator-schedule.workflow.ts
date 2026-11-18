import {
  OperatorLessonSession,
  OperatorScheduleDraft,
  OperatorScheduleInput,
  OperatorUpdateScheduleInput,
} from "../types/operator";
import { RequestState } from "../../../../utils/request-state";
import { seriesDate, seriesUuid, seriesVersion } from "./operator-lesson-series.presenter";

interface OperatorScheduleWorkflowService {
  createLessonSession(
    input: OperatorScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLessonSession>>;
  updateLessonSession(
    lessonSessionId: string,
    input: OperatorUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLessonSession>>;
  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLessonSession>>;
}

export type OperatorScheduleWorkflowOutcome =
  | { status: "success"; data: OperatorLessonSession }
  | {
      status: "validation" | "error" | "forbidden";
      message: string;
      code?: string;
      retryable?: boolean;
    }
  | {
      status: "conflict";
      message: string;
      code?: string;
      currentVersion?: number;
      conflictDates?: string[];
    };

export interface OperatorScheduleWorkflowOptions {
  createIdempotencyKey?: () => string;
}

let idempotencySequence = 0;

function defaultIdempotencyKey(): string {
  idempotencySequence += 1;
  return `campus-schedule-${Date.now()}-${idempotencySequence}`;
}

function isDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
}

function isTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateOperatorScheduleDraft(
  draft: OperatorScheduleDraft,
): string | null {
  if (!seriesUuid(draft.classGroupId)) {
    return "请选择班级";
  }
  if (!isDate(draft.date)) {
    return "请选择有效日期";
  }
  if (!isTime(draft.startsAt) || !isTime(draft.endsAt)) {
    return "请选择有效的上课时间";
  }
  if (draft.startsAt >= draft.endsAt) {
    return "结束时间必须晚于开始时间";
  }
  const startsAt = Date.parse(`${draft.date}T${draft.startsAt}:00+08:00`);
  if (startsAt <= Date.now()) {
    return "只能安排未来课次";
  }
  return null;
}

export function normalizeOperatorScheduleDraft(
  draft: OperatorScheduleDraft,
): OperatorScheduleInput {
  return {
    classGroupId: draft.classGroupId.trim(),
    startsAt: `${draft.date}T${draft.startsAt}:00+08:00`,
    endsAt: `${draft.date}T${draft.endsAt}:00+08:00`,
    kind: draft.kind,
  };
}

export class OperatorScheduleWorkflow {
  private readonly createIdempotencyKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly uncertain = new Set<string>();
  private readonly inFlight = new Map<
    string,
    Promise<OperatorScheduleWorkflowOutcome>
  >();

  constructor(
    private readonly service: OperatorScheduleWorkflowService,
    options: OperatorScheduleWorkflowOptions = {},
  ) {
    this.createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
  }

  create(
    draft: OperatorScheduleDraft,
  ): Promise<OperatorScheduleWorkflowOutcome> {
    const input = normalizeOperatorScheduleDraft(draft);
    const validation = validateOperatorScheduleDraft(draft);
    if (validation && !this.uncertain.has(this.signature("create", input))) {
      return Promise.resolve({ status: "validation", message: validation });
    }
    return this.run("create", input, (key) =>
      this.service.createLessonSession(input, key),
    );
  }

  update(
    lessonSessionId: string,
    version: number,
    draft: OperatorScheduleDraft,
  ): Promise<OperatorScheduleWorkflowOutcome> {
    const normalized = normalizeOperatorScheduleDraft(draft);
    const input: OperatorUpdateScheduleInput = {
      version,
      startsAt: normalized.startsAt,
      endsAt: normalized.endsAt,
      kind: normalized.kind,
    };
    const validation = validateOperatorScheduleDraft(draft);
    if (validation && !this.uncertain.has(this.signature(`update:${lessonSessionId}`, input))) {
      return Promise.resolve({ status: "validation", message: validation });
    }
    return this.run(`update:${lessonSessionId}`, input, (key) =>
      this.service.updateLessonSession(lessonSessionId, input, key),
    );
  }

  cancel(
    lessonSessionId: string,
    version: number,
  ): Promise<OperatorScheduleWorkflowOutcome> {
    if (!seriesUuid(lessonSessionId) || !seriesVersion(version))
      return Promise.resolve({ status: "validation", message: "课次编号或版本无效" });
    return this.run(`cancel:${lessonSessionId}`, { version }, (key) =>
      this.service.cancelLessonSession(lessonSessionId, version, key),
    );
  }

  private run(
    operation: string,
    input: unknown,
    invoke: (
      idempotencyKey: string,
    ) => Promise<RequestState<OperatorLessonSession>>,
  ): Promise<OperatorScheduleWorkflowOutcome> {
    const signature = this.signature(operation, input);
    const current = this.inFlight.get(signature);
    if (current) {
      return current;
    }
    const key = this.keys.get(signature) ?? this.createIdempotencyKey();
    this.keys.set(signature, key);
    const promise = this.execute(signature, key, invoke);
    this.inFlight.set(signature, promise);
    void promise.finally(() => {
      if (this.inFlight.get(signature) === promise) {
        this.inFlight.delete(signature);
      }
    });
    return promise;
  }

  private signature(operation: string, input: unknown): string {
    return `${operation}:${JSON.stringify(input)}`;
  }

  private async execute(
    signature: string,
    key: string,
    invoke: (
      idempotencyKey: string,
    ) => Promise<RequestState<OperatorLessonSession>>,
  ): Promise<OperatorScheduleWorkflowOutcome> {
    const state = await invoke(key);
    if (state.status === "success") {
      this.keys.delete(signature);
      this.uncertain.delete(signature);
      return { status: "success", data: state.data };
    }
    if (state.status !== "error") {
      this.uncertain.add(signature);
      return { status: "error", message: "排课操作未完成，请重试", retryable: true };
    }
    const retryable = state.statusCode === undefined || state.statusCode === 0 || state.statusCode >= 500;
    if (retryable) this.uncertain.add(signature);
    else this.uncertain.delete(signature);
    if (state.statusCode === 401 || state.statusCode === 403) {
      return { status: "forbidden", message: state.message, code: state.code };
    }
    if (state.statusCode === 409) {
      const currentVersion = state.details?.currentVersion;
      const dates = state.details?.conflictDates;
      return {
        status: "conflict",
        message: state.message,
        code: state.code,
        ...(typeof currentVersion === "number" ? { currentVersion } : {}),
        ...(Array.isArray(dates) && dates.every(seriesDate) ? { conflictDates: dates } : {}),
      };
    }
    return { status: "error", message: state.message, code: state.code, retryable };
  }
}
