import { createSuperAdminRuntimeEnv } from '../../../config/super-admin-env';
import { getStaffAccountRuntime, type StaffAccountPort } from './staff-account-runtime';
import type { RequestState } from '../../../utils/request-state';
import type { SuperAdminStaffAccount } from '../../../types/super-admin';
import { HeadquartersManagementService } from './headquarters-management.service';
import { ManagementError, pageRows, record, responseInvalid, uuid, type ManagementRequest } from './headquarters-management.types';
import { createHeadquartersManagementMock } from './headquarters-management.mock';

function stored(key: string): unknown { try { return wx.getStorageSync(key); } catch { return undefined; } }
function snapshot() {
  const value = createSuperAdminRuntimeEnv(), local = stored('education.runtime'), account = stored('education.test-account.current');
  const env = { ...value, apiBaseUrl: value.apiBaseUrl.trim().replace(/\/+$/, ''), accessToken: value.accessToken.trim() };
  const loggedOut = stored('education.session.logged-out') === true;
  const mockAllowed = record(local) && local.enableTestAccountSwitcher === true &&
    (account ?? local.mockWechatAccount) === 'SUPER_ADMIN';
  return { env, loggedOut, mockAllowed, key: JSON.stringify([env, loggedOut, mockAllowed, account,
    record(local) ? local.mockWechatAccount : undefined]) };
}
export const managementSessionKey = () => snapshot().key;
const owners = new Set<HeadquartersManagementContext>();
const messages: Record<string, string> = {
  STAFF_PHONE_ALREADY_EXISTS: '该手机号已创建工作人员账号', IDEMPOTENCY_CONFLICT: '原操作内容不一致，请先核对',
  CONFLICT: '授权已更新，请核对最新状态', STAFF_ACCOUNT_UNAVAILABLE: '总部账号不存在或当前不可用',
  RESOURCE_NOT_FOUND: '校区不存在或当前不可用', VALIDATION_FAILED: '请核对输入内容',
};
export class HeadquartersManagementContext {
  private readonly owner = snapshot();
  private readonly mock = createHeadquartersManagementMock();
  private cycle = 0; private hidden = false; private disposed = false; private invalid = false; private identity = '';
  private monitor?: ReturnType<typeof setInterval>;
  readonly staff: StaffAccountPort;
  readonly service: HeadquartersManagementService;
  constructor(private readonly clear: (message: string) => void) {
    const wrap = async <T>(operation: () => Promise<RequestState<T>>): Promise<RequestState<T>> => {
      try {
        const cycle = this.cycle; await this.authorize(cycle); this.active(cycle);
        const result = await operation();
        if (cycle === this.cycle && this.sameOwner() && result.status === 'error' &&
          [401, 403].includes(Number(result.statusCode))) throw this.denied(Number(result.statusCode));
        this.active(cycle); return result;
      } catch (error) {
        const failure = error instanceof ManagementError ? error : new ManagementError(0, 'MANAGEMENT_NETWORK_FAILED');
        return { status: 'error', message: failure.message, statusCode: failure.statusCode };
      }
    };
    this.staff = {
      loadCampuses: query => wrap(() => getStaffAccountRuntime().loadCampuses(query)),
      loadStaffAccounts: query => wrap(async () => {
        if (this.owner.env.dataDriver !== 'mock') return getStaffAccountRuntime().loadStaffAccounts(query);
        const rows: SuperAdminStaffAccount[] = [];
        let total: number | undefined;
        const ids = new Set<string>();
        for (let page = 1;; page++) {
          const existing = await getStaffAccountRuntime().loadStaffAccounts({ ...query, page, pageSize: 100 });
          if (existing.status !== 'success' && existing.status !== 'empty') return existing;
          const current = pageRows(existing.data, page, 100);
          if (total !== undefined && current.total !== total) responseInvalid();
          total = current.total;
          for (const row of existing.data.data) {
            if (ids.has(row.id)) responseInvalid();
            ids.add(row.id); rows.push(row);
          }
          if (rows.length === total) break;
        }
        rows.push(...this.mock.matchingAccounts(query.query).filter(row =>
          (!query.roleCode || row.roleCode === query.roleCode) &&
          (!query.status || row.status === query.status) && (!query.campusId || row.campusId === query.campusId)).map(row => ({
          ...this.mock.view(row),
        })));
        return { status: rows.length ? 'success' : 'empty', data: {
          data: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          meta: { page: query.page, pageSize: query.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / query.pageSize) },
        } };
      }),
      createStaffAccount: (input, key) => wrap(() => getStaffAccountRuntime().createStaffAccount(input, key)),
      updateStaffAccountStatus: (id, input, key) => wrap(() => this.owner.env.dataDriver === 'mock' &&
        this.mock.accounts.some(row => row.id === id) ? this.mock.status(id, input, key)
          : getStaffAccountRuntime().updateStaffAccountStatus(id, input, key)),
      unbindStaffWechat: (id, input, key) => wrap(() => this.owner.env.dataDriver === 'mock' &&
        this.mock.accounts.some(row => row.id === id) ? this.mock.unbind(id, input, key)
          : getStaffAccountRuntime().unbindStaffWechat(id, input, key)),
    };
    this.service = new HeadquartersManagementService((...args) => this.send(...args), this.staff);
    owners.add(this); this.watch();
  }
  sameOwner() { return !this.owner.loggedOut && managementSessionKey() === this.owner.key; }
  current() {
    if (this.disposed || this.invalid) return false;
    if (!this.sameOwner()) { this.invalidate('登录已更新，请重新读取账号'); return false; }
    return true;
  }
  isActive() { return !this.hidden && this.current(); }
  private active(cycle: number) {
    if (!this.isActive() || cycle !== this.cycle) throw new ManagementError(0, 'MANAGEMENT_CANCELLED', '操作已中断，请重新核对');
  }
  private invalidate(message: string) {
    if (this.disposed || this.invalid) return;
    this.invalid = true; this.cycle++; this.stop(); this.clear(message);
  }
  private denied(status = 403) {
    for (const owner of owners) if (owner.owner.key === this.owner.key) owner.invalidate('当前账号无总部账号管理权限');
    return new ManagementError(status, 'FORBIDDEN', '当前账号无总部账号管理权限');
  }
  private raw: ManagementRequest = (path, method, data, key) => {
    const cycle = this.cycle; this.active(cycle);
    if (this.owner.env.dataDriver === 'mock') {
      if (!this.owner.mockAllowed) return Promise.reject(this.denied());
      return this.mock.request(path, method, data, key).then(value => { this.active(cycle); return value; });
    }
    if (!this.owner.env.accessToken || !this.owner.env.apiBaseUrl)
      return Promise.reject(new ManagementError(401, 'UNAUTHORIZED', '总端登录或接口配置已失效'));
    return new Promise((resolve, reject) => wx.request({
      url: this.owner.env.apiBaseUrl + path, method, timeout: 15000,
      data: data as WechatMiniprogram.IAnyObject | undefined,
      header: { Authorization: 'Bearer ' + this.owner.env.accessToken, ...(key ? { 'Idempotency-Key': key } : {}) },
      success: response => {
        try {
          if (cycle === this.cycle && this.sameOwner() && [401, 403].includes(response.statusCode)) throw this.denied(response.statusCode);
          this.active(cycle);
          if (response.statusCode < 200 || response.statusCode >= 300) {
            const code = record(response.data) && typeof response.data.code === 'string' ? response.data.code : 'MANAGEMENT_FAILED';
            throw new ManagementError(response.statusCode, code, messages[code] ?? '操作未确认，请重新核对');
          }
          resolve(response.data);
        } catch (error) { reject(error); }
      },
      fail: () => reject(new ManagementError(0, 'MANAGEMENT_NETWORK_FAILED', '网络中断，操作结果待核对')),
    }));
  };
  private async authorize(cycle: number) {
    this.active(cycle);
    const response = await this.raw('/me', 'GET'), me = record(response) ? response.data : undefined;
    const roles = record(me) && Array.isArray(me.roles) ? me.roles : [], role = roles[0];
    if (!record(me) || !uuid(me.userId) || roles.length !== 1 || !record(role) ||
      role.code !== 'SUPER_ADMIN' || role.campusId !== null || this.identity && this.identity !== me.userId) throw this.denied();
    this.active(cycle); this.identity = me.userId;
  }
  private async send(path: string, method: 'GET' | 'POST' | 'PUT', data?: unknown, key?: string) {
    const cycle = this.cycle; this.active(cycle);
    const create = path === '/management/operator-headquarters' && method === 'POST';
    const read = /^\/management\/operator-headquarters\/[0-9a-f-]+\/campuses\?page=\d+&pageSize=100$/.test(path) && method === 'GET';
    const update = /^\/management\/operator-headquarters\/[0-9a-f-]+\/campuses\/[0-9a-f-]+$/.test(path) && method === 'PUT';
    if (!create && !read && !update || method !== 'GET' && !/^[A-Za-z0-9._:-]{8,128}$/.test(key ?? '')) throw this.denied();
    await this.authorize(cycle); this.active(cycle);
    return this.raw(path, method, data, key);
  }
  private watch() { if (!this.monitor) this.monitor = setInterval(() => { this.current(); }, 1000); }
  private stop() { if (this.monitor) clearInterval(this.monitor); this.monitor = undefined; }
  show() { this.hidden = false; if (this.current()) this.watch(); }
  hide() { this.hidden = true; this.cycle++; this.stop(); }
  dispose() { this.hide(); this.disposed = true; owners.delete(this); }
}
