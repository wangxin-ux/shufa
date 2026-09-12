import type {
  RosterImportResult,
  RosterKind,
  RosterPreview,
  RosterRowResult,
  TeacherRosterPage,
} from '../types/roster';

interface HttpResponse {
  statusCode: number;
  data: unknown;
}

interface UploadResponse {
  statusCode: number;
  data: string;
}

interface DownloadResponse {
  statusCode: number;
  tempFilePath: string;
}

export interface RosterNativeApi {
  request(options: unknown): unknown;
  uploadFile(options: unknown): unknown;
  downloadFile(options: unknown): unknown;
  chooseMessageFile(options: unknown): unknown;
  openDocument(options: unknown): unknown;
  getFileSystemManager(): {
    writeFile(options: unknown): unknown;
  };
  userDataPath: string;
}

const defaultNativeApi: RosterNativeApi = {
  request: (options) => wx.request(options as WechatMiniprogram.RequestOption),
  uploadFile: (options) => wx.uploadFile(options as WechatMiniprogram.UploadFileOption),
  downloadFile: (options) => wx.downloadFile(options as WechatMiniprogram.DownloadFileOption),
  chooseMessageFile: (options) => wx.chooseMessageFile(options as WechatMiniprogram.ChooseMessageFileOption),
  openDocument: (options) => wx.openDocument(options as WechatMiniprogram.OpenDocumentOption),
  getFileSystemManager: () =>
    wx.getFileSystemManager() as unknown as {
      writeFile(options: unknown): unknown;
    },
  userDataPath: typeof wx === 'undefined' ? '' : wx.env.USER_DATA_PATH,
};

export class RosterClientError extends Error {}

export class RosterFileTransferClient {
  private readonly baseUrl: string;
  private readonly accessToken: () => string;

