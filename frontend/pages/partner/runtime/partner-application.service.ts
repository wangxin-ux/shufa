import { SessionServiceError } from '../../../services/session.service';
import type { PartnerApplicantSessionService } from './partner-applicant-session.service';

export interface PartnerApplicationBasicInformation {
  institutionName: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  detailedAddress: string | null;
  contactPhone?: string | null;
}

export type PartnerApplicationBasicInput = Partial<PartnerApplicationBasicInformation>;
export type PartnerApplicationStatus = 'DRAFT' | 'SUBMITTED' | 'REJECTED' | 'APPROVED';

export interface PartnerApplication {
  applicationId: string;
  status: PartnerApplicationStatus;
  version: number;
  basicInformation: PartnerApplicationBasicInformation;
  createdAt: string;
  updatedAt: string;
}

const LIMITS = {
  institutionName: 200, province: 100, city: 100, district: 100, detailedAddress: 300, contactPhone: 30,
} as const;
const FIELDS = Object.keys(LIMITS) as Array<keyof PartnerApplicationBasicInformation>;
const APPLICATION_FIELDS = [
  'applicationId', 'status', 'version', 'basicInformation', 'createdAt', 'updatedAt',
];
const STATUSES: readonly string[] = ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'];
const MAX_VERSION = 2_147_483_647;

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && allowedKeys(value, keys);
}

function version(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) &&
    value >= minimum && value <= MAX_VERSION;
}

function fail(response: boolean): never {
  throw new SessionServiceError(
    response ? 502 : 400,
    response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '申请草稿响应格式无效' : '机构基础信息格式无效',
  );
}

function basics(value: unknown, response: boolean): PartnerApplicationBasicInformation {
  if (!record(value) || !allowedKeys(value, FIELDS) || (response &&
      !FIELDS.every((field) => field === 'contactPhone' ||
        Object.prototype.hasOwnProperty.call(value, field)))) {
    fail(response);
  }
  const result: PartnerApplicationBasicInformation = {
    institutionName: null, province: null, city: null, district: null, detailedAddress: null,
    contactPhone: null,
  };
  for (const field of FIELDS) {
    const item = Object.prototype.hasOwnProperty.call(value, field) ? value[field] : undefined;
    if (field === 'contactPhone' && item === undefined) {
      if (!response) delete result.contactPhone;
      continue;
    }
    if (item === null || (!response && item === undefined)) continue;
    if (typeof item !== 'string' || Array.from(item).length > LIMITS[field]) fail(response);
    result[field] = response ? item : item.trim() || null;
  }
  return result;
}

function utcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19);
}

function application(value: unknown): PartnerApplication {
  if (!record(value) || !exactKeys(value, APPLICATION_FIELDS) ||
      typeof value.applicationId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.applicationId) ||
      typeof value.status !== 'string' || !STATUSES.includes(value.status) ||
      !version(value.version, 1) || !utcTimestamp(value.createdAt) || !utcTimestamp(value.updatedAt)) {
    fail(true);
  }
  return {
    applicationId: value.applicationId, status: value.status as PartnerApplicationStatus,
    version: value.version, basicInformation: basics(value.basicInformation, true),
    createdAt: value.createdAt, updatedAt: value.updatedAt,
  };
}

export class PartnerApplicationService {
  private readonly pendingLoads = new Map<string, Promise<PartnerApplication | null>>();
  private readonly pendingSaves = new Map<string, { input: string; promise: Promise<PartnerApplication> }>();

  constructor(private readonly sessions: Pick<PartnerApplicantSessionService,
    'getSessionKey' | 'getReadKey' | 'requestApplication'>) {}

  load(): Promise<PartnerApplication | null> {
    const session = this.sessions.getSessionKey();
    if (!session) return Promise.reject(this.unauthorized());
    const readKey = this.sessions.getReadKey();
    const existing = this.pendingLoads.get(readKey);
    if (existing) return existing;
    const pending = this.sessions.requestApplication('GET').then((value) => {
      this.assertCurrent(session);
      return value === null ? null : application(value);
    }).finally(() => {
      if (this.pendingLoads.get(readKey) === pending) this.pendingLoads.delete(readKey);
    });
    this.pendingLoads.set(readKey, pending);
    return pending;
  }

  saveBasics(expectedVersion: number, input: PartnerApplicationBasicInput): Promise<PartnerApplication> {
    const session = this.sessions.getSessionKey();
    if (!session) return Promise.reject(this.unauthorized());
    let data: { expectedVersion: number; basicInformation: PartnerApplicationBasicInformation };
    try {
      if (!version(expectedVersion, 0)) fail(false);
      data = { expectedVersion, basicInformation: basics(input, false) };
    } catch (error) {
      return Promise.reject(error);
    }
    const key = JSON.stringify(data);
    const existing = this.pendingSaves.get(session);
    if (existing) {
      return existing.input === key ? existing.promise : Promise.reject(
        new SessionServiceError(409, 'SAVE_IN_PROGRESS', '草稿正在保存，请稍后重试'),
      );
    }
    const pending = this.sessions.requestApplication('PUT', data).then((value) => {
      this.assertCurrent(session);
      return application(value);
    }).finally(() => {
      if (this.pendingSaves.get(session)?.promise === pending) this.pendingSaves.delete(session);
    });
    this.pendingSaves.set(session, { input: key, promise: pending });
    return pending;
  }

  private assertCurrent(session: string) {
    if (this.sessions.getSessionKey() !== session) {
      throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '申请会话已更新');
    }
  }

  private unauthorized() {
    return new SessionServiceError(401, 'UNAUTHORIZED', '请先登录入驻申请');
  }
}
