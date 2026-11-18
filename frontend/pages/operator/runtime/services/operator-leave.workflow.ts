import { OperatorLeaveRequest } from "../types/operator";
import { RequestState } from "../../../../utils/request-state";

interface OperatorLeaveWorkflowService {
  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLeaveRequest>>;
  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<RequestState<OperatorLeaveRequest>>;
}

export type OperatorLeaveWorkflowOutcome =
  | { status: "success"; data: OperatorLeaveRequest }
  | { status: "validation" | "forbidden"; message: string }
  | { status: "error"; message: string; uncertain?: boolean }
  | {
      status: "conflict";
      message: string;
      currentVersion?: number;
    };

export interface OperatorLeaveWorkflowOptions {
  createIdempotencyKey?: () => string;
}

let idempotencySequence = 0;

function defaultIdempotencyKey(): string {
  idempotencySequence += 1;
  return `campus-leave-${Date.now()}-${idempotencySequence}`;
}

export function validateOperatorRejectReason(reason: string): string | null {
  const normalized = reason.trim();
  if (!normalized) {
    return "请填写驳回原因";
  }
  if (normalized.length > 500) {
    return "驳回原因不能超过 500 字";
  }
  return null;
}

export class OperatorLeaveWorkflow {
  private readonly createIdempotencyKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly inFlight = new Map<
    string,
    Promise<OperatorLeaveWorkflowOutcome>
  >();

  constructor(
    private readonly service: OperatorLeaveWorkflowService,
    options: OperatorLeaveWorkflowOptions = {},
  ) {
    this.createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
  }

  approve(
    leaveRequestId: string,
    version: number,
    reviewReason?: string,
  ): Promise<OperatorLeaveWorkflowOutcome> {
    const normalizedReason = reviewReason?.trim() || undefined;
    return this.run(
      `approve:${leaveRequestId}`,
      { version, reviewReason: normalizedReason },
      (key) =>
        this.service.approveLeaveRequest(
          leaveRequestId,
          version,
          normalizedReason,
          key,
        ),
    );
  }

  reject(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
  ): Promise<OperatorLeaveWorkflowOutcome> {
    const validation = validateOperatorRejectReason(reviewReason);
    if (validation) {
      return Promise.resolve({ status: "validation", message: validation });
    }
    const normalizedReason = reviewReason.trim();
    return this.run(
      `reject:${leaveRequestId}`,
      { version, reviewReason: normalizedReason },
      (key) =>
        this.service.rejectLeaveRequest(
          leaveRequestId,
          version,
          normalizedReason,
          key,
        ),
    );
  }

  private run(
    operation: string,
    input: unknown,
    invoke: (
      idempotencyKey: string,
    ) => Promise<RequestState<OperatorLeaveRequest>>,
  ): Promise<OperatorLeaveWorkflowOutcome> {
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
    ) => Promise<RequestState<OperatorLeaveRequest>>,
  ): Promise<OperatorLeaveWorkflowOutcome> {
    const state = await invoke(key);
    if (state.status === "success") {
      this.keys.delete(signature);
      return { status: "success", data: state.data };
    }
    if (state.status !== "error") {
      return { status: "error", message: "审批结果尚未确认，请先核对", uncertain: true };
    }
    if (state.statusCode && state.statusCode >= 400 && state.statusCode < 500) {
      this.keys.delete(signature);
    }
    if (state.statusCode === 401 || state.statusCode === 403) {
      return { status: "forbidden", message: state.message };
    }
    if (state.statusCode === 409) {
      const currentVersion = state.details?.currentVersion;
      return {
        status: "conflict",
        message: state.message,
        ...(typeof currentVersion === "number" ? { currentVersion } : {}),
      };
    }
    return {
      status: "error", message: state.message,
      uncertain: !state.statusCode || state.statusCode >= 500,
    };
  }
}