  constructor(
    options: {
      baseUrl: string;
      accessToken: string | (() => string);
    },
    private readonly native: RosterNativeApi = defaultNativeApi,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken =
      typeof options.accessToken === 'function'
        ? options.accessToken
        : () => options.accessToken as string;
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.accessToken());
  }

  async chooseWorkbook(): Promise<string | null> {
    return new Promise((resolve, reject) => {
      this.native.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['xlsx'],
        success: (result: { tempFiles?: Array<{ path: string; size: number }> }) => {
          const file = result.tempFiles?.[0];
          if (!file) return resolve(null);
          if (file.size > 5 * 1024 * 1024) {
            return reject(new RosterClientError('Excel 文件不能超过 5 MB'));
          }
          resolve(file.path);
        },
        fail: (error: { errMsg?: string }) => {
          if (error.errMsg?.includes('cancel')) return resolve(null);
          reject(new RosterClientError('无法选择 Excel 文件'));
        },
      });
    });
  }

  preview(prefix: string, kind: RosterKind, filePath: string) {
    return this.upload<RosterPreview>(`${prefix}/${kind}/preview`, filePath);
  }

  import(prefix: string, kind: RosterKind, filePath: string) {
    return this.upload<RosterImportResult>(`${prefix}/${kind}/import`, filePath);
  }

  quickEntry(
    prefix: string,
    kind: RosterKind,
    input: Record<string, string>,
    idempotencyKey: string,
  ) {
    return this.json<RosterRowResult>(`${prefix}/${kind}/entries`, 'POST', input, idempotencyKey);
  }

  listTeachers(prefix: string, query: Record<string, string | number | undefined>) {
    return this.page<TeacherRosterPage>(`${prefix}/teachers`, query);
  }

  openTemplate(prefix: string, kind: RosterKind) {
    return this.downloadAndOpen(`${prefix}/${kind}/template`);
  }

  openExport(
    prefix: string,
    kind: RosterKind,
    query: Record<string, string | undefined>,
  ) {
    return this.downloadAndOpen(
      `${prefix}/${kind}/export${this.query({ ...query, confirmed: 'true' })}`,
    );
  }

  async openReceipt(result: RosterImportResult): Promise<void> {
    if (!result.errorReceiptBase64 || !result.errorReceiptFileName) return;
    const safeName = result.errorReceiptFileName.replace(/[\\/:*?"<>|]/g, '-');
    const filePath = `${this.native.userDataPath}/${safeName}`;
    await new Promise<void>((resolve, reject) => {
      this.native.getFileSystemManager().writeFile({
        filePath,
        data: result.errorReceiptBase64,
        encoding: 'base64',
        success: () => resolve(),
        fail: () => reject(new RosterClientError('错误回执保存失败')),
      });
    });
    await this.openDocument(filePath);
  }

  private upload<T>(path: string, filePath: string): Promise<T> {
    this.requireConfigured();
    return new Promise((resolve, reject) => {
      this.native.uploadFile({
        url: `${this.baseUrl}${path}`,
        filePath,
        name: 'file',
        header: { Authorization: `Bearer ${this.accessToken()}` },
        success: (response: UploadResponse) => {
          try {
            const body = JSON.parse(response.data) as unknown;
            if (response.statusCode >= 200 && response.statusCode < 300) {
              return resolve(this.envelope<T>(body));
            }
            reject(this.serverError(body));
          } catch {
            reject(new RosterClientError('服务器返回了无法识别的导入结果'));
          }
        },
        fail: () => reject(new RosterClientError('Excel 上传失败，请检查网络')),
      });
    });
  }

  private json<T>(
    path: string,
    method: 'GET' | 'POST',
    data?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    this.requireConfigured();
    return new Promise((resolve, reject) => {
      this.native.request({
        url: `${this.baseUrl}${path}`,
        method,
        header: {
          Authorization: `Bearer ${this.accessToken()}`,
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        data,
        success: (response: HttpResponse) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve(this.envelope<T>(response.data));
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(this.serverError(response.data));
        },
        fail: () => reject(new RosterClientError('网络请求失败，请稍后重试')),
      });
    });
  }

  private page<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
    this.requireConfigured();
    return new Promise((resolve, reject) => {
      this.native.request({
        url: `${this.baseUrl}${path}${this.query(query)}`,
        method: 'GET',
        header: { Authorization: `Bearer ${this.accessToken()}` },
        success: (response: HttpResponse) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            const body = response.data as { data?: unknown; meta?: unknown };
            if (!body || !Array.isArray(body.data) || !body.meta) {
              return reject(new RosterClientError('教师名册数据格式错误'));
            }
            return resolve({ data: body.data, meta: body.meta } as T);
          }
          reject(this.serverError(response.data));
        },
        fail: () => reject(new RosterClientError('教师名册加载失败')),
      });
    });
  }

  private downloadAndOpen(path: string): Promise<void> {
    this.requireConfigured();
    return new Promise((resolve, reject) => {
      this.native.downloadFile({
        url: `${this.baseUrl}${path}`,
        header: { Authorization: `Bearer ${this.accessToken()}` },
        success: (response: DownloadResponse) => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            return reject(new RosterClientError('Excel 下载失败'));
          }
          this.openDocument(response.tempFilePath).then(resolve, reject);
        },
        fail: () => reject(new RosterClientError('Excel 下载失败，请检查网络')),
      });
    });
  }

  private openDocument(filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.native.openDocument({
        filePath,
        fileType: 'xlsx',
        showMenu: true,
        success: () => resolve(),
        fail: () => reject(new RosterClientError('无法打开 Excel 文件')),
      });
    });
  }

  private envelope<T>(body: unknown): T {
    if (!body || typeof body !== 'object' || !('data' in body)) {
      throw new RosterClientError('服务器返回的数据格式错误');
    }
    return (body as { data: T }).data;
  }

  private serverError(body: unknown): RosterClientError {
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && /[\u4e00-\u9fff]/.test(message)) {
        return new RosterClientError(message);
      }
    }
    return new RosterClientError('操作失败，请稍后重试');
  }

  private query(input: Record<string, string | number | undefined>): string {
    const query = Object.entries(input)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
    return query ? `?${query}` : '';
  }

  private requireConfigured(): void {
    if (!this.isConfigured()) {
      throw new RosterClientError('Excel 名册功能需要连接本地接口');
    }
  }
}
