import { LOCAL_RUNTIME_STORAGE_KEY } from '../../../config/local-runtime';
import {
  defaultLoginCodeProvider, defaultRequest, defaultStorage, SessionServiceError,
  type SessionStorage, type SessionHttpRequest, type SessionHttpRequestOptions,
  type SessionLoginCodeProvider,
} from '../../../services/session.service';

type ApplicantHttpRequestOptions = Omit<SessionHttpRequestOptions, 'method'> & {
  method: 'GET' | 'POST' | 'PUT';
};

export interface PartnerApplicantIdentity {
  applicantId: string;
  displayName: string;
  formalAccountReady: boolean;
}

interface ApplicantCredentials {
  token: string;
  expiresAt: string;
  me: PartnerApplicantIdentity;
}

interface ApplicantSessionOptions {
  apiBaseUrl: string;
  storage?: SessionStorage;
  request?: SessionHttpRequest;
  loginCodeProvider?: SessionLoginCodeProvider;
  now?: () => number;
  isRuntimeCurrent?: () => boolean;
  upload?: (options: WechatMiniprogram.UploadFileOption) => unknown;
  download?: (options: WechatMiniprogram.DownloadFileOption) => unknown;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(): never {
  throw new SessionServiceError(502, 'INVALID_RESPONSE', '申请会话响应格式无效');
}

function identity(value: unknown): PartnerApplicantIdentity {
  if (!record(value) || typeof value.applicantId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.applicantId) ||
      typeof value.displayName !== 'string' || value.displayName.length > 100 ||
      typeof value.formalAccountReady !== 'boolean') invalid();
  return {
    applicantId: value.applicantId, displayName: value.displayName,
    formalAccountReady: value.formalAccountReady,
  };
}

function credentials(value: unknown, now: number): ApplicantCredentials {
  if (!record(value) || typeof value.token !== 'string' || !value.token.trim() ||
      typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) ||
      Date.parse(value.expiresAt) <= now) invalid();
  return { token: value.token, expiresAt: value.expiresAt, me: identity(value.me) };
}

export class PartnerApplicantSessionService {
  private readonly storage: SessionStorage;
  private readonly request: (options: ApplicantHttpRequestOptions) => unknown;
  private readonly codeProvider: SessionLoginCodeProvider;
  private readonly now: () => number;
  private readonly baseUrl: string;
  private readonly isRuntimeCurrent: () => boolean;
  private readonly upload: (options: WechatMiniprogram.UploadFileOption) => unknown;
  private readonly download: (options: WechatMiniprogram.DownloadFileOption) => unknown;
  private generation = 0;
  private readRevision = 0;
  private pendingLogin?: Promise<PartnerApplicantIdentity>;
  private pendingMe?: { key: string; promise: Promise<PartnerApplicantIdentity> };

