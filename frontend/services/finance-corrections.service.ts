import { createTeacherRuntimeEnv } from "../config/teacher-env";
import { createRuntimeAccessTokenProvider } from "../config/local-runtime";
import type { FinancePage } from "./finance.service";

export type CorrectionRole = "FINANCE" | "SUPER_ADMIN";
export type CorrectionType = "VOID" | "REPLACE";
export type CorrectionStatus =
  | "SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "WITHDRAWN"
  | "APPLIED";
export type CorrectionAction = "APPROVE" | "REJECT" | "WITHDRAW" | "APPLY";

export interface CorrectionPackageSnapshot {
  name: string;
  mainUnits: number;
  giftUnits: number;
  validFrom: string;
  expiresAt: string | null;
}

export interface CorrectionReceiptSnapshot {
  campusId: string;
  campusName: string;
  studentId: string;
  studentName: string;
  amountFen: number;
  receivedOn: string;
  channel: string;
  note: string;
  proofAvailable: boolean;
  package: CorrectionPackageSnapshot;
}

export interface CorrectionReplacementInput {
  campusId: string;
  studentId: string;
  amountFen: number;
  receivedOn: string;
  channel: string;
  proofFileId: string;
  note: string;
  package: CorrectionPackageSnapshot;
}

export type CreateCorrectionInput =
  | { type: "VOID"; reason: string; replacement?: never }
  | {
      type: "REPLACE";
      reason: string;
      replacement: CorrectionReplacementInput;
    };

export interface CorrectionActionInput {
  action: CorrectionAction;
  expectedVersion: number;
  reason: string;
}

export interface CorrectionView {
  id: string;
  originalReceiptId: string;
  originalCoursePackageId: string;
  type: CorrectionType;
  status: CorrectionStatus;
  version: number;
  reason: string;
  requestedByUserId: string;
  createdAt: string;
  original: CorrectionReceiptSnapshot;
  proposedReplacement: CorrectionReceiptSnapshot | null;
  replacementReceiptId: string | null;
  correctionEffectFen: number;
  events: Array<{
    id: string;
    action: string;
    fromStatus: CorrectionStatus | null;
    toStatus: CorrectionStatus;
    version: number;
    reason: string;
    actorName: string;
    createdAt: string;
  }>;
}

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  SUBMITTED: "待审核",
  APPROVED: "待执行",
  REJECTED: "已驳回",
  WITHDRAWN: "已撤回",
  APPLIED: "已应用",
};

export const CORRECTION_TYPE_LABELS: Record<CorrectionType, string> = {
  VOID: "撤销收款",
  REPLACE: "更正替代",
};

export const CORRECTION_ACTION_LABELS: Record<CorrectionAction, string> = {
  APPROVE: "批准纠错",
  REJECT: "驳回纠错",
  WITHDRAW: "撤回申请",
  APPLY: "执行账面纠错",
};

export function correctionActions(
  role: CorrectionRole,
  status: CorrectionStatus,
) {
  const actions =
    role === "SUPER_ADMIN"
      ? status === "SUBMITTED"
        ? (["APPROVE", "REJECT"] as const)
        : []
      : status === "SUBMITTED"
        ? (["WITHDRAW"] as const)
        : status === "APPROVED"
          ? (["APPLY"] as const)
          : [];
  return actions.map((code) => ({ code, name: CORRECTION_ACTION_LABELS[code] }));
}

export function correctionActionGroups(
  role: CorrectionRole,
  status: CorrectionStatus,
) {
  const actions = correctionActions(role, status);
  return { actions, primaryActions: actions, secondaryActions: [] };
}

interface RequestOptions {
  url: string;
  method: "GET" | "POST";
  data?: unknown;
  header: Record<string, string>;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: unknown): void;
}

type Request = (options: RequestOptions) => unknown;

export class CorrectionApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string,
    private readonly role: CorrectionRole,
    private readonly request: Request = (options) =>
      wx.request({
        ...options,
        data: options.data as WechatMiniprogram.IAnyObject | undefined,
      }),
  ) {}

  private prefix() {
    return this.role === "FINANCE"
      ? "/finance/corrections"
      : "/management/finance-corrections";
  }

  private headers(key?: string) {
    const token = this.token();
    if (!token || !this.baseUrl) throw new Error("请先登录总部账号");
    return {
      Authorization: `Bearer ${token}`,
      ...(key ? { "Idempotency-Key": key } : {}),
    };
  }

  private call<T>(
    path: string,
    method: "GET" | "POST",
    data?: unknown,
    key?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) =>
      this.request({
        url: `${this.baseUrl.replace(/\/$/, "")}${path}`,
        method,
        data,
        header: this.headers(key),
        success: (response) => {
          try {
            resolve(decode<T>(response.statusCode, response.data));
          } catch (error) {
            reject(error);
          }
        },
        fail: () => reject(new Error("网络连接失败，原表单已保留")),
      }),
    );
  }

  submit(receiptId: string, body: CreateCorrectionInput, key: string) {
    if (this.role !== "FINANCE")
      return Promise.reject(new Error("当前账号不能提交纠错申请"));
    return this.call<CorrectionView>(
      `/finance/receipts/${encodeURIComponent(receiptId)}/corrections`,
      "POST",
      body,
      key,
    );
  }

  list(query: Record<string, string | number>) {
    return this.call<FinancePage<CorrectionView>>(this.prefix(), "GET", query);
  }

  detail(id: string) {
    return this.call<CorrectionView>(
      `${this.prefix()}/${encodeURIComponent(id)}`,
      "GET",
    );
  }

  act(id: string, body: CorrectionActionInput, key: string) {
    return this.call<CorrectionView>(
      `${this.prefix()}/${encodeURIComponent(id)}/actions`,
      "POST",
      body,
      key,
    );
  }

  originalProof(id: string) {
    return this.downloadProof(id, "original-proof");
  }

  replacementProof(id: string) {
    return this.downloadProof(id, "replacement-proof");
  }

  private downloadProof(id: string, kind: string): Promise<string> {
    return new Promise((resolve, reject) =>
      wx.downloadFile({
        url: `${this.baseUrl.replace(/\/$/, "")}${this.prefix()}/${encodeURIComponent(id)}/${kind}`,
        header: this.headers(),
        success: (response) =>
          response.statusCode === 200
            ? resolve(response.tempFilePath)
            : reject(new Error("纠错凭证暂时无法读取")),
        fail: () => reject(new Error("纠错凭证下载失败")),
      }),
    );
  }
}

function decode<T>(status: number, body: unknown): T {
  if (status < 200 || status >= 300) {
    const messages: Record<number, string> = {
      400: "请核对纠错类型、替代收款与处理说明",
      401: "登录已失效，请重新登录",
      403: "当前账号不能执行此纠错操作",
      404: "纠错记录或原收款不存在",
      409: "状态或记录版本已变化，请刷新详情核对",
      413: "凭证图片不能超过 3 MB",
    };
    throw new Error(messages[status] ?? "纠错操作失败，请稍后重试");
  }
  if (!body || typeof body !== "object" || !("data" in body))
    throw new Error("纠错接口响应无效");
  return (body as { data: T }).data;
}

export function createCorrectionApi(role: CorrectionRole) {
  const env = createTeacherRuntimeEnv();
  return new CorrectionApi(
    env.apiBaseUrl,
    createRuntimeAccessTokenProvider(env.accessToken),
    role,
  );
}
