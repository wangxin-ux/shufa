import { LOCAL_RUNTIME_STORAGE_KEY } from '../../../config/local-runtime';
import {
  defaultRequest, defaultStorage, SessionServiceError,
  type SessionHttpRequest, type SessionStorage,
} from '../../../services/session.service';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class PartnerFormalArchiveSession {
  private readonly storage: SessionStorage;
  private readonly request: SessionHttpRequest;
  private readonly baseUrl: string;
  private readRevision = 0;
  private pendingMe?: { key: string; promise: Promise<{ displayName: string; formalAccountReady: true }> };

  constructor(options: { apiBaseUrl: string; storage?: SessionStorage; request?: SessionHttpRequest }) {
    this.baseUrl = options.apiBaseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^/\s]+/i.test(this.baseUrl)) throw new Error('入驻档案接口地址未配置');
    this.storage = options.storage ?? defaultStorage;
    this.request = options.request ?? defaultRequest;
  }

  getSessionKey(): string {
    if (this.storage.get('education.session.logged-out') === true) return '';
    const runtime = this.storage.get(LOCAL_RUNTIME_STORAGE_KEY);
    if (!record(runtime) || runtime.dataDriver !== 'api' ||
        typeof runtime.apiBaseUrl !== 'string' ||
        runtime.apiBaseUrl.trim().replace(/\/+$/, '') !== this.baseUrl) return '';
    const token = typeof runtime.accessToken === 'string'
      ? runtime.accessToken.trim() : '';
    return token ? `formal:${token}` : '';
  }

  getReadKey(): string {
    const key = this.getSessionKey();
    return key ? `${key}:${this.readRevision}` : '';
  }

  invalidateReads(): void {
    this.readRevision += 1;
    this.pendingMe = undefined;
  }

  loadMe(options: { fresh?: boolean } = {}): Promise<{ displayName: string; formalAccountReady: true }> {
    const key = this.getReadKey();
    if (!options.fresh && this.pendingMe?.key === key) return this.pendingMe.promise;
    const promise = this.read('/partners/me/profile').then((value) => {
      if (!record(value) || value.roleCode !== 'PARTNER' ||
          typeof value.displayName !== 'string' || value.displayName.length > 100 ||
          !record(value.campus) || typeof value.campus.id !== 'string' || !value.campus.id) {
        throw new SessionServiceError(502, 'INVALID_RESPONSE', '正式合作方身份响应无效');
      }
      return { displayName: value.displayName, formalAccountReady: true as const };
    }).finally(() => {
      if (this.pendingMe?.promise === promise) this.pendingMe = undefined;
    });
    this.pendingMe = { key, promise };
    return promise;
  }

  requestApplication(method: 'GET' | 'PUT'): Promise<unknown> {
    if (method !== 'GET') return Promise.reject(this.readonlyError());
    return this.read('/partners/me/application');
  }

  login(): Promise<never> { return Promise.reject(this.readonlyError()); }
  logout(): Promise<never> { return Promise.reject(this.readonlyError()); }

  private readonlyError() {
    return new SessionServiceError(403, 'FORBIDDEN', '正式账号的入驻档案仅可查看');
  }

  private read(path: string): Promise<unknown> {
    const sessionKey = this.getSessionKey();
    const readKey = this.getReadKey();
    if (!sessionKey) return Promise.reject(
      new SessionServiceError(401, 'UNAUTHORIZED', '正式登录已失效，请返回重新登录'),
    );
    const check = () => {
      if (sessionKey !== this.getSessionKey() || readKey !== this.getReadKey()) {
        throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '正式会话或读取已更新');
      }
    };
    return new Promise((resolve, reject) => {
      try {
        this.request({
          url: `${this.baseUrl}${path}`, method: 'GET',
          header: { Authorization: `Bearer ${sessionKey.slice('formal:'.length)}` },
          success: (response) => {
            try {
              check();
              if (response.statusCode < 200 || response.statusCode >= 300) {
                const code = record(response.data) && typeof response.data.code === 'string'
                  ? response.data.code : 'UNKNOWN_ERROR';
                throw new SessionServiceError(response.statusCode, code,
                  response.statusCode === 401 ? '正式登录已失效，请返回重新登录'
                    : response.statusCode === 403 ? '当前账号无权查看入驻档案'
                    : '入驻档案读取失败，请重试');
              }
              if (!record(response.data) || !Object.prototype.hasOwnProperty.call(response.data, 'data')) {
                throw new SessionServiceError(502, 'INVALID_RESPONSE', '入驻档案响应无效');
              }
              resolve(response.data.data);
            } catch (error) { reject(error); }
          },
          fail: () => {
            try { check(); reject(new Error('入驻档案网络请求失败，请重试')); }
            catch (error) { reject(error); }
          },
        });
      } catch (error) { reject(error); }
    });
  }
}
