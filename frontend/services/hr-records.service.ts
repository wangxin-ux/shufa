import { createTeacherRuntimeEnv } from "../config/teacher-env";
import { createRuntimeAccessTokenProvider } from "../config/local-runtime";

export type HrTeacherRecordKind = "QUALIFICATION" | "TRAINING" | "GROWTH";
export type HrTeacherRecordStatus = "ACTIVE" | "ARCHIVED";

export interface HrRecordAttachment {
  id: string;
  originalName: string;
  mimeType: "image/png" | "image/jpeg" | "application/pdf";
  sizeBytes: number;
}

export interface HrTeacherRecordInput {
  kind: HrTeacherRecordKind;
  title: string;
  organization?: string | null;
  occurredOn: string;
  expiresOn?: string | null;
  note?: string;
  attachmentFileId?: string | null;
}

export interface HrTeacherRecord extends Required<HrTeacherRecordInput> {
  id: string;
  teacherId: string;
  attachment: HrRecordAttachment | null;
  version: number;
  status: HrTeacherRecordStatus;
  archivedAt: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface HrTeacherRecordPage {
  items: HrTeacherRecord[];
  total: number;
  page: number;
  pageSize: number;
}

type HttpMethod = "GET" | "POST" | "PATCH";
interface RequestOption {
  url: string;
  method: HttpMethod;
  header: Record<string, string>;
  data?: unknown;
  success(result: { statusCode: number; data: unknown }): void;
  fail(error: unknown): void;
}
interface UploadFileOption {
  url: string;
  filePath: string;
  name: string;
  header: Record<string, string>;
  success(result: { statusCode: number; data: string }): void;
  fail(error: unknown): void;
}
interface DownloadFileOption {
  url: string;
  header: Record<string, string>;
  success(result: { statusCode: number; tempFilePath: string }): void;
  fail(error: unknown): void;
}
interface PreviewImageOption {
  current: string;
  urls: string[];
  success(): void;
  fail(error: unknown): void;
}
interface OpenDocumentOption {
  filePath: string;
  fileType: "pdf";
  showMenu: boolean;
  success(): void;
  fail(error: unknown): void;
}
interface HrRecordNative {
  request(options: RequestOption): unknown;
  uploadFile(options: UploadFileOption): unknown;
  downloadFile(options: DownloadFileOption): unknown;
  previewImage(options: PreviewImageOption): unknown;
  openDocument(options: OpenDocumentOption): unknown;
}

const defaultNative: HrRecordNative = {
  request: (options) => wx.request(options as WechatMiniprogram.RequestOption),
  uploadFile: (options) =>
    wx.uploadFile(options as WechatMiniprogram.UploadFileOption),
  downloadFile: (options) =>
    wx.downloadFile(options as WechatMiniprogram.DownloadFileOption),
  previewImage: (options) =>
    wx.previewImage(options as WechatMiniprogram.PreviewImageOption),
  openDocument: (options) =>
    wx.openDocument(options as WechatMiniprogram.OpenDocumentOption),
};

export class HrRecordsApi {
  private readonly native: HrRecordNative;

  constructor(
    private readonly baseUrl: string,
    private readonly token: () => string,
    native: Partial<HrRecordNative> = {},
  ) {
    this.native = { ...defaultNative, ...native };
  }

  list(
    teacherId: string,
    query: {
      page: number;
      pageSize: number;
      kind?: HrTeacherRecordKind;
      status?: "ACTIVE" | "ARCHIVED" | "ALL";
    },
  ) {
    return this.request<HrTeacherRecordPage>(
      `/hr/teachers/${encodeURIComponent(teacherId)}/records`,
      "GET",
      query,
    );
  }

  create(
    teacherId: string,
    input: HrTeacherRecordInput,
    idempotencyKey: string,
  ) {
    return this.request<HrTeacherRecord>(
      `/hr/teachers/${encodeURIComponent(teacherId)}/records`,
      "POST",
      input,
      idempotencyKey,
    );
  }

  update(
    recordId: string,
    input: HrTeacherRecordInput & { expectedVersion: number },
    idempotencyKey: string,
  ) {
    return this.request<HrTeacherRecord>(
      `/hr/teacher-records/${encodeURIComponent(recordId)}`,
      "PATCH",
      input,
      idempotencyKey,
    );
  }

