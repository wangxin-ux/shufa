import { createTeacherRuntimeEnv } from "../config/teacher-env";
import { createRuntimeAccessTokenProvider } from "../config/local-runtime";

export type FinanceReportKind = "lesson-consumption" | "refunds";
export type FinanceReportQuery = {
  campusId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};
export type FinanceConsumptionRow = {
  id: string;
  entryType: "CONSUME" | "REVERSAL";
  campusId: string;
  campusName: string;
  studentName: string;
  packageName: string;
  courseName: string;
  lessonCompletedAt: string;
  bucket: "MAIN" | "GIFT";
  units: number;
  amountFen: number | null;
  amountStatus: "KNOWN" | "PENDING_CHECK";
};
export type FinancePaidRefundRow = {
  id: string;
  campusId: string;
  campusName: string;
  studentName: string;
  packageName: string;
  paidAt: string;
  amountFen: number;
  mainUnits: number;
  giftUnits: number;
};
export type FinanceReportPage<T, S> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  summary: S;
};
export type FinanceConsumptionSummary = {
  mainUnits: number;
  giftUnits: number;
  knownAmountFen: number;
  pendingCheckCount: number;
};
export type FinanceRefundSummary = {
  actualRefundFen: number;
  mainUnits: number;
  giftUnits: number;
};

type RequestOptions = {
  url: string;
  method: "GET";
  header: Record<string, string>;
  data?: unknown;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: unknown): void;
};
type DownloadOptions = {
  url: string;
  header: Record<string, string>;
  success(response: { statusCode: number; tempFilePath: string }): void;
  fail(error: unknown): void;
};
type OpenOptions = {
  filePath: string;
  fileType: "xlsx";
  showMenu: boolean;
  success(): void;
  fail(error: unknown): void;
};
type Request = (options: RequestOptions) => unknown;
type Download = (options: DownloadOptions) => unknown;
type Open = (options: OpenOptions) => unknown;

export class FinanceReportsService {
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string,
    private readonly request: Request = (options) =>
      wx.request(options as WechatMiniprogram.RequestOption),
    private readonly download: Download = (options) =>
      wx.downloadFile(options as WechatMiniprogram.DownloadFileOption),
    private readonly open: Open = (options) =>
      wx.openDocument(options as WechatMiniprogram.OpenDocumentOption),
  ) {}

  lessonConsumption(query: FinanceReportQuery) {
    return this.call<
      FinanceReportPage<FinanceConsumptionRow, FinanceConsumptionSummary>
    >("/lesson-consumption", query);
  }

  refunds(query: FinanceReportQuery) {
    return this.call<
      FinanceReportPage<FinancePaidRefundRow, FinanceRefundSummary>
    >("/refunds", query);
  }

  export(kind: FinanceReportKind, query: FinanceReportQuery): Promise<void> {
    const search = searchParams(query);
    return new Promise((resolve, reject) =>
      this.download({
        url: `${this.root()}/${kind}/export${search ? `?${search}` : ""}`,
        header: this.headers(),
        success: (response) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                response.statusCode === 400
                  ? "请核对日期或缩小导出范围（最多5000条）"
                  : "报表下载失败",
              ),
            );
            return;
          }
          this.open({
            filePath: response.tempFilePath,
            fileType: "xlsx",
            showMenu: true,
            success: resolve,
            fail: () => reject(new Error("报表已下载，文件打开失败")),
          });
        },
        fail: () => reject(new Error("报表下载失败，请检查网络")),
      }),
    );
  }

  private call<T>(path: string, query: FinanceReportQuery): Promise<T> {
    return new Promise((resolve, reject) =>
      this.request({
        url: `${this.root()}${path}`,
        method: "GET",
        header: this.headers(),
        data: query,
        success: (response) => {
          try {
            resolve(decode<T>(response.statusCode, response.data));
          } catch (error) {
            reject(error);
          }
        },
        fail: () => reject(new Error("网络连接失败，请重试")),
      }),
    );
  }

  private root() {
    return `${this.baseUrl.replace(/\/$/, "")}/finance/reports`;
  }

  private headers() {
    const token = this.token();
    if (!this.baseUrl || !token) throw new Error("请先登录财务账号");
    return { Authorization: `Bearer ${token}` };
  }
}

function decode<T>(statusCode: number, body: unknown): T {
  if (statusCode < 200 || statusCode >= 300) {
    const labels: Record<number, string> = {
      400: "请缩小日期或校区范围后重试",
      401: "登录已过期，请重新登录",
      403: "当前账号无财务报表权限",
    };
    throw new Error(labels[statusCode] ?? "报表加载失败，请稍后重试");
  }
  if (!body || typeof body !== "object" || !("data" in body))
    throw new Error("财务报表响应无效");
  return (body as { data: T }).data;
}

function searchParams(query: FinanceReportQuery) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
}

export function createFinanceReportsService() {
  const env = createTeacherRuntimeEnv();
  return new FinanceReportsService(
    env.apiBaseUrl,
    createRuntimeAccessTokenProvider(env.accessToken),
  );
}