  constructor(options: ApplicantSessionOptions) {
    this.storage = options.storage ?? defaultStorage;
    // The existing transport forwards methods to wx.request, which also supports PUT.
    this.request = (options.request ?? defaultRequest) as typeof this.request;
    this.codeProvider = options.loginCodeProvider ?? defaultLoginCodeProvider;
    this.now = options.now ?? Date.now;
    this.isRuntimeCurrent = options.isRuntimeCurrent ?? (() => true);
    this.upload = options.upload ?? ((input) => wx.uploadFile(input));
    this.download = options.download ?? ((input) => wx.downloadFile(input));
    this.baseUrl = options.apiBaseUrl.replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+/i.test(this.baseUrl)) {
      throw new Error('申请会话接口地址未配置');
    }
  }

  getToken(): string {
    if (!this.isRuntimeCurrent()) return '';
    const runtime = this.runtime();
    if (runtime.partnerApplicantSession === undefined) return '';
    try {
      return credentials(runtime.partnerApplicantSession, this.now()).token;
    } catch {
      this.removeCredentials();
      return '';
    }
  }

  getSessionKey(): string {
    const token = this.getToken();
    return token ? `${this.generation}:${token}` : '';
  }

  getReadKey(): string {
    const session = this.getSessionKey();
    return session ? `${session}:${this.readRevision}` : '';
  }

  invalidateReads(): void {
    this.readRevision += 1;
    this.pendingMe = undefined;
  }

  async requestApplication(method: 'GET' | 'PUT', data?: unknown): Promise<unknown> {
    return this.requestDraft(method, data, false);
  }

  async requestBankInformation(method: 'GET' | 'PUT', data?: unknown): Promise<unknown> {
    return this.requestDraft(method, data, true);
  }

  requestMaterials(method: 'GET' | 'PUT', data?: unknown): Promise<unknown> {
    return this.requestPrivate('/me/application/materials', method, data);
  }
  requestSubmission(expectedVersion: number, key: string): Promise<unknown> {
    return this.requestPrivate('/me/application/submit', 'POST', { expectedVersion }, { 'Idempotency-Key': key });
  }
  requestHistory(page: number): Promise<unknown> {
    return this.requestPrivate(`/me/application/history?page=${page}&pageSize=20`, 'GET');
  }
  requestReopen(submissionId: string, expectedVersion: number, key: string): Promise<unknown> {
    return this.requestPrivate('/me/application/reopen', 'POST', { submissionId, expectedVersion }, { 'Idempotency-Key': key });
  }
  reserveMaterial(data: unknown): Promise<unknown> {
    return this.requestPrivate('/me/application/material-uploads', 'POST', data);
  }
  transferMaterial(id: string, filePath: string): Promise<unknown> {
    return this.privateTransfer(false, (token) => new Promise((resolve, reject) => {
      this.upload({
        url: `${this.baseUrl}/partner-applicants/me/application/material-uploads/${encodeURIComponent(id)}`,
        filePath, name: 'file', header: { Authorization: `Bearer ${token}` },
        success: (response) => {
          let body: unknown;
          try { body = JSON.parse(response.data); } catch {
            reject(new SessionServiceError(502, 'INVALID_RESPONSE', '材料上传响应格式无效')); return;
          }
          if (response.statusCode !== 200) {
            reject(this.materialError(response.statusCode)); return;
          }
          if (!record(body) || Reflect.ownKeys(body).length !== 2 ||
              typeof body.requestId !== 'string' || !Object.prototype.hasOwnProperty.call(body, 'data')) {
            reject(new SessionServiceError(502, 'INVALID_RESPONSE', '材料上传响应格式无效')); return;
          }
          resolve(body.data);
        }, fail: () => reject(this.materialError(0)),
      });
    }));
  }
  downloadMaterial(id: string): Promise<string> {
    return this.privateTransfer(true, (token) => new Promise<string>((resolve, reject) => {
      this.download({
        url: `${this.baseUrl}/partner-applicants/me/application/materials/${encodeURIComponent(id)}/content`,
        header: { Authorization: `Bearer ${token}` },
        success: (response) => {
          if (response.statusCode !== 200) reject(this.materialError(response.statusCode));
          else if (typeof response.tempFilePath !== 'string' || !response.tempFilePath.trim())
            reject(new SessionServiceError(502, 'INVALID_RESPONSE', '材料预览响应格式无效'));
          else resolve(response.tempFilePath);
        }, fail: () => reject(this.materialError(0)),
      });
    }));
  }

  private async requestDraft(method: 'GET' | 'PUT', data: unknown, bank: boolean): Promise<unknown> {
    if (method !== 'GET' && method !== 'PUT') {
      throw new SessionServiceError(400, 'BAD_REQUEST', '申请草稿请求方式无效');
    }
    const path = bank ? '/me/application/bank-information'
      : method === 'GET' ? '/me/application' : '/me/application/basic-information';
    return this.requestPrivate(path, method, data);
  }
  private async requestPrivate(path: string, method: ApplicantHttpRequestOptions['method'], data?: unknown,
    headers?: Record<string, string>): Promise<unknown> {
    const token = this.getToken();
    if (!token) throw this.unauthorized();
    const generation = this.generation;
    const readKey = this.getReadKey();
    try {
      const result = await this.send(path, method, token, data, true, headers);
      this.assertCurrent(generation, token);
      if (method === 'GET') this.assertReadCurrent(readKey);
      return result;
    } catch (error) {
      if (error instanceof SessionServiceError && error.statusCode === 401 &&
          generation === this.generation && this.getToken() === token &&
          (method !== 'GET' || readKey === this.getReadKey())) {
        this.removeCredentials();
      }
      throw error;
    }
  }
  private async privateTransfer<T>(read: boolean, action: (token: string) => Promise<T>): Promise<T> {
    const token = this.getToken();
    if (!token) throw this.unauthorized();
    const generation = this.generation;
    const readKey = this.getReadKey();
    try {
      const result = await action(token);
      this.assertCurrent(generation, token);
      if (read) this.assertReadCurrent(readKey);
      return result;
    } catch (error) {
      if (error instanceof SessionServiceError && error.statusCode === 401 &&
          generation === this.generation && this.getToken() === token &&
          (!read || this.getReadKey() === readKey)) this.removeCredentials();
      throw error;
    }
  }
  private materialError(statusCode: number) {
    return new SessionServiceError(statusCode, statusCode === 401 ? 'UNAUTHORIZED'
      : statusCode === 403 ? 'FORBIDDEN' : statusCode === 409 ? 'CONFLICT' : 'REQUEST_FAILED',
    statusCode >= 500 ? '材料服务暂时不可用，请稍后重试'
      : statusCode === 409 ? '材料请求未完成，请恢复原上传或重新读取'
      : statusCode === 400 || statusCode === 413 ? '请选择完整的 JPEG 或 PNG 图片，单张不超过 3MB'
      : '材料请求失败，请重试');
  }

  login(): Promise<PartnerApplicantIdentity> {
    if (!this.isRuntimeCurrent()) return Promise.reject(
      new SessionServiceError(409, 'SESSION_SUPERSEDED', '申请会话已更新'),
    );
    if (this.pendingLogin) return this.pendingLogin;
    const previousToken = this.getToken();
    const generation = ++this.generation;
    const pending = (async () => {
      const code = await this.codeProvider();
      this.assertCurrent(generation, previousToken);
      if (!code.trim()) throw new Error('未获取到微信登录凭证，请重试');
      const result = await this.send('/auth/wechat', 'POST', '', { code });
      this.assertCurrent(generation, previousToken);
      const value = credentials(result, this.now());
      this.storage.set(LOCAL_RUNTIME_STORAGE_KEY, {
        ...this.runtime(), partnerApplicantSession: value,
      });
      this.pendingMe = undefined;
      return { ...value.me };
    })().finally(() => {
      if (this.pendingLogin === pending) this.pendingLogin = undefined;
    });
    this.pendingLogin = pending;
    return pending;
  }

  loadMe(): Promise<PartnerApplicantIdentity> {
    const token = this.getToken();
    if (!token) return Promise.reject(this.unauthorized());
    const readKey = this.getReadKey();
    if (this.pendingMe?.key === readKey) return this.pendingMe.promise;
    const generation = this.generation;
    const pending = (async () => {
      try {
        const result = await this.send('/me', 'GET', token);
        this.assertCurrent(generation, token);
        this.assertReadCurrent(readKey);
        const me = identity(result);
        const current = credentials(this.runtime().partnerApplicantSession, this.now());
        this.storage.set(LOCAL_RUNTIME_STORAGE_KEY, {
          ...this.runtime(), partnerApplicantSession: { ...current, me },
        });
        return { ...me };
      } catch (error) {
        if (error instanceof SessionServiceError && error.statusCode === 401 &&
            generation === this.generation && this.getToken() === token &&
            readKey === this.getReadKey()) {
          this.removeCredentials();
        }
        throw error;
      }
    })().finally(() => {
      if (this.pendingMe?.promise === pending) this.pendingMe = undefined;
    });
    this.pendingMe = { key: readKey, promise: pending };
    return pending;
  }

  async logout(): Promise<void> {
    if (!this.isRuntimeCurrent()) {
      throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '申请会话已更新');
    }
    const token = this.getToken();
    ++this.generation;
    this.pendingLogin = undefined;
    this.pendingMe = undefined;
    this.removeCredentials();
    if (!token) return;
    try {
      await this.send('/auth/logout', 'POST', token);
    } catch (error) {
      if (error instanceof SessionServiceError && error.statusCode === 401) return;
      throw error;
    }
  }

  private send(
    path: string, method: ApplicantHttpRequestOptions['method'], token: string,
    data?: unknown, strictEnvelope = false,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.request({
        url: `${this.baseUrl}/partner-applicants${path}`, method,
        header: { 'Content-Type': 'application/json', ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        data,
        success: (response) => {
          if (response.statusCode !== 200) {
            const error = record(response.data)
              ? (record(response.data.error) ? response.data.error : response.data)
              : {};
            reject(new SessionServiceError(
              response.statusCode,
              typeof error.code === 'string' ? error.code : 'REQUEST_FAILED',
              typeof error.message === 'string' ? error.message : '申请会话请求失败，请重试',
            ));
          } else if (record(response.data) && 'data' in response.data) {
            if (strictEnvelope && (typeof response.data.requestId !== 'string' ||
                Object.keys(response.data).length !== 2)) {
              reject(new SessionServiceError(502, 'INVALID_RESPONSE', '申请草稿响应格式无效'));
            } else {
              resolve(response.data.data);
            }
          } else {
            reject(new SessionServiceError(502, 'INVALID_RESPONSE', '申请会话响应格式无效'));
          }
        },
        fail: () => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络连接失败，请重试')),
      });
    });
  }

  private assertCurrent(generation: number, token: string) {
    if (!this.isRuntimeCurrent() || generation !== this.generation || this.getToken() !== token) {
      throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '申请会话已更新');
    }
  }

  private assertReadCurrent(key: string) {
    if (key !== this.getReadKey()) {
      throw new SessionServiceError(409, 'READ_SUPERSEDED', '申请读取已更新');
    }
  }

  private runtime(): Record<string, unknown> {
    const value = this.storage.get(LOCAL_RUNTIME_STORAGE_KEY);
    return record(value) ? value : {};
  }

  private removeCredentials() {
    const runtime = { ...this.runtime() };
    delete runtime.partnerApplicantSession;
    this.storage.set(LOCAL_RUNTIME_STORAGE_KEY, runtime);
  }

  private unauthorized() {
    return new SessionServiceError(401, 'UNAUTHORIZED', '请先登录入驻申请');
  }
}
