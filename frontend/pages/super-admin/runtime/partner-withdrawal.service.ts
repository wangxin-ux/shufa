import { createSuperAdminRuntimeEnv } from '../../../config/super-admin-env';
import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';

export interface ManagedSettlementProfile {
  version: number; payerName: string; beneficiaryName: string; accountLabel: string; minimumAmountFen: number; dailyRequestLimit: number;
}
export interface ManagedSettlementSummary {
  simulated: boolean; enabled: boolean; campusId: string; profile: ManagedSettlementProfile | null;
  availableFen: number; reservedFen: number; paidFen: number; unresolvedFen: number;
}
export interface ManagedPartnerWithdrawal {
  id: string; campusId: string; campusName: string; requestNo: string; amountFen: number; status: string; version: number;
  profile: ManagedSettlementProfile; requestedAt: string; reason: string | null; proofFileId: string | null;
  payoutReference: string | null; unresolvedFen: number;
  proofOutcome: 'PAID' | 'UNPAID' | null;
}
export interface SettlementSource { id: string; amountFen: number; version: number; createdAt: string; confirmed: boolean }
export interface ManagedPage<T> { data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const integer = (v: unknown, min = 0) => Number.isSafeInteger(v) && Number(v) >= min;
function invalid(): never { throw new SessionServiceError(502, 'INVALID_RESPONSE', '返回内容待核对，请重试原操作'); }
function failure(statusCode: number) {
  return new SessionServiceError(statusCode, 'PARTNER_SETTLEMENT_FAILED',
    statusCode === 401 || statusCode === 403 ? '当前登录无处理权限，请重新登录'
      : statusCode === 409 ? '额度、资料或状态已变化，请重新读取' : '请求未确认，请核对后重试原操作');
}
function profile(v: unknown): ManagedSettlementProfile {
  if (!object(v) || !integer(v.version, 1) || !integer(v.minimumAmountFen, 1) || !integer(v.dailyRequestLimit, 1) ||
    typeof v.payerName !== 'string' || typeof v.beneficiaryName !== 'string' || typeof v.accountLabel !== 'string' ||
    !/^模拟对公 \*{4}\d{4}$/.test(v.accountLabel)) invalid();
  return { version: Number(v.version), payerName: v.payerName, beneficiaryName: v.beneficiaryName,
    accountLabel: v.accountLabel, minimumAmountFen: Number(v.minimumAmountFen), dailyRequestLimit: Number(v.dailyRequestLimit) };
}
function withdrawal(v: unknown): ManagedPartnerWithdrawal {
  if (!object(v) || !uuid(v.id) || !uuid(v.campusId) || !integer(v.version, 1) || !integer(v.amountFen, 1) ||
    typeof v.campusName !== 'string' || typeof v.requestNo !== 'string' || !v.requestNo.startsWith('SIM-PW-') ||
    typeof v.requestedAt !== 'string' || !Number.isFinite(Date.parse(v.requestedAt)) || v.simulated !== true ||
    !['SUBMITTED', 'APPROVED', 'PAYING', 'RECONCILING', 'PAID', 'CANCELLED', 'REJECTED', 'FAILED', 'INVALIDATED'].includes(String(v.status)) ||
    !(v.proofFileId === null || uuid(v.proofFileId)) || !integer(v.unresolvedFen) ||
    !(v.reason === null || typeof v.reason === 'string') || !(v.payoutReference === null || typeof v.payoutReference === 'string') ||
    ![null, 'PAID', 'UNPAID'].includes(v.proofOutcome as string | null)) invalid();
  return { id: String(v.id), campusId: String(v.campusId), campusName: v.campusName, requestNo: v.requestNo,
    amountFen: Number(v.amountFen), status: String(v.status), version: Number(v.version), profile: profile(v.profile),
    requestedAt: v.requestedAt, reason: v.reason as string | null, proofFileId: v.proofFileId as string | null,
    payoutReference: v.payoutReference as string | null, proofOutcome: v.proofOutcome as 'PAID' | 'UNPAID' | null, unresolvedFen: Number(v.unresolvedFen) };
}
export function parseManagedWithdrawalYuan(value: string): number | null {
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const fen = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(fen) && fen > 0 && fen <= 2147483647 ? fen : null;
}
export class ManagedPartnerWithdrawalClient {
  readonly isMock: boolean;
  constructor(private readonly options: {
    dataDriver: 'api' | 'mock'; baseUrl: string; session: () => { key: string; token: string }; request?: SessionHttpRequest;
  }) { this.isMock = options.dataDriver === 'mock'; }
  getSessionKey() { return this.options.session().key; }
  async campuses(page = 1, query = '') {
    const raw = await this.send(`/management/campuses?page=${page}&pageSize=20&query=${encodeURIComponent(query)}`);
    return this.page(raw, page, v => {
      if (!object(v) || !uuid(v.id) || typeof v.name !== 'string') invalid();
      return { id: String(v.id), name: v.name };
    });
  }
  async summary(campusId: string) {
    const v = (await this.send(`/management/campuses/${campusId}/partner-settlement`)).data;
    if (!object(v) || v.campusId !== campusId || v.simulated !== true || v.enabled !== true ||
      !['availableFen', 'reservedFen', 'paidFen', 'unresolvedFen'].every(k => integer(v[k]))) invalid();
    return { simulated: true, enabled: true, campusId, profile: v.profile === null ? null : profile(v.profile),
      availableFen: Number(v.availableFen), reservedFen: Number(v.reservedFen), paidFen: Number(v.paidFen), unresolvedFen: Number(v.unresolvedFen) };
  }
  async sources(campusId: string, page = 1) {
    return this.page(await this.send(`/management/campuses/${campusId}/partner-settlement/sources?page=${page}&pageSize=20`), page, v => {
      if (!object(v) || !uuid(v.id) || !integer(v.version, 1) || !integer(v.amountFen, 1) || typeof v.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(v.createdAt)) || typeof v.confirmed !== 'boolean') invalid();
      return { id: String(v.id), amountFen: Number(v.amountFen), version: Number(v.version), createdAt: v.createdAt, confirmed: v.confirmed };
    });
  }
  async list(campusId: string, page = 1) {
    const result = this.page(await this.send(`/management/partner-withdrawals?campusId=${campusId}&page=${page}&pageSize=20`), page, withdrawal);
    if (result.data.some(w => w.campusId !== campusId)) invalid();
    return result;
  }
  async configure(campusId: string, data: object, key: string) {
    const v = (await this.send(`/management/campuses/${campusId}/partner-settlement`, data, key, 'PUT')).data;
    if (!object(v) || v.campusId !== campusId || !v.profile) invalid();
    return v;
  }
  async confirm(campusId: string, earningId: string, data: object, key: string) {
    const v = (await this.send(`/management/campuses/${campusId}/partner-settlement/sources/${earningId}`, data, key)).data;
    if (!object(v) || v.campusId !== campusId) invalid();
    return v;
  }
  async action(id: string, action: string, data: { expectedVersion: number; [key: string]: unknown }, key: string) {
    const w = withdrawal((await this.send(`/management/partner-withdrawals/${id}/${action}`, data, key)).data);
    const states: Record<string, string> = { approve: 'APPROVED', reject: 'REJECTED', 'mark-paying': 'PAYING',
      'mark-unknown': 'RECONCILING', 'mark-paid': 'PAID', 'mark-failed': 'FAILED' };
    if (w.id !== id || w.version !== data.expectedVersion + 1 || (states[action] && w.status !== states[action]) ||
      action === 'mark-paid' && (w.amountFen !== data.amountFen || w.profile.version !== data.accountVersion ||
        w.proofFileId !== data.proofFileId || w.payoutReference !== data.payoutReference) ||
      action === 'mock-proof' && !w.proofFileId) invalid();
    return w;
  }
  private page<T>(raw: Record<string, unknown>, page: number, parse: (v: unknown) => T): ManagedPage<T> {
    if (!Array.isArray(raw.data) || !object(raw.meta) || raw.meta.page !== page || raw.meta.pageSize !== 20 ||
      !integer(raw.meta.total) || raw.meta.totalPages !== Math.ceil(Number(raw.meta.total) / 20) ||
      raw.data.length !== Math.max(0, Math.min(20, Number(raw.meta.total) - (page - 1) * 20))) invalid();
    return { data: raw.data.map(parse), meta: raw.meta as unknown as ManagedPage<T>['meta'] };
  }
  private async send(path: string, data?: unknown, key?: string, method?: 'PUT'): Promise<Record<string, unknown>> {
    if (this.isMock) throw failure(409);
    const session = this.options.session();
    if (!session.key || !session.token) throw failure(401);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (response?: { statusCode: number; data: unknown }) => {
        if (done) return; done = true; clearTimeout(timer);
        if (session.key !== this.getSessionKey()) { reject(failure(401)); return; }
        if (!response || response.statusCode !== 200) { reject(failure(response?.statusCode ?? 0)); return; }
        if (!object(response.data) || typeof response.data.requestId !== 'string' ||
          !Object.prototype.hasOwnProperty.call(response.data, 'data')) { reject(failure(502)); return; }
        resolve(response.data);
      };
      const timer = setTimeout(() => finish(), 15000);
      try { (this.options.request ?? defaultRequest)({ url: this.options.baseUrl + path,
        method: method ?? (data === undefined ? 'GET' : 'POST'), data,
        header: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        success: finish, fail: () => finish() }); } catch { finish(); }
    });
  }
}
export function createManagedPartnerWithdrawalClient() {
  const env = createSuperAdminRuntimeEnv(), baseUrl = env.apiBaseUrl.trim().replace(/\/+$/, '');
  return new ManagedPartnerWithdrawalClient({ dataDriver: env.dataDriver, baseUrl, session: () => {
    const current = createSuperAdminRuntimeEnv(), token = current.accessToken.trim();
    if (current.dataDriver !== env.dataDriver || current.apiBaseUrl.trim().replace(/\/+$/, '') !== baseUrl) return { key: '', token: '' };
    return { token, key: env.dataDriver === 'api' && !token ? '' : JSON.stringify([env.dataDriver, baseUrl, token]) };
  } });
}
