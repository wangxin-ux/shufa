import { createTeacherRuntimeEnv } from "../config/teacher-env";
import { createRuntimeAccessTokenProvider } from "../config/local-runtime";

export type FinanceOverviewQuery = {
  campusIds?: string;
  from?: string;
  to?: string;
  keyword?: string;
  region?: string;
  status?: string;
  category?: string;
  page?: number;
  pageSize?: number;
};

export type FinanceHoursRow = {
  id: string;
  campusName: string;
  studentName: string;
  packageName: string;
  validFrom: string;
  expiresAt: string | null;
  consumedMainUnits: number;
  consumedGiftUnits: number;
  unitPriceFen: number | null;
  priceStatus: "KNOWN" | "PENDING_CHECK";
  mainRemainingUnits: number;
  giftRemainingUnits: number;
  totalRemainingUnits: number;
  mainReservedUnits: number;
  giftReservedUnits: number;
};

export type FinanceOrderRow = {
  id: string;
  orderNo: string;
  source: "ENROLLMENT" | "GROUP_BUYING";
  campusName: string;
  studentName: string;
  productName: string;
  amountFen: number;
  status: string;
  proofAvailable: boolean;
  proofSubmittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type FinanceEarningRow = {
  campusId: string;
  campusName: string;
  regionLabel: string;
  grossLessonRevenueFen: number;
  teacherEarningFen: number;
  partnerEarningFen: number;
  platformRetainedFen: number;
  knownContributionFen: number;
};

export type FinancePayoutRow = {
  id: string;
  category: "PARENT_REFUND" | "TEACHER_WITHDRAWAL";
  referenceNo: string;
  campusName: string;
  subjectName: string;
  amountFen: number;
  status: string;
  requestedAt: string;
  paidAt: string | null;
  proofAvailable: boolean;
};

export type FinanceCashFlowRow = {
  id: string;
  direction: "INFLOW" | "OUTFLOW";
  type: string;
  campusName: string;
  subjectName: string;
  amountFen: number;
  occurredAt: string;
  status: string;
};

export type FinanceProfitabilityRow = {
  campusId: string;
  campusName: string;
  regionLabel: string;
  grossLessonRevenueFen: number;
  teacherEarningFen: number;
  partnerEarningFen: number;
  refundFen: number;
  knownContributionFen: number;
  feeFen: number | null;
  netProfitFen: number | null;
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

export class FinanceOverviewService {
  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string,
    private readonly request: (options: RequestOptions) => unknown = (options) =>
      wx.request(options as WechatMiniprogram.RequestOption),
    private readonly download: (options: DownloadOptions) => unknown = (options) =>
      wx.downloadFile(options as WechatMiniprogram.DownloadFileOption),
    private readonly open: (options: OpenOptions) => unknown = (options) =>
      wx.openDocument(options as WechatMiniprogram.OpenDocumentOption),
  ) {}

  hours(query: FinanceOverviewQuery) {
    return this.call<{
      items: FinanceHoursRow[];
      total: number;
      page: number;
      pageSize: number;
      asOf: string;
      summary: {
        studentCount: number;
        consumedMainUnits: number;
        consumedGiftUnits: number;
        remainingUnits: number;
      };
    }>("/hours", query);
  }

  orders(query: FinanceOverviewQuery) {
    return this.call<{
      items: FinanceOrderRow[];
      total: number;
      page: number;
      pageSize: number;
    }>("/oversight/orders", query);
  }

  earnings(query: FinanceOverviewQuery) {
    return this.call<{
      rows: FinanceEarningRow[];
      summary: Omit<FinanceEarningRow, "campusId" | "campusName" | "regionLabel">;
    }>("/oversight/earnings", query);
  }

  payouts(query: FinanceOverviewQuery) {
    return this.call<{
      items: FinancePayoutRow[];
      total: number;
      page: number;
      pageSize: number;
      coverage: {
        parentRefunds: "AVAILABLE";
        teacherWithdrawals: "AVAILABLE";
        partnerPayouts: "NOT_IMPLEMENTED";
      };
    }>("/oversight/payouts", query);
  }

  cashFlow(query: FinanceOverviewQuery) {
    return this.call<{
      items: FinanceCashFlowRow[];
      total: number;
      page: number;
      pageSize: number;
      summary: { inflowFen: number; outflowFen: number; feeFen: number | null };
      feeStatus: "NOT_RECORDED";
    }>("/oversight/cash-flow", query);
  }

  profitability(query: FinanceOverviewQuery) {
    return this.call<{
      rows: FinanceProfitabilityRow[];
      summary: Omit<FinanceProfitabilityRow, "campusId" | "campusName" | "regionLabel">;
      feeStatus: "NOT_RECORDED";
    }>("/oversight/profitability", query);
  }

  orderProof(orderId: string): Promise<string> {
    return new Promise((resolve, reject) =>
      this.download({
        url: `${this.root()}/oversight/orders/${encodeURIComponent(orderId)}/proof`,
        header: this.headers(),
        success: (response) =>
          response.statusCode === 200
            ? resolve(response.tempFilePath)
            : reject(new Error("收款凭证暂时无法读取")),
        fail: () => reject(new Error("收款凭证下载失败")),
      }),
    );
  }

  export(
    kind: "cash-flow" | "profitability",
    query: FinanceOverviewQuery,
  ): Promise<void> {
    const search = queryString(query);
    return new Promise((resolve, reject) =>
      this.download({
        url: `${this.root()}/oversight/${kind}/export${search ? `?${search}` : ""}`,
        header: this.headers(),
        success: (response) => {
          if (response.statusCode !== 200) {
            reject(new Error("报表下载失败，请缩小查询范围"));
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

  private call<T>(path: string, query: FinanceOverviewQuery): Promise<T> {
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
    return `${this.baseUrl.replace(/\/$/, "")}/finance`;
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
      400: "请核对筛选条件或缩小查询范围",
      401: "登录已过期，请重新登录",
      403: "当前账号无财务查看权限",
      404: "记录不存在",
    };
    throw new Error(labels[statusCode] ?? "财务数据加载失败");
  }
  if (!body || typeof body !== "object" || !("data" in body))
    throw new Error("财务接口响应无效");
  return (body as { data: T }).data;
}

function queryString(query: FinanceOverviewQuery) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
}

export function createFinanceOverviewService() {
  const env = createTeacherRuntimeEnv();
  return new FinanceOverviewService(
    env.apiBaseUrl,
    createRuntimeAccessTokenProvider(env.accessToken),
  );
}
