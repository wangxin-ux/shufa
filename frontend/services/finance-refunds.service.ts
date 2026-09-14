import { createTeacherRuntimeEnv } from '../config/teacher-env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';
import type { FinancePage } from './finance.service';

export type RefundRole = 'FINANCE' | 'SUPER_ADMIN';
export const REFUND_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: '待审核', APPROVED: '已批准', REJECTED: '已驳回', WITHDRAWN: '已撤回',
  CANCEL_REQUESTED: '待确认取消', CANCELLED: '已取消', PAYING: '退款办理中', UNCERTAIN: '付款待核实', PAID: '已退款',
};
export const REFUND_ACTION_LABELS: Record<string, string> = {
  SUBMIT: '提交申请', APPROVE: '批准退费', REJECT: '驳回申请', WITHDRAW: '撤回申请',
  START_PAYMENT: '开始办理退款', MARK_UNCERTAIN: '标记待核实', RECORD_PAYMENT: '登记退款结果',
  REQUEST_CANCELLATION: '申请取消退款', CONFIRM_CANCELLATION: '确认未付款并取消', DENY_CANCELLATION: '保留原批准',
};
export interface RefundView {
  id: string; receiptId: string; campusId: string; campusName: string; studentId: string; studentName: string;
  mainUnits: number; giftUnits: number; amountFen: number; referenceAmountFen: number;
  reason: string; status: string; version: number; createdAt: string; requestedByUserId: string;
  payment: null | { amountFen: number; paidAt: string; recordedAt: string; externalReference: string };
  events: Array<{ id: string; action: string; reason: string; actorName: string; createdAt: string }>;
}
export interface RefundQuote {
  receiptId: string; mainUnits: number; giftUnits: number; availableMainUnits: number; availableGiftUnits: number;
  referenceAmountFen: number; suggestedAmountFen: number; maxAmountFen: number;
}
export interface RefundActionInput {
  action: string; expectedVersion: number; reason: string;
  payment?: { amountFen: number; paidAt: string; proofFileId: string; externalReference: string };
}
interface RequestOptions {
  url: string; method: 'GET' | 'POST'; data?: unknown; header: Record<string, string>;
  success(response: { statusCode: number; data: unknown }): void;
  fail(error: unknown): void;
}
type Request = (options: RequestOptions) => unknown;
const payActions = ['START_PAYMENT', 'MARK_UNCERTAIN', 'RECORD_PAYMENT'];

export function refundActions(role: RefundRole, status: string) {
  const actions = role === 'SUPER_ADMIN'
    ? ({ SUBMITTED: ['APPROVE', 'REJECT'], CANCEL_REQUESTED: ['CONFIRM_CANCELLATION', 'DENY_CANCELLATION'] } as Record<string, string[]>)
    : ({ SUBMITTED: ['WITHDRAW'], APPROVED: ['START_PAYMENT', 'REQUEST_CANCELLATION'],
      PAYING: ['RECORD_PAYMENT', 'MARK_UNCERTAIN'], UNCERTAIN: ['RECORD_PAYMENT'] } as Record<string, string[]>);
  return (actions[status] ?? []).map((code) => ({ code, name: REFUND_ACTION_LABELS[code] }));
}

export function refundActionGroups(role: RefundRole, status: string) {
  const actions = refundActions(role, status);
  const secondary = ['WITHDRAW', 'REQUEST_CANCELLATION', 'MARK_UNCERTAIN'];
  return {
    actions,
    primaryActions: actions.filter((action) => !secondary.includes(action.code)),
    secondaryActions: actions.filter((action) => secondary.includes(action.code)),
  };
}

export class RefundApi {
  constructor(private readonly baseUrl: string, private readonly token: () => string, private readonly role: RefundRole,
    private readonly request: Request = (options) => wx.request({ ...options, data: options.data as WechatMiniprogram.IAnyObject })) {}
  private prefix() { return this.role === 'FINANCE' ? '/finance/refunds' : '/management/finance-refunds'; }
  private headers(key?: string) {
    if (!this.token() || !this.baseUrl) throw new Error('请先登录总部账号');
    return { Authorization: `Bearer ${this.token()}`, ...(key ? { 'Idempotency-Key': key } : {}) };
  }
  private call<T>(path: string, method: 'GET' | 'POST', data?: unknown, key?: string): Promise<T> {
    return new Promise((resolve, reject) => this.request({
      url: `${this.baseUrl.replace(/\/$/, '')}${path}`, method, data, header: this.headers(key),
      success: (response) => { try { resolve(decode<T>(response.statusCode, response.data)); } catch (error) { reject(error); } },
      fail: () => reject(new Error('网络连接失败，原表单已保留')),
    }));
  }
  list(query: Record<string, string | number>) { return this.call<FinancePage<RefundView>>(this.prefix(), 'GET', query); }
  detail(id: string) { return this.call<RefundView>(`${this.prefix()}/${encodeURIComponent(id)}`, 'GET'); }
  quote(receiptId: string, mainUnits: number, giftUnits: number) {
    return this.call<RefundQuote>(`/finance/receipts/${encodeURIComponent(receiptId)}/refund-quote`, 'GET', { mainUnits, giftUnits });
  }
  submit(receiptId: string, body: { mainUnits: number; giftUnits: number; amountFen: number; reason: string }, key: string) {
    return this.call<RefundView>(`/finance/receipts/${encodeURIComponent(receiptId)}/refunds`, 'POST', body, key);
  }
  act(id: string, body: RefundActionInput, key: string) {
    const command = this.role === 'FINANCE' && payActions.includes(body.action) ? 'payment-actions' : 'actions';
    return this.call<RefundView>(`${this.prefix()}/${encodeURIComponent(id)}/${command}`, 'POST', body, key);
  }
  upload(filePath: string): Promise<{ id: string }> {
    return new Promise((resolve, reject) => wx.uploadFile({
      url: `${this.baseUrl.replace(/\/$/, '')}/finance/refund-proofs`, header: this.headers(), filePath, name: 'file',
      success: (response) => { try { resolve(decode(response.statusCode, JSON.parse(response.data))); } catch (error) { reject(error); } },
      fail: () => reject(new Error('退款凭证上传失败')),
    }));
  }
  proof(id: string): Promise<string> {
    return new Promise((resolve, reject) => wx.downloadFile({
      url: `${this.baseUrl.replace(/\/$/, '')}${this.prefix()}/${encodeURIComponent(id)}/proof`, header: this.headers(),
      success: (response) => response.statusCode === 200 ? resolve(response.tempFilePath) : reject(new Error('退款凭证读取失败')),
      fail: () => reject(new Error('退款凭证下载失败')),
    }));
  }
}
function decode<T>(status: number, body: unknown): T {
  if (status < 200 || status >= 300) {
    const messages: Record<number, string> = {
      400: '请核对课时、金额、实际付款时间和凭证', 401: '登录已失效，请重新登录',
      403: '当前账号不能执行此操作', 404: '记录不存在或原收款未发包',
      409: '状态、可退课时或金额额度已变化，请刷新详情核对', 413: '凭证不得超过 3 MB',
    };
    throw new Error(messages[status] ?? '操作失败，请稍后重试');
  }
  if (!body || typeof body !== 'object' || !('data' in body)) throw new Error('退费接口响应无效');
  return (body as { data: T }).data;
}
export function createRefundApi(role: RefundRole) {
  const env = createTeacherRuntimeEnv();
  return new RefundApi(env.apiBaseUrl, createRuntimeAccessTokenProvider(env.accessToken), role);
}
