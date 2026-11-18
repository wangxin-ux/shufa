import { createTeacherRuntimeEnv } from '../../../config/teacher-env';
import { createRuntimeAccessTokenProvider, LOCAL_RUNTIME_STORAGE_KEY } from '../../../config/local-runtime';
import {
  defaultLoginCodeProvider, defaultRequest, defaultStorage, resolveRoleBootstrap,
  SessionService, sessionService, SessionServiceError,
} from '../../../services/session.service';
import type { SessionServiceOptions, SessionView } from '../../../services/session.service';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class WechatFormalLoginService {
  private readonly session: SessionService;
  private readonly storage;
  private readonly request;
  private readonly codeProvider;
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly checkOwner: () => void;
  private readonly resetOwner: () => void;
  private readonly owner: () => string;
  private pending?: { current: () => boolean; promise: Promise<SessionView> };
  private restoring?: Promise<SessionView | null>;

  constructor(options: SessionServiceOptions & { session?: SessionService; current?: () => boolean }) {
    const storage = options.storage ?? defaultStorage;
    const owner = () => {
      const runtime = storage.get(LOCAL_RUNTIME_STORAGE_KEY);
      return JSON.stringify([
        record(runtime) ? runtime.accessToken : undefined,
        storage.get('education.session.logged-out'), storage.get('education.test-account.current'),
      ]);
    };
    this.owner = owner;
    let expectedOwner = owner();
    this.resetOwner = () => {
      if (options.current?.() === false) throw new Error('登录状态已更新，请重新登录');
      expectedOwner = owner();
    };
    this.checkOwner = () => {
      if (options.current?.() === false || expectedOwner !== owner()) {
        throw new Error('登录状态已更新，请重新登录');
      }
    };
    this.storage = {
      get: (key: string) => { this.checkOwner(); return storage.get(key); },
      set: (key: string, value: unknown) => {
        this.checkOwner();
        storage.set(key, value);
        expectedOwner = owner();
      },
    };
    const request = options.request ?? defaultRequest;
    this.request = (input: Parameters<typeof request>[0]) => {
      this.checkOwner();
      const requestOwner = owner();
      return request({
        ...input,
        success: (response) => {
          try {
            this.checkOwner();
            if (requestOwner !== owner()) throw new Error('登录状态已更新，请重新登录');
            input.success(response);
          }
          catch (error) { input.fail(error); }
        },
      });
    };
    const codeProvider = options.loginCodeProvider ?? defaultLoginCodeProvider;
    this.codeProvider = async () => {
      this.checkOwner();
      const code = await codeProvider();
      this.checkOwner();
      return code;
    };
    // Share cancellation while retaining this runtime's connection settings.
    this.session = new SessionService({
      ...options, storage: this.storage, request: this.request, loginCodeProvider: this.codeProvider,
    }, options.session);
    this.baseUrl = (options.apiBaseUrl ?? '').trim().replace(/\/+$/, '');
    this.enabled = options.dataDriver === 'api' && !options.testAccountSwitcherEnabled;
  }

  async load() {
    this.checkOwner();
    if (!this.restoring) {
      const pending = this.session.load().finally(() => {
        if (this.restoring === pending) this.restoring = undefined;
      });
      this.restoring = pending;
    }
    return this.restoring;
  }

  isCurrent() {
    try { this.checkOwner(); return true; } catch { return false; }
  }

  loginWithWechat(): Promise<SessionView> {
    if (!this.enabled) return Promise.reject(new Error('当前环境不支持正式微信登录'));
    if (this.pending?.current()) return this.pending.promise;
    try { this.resetOwner(); } catch (error) { return Promise.reject(error); }
    const loginOwner = this.owner();
    const revisionCurrent = this.session.beginExplicitLogin();
    this.restoring = undefined;
    const current = () => {
      try { this.checkOwner(); return revisionCurrent() && loginOwner === this.owner(); } catch { return false; }
    };
    const check = () => { if (!current()) throw new Error('登录状态已更新，请重新登录'); };
    const pending = Promise.resolve().then(() => {
      check();
      if (!this.baseUrl) throw new Error('API 地址不能为空');
      return this.codeProvider();
    }).then((code) => {
      check();
      if (typeof code !== 'string' || !code.trim()) throw new Error('未获取到微信登录凭证');
      return new Promise<SessionView>((resolve, reject) => {
        this.request({
          url: `${this.baseUrl}/auth/wechat/login`, method: 'POST',
          header: { 'Content-Type': 'application/json' }, data: { code: code.trim() },
          success: (response) => {
            try {
              check();
              const body = response.data;
              if (response.statusCode < 200 || response.statusCode >= 300) {
                const errorCode = record(body) && typeof body.code === 'string' ? body.code : 'UNKNOWN_ERROR';
                throw new SessionServiceError(response.statusCode, errorCode,
                  errorCode === 'STAFF_PHONE_BINDING_REQUIRED'
                    ? '请返回登录页授权微信手机号完成账号绑定'
                    : response.statusCode >= 500 ? '服务器处理失败，请稍后重试' : '微信登录失败，请重试');
              }
              const data = record(body) && record(body.data) ? body.data : undefined;
              const identity = data?.me;
              if (!data || typeof data.accessToken !== 'string' || !data.accessToken.trim() ||
                  !record(identity) || typeof identity.userId !== 'string' || !identity.userId.trim() ||
                  typeof identity.displayName !== 'string' || !Array.isArray(identity.roles) ||
                  !identity.roles.every(record)) throw new Error('登录响应格式无效');
              const me = identity as unknown as SessionView;
              if (resolveRoleBootstrap(me).kind !== 'navigate') throw new Error('当前账号未分配可用的客户端权限');
              const previous = this.storage.get(LOCAL_RUNTIME_STORAGE_KEY);
              this.storage.set(LOCAL_RUNTIME_STORAGE_KEY, { ...(record(previous) ? previous : {}), accessToken: data.accessToken });
              this.storage.set('education.session.logged-out', false);
              this.storage.set('education.test-account.current', '');
              resolve(me);
            } catch (error) { reject(error); }
          },
          fail: () => {
            try { check(); reject(new Error('微信登录网络请求失败，请重试')); }
            catch (error) { reject(error); }
          },
        });
      });
    }).finally(() => {
      if (this.pending?.promise === pending) this.pending = undefined;
    });
    this.pending = { current, promise: pending };
    return pending;
  }
}

export function getWechatFormalLoginRuntime() {
  const env = createTeacherRuntimeEnv();
  const context = () => {
    const latest = createTeacherRuntimeEnv();
    return latest.dataDriver === env.dataDriver && latest.apiBaseUrl === env.apiBaseUrl &&
      latest.enableTestAccountSwitcher === env.enableTestAccountSwitcher;
  };
  return new WechatFormalLoginService({
    ...env, testAccountSwitcherEnabled: env.enableTestAccountSwitcher,
    accessToken: createRuntimeAccessTokenProvider(env.accessToken),
    session: sessionService, current: context,
  });
}
