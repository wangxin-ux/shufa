import {
  CampusManagerCreateStudentInput,
  CampusManagerCampusSettings,
  CampusManagerDashboard,
  CampusManagerLessonQuery,
  CampusManagerLessonSession,
  CampusManagerLeaveQuery,
  CampusManagerLeaveRequest,
  CampusManagerPage,
  CampusManagerPageMeta,
  CampusManagerProfile,
  CampusManagerSchedulingOptions,
  CampusManagerScheduleInput,
  CampusManagerStudent,
  CampusManagerStudentDetail,
  CampusManagerStudentQuery,
  CampusManagerUpdateScheduleInput,
  CampusManagerUpdateSettingsInput,
  CampusManagerWarning,
  CampusManagerWarningQuery,
} from "../types/campus-manager";
import {
  CampusManagerDataSource,
  CampusManagerDataSourceError,
} from "./campus-manager-data-source";

export interface CampusManagerHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface CampusManagerHttpRequestOptions {
  url: string;
  method: "GET" | "POST" | "PATCH";
  header: Record<string, string>;
  data?: unknown;
  success(response: CampusManagerHttpResponse): void;
  fail(error: unknown): void;
}

export type CampusManagerHttpRequest = (
  options: CampusManagerHttpRequestOptions,
) => unknown;

export interface ApiCampusManagerDataSourceOptions {
  baseUrl: string;
  accessToken: string | (() => string);
  request?: CampusManagerHttpRequest;
}

interface SuccessEnvelope<T> {
  data: T;
  requestId: string;
}

interface PageEnvelope<T> extends SuccessEnvelope<T[]> {
  meta: CampusManagerPageMeta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const defaultRequest: CampusManagerHttpRequest = (options) =>
  wx.request({
    url: options.url,
    method: options.method as WechatMiniprogram.RequestOption["method"],
    header: options.header,
    data: options.data as
      string | WechatMiniprogram.IAnyObject | ArrayBuffer | undefined,
    success: (response) =>
      options.success({
        statusCode: response.statusCode,
        data: response.data,
      }),
    fail: options.fail,
  });

export class ApiCampusManagerDataSource implements CampusManagerDataSource {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;
  private readonly request: CampusManagerHttpRequest;

  constructor(options: ApiCampusManagerDataSourceOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.accessToken =
      typeof options.accessToken === "function"
        ? options.accessToken
        : () => options.accessToken as string;
    this.request = options.request ?? defaultRequest;
  }

  getDashboard(): Promise<CampusManagerDashboard> {
    return this.envelope("/campus-managers/me/dashboard");
  }

  getProfile(): Promise<CampusManagerProfile> {
    return this.envelope("/campus-managers/me/profile");
  }