  archive(
    recordId: string,
    input: { expectedVersion: number; reason: string },
    idempotencyKey: string,
  ) {
    return this.request<HrTeacherRecord>(
      `/hr/teacher-records/${encodeURIComponent(recordId)}/archive`,
      "POST",
      input,
      idempotencyKey,
    );
  }

  uploadAttachment(filePath: string): Promise<HrRecordAttachment> {
    const auth = this.authorization();
    if (!auth) return Promise.reject(new Error("请先登录总部人力账号"));
    return new Promise((resolve, reject) => {
      this.native.uploadFile({
        url: this.url("/hr/teacher-record-attachments"),
        filePath,
        name: "file",
        header: auth,
        success: (response) => {
          let body: unknown;
          try {
            body = JSON.parse(response.data) as unknown;
          } catch {
            reject(new Error("附件上传响应无效"));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(statusMessage(response.statusCode, true)));
            return;
          }
          const data = unwrap<HrRecordAttachment>(body);
          data ? resolve(data) : reject(new Error("附件上传响应无效"));
        },
        fail: () => reject(new Error("网络连接失败，请重试")),
      });
    });
  }

  previewAttachment(record: HrTeacherRecord): Promise<void> {
    if (!record.attachment) {
      return Promise.reject(new Error("该记录没有附件"));
    }
    const auth = this.authorization();
    if (!auth) return Promise.reject(new Error("请先登录总部人力账号"));
    return new Promise((resolve, reject) => {
      this.native.downloadFile({
        url: this.url(
          `/hr/teacher-records/${encodeURIComponent(record.id)}/attachment`,
        ),
        header: auth,
        success: (response) => {
          if (response.statusCode !== 200) {
            reject(new Error(statusMessage(response.statusCode)));
            return;
          }
          if (record.attachment?.mimeType === "application/pdf") {
            this.native.openDocument({
              filePath: response.tempFilePath,
              fileType: "pdf",
              showMenu: true,
              success: resolve,
              fail: () => reject(new Error("附件已下载，文件打开失败")),
            });
            return;
          }
          this.native.previewImage({
            current: response.tempFilePath,
            urls: [response.tempFilePath],
            success: resolve,
            fail: () => reject(new Error("附件已下载，图片预览失败")),
          });
        },
        fail: () => reject(new Error("网络连接失败，请重试")),
      });
    });
  }

  private request<T>(
    path: string,
    method: HttpMethod,
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const auth = this.authorization();
    if (!auth) return Promise.reject(new Error("请先登录总部人力账号"));
    return new Promise((resolve, reject) => {
      this.native.request({
        url: this.url(path),
        method,
        header: {
          ...auth,
          ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        data,
        success: (response) => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(statusMessage(response.statusCode)));
            return;
          }
          const result = unwrap<T>(response.data);
          result ? resolve(result) : reject(new Error("人力记录接口响应无效"));
        },
        fail: () => reject(new Error("网络连接失败，请重试")),
      });
    });
  }

  private authorization(): Record<string, string> | null {
    const token = this.token();
    return token && this.baseUrl ? { Authorization: `Bearer ${token}` } : null;
  }

  private url(path: string) {
    return `${this.baseUrl.replace(/\/$/, "")}${path}`;
  }
}

function unwrap<T>(body: unknown): T | null {
  return body && typeof body === "object" && "data" in body
    ? ((body as { data: T }).data ?? null)
    : null;
}

function statusMessage(status: number, upload = false) {
  if (status === 400)
    return upload ? "附件格式或大小不符合要求" : "请核对记录内容";
  if (status === 401) return "登录已失效，请重新登录";
  if (status === 403) return "当前账号无权维护人力资料";
  if (status === 404) return "教师记录或附件不存在";
  if (status === 409) return "记录已被更新，请刷新后重试";
  return upload ? "附件上传失败，请重试" : "操作失败，请重试";
}

export function createHrRecordsApi() {
  const env = createTeacherRuntimeEnv();
  return new HrRecordsApi(
    env.apiBaseUrl,
    createRuntimeAccessTokenProvider(env.accessToken),
  );
}
