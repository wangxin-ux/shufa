import {
  CampusManagerCampusSettings,
  CampusManagerSettingsDraft,
  CampusManagerUpdateSettingsInput,
} from "../types/campus-manager";
import { RequestState } from "../utils/request-state";

const CHINA_PHONE_PATTERN = /^(?:1[3-9]\d{9}|0\d{2,3}-?\d{7,8})$/;

interface CampusManagerSettingsWorkflowService {
  updateCampusSettings(
    input: CampusManagerUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<RequestState<CampusManagerCampusSettings>>;
}

export type CampusManagerSettingsWorkflowOutcome =
  | { status: "success"; data: CampusManagerCampusSettings }
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

export function formatCampusManagerLessonHours(units: number): string {
  const normalized = Math.max(0, Math.trunc(units));
  const whole = Math.floor(normalized / 100);
  const fraction = normalized % 100;
  return fraction === 0
    ? String(whole)
    : `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}

function parseLessonHours(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const units = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(units) && units <= 2_147_483_647
    ? units
    : null;
}

export function validateCampusManagerSettingsDraft(
  draft: CampusManagerSettingsDraft,
): string | null {
  const name = draft.name.trim();
  if (!name) {
    return "请填写校区名称";
  }
  if (name.length > 200) {
    return "校区名称不能超过 200 字";
  }
  const phone = draft.contactPhone.trim();
  if (phone && !CHINA_PHONE_PATTERN.test(phone)) {
    return "请输入正确的手机号或固定电话";
  }
  if (draft.address.trim().length > 300) {
    return "校区地址不能超过 300 字";
  }
  const threshold = draft.lessonWarningThresholdHours.trim();
  if (/^\d+\.\d{3,}$/.test(threshold)) {
    return "预警阈值最多保留两位小数";
  }
  if (parseLessonHours(threshold) === null) {
    return "请输入非负的预警阈值";
  }
  return null;
}

export function normalizeCampusManagerSettingsDraft(
  draft: CampusManagerSettingsDraft,
  version: number,
): CampusManagerUpdateSettingsInput {
  const thresholdUnits = parseLessonHours(
    draft.lessonWarningThresholdHours,
  );
  if (thresholdUnits === null) {
    throw new Error("Cannot normalize invalid lesson warning threshold");
  }
  return {
    version,
    name: draft.name.trim(),
    contactPhone: draft.contactPhone.trim() || null,
    address: draft.address.trim() || null,
    lessonWarningThresholdUnits: thresholdUnits,
  };
}

let idempotencySequence = 0;

function defaultIdempotencyKey(): string {
  idempotencySequence += 1;
  return `campus-settings-${Date.now()}-${idempotencySequence}`;
}

export class CampusManagerSettingsWorkflow {
  private readonly createIdempotencyKey: () => string;
  private readonly keys = new Map<string, string>();
  private readonly inFlight = new Map<
    string,
    Promise<CampusManagerSettingsWorkflowOutcome>
  >();

  constructor(
    private readonly service: CampusManagerSettingsWorkflowService,
    options: { createIdempotencyKey?: () => string } = {},
  ) {
    this.createIdempotencyKey =
      options.createIdempotencyKey ?? defaultIdempotencyKey;
  }

  submit(
    draft: CampusManagerSettingsDraft,
    version: number,
  ): Promise<CampusManagerSettingsWorkflowOutcome> {
    const validation = validateCampusManagerSettingsDraft(draft);
    if (validation) {
      return Promise.resolve({ status: "validation", message: validation });
    }
    const input = normalizeCampusManagerSettingsDraft(draft, version);
    const signature = JSON.stringify(input);
    const current = this.inFlight.get(signature);
    if (current) {
      return current;
    }
    const key = this.keys.get(signature) ?? this.createIdempotencyKey();
    this.keys.set(signature, key);
    const promise = this.execute(signature, input, key);
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
    input: CampusManagerUpdateSettingsInput,
    key: string,
  ): Promise<CampusManagerSettingsWorkflowOutcome> {
    const state = await this.service.updateCampusSettings(input, key);
    if (state.status === "success") {
      this.keys.delete(signature);
      return { status: "success", data: state.data };
    }
    if (state.status !== "error") {
      return { status: "error", message: "设置保存未完成，请重试" };
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
