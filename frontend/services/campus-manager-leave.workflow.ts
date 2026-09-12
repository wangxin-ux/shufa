import { CampusManagerLeaveRequest } from "../types/campus-manager";
import { RequestState } from "../utils/request-state";

interface CampusManagerLeaveWorkflowService {
  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLeaveRequest>>;
  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerLeaveRequest>>;
}

export type CampusManagerLeaveWorkflowOutcome =
  | { status: "success"; data: CampusManagerLeaveRequest }
  | { status: "validation" | "error" | "forbidden"; message: string }
  | {
      status: "conflict";
      message: string;
      currentVersion?: number;
    };

export interface CampusManagerLeaveWorkflowOptions {
  createIdempotencyKey?: () => string;
}

let idempotencySequence = 0;

function defaultIdempotencyKey(): string {
  idempotencySequence += 1;
  return `campus-leave-${Date.now()}-${idempotencySequence}`;
}

export function validateCampusManagerRejectReason(reason: string): string | null {
  const normalized = reason.trim();
  if (!normalized) {
    return "请填写驳回原因";
  }
  if (normalized.length > 500) {
    return "驳回原因不能超过 500 字";
  }
  return null;
}

export class CampusManagerLeaveWorkflow {
  private readonly createIdempotencyKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly inFlight = new Map<
    string,
    Promise<CampusManagerLeaveWorkflowOutcome>
  >();

  constructor(
    private readonly service: CampusManagerLeaveWorkflowService,
    options: CampusManagerLeaveWorkflowOptions = {},
  ) {
    this.createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
  }

  approve(
    leaveRequestId: string,
    version: number,
    reviewReason?: string,
  ): Promise<CampusManagerLeaveWorkflowOutcome> {
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
  ): Promise<CampusManagerLeaveWorkflowOutcome> {
    const validation = validateCampusManagerRejectReason(reviewReason);
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
    ) => Promise<RequestState<CampusManagerLeaveRequest>>,
  ): Promise<CampusManagerLeaveWorkflowOutcome> {
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
    ) => Promise<RequestState<CampusManagerLeaveRequest>>,
  ): Promise<CampusManagerLeaveWorkflowOutcome> {
    const state = await invoke(key);
    if (state.status === "success") {
      this.keys.delete(signature);
      return { status: "success", data: state.data };
    }
    if (state.status !== "error") {
      return { status: "error", message: "审批未完成，请重试" };
    }
    if (state.statusCode === 403) {
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
    return { status: "error", message: state.message };
  }
}