  listStudents(
    query: CampusManagerStudentQuery,
  ): Promise<CampusManagerPage<CampusManagerStudent>> {
    return this.page(
      "/campus-managers/me/students",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["query", query.query],
      ]),
    );
  }

  getStudent(id: string): Promise<CampusManagerStudentDetail> {
    return this.envelope(
      `/campus-managers/me/students/${encodeURIComponent(id)}`,
    );
  }

  getSchedulingOptions(): Promise<CampusManagerSchedulingOptions> {
    return this.envelope("/campus-managers/me/scheduling-options");
  }

  createStudent(
    input: CampusManagerCreateStudentInput,
    idempotencyKey: string,
  ): Promise<CampusManagerStudent> {
    return this.envelope(
      "/campus-managers/me/students",
      "POST",
      input,
      idempotencyKey,
    );
  }

  listLessonSessions(
    query: CampusManagerLessonQuery,
  ): Promise<CampusManagerPage<CampusManagerLessonSession>> {
    return this.page(
      "/campus-managers/me/lesson-sessions",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["from", query.from],
        ["to", query.to],
        ["status", query.status],
      ]),
    );
  }

  createLessonSession(
    input: CampusManagerScheduleInput,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession> {
    return this.envelope(
      "/campus-managers/me/lesson-sessions",
      "POST",
      input,
      idempotencyKey,
    );
  }

  updateLessonSession(
    lessonSessionId: string,
    input: CampusManagerUpdateScheduleInput,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession> {
    return this.envelope(
      `/campus-managers/me/lesson-sessions/${encodeURIComponent(lessonSessionId)}`,
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  cancelLessonSession(
    lessonSessionId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<CampusManagerLessonSession> {
    return this.envelope(
      `/campus-managers/me/lesson-sessions/${encodeURIComponent(lessonSessionId)}/cancel`,
      "POST",
      { version },
      idempotencyKey,
    );
  }

  listLeaveRequests(
    query: CampusManagerLeaveQuery,
  ): Promise<CampusManagerPage<CampusManagerLeaveRequest>> {
    return this.page(
      "/campus-managers/me/leave-requests",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["status", query.status],
      ]),
    );
  }

  approveLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string | undefined,
    idempotencyKey: string,
  ): Promise<CampusManagerLeaveRequest> {
    return this.envelope(
      `/campus-managers/me/leave-requests/${encodeURIComponent(leaveRequestId)}/approve`,
      "POST",
      { version, ...(reviewReason ? { reviewReason } : {}) },
      idempotencyKey,
    );
  }

  rejectLeaveRequest(
    leaveRequestId: string,
    version: number,
    reviewReason: string,
    idempotencyKey: string,
  ): Promise<CampusManagerLeaveRequest> {
    return this.envelope(
      `/campus-managers/me/leave-requests/${encodeURIComponent(leaveRequestId)}/reject`,
      "POST",
      { version, reviewReason },
      idempotencyKey,
    );
  }

  listWarnings(
    query: CampusManagerWarningQuery,
  ): Promise<CampusManagerPage<CampusManagerWarning>> {
    return this.page(
      "/campus-managers/me/warnings",
      this.query([
        ["page", query.page],
        ["pageSize", query.pageSize],
        ["query", query.query],
      ]),
    );
  }

  getCampusSettings(): Promise<CampusManagerCampusSettings> {
    return this.envelope("/campus-managers/me/campus");
  }

  updateCampusSettings(
    input: CampusManagerUpdateSettingsInput,
    idempotencyKey: string,
  ): Promise<CampusManagerCampusSettings> {
    return this.envelope(
      "/campus-managers/me/campus",
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  private envelope<T>(
    path: string,
    method: "GET" | "POST" | "PATCH" = "GET",
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    return this.send<SuccessEnvelope<T>>(
      method,
      path,
      data,
      idempotencyKey,
    ).then((response) => response.data);
  }

  private page<T>(path: string, query: string): Promise<CampusManagerPage<T>> {
    return this.send<PageEnvelope<T>>("GET", `${path}${query}`).then(
      ({ data, meta }) => ({ data, meta }),
    );
  }

  private send<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const accessToken = this.accessToken().trim();
    if (!accessToken) {
      return Promise.reject(
        new CampusManagerDataSourceError(
          401,
          "UNAUTHORIZED",
          "管理员登录已失效",
        ),
      );
    }
    const header: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (idempotencyKey) {
      header["Idempotency-Key"] = idempotencyKey;
    }
    return new Promise<T>((resolve, reject) => {
      this.request({
        url: `${this.baseUrl}${path}`,
        method,
        header,
        ...(data === undefined ? {} : { data }),
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(response.data as T);
            return;
          }
          reject(this.toError(response.statusCode, response.data));
        },
        fail: (error) =>
          reject(
            new CampusManagerDataSourceError(
              0,
              "NETWORK_ERROR",
              error instanceof Error
                ? error.message
                : "网络请求失败，请稍后重试",
            ),
          ),
      });
    });
  }

  private query(
    entries: ReadonlyArray<[string, string | number | undefined]>,
  ): string {
    const encoded = entries
      .filter(
        (entry): entry is [string, string | number] => entry[1] !== undefined,
      )
      .map(
        ([key, value]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
      );
    return encoded.length > 0 ? `?${encoded.join("&")}` : "";
  }

  private toError(
    statusCode: number,
    body: unknown,
  ): CampusManagerDataSourceError {
    const code =
      isRecord(body) && typeof body.code === "string"
        ? body.code
        : "UNKNOWN_ERROR";
    const messages: Record<number, string> = {
      401: "管理员登录已失效",
      403: "当前账号无管理员端访问权限",
      409: "数据已更新，请刷新后重试",
    };
    const message =
      messages[statusCode] ??
      (statusCode >= 500 || code === "INTERNAL_SERVER_ERROR"
        ? "服务器处理失败，请稍后重试"
        : isRecord(body) && typeof body.message === "string"
          ? body.message
          : "请求失败，请稍后重试");
    const details =
      isRecord(body) && isRecord(body.details) ? body.details : {};
    return new CampusManagerDataSourceError(statusCode, code, message, details);
  }
}
