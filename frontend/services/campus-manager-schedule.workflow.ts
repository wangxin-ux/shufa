import {
  CampusManagerLessonSession,
  CampusManagerScheduleDraft,
  CampusManagerScheduleInput,
  CampusManagerUpdateScheduleInput,
} from "../types/campus-manager";
import { RequestState } from "../utils/request-state";

interface CampusManagerScheduleWorkflowService {
  createLessonSession(
    input: CampusManagerScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>>;
  updateLessonSession(
    lessonSessionId: string,
    input: CampusManagerUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>>;
  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLessonSession>>;
}

export type CampusManagerScheduleWorkflowOutcome =
  | { status: "success"; data: CampusManagerLessonSession }
  | {
      status: "validation" | "error" | "forbidden";
      message: string;
      code?: string;
    }
  | {
      status: "conflict";
      message: string;
      code?: string;
      currentVersion?: number;
    };

export interface CampusManagerScheduleWorkflowOptions {
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

export function validateCampusManagerScheduleDraft(
  draft: CampusManagerScheduleDraft,
): string | null {
  if (!draft.classGroupId.trim()) {
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

export function normalizeCampusManagerScheduleDraft(
  draft: CampusManagerScheduleDraft,
): CampusManagerScheduleInput {
  return {
    classGroupId: draft.classGroupId.trim(),
    startsAt: `${draft.date}T${draft.startsAt}:00+08:00`,
    endsAt: `${draft.date}T${draft.endsAt}:00+08:00`,
    kind: draft.kind,
  };
}

export class CampusManagerScheduleWorkflow {
  private readonly createIdempotencyKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly inFlight = new Map<
    string,
    Promise<CampusManagerScheduleWorkflowOutcome>
  >();

  constructor(
    private readonly service: CampusManagerScheduleWorkflowService,
    options: CampusManagerScheduleWorkflowOptions = {},
  ) {
    this.createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
  }

  create(
    draft: CampusManagerScheduleDraft,
  ): Promise<CampusManagerScheduleWorkflowOutcome> {
    const validation = validateCampusManagerScheduleDraft(draft);
    if (validation) {
      return Promise.resolve({ status: "validation", message: validation });
    }
    const input = normalizeCampusManagerScheduleDraft(draft);
    return this.run("create", input, (key) =>
      this.service.createLessonSession(input, key),
    );
  }

  update(
    lessonSessionId: string,
    version: number,
    draft: CampusManagerScheduleDraft,
  ): Promise<CampusManagerScheduleWorkflowOutcome> {
    const validation = validateCampusManagerScheduleDraft(draft);
    if (validation) {
      return Promise.resolve({ status: "validation", message: validation });
    }
    const normalized = normalizeCampusManagerScheduleDraft(draft);
    const input: CampusManagerUpdateScheduleInput = {
      version,
      startsAt: normalized.startsAt,
      endsAt: normalized.endsAt,
      kind: normalized.kind,
    };
    return this.run(`update:${lessonSessionId}`, input, (key) =>
      this.service.updateLessonSession(lessonSessionId, input, key),
    );
  }

  cancel(
    lessonSessionId: string,
    version: number,
  ): Promise<CampusManagerScheduleWorkflowOutcome> {
    return this.run(`cancel:${lessonSessionId}`, { version }, (key) =>
      this.service.cancelLessonSession(lessonSessionId, version, key),
    );
  }

  private run(
    operation: string,
    input: unknown,
    invoke: (
      idempotencyKey: string,
    ) => Promise<RequestState<CampusManagerLessonSession>>,
  ): Promise<CampusManagerScheduleWorkflowOutcome> {
    const signature = `${operation}:${JSON.stringify(input)}`;
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

  private async execute(
    signature: string,
    key: string,
    invoke: (
      idempotencyKey: string,
    ) => Promise<RequestState<CampusManagerLessonSession>>,
  ): Promise<CampusManagerScheduleWorkflowOutcome> {
    const state = await invoke(key);
    if (state.status === "success") {
      this.keys.delete(signature);
      return { status: "success", data: state.data };
    }
    if (state.status !== "error") {
      return { status: "error", message: "排课操作未完成，请重试" };
    }
    if (state.statusCode === 403) {
      return { status: "forbidden", message: state.message, code: state.code };
    }
    if (state.statusCode === 409) {
      const currentVersion = state.details?.currentVersion;
      return {
        status: "conflict",
        message: state.message,
        code: state.code,
        ...(typeof currentVersion === "number" ? { currentVersion } : {}),
      };
    }
    return { status: "error", message: state.message, code: state.code };
  }
}
