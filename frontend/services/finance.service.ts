import { createTeacherRuntimeEnv } from "../config/teacher-env";
import { createRuntimeAccessTokenProvider } from "../config/local-runtime";

export interface FinanceIssuance {
  id: string;
  coursePackageId: string;
  originalAmountFen: number;
  initialMainUnits: number;
  initialGiftUnits: number;
  name: string;
  validFrom: string;
  expiresAt: string | null;
  createdAt: string;
  unitPriceFen: number;
}
export interface FinanceReceipt {
  id: string;
  campusId: string;
  campusName: string;
  studentId: string;
  studentName: string;
  amountFen: number;
  receivedOn: string;
  channel: string;
  note: string;
  createdAt: string;
  status: "LINKED" | "UNLINKED";
  recordKind: "ORIGINAL" | "REPLACEMENT";
  replacementOfCorrectionId: string | null;
  correctionEffectFen: number;
  correction: null | {
    id: string;
    type: "VOID" | "REPLACE";
    status: "SUBMITTED" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "APPLIED";
    replacementReceiptId: string | null;
  };
  issuance: FinanceIssuance | null;
}
export interface FinancePage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface FinanceChoice {
  id: string;
  name: string;
}
export interface CreateFinanceReceipt {
  campusId: string;
  studentId: string;
  amountFen: number;
  receivedOn: string;
  channel: string;
  proofFileId: string;
  note: string;
}
export interface IssueFinancePackage {
  name: string;
  mainUnits: number;
  giftUnits: number;
  validFrom: string;
  expiresAt: string | null;
}
interface HttpOptions {
  url: string;
  method: "GET" | "POST";
  header: Record<string, string>;
  data?: unknown;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: unknown): void;
}
type HttpRequest = (options: HttpOptions) => unknown;
const defaultRequest: HttpRequest = (options) =>
  wx.request({
    ...options,
    data: options.data as WechatMiniprogram.IAnyObject | undefined,
  });

export class FinanceService {
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string,
    private readonly request: HttpRequest = defaultRequest,
  ) {}

  private headers(key?: string) {
    if (!this.baseUrl || !this.token()) throw new Error("请先登录财务账号");
    return {
      Authorization: `Bearer ${this.token()}`,
      ...(key ? { "Idempotency-Key": key } : {}),
    };
  }
  private call<T>(
    path: string,
    method: "GET" | "POST",
    data?: unknown,
    key?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.request({
        url: `${this.baseUrl.replace(/\/$/, "")}/finance${path}`,
        method,
        header: this.headers(key),
        data,
        success: (response) => {
          try {
            resolve(decode<T>(response.statusCode, response.data));
          } catch (error) {
            reject(error);
          }
        },
        fail: () => reject(new Error("网络连接失败，请重试")),
      });
    });
  }
  list(query: Record<string, string | number>) {
    return this.call<
      FinancePage<FinanceReceipt> & {
        summary: {
          amountFen: number;
          correctionEffectFen: number;
          netAmountFen: number;
          unlinkedCount: number;
        };
      }
    >("/receipts", "GET", query);
  }
  detail(id: string) {
    return this.call<FinanceReceipt>(
      `/receipts/${encodeURIComponent(id)}`,
      "GET",
    );
  }
  campuses(page = 1, query = "") {
    return this.call<FinancePage<FinanceChoice>>("/campuses", "GET", {
      page,
      pageSize: 50,
      query,
    });
  }
  students(campusId: string, query = "", page = 1) {
    return this.call<FinancePage<FinanceChoice>>("/students", "GET", {
      campusId,
      query,
      page,
      pageSize: 50,
    });
  }
  create(input: CreateFinanceReceipt, key: string) {
    return this.call<FinanceReceipt>("/receipts", "POST", input, key);
  }
  issue(id: string, input: IssueFinancePackage, key: string) {
    return this.call<FinanceIssuance>(
      `/receipts/${encodeURIComponent(id)}/issue-package`,
      "POST",
      input,
      key,
    );
  }
  upload(filePath: string): Promise<{ id: string }> {
    return new Promise((resolve, reject) =>
      wx.uploadFile({
        url: `${this.baseUrl.replace(/\/$/, "")}/finance/receipt-proofs`,
        name: "file",
        filePath,
        header: this.headers(),
        success: (response) => {
          try {
            resolve(decode(response.statusCode, JSON.parse(response.data)));
          } catch (error) {
            reject(error);
          }
        },
        fail: () => reject(new Error("凭证上传失败，请重试")),
      }),
    );
  }
  proof(id: string): Promise<string> {
    return new Promise((resolve, reject) =>
      wx.downloadFile({
        url: `${this.baseUrl.replace(/\/$/, "")}/finance/receipts/${encodeURIComponent(id)}/proof`,
        header: this.headers(),
        success: (response) =>
          response.statusCode === 200
            ? resolve(response.tempFilePath)
            : reject(new Error("凭证暂时无法读取")),
        fail: () => reject(new Error("凭证下载失败")),
      }),
    );
  }
  exportReceipts(query: Record<string, string | number>): Promise<void> {
    const search = Object.entries(query)
      .filter(([, value]) => value !== "")
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      )
      .join("&");
    return new Promise((resolve, reject) =>
      wx.downloadFile({
        url: `${this.baseUrl.replace(/\/$/, "")}/finance/receipts/export${search ? `?${search}` : ""}`,
        header: this.headers(),
        success: (response) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                response.statusCode === 400
                  ? "请核对筛选条件或缩小导出范围（最多5000条）"
                  : "收款明细下载失败",
              ),
            );
            return;
          }
          wx.openDocument({
            filePath: response.tempFilePath,
            fileType: "xlsx",
            showMenu: true,
            success: () => resolve(),
            fail: () => reject(new Error("收款明细已下载，文件打开失败")),
          });
        },
        fail: () => reject(new Error("收款明细下载失败，请检查网络")),
      }),
    );
  }
}
function decode<T>(status: number, body: unknown): T {
  if (status < 200 || status >= 300) {
    const messages: Record<number, string> = {
      400: "请核对学员、日期、金额和凭证后重试",
      401: "登录已过期，请重新登录",
      403: "当前账号无财务操作权限",
      404: "记录不存在",
      409: "记录已处理或提交内容已变化，请刷新核对",
      413: "凭证图片不能超过 3 MB",
    };
    throw new Error(messages[status] ?? "操作失败，请稍后重试");
  }
  if (!body || typeof body !== "object" || !("data" in body))
    throw new Error("财务接口响应无效");
  return (body as { data: T }).data;
}
export function createFinanceService() {
  const env = createTeacherRuntimeEnv();
  return new FinanceService(
    env.apiBaseUrl,
    createRuntimeAccessTokenProvider(env.accessToken),
  );
}
export function parseDecimalUnits(value: string): number {
  const normalized = value.trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(normalized))
    throw new Error("请输入最多两位小数的非负数");
  const [whole, fraction = ""] = normalized.split(".");
  const units = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(units) || units > 2147483647)
    throw new Error("数值超出允许范围");
  return units;
}
export function financeMoney(fen: number) {
  return (fen / 100).toFixed(2);
}
export function financeToday() {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
