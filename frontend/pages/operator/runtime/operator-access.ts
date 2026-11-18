import type { OperatorHttpRequest, OperatorHttpRequestOptions, OperatorHttpResponse } from './data/api-operator-data-source';
import { OperatorDataSourceError } from './data/operator-data-source';
import type { RosterNativeApi } from '../../../services/roster-file-transfer';

interface Options {
  apiBaseUrl: string;
  accessToken: string;
  isCurrent(): boolean;
  canSend?(): boolean;
  forbidden(message: string): void;
  request?: OperatorHttpRequest;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const defaultRequest: OperatorHttpRequest = (options) => wx.request(options as WechatMiniprogram.RequestOption);

export class OperatorAccess {
  private readonly baseUrl: string;
  private readonly transport: OperatorHttpRequest;
  private scope?: { userId: string; campusId: string };
  private checking?: Promise<void>;
  private rejected?: OperatorDataSourceError;

  constructor(private readonly options: Options) {
    this.baseUrl = options.apiBaseUrl.trim().replace(/\/+$/, '');
    this.transport = options.request ?? defaultRequest;
  }

  private deny(statusCode: number, message: string): OperatorDataSourceError {
    if (!this.rejected) {
      this.rejected = new OperatorDataSourceError(statusCode, 'OPERATOR_ACCESS_DENIED', message);
      this.options.forbidden(message);
    }
    return this.rejected;
  }

  private current(): void {
    if (this.rejected) throw this.rejected;
    if (!this.options.isCurrent()) throw this.deny(401, '登录已更新，请重新登录');
  }

  private active(): void {
    this.current();
    if (this.options.canSend && !this.options.canSend()) {
      throw new OperatorDataSourceError(0, 'OPERATOR_REQUEST_CANCELLED', '操作已中断，请重试');
    }
  }

  authorize(): Promise<void> {
    try {
      this.active();
      if (!this.options.accessToken.trim()) throw this.deny(401, '请先登录校区运营账号');
      if (!this.baseUrl) throw new OperatorDataSourceError(0, 'OPERATOR_API_UNAVAILABLE', '运营接口尚未配置');
    } catch (error) { return Promise.reject(error); }
    if (this.checking) return this.checking;
    const check = new Promise<void>((resolve, reject) => {
      this.transport({
        url: `${this.baseUrl}/me`, method: 'GET',
        header: { Authorization: `Bearer ${this.options.accessToken}` },
        success: (response) => {
          try {
            this.current();
            if (response.statusCode === 401 || response.statusCode === 403) {
              throw this.deny(response.statusCode, '当前登录无校区运营访问权限');
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
              throw new OperatorDataSourceError(response.statusCode, 'OPERATOR_SESSION_UNAVAILABLE', '身份校验失败，请重试');
            }
            const me = record(response.data) ? response.data.data : undefined;
            const roles = record(me) && Array.isArray(me.roles) ? me.roles : [];
            const role = roles[0];
            if (!record(me) || typeof me.userId !== 'string' || !me.userId.trim() ||
                roles.length !== 1 || !record(role) || role.code !== 'OPERATOR' ||
                typeof role.campusId !== 'string' || !role.campusId.trim()) {
              throw this.deny(403, '请使用绑定单一校区的运营账号');
            }
            const scope = { userId: me.userId, campusId: role.campusId };
            if (this.scope && (this.scope.userId !== scope.userId || this.scope.campusId !== scope.campusId)) {
              throw this.deny(403, '校区权限已更新，请重新登录');
            }
            this.scope = scope;
            this.active();
            resolve();
          } catch (error) { reject(error); }
        },
        fail: () => reject(new OperatorDataSourceError(0, 'OPERATOR_SESSION_UNAVAILABLE', '身份校验失败，请重试')),
      });
    });
    this.checking = check;
    void check.then(
      () => { if (this.checking === check) this.checking = undefined; },
      () => { if (this.checking === check) this.checking = undefined; },
    );
    return check;
  }

  readonly request: OperatorHttpRequest = (options) => {
    void this.authorize().then(() => {
      this.active();
      if (!options.url.startsWith(`${this.baseUrl}/operators/me/`)) {
        throw this.deny(403, '运营请求地址不可用');
      }
      this.transport({
        ...options,
        header: { ...options.header, Authorization: `Bearer ${this.options.accessToken}` },
        success: (response) => {
          try {
            this.current();
            if (response.statusCode === 401 || response.statusCode === 403) {
              throw this.deny(response.statusCode, '当前登录无校区运营访问权限');
            }
            if (options.url === `${this.baseUrl}/operators/me/profile` && response.statusCode === 200) {
              const profile = record(response.data) ? response.data.data : undefined;
              if (!record(profile) || profile.roleCode !== 'OPERATOR' || typeof profile.campusId !== 'string' ||
                  profile.campusId !== this.scope?.campusId) {
                throw this.deny(403, '运营身份与校区不一致，请重新登录');
              }
            }
            options.success(response);
          } catch (error) { this.rejectRequest(options, error); }
        },
        fail: () => options.fail(new Error('网络请求失败，请稍后重试')),
      });
    }).catch((error) => this.rejectRequest(options, error));
  };

  private rejectRequest(options: OperatorHttpRequestOptions, error: unknown): void {
    const failure = error instanceof OperatorDataSourceError ? error
      : new OperatorDataSourceError(0, 'OPERATOR_REQUEST_FAILED', '操作失败，请稍后重试');
    options.success({ statusCode: failure.statusCode, data: { code: failure.code, message: failure.message } });
  }

  rosterNative(isLive: () => boolean = () => true): RosterNativeApi {
    const guard = (send: (options: any) => unknown) => (options: any) => {
      if (!isLive()) return options.fail?.(new Error('名册操作已中断'));
      void this.authorize().then(() => {
        this.active();
        if (!isLive()) throw new Error('名册操作已中断');
        if (options.url && !options.url.startsWith(`${this.baseUrl}/operators/me/rosters/`)) {
          throw this.deny(403, '运营名册地址不可用');
        }
        send({
          ...options,
          ...(options.url ? { header: { ...options.header, Authorization: `Bearer ${this.options.accessToken}` } } : {}),
          success: (response: OperatorHttpResponse) => {
            try {
              this.current();
              if (response.statusCode === 401 || response.statusCode === 403) {
                throw this.deny(response.statusCode, '当前账号无运营名册访问权限');
              }
              this.active();
              if (!isLive()) throw new Error('名册操作已中断');
              options.success?.(response);
            } catch (error) { options.fail?.(error); }
          },
          fail: () => options.fail?.(new Error('名册操作失败，请重试')),
        });
      }).catch((error) => options.fail?.(error));
    };
    return {
      request: guard((options) => wx.request(options)),
      uploadFile: guard((options) => wx.uploadFile(options)),
      downloadFile: guard((options) => wx.downloadFile(options)),
      chooseMessageFile: guard((options) => wx.chooseMessageFile(options)),
      openDocument: guard((options) => wx.openDocument(options)),
      getFileSystemManager: () => ({ writeFile: guard((options) => wx.getFileSystemManager().writeFile(options)) }),
      userDataPath: typeof wx === 'undefined' ? '' : wx.env.USER_DATA_PATH,
    };
  }
}
