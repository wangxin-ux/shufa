import { SessionServiceError } from '../../../services/session.service';
import type { PartnerApplicantSessionService } from './partner-applicant-session.service';
import type { PartnerApplicationStatus } from './partner-application.service';

export const BANK_LIMITS = { bankName: 200, accountHolder: 200, accountNumber: 80 } as const;
export type BankInformation = Record<keyof typeof BANK_LIMITS, string | null>;
export interface BankView {
  applicationId: string | null;
  status: PartnerApplicationStatus | null;
  version: number;
  bankInformation: BankInformation | null;
  readonly: boolean;
}
export interface BankReceipt {
  applicationId: string;
  version: number;
  bankRecordId: string;
}
const fields = Object.keys(BANK_LIMITS) as Array<keyof BankInformation>;
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const version = (value: unknown, min = 0): value is number => typeof value === 'number' &&
  Number.isInteger(value) && value >= min && value <= 2_147_483_647;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null);
}
function keys(value: Record<string, unknown>, allowed: readonly string[], exact = true) {
  return (!exact || Reflect.ownKeys(value).length === allowed.length) &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && allowed.includes(key));
}
function fail(response: boolean): never {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '银行信息响应格式无效' : '银行信息格式无效');
}
function bankInformation(value: unknown, response: boolean): BankInformation {
  if (!record(value) || !keys(value, fields, response)) fail(response);
  const result: BankInformation = { bankName: null, accountHolder: null, accountNumber: null };
  for (const field of fields) {
    const item = Object.prototype.hasOwnProperty.call(value, field) ? value[field] : undefined;
    if (item === null || (!response && item === undefined)) continue;
    if (typeof item !== 'string' || Array.from(item).length > BANK_LIMITS[field]) fail(response);
    result[field] = response ? item : item.trim() || null;
  }
  return result;
}
function view(value: unknown): BankView {
  if (!record(value) || !keys(value, ['applicationId', 'status', 'version', 'bankInformation', 'readonly']) ||
      !version(value.version) || typeof value.readonly !== 'boolean') fail(true);
  if (value.applicationId === null) {
    if (value.status !== null || value.version !== 0 || value.bankInformation !== null) fail(true);
  } else if (!uuid(value.applicationId) || !version(value.version, 1) ||
      !['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'].includes(value.status as string) ||
      (value.status !== 'DRAFT' && !value.readonly)) fail(true);
  return {
    applicationId: value.applicationId as string | null,
    status: value.status as PartnerApplicationStatus | null,
    version: value.version, readonly: value.readonly,
    bankInformation: value.bankInformation === null ? null : bankInformation(value.bankInformation, true),
  };
}
function receipt(value: unknown): BankReceipt {
  if (!record(value) || !keys(value, ['applicationId', 'version', 'bankRecordId']) ||
      !uuid(value.applicationId) || !uuid(value.bankRecordId) || !version(value.version, 1)) fail(true);
  return { applicationId: value.applicationId, version: value.version, bankRecordId: value.bankRecordId };
}

export class PartnerApplicationBankService {
  private readonly reads = new Map<string, Promise<BankView>>();
  private readonly writes = new Map<string, { input: string; promise: Promise<BankReceipt> }>();
  constructor(private readonly sessions: Pick<PartnerApplicantSessionService,
    'getSessionKey' | 'getReadKey' | 'requestBankInformation'>) {}

  load(): Promise<BankView> {
    const session = this.sessions.getSessionKey();
    if (!session) return Promise.reject(this.unauthorized());
    const key = this.sessions.getReadKey();
    const existing = this.reads.get(key);
    if (existing) return existing;
    const pending = this.sessions.requestBankInformation('GET').then((value) => {
      this.assertCurrent(session);
      if (this.sessions.getReadKey() !== key)
        throw new SessionServiceError(409, 'READ_SUPERSEDED', '申请读取已更新');
      return view(value);
    }).finally(() => { if (this.reads.get(key) === pending) this.reads.delete(key); });
    this.reads.set(key, pending);
    return pending;
  }

  save(expectedVersion: number, input: Partial<BankInformation>): Promise<BankReceipt> {
    const session = this.sessions.getSessionKey();
    if (!session) return Promise.reject(this.unauthorized());
    let data: { expectedVersion: number; bankInformation: BankInformation };
    try {
      if (!version(expectedVersion)) fail(false);
      data = { expectedVersion, bankInformation: bankInformation(input, false) };
    } catch (error) { return Promise.reject(error); }
    const serialized = JSON.stringify(data);
    const existing = this.writes.get(session);
    if (existing) return existing.input === serialized ? existing.promise : Promise.reject(
      new SessionServiceError(409, 'SAVE_IN_PROGRESS', '银行信息正在保存'),
    );
    const pending = this.sessions.requestBankInformation('PUT', data).then((value) => {
      this.assertCurrent(session);
      return receipt(value);
    }).finally(() => { if (this.writes.get(session)?.promise === pending) this.writes.delete(session); });
    this.writes.set(session, { input: serialized, promise: pending });
    return pending;
  }

  private assertCurrent(key: string) {
    if (this.sessions.getSessionKey() !== key)
      throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '申请会话已更新');
  }
  private unauthorized() {
    return new SessionServiceError(401, 'UNAUTHORIZED', '请先登录入驻申请');
  }
}
