import { createOperatorRuntimeEnv } from '../runtime/config/operator-env';
import type { OperatorHttpRequest } from '../runtime/data/api-operator-data-source';
import { HeadquartersError, record, validUuid } from './codec';
import { HeadquartersService } from './service';
import { createHeadquartersMock } from './mock';

function stored(key: string): unknown {
  try { return wx.getStorageSync(key); } catch { return undefined; }
}
function snapshot() {
  const raw = createOperatorRuntimeEnv();
  const env = { ...raw, apiBaseUrl: raw.apiBaseUrl.trim().replace(/\/+$/, ''), accessToken: raw.accessToken.trim() };
  const local = stored('education.runtime');
  const account = stored('education.test-account.current');
  // This local-only alias needs coordinator bootstrap wiring; it is not a role.
  const mockAllowed = record(local) && local.enableTestAccountSwitcher === true &&
    (account ?? local.mockWechatAccount) === 'OPERATOR_HEADQUARTERS';
  const loggedOut = stored('education.session.logged-out') === true;
  return { env, mockAllowed, loggedOut, key: JSON.stringify([
    env, loggedOut, mockAllowed, account, record(local) ? local.mockWechatAccount : undefined,
  ]) };
}
const owners = new Set<HeadquartersContext>();
const defaultRequest: OperatorHttpRequest = options => wx.request(options as WechatMiniprogram.RequestOption);

export class HeadquartersContext {
  readonly service: HeadquartersService;
  private readonly owner = snapshot();
  private readonly mock = createHeadquartersMock(this.owner.env.mockScenario);
  private readonly transport: OperatorHttpRequest;
  private cycle = 0;
  private hidden = false;
  private disposed = false;
  private invalidated = false;
  private identity?: string;
  private proof?: { cycle: number; promise: Promise<void> };
  private monitor?: ReturnType<typeof setInterval>;

  constructor(private readonly clear: (message: string) => void, request: OperatorHttpRequest = defaultRequest) {
    this.transport = request;
    this.service = new HeadquartersService(path => this.read(path));
    owners.add(this);
    this.watch();
  }
  ownsRuntime(): boolean { return !this.owner.loggedOut && snapshot().key === this.owner.key; }
  navigationGuard(): () => boolean {
    const key = snapshot().key;
    return () => snapshot().key === key;
  }
  isCurrent(): boolean {
    if (this.disposed || this.invalidated) return false;
    if (!this.ownsRuntime()) { this.invalidate('登录已更新，请重新登录'); return false; }
    return true;
  }
  isActive(): boolean { return !this.hidden && this.isCurrent(); }
  private active(cycle: number): void {
    if (!this.isActive() || cycle !== this.cycle) throw new HeadquartersError(0, 'HEADQUARTERS_CANCELLED', '读取已中断，请重试');
  }
  invalidate(message: string): void {
    if (this.disposed || this.invalidated) return;
    this.invalidated = true; this.cycle++; this.proof = undefined; this.stopWatch(); this.clear(message);
  }
  private denied(statusCode = 403): HeadquartersError {
    for (const owner of owners) if (owner.owner.key === this.owner.key) owner.invalidate('当前账号无总部运营读取权限');
    return new HeadquartersError(statusCode, 'HEADQUARTERS_ACCESS_DENIED', '当前账号无总部运营读取权限');
  }
  private raw(path: string, cycle: number): Promise<unknown> {
    this.active(cycle);
    if (this.owner.env.dataDriver === 'mock') {
      if (!this.owner.mockAllowed) return Promise.reject(this.denied());
      return this.mock(path).then(value => { this.active(cycle); return value; }).catch(error => {
        if (this.ownsRuntime() && error instanceof HeadquartersError && [401, 403].includes(error.statusCode))
          throw this.denied(error.statusCode);
        throw error;
      });
    }
    if (!this.owner.env.accessToken) return Promise.reject(this.denied());
    if (!this.owner.env.apiBaseUrl) return Promise.reject(new HeadquartersError(0, 'HEADQUARTERS_API_UNAVAILABLE', '总部接口尚未配置'));
    return new Promise((resolve, reject) => {
      this.transport({
        url: this.owner.env.apiBaseUrl + path, method: 'GET',
        header: { Authorization: `Bearer ${this.owner.env.accessToken}` },
        success: response => {
          try {
            // A disposed request can still revoke its live siblings, never a new owner.
            if (this.ownsRuntime() && [401, 403].includes(response.statusCode)) throw this.denied(response.statusCode);
            if (!this.isCurrent()) throw new HeadquartersError(0, 'HEADQUARTERS_CANCELLED');
            this.active(cycle);
            if (response.statusCode < 200 || response.statusCode >= 300)
              throw new HeadquartersError(response.statusCode, 'HEADQUARTERS_READ_FAILED');
            resolve(response.data);
          } catch (error) { reject(error); }
        },
        fail: () => reject(new HeadquartersError(0, 'HEADQUARTERS_NETWORK_FAILED', '网络读取失败，请重试')),
      });
    });
  }
  private authorize(cycle: number): Promise<void> {
    this.active(cycle);
    if (this.proof?.cycle === cycle) return this.proof.promise;
    const promise = this.raw('/me', cycle).then(value => {
      const me = record(value) ? value.data : undefined;
      const roles = record(me) && Array.isArray(me.roles) ? me.roles : [], role = roles[0];
      if (!record(me) || !validUuid(me.userId) || roles.length !== 1 || !record(role) ||
        role.code !== 'OPERATOR' || role.campusId !== null || (this.identity && this.identity !== me.userId))
        throw this.denied();
      this.active(cycle); this.identity = me.userId;
    });
    this.proof = { cycle, promise };
    void promise.finally(() => { if (this.proof?.promise === promise) this.proof = undefined; }).catch(() => undefined);
    return promise;
  }
  private async read(path: string): Promise<unknown> {
    const cycle = this.cycle;
    this.active(cycle);
    if (!/^\/operators\/me\/headquarters\/(?:summary|campuses(?:\?[^#]*|\/[0-9a-f-]+\/summary)?)$/i.test(path))
      throw this.denied();
    await this.authorize(cycle); this.active(cycle);
    return this.raw(path, cycle);
  }
  private watch(): void {
    if (!this.monitor) this.monitor = setInterval(() => { this.isCurrent(); }, 1000);
  }
  private stopWatch(): void { if (this.monitor) clearInterval(this.monitor); this.monitor = undefined; }
  show(): boolean {
    this.hidden = false;
    if (!this.isCurrent()) return false;
    this.watch(); return true;
  }
  hide(): void { this.hidden = true; this.cycle++; this.proof = undefined; this.stopWatch(); }
  dispose(): void { this.hide(); this.disposed = true; owners.delete(this); }
}
