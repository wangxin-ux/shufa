import { createPartnerRuntimeEnv } from '../../../config/partner-env';
import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';

export interface SettlementProfile {
  version: number; payerName: string; beneficiaryName: string; accountLabel: string;
  minimumAmountFen: number; dailyRequestLimit: number;
}
export interface WithdrawalSummary {
  simulated: boolean; enabled: boolean; campusId: string; profile: SettlementProfile | null;
  settledEntitlementFen: number; reservedFen: number; paidFen: number; availableFen: number;
  unresolvedFen: number; requestsToday: number; canApply: boolean; blockReason: string;
}
export interface PartnerWithdrawal {
  id: string; campusId: string; campusName: string; requestNo: string; amountFen: number;
  status: string; version: number; simulated: true; profile: SettlementProfile; requestedAt: string;
  reviewedAt: string | null; payingAt: string | null; paidAt: string | null; reason: string | null;
  payoutReference: string | null; proofFileId: string | null; unresolvedFen: number;
  proofOutcome: 'PAID' | 'UNPAID' | null;
}
export interface WithdrawalPage {
  data: PartnerWithdrawal[]; meta: { page: number; pageSize: number; total: number; totalPages: number };
}
export const WITHDRAWAL_LABELS: Record<string, string> = {
  SUBMITTED: '待审核', APPROVED: '已批准', PAYING: '模拟出款中', RECONCILING: '到账待核对',
  PAID: '模拟已付款', CANCELLED: '已撤回', REJECTED: '已驳回', FAILED: '已确认未付款', INVALIDATED: '来源失效已停止',
};
export const WITHDRAWAL_BLOCK_LABELS: Record<string, string> = {
  SIMULATION_DISABLED: '提现暂未开放', PROFILE_REQUIRED: '结算资料待总端确认',
  RECONCILIATION_REQUIRED: '存在待核对款项，暂停新申请', DAILY_LIMIT: '今日申请次数已用完',
  BELOW_MINIMUM: '可申请额度不足最低金额',
};
export function parseWithdrawalYuan(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const fen = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(fen) && fen > 0 && fen <= 2147483647 ? fen : null;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const integer = (v: unknown, minimum = 0) => Number.isSafeInteger(v) && Number(v) >= minimum;
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
function invalid(): never { throw new SessionServiceError(502, 'INVALID_RESPONSE', '提现数据待核对，请重试原操作'); }
function failure(statusCode: number) {
  return new SessionServiceError(statusCode, 'WITHDRAWAL_REQUEST_FAILED',
    statusCode === 401 || statusCode === 403 ? '当前登录无权办理，请重新登录'
      : statusCode === 409 ? '额度、资料或状态已变化，请重新读取'
        : statusCode === 400 ? '填写内容不符合要求，请核对' : '请求结果未确认，请重试原操作');
}
function parseProfile(v: unknown): SettlementProfile {
  if (!object(v) || !integer(v.version, 1) || !integer(v.minimumAmountFen, 1) || !integer(v.dailyRequestLimit, 1) ||
    typeof v.payerName !== 'string' || typeof v.beneficiaryName !== 'string' ||
    typeof v.accountLabel !== 'string' || !/^模拟对公 \*{4}\d{4}$/.test(v.accountLabel)) invalid();
  return { version: Number(v.version), payerName: v.payerName, beneficiaryName: v.beneficiaryName,
    accountLabel: v.accountLabel, minimumAmountFen: Number(v.minimumAmountFen), dailyRequestLimit: Number(v.dailyRequestLimit) };
}
function parseSummary(v: unknown): WithdrawalSummary {
  if (!object(v) || !uuid(v.campusId) || typeof v.enabled !== 'boolean' || typeof v.simulated !== 'boolean' ||
    typeof v.canApply !== 'boolean' || typeof v.blockReason !== 'string' ||
    !['settledEntitlementFen', 'reservedFen', 'paidFen', 'availableFen', 'unresolvedFen', 'requestsToday'].every(k => integer(v[k])) ||
    !['', ...Object.keys(WITHDRAWAL_BLOCK_LABELS)].includes(v.blockReason) ||
    v.canApply !== (v.enabled && !v.blockReason) || v.enabled && !v.simulated) invalid();
  return { simulated: v.simulated, enabled: v.enabled, campusId: String(v.campusId),
    profile: v.profile === null ? null : parseProfile(v.profile), settledEntitlementFen: Number(v.settledEntitlementFen),
    reservedFen: Number(v.reservedFen), paidFen: Number(v.paidFen), availableFen: Number(v.availableFen),
    unresolvedFen: Number(v.unresolvedFen), requestsToday: Number(v.requestsToday), canApply: v.canApply, blockReason: v.blockReason };
}
export function parsePartnerWithdrawal(v: unknown): PartnerWithdrawal {
  if (!object(v) || !uuid(v.id) || !uuid(v.campusId) || !integer(v.amountFen, 1) || Number(v.amountFen) > 2147483647 ||
    !integer(v.version, 1) || v.simulated !== true || !Object.prototype.hasOwnProperty.call(WITHDRAWAL_LABELS, String(v.status)) ||
    typeof v.campusName !== 'string' || typeof v.requestNo !== 'string' || !v.requestNo.startsWith('SIM-PW-') ||
    typeof v.requestedAt !== 'string' || !Number.isFinite(Date.parse(v.requestedAt)) || !integer(v.unresolvedFen) ||
    !['reviewedAt', 'payingAt', 'paidAt'].every(k => v[k] === null || typeof v[k] === 'string' && Number.isFinite(Date.parse(v[k] as string))) ||
    !(v.proofFileId === null || uuid(v.proofFileId)) || !(v.reason === null || typeof v.reason === 'string') ||
    !(v.payoutReference === null || typeof v.payoutReference === 'string') ||
    ![null, 'PAID', 'UNPAID'].includes(v.proofOutcome as string | null)) invalid();
  return { id: String(v.id), campusId: String(v.campusId), campusName: v.campusName, requestNo: v.requestNo,
    amountFen: Number(v.amountFen), status: String(v.status), version: Number(v.version), simulated: true,
    profile: parseProfile(v.profile), requestedAt: v.requestedAt, reviewedAt: v.reviewedAt as string | null,
    payingAt: v.payingAt as string | null, paidAt: v.paidAt as string | null, reason: v.reason as string | null,
    payoutReference: v.payoutReference as string | null, proofFileId: v.proofFileId as string | null,
    proofOutcome: v.proofOutcome as 'PAID' | 'UNPAID' | null, unresolvedFen: Number(v.unresolvedFen) };
}
export class PartnerWithdrawalClient {
  constructor(private readonly options: {
    dataDriver: 'mock' | 'api'; apiBaseUrl?: string; accessToken: () => string; isCurrent?: () => boolean;
    request?: SessionHttpRequest; download?: (input: WechatMiniprogram.DownloadFileOption) => unknown;
  }) {}
  getSessionKey() {
    if (this.options.isCurrent && !this.options.isCurrent()) return '';
    const token = this.options.accessToken().trim();
    return this.options.dataDriver === 'api' && !token ? '' : JSON.stringify([this.options.dataDriver, this.options.apiBaseUrl ?? '', token]);
  }
  async summary(): Promise<WithdrawalSummary> {
    if (this.options.dataDriver === 'mock') return { simulated: false, enabled: false,
      campusId: '00000000-0000-4000-8000-000000000001', profile: null, settledEntitlementFen: 0,
      reservedFen: 0, paidFen: 0, availableFen: 0, unresolvedFen: 0, requestsToday: 0, canApply: false, blockReason: 'SIMULATION_DISABLED' };
    return parseSummary((await this.send('/partners/me/withdrawal-summary')).data);
  }
  async list(page = 1): Promise<WithdrawalPage> {
    if (this.options.dataDriver === 'mock') return { data: [], meta: { page, pageSize: 20, total: 0, totalPages: 0 } };
    const response = await this.send(`/partners/me/withdrawals?page=${page}&pageSize=20`);
    if (!Array.isArray(response.data) || !object(response.meta) || response.meta.page !== page ||
      response.meta.pageSize !== 20 || !integer(response.meta.total) || response.meta.totalPages !== Math.ceil(Number(response.meta.total) / 20) ||
      response.data.length !== Math.max(0, Math.min(20, Number(response.meta.total) - (page - 1) * 20))) invalid();
    return { data: response.data.map(parsePartnerWithdrawal), meta: response.meta as unknown as WithdrawalPage['meta'] };
  }
  async create(body: { amountFen: number; expectedProfileVersion: number }, key: string) {
    const w = parsePartnerWithdrawal((await this.send('/partners/me/withdrawals', body, key)).data);
    if (w.amountFen !== body.amountFen || w.profile.version !== body.expectedProfileVersion || w.status !== 'SUBMITTED') invalid();
    return w;
  }
  async cancel(id: string, version: number, key: string) {
    const w = parsePartnerWithdrawal((await this.send(`/partners/me/withdrawals/${id}/cancel`, { expectedVersion: version }, key)).data);
    if (w.id !== id || w.version !== version + 1 || w.status !== 'CANCELLED') invalid();
    return w;
  }
  async proof(id: string): Promise<string> {
    const owner = this.getSessionKey();
    if (!owner || !uuid(id) || this.options.dataDriver !== 'api') throw failure(403);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (response?: { statusCode: number; tempFilePath: string }) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (owner !== this.getSessionKey()) reject(failure(401));
        else if (!response || response.statusCode !== 200 || !response.tempFilePath) reject(failure(response?.statusCode ?? 0));
        else resolve(response.tempFilePath);
      };
      const timer = setTimeout(() => finish(), 15000);
      try { (this.options.download ?? (o => wx.downloadFile(o)))({
        url: `${this.options.apiBaseUrl}/partners/me/withdrawals/${id}/proof`,
        header: { Authorization: `Bearer ${this.options.accessToken()}` }, timeout: 15000,
        success: finish, fail: () => finish(),
      }); } catch { finish(); }
    });
  }
  private async send(path: string, data?: unknown, key?: string): Promise<Record<string, unknown>> {
    if (this.options.dataDriver !== 'api') throw failure(409);
    const owner = this.getSessionKey(), base = this.options.apiBaseUrl?.replace(/\/+$/, '');
    if (!owner) throw failure(401);
    if (!base || !/^https?:\/\//.test(base)) throw failure(503);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (response?: { statusCode: number; data: unknown }) => {
        if (settled) return; settled = true; clearTimeout(timer);
        if (owner !== this.getSessionKey()) { reject(failure(401)); return; }
        if (!response || response.statusCode !== 200) { reject(failure(response?.statusCode ?? 0)); return; }
        if (!object(response.data) || !Object.prototype.hasOwnProperty.call(response.data, 'data') ||
          typeof response.data.requestId !== 'string') { reject(new SessionServiceError(502, 'INVALID_RESPONSE', '返回结果待核对，请重试原操作')); return; }
        resolve(response.data);
      };
      const timer = setTimeout(() => finish(), 15000);
      try { (this.options.request ?? defaultRequest)({ url: base + path, method: data === undefined ? 'GET' : 'POST', data,
        header: { Authorization: `Bearer ${this.options.accessToken()}`, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        success: finish, fail: () => finish() }); } catch { finish(); }
    });
  }
}
export function createPartnerWithdrawalClient() {
  const env = createPartnerRuntimeEnv(), base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  return new PartnerWithdrawalClient({ dataDriver: env.dataDriver, apiBaseUrl: base,
    accessToken: () => createPartnerRuntimeEnv().accessToken,
    isCurrent: () => { const current = createPartnerRuntimeEnv(); return current.dataDriver === env.dataDriver && current.apiBaseUrl.trim().replace(/\/+$/, '') === base; } });
}
