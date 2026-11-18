import { createParentRuntimeEnv } from '../../../config/env';
import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';
import { FreeCampaignMock } from './free-campaign.mock';

export type FreeAvailability = 'CLOSED' | 'REPLACED' | 'NOT_STARTED' | 'ENDED' | 'FULL' | 'AVAILABLE';
export interface FreeCampaignImage {
  id: string; mimeType: 'image/png' | 'image/jpeg'; sizeBytes: number;
  accessUrl: string; accessUrlExpiresAt: string;
}
export interface FreeConfiguration {
  title: string; campaignType: 'FREE_REGISTRATION'; shareDescription: string; contactPhone: string | null;
  activityContent?: string | null;
  images?: { cover: FreeCampaignImage | null; share: FreeCampaignImage | null };
  startsAt: string; endsAt: string; timezone: string; capacityMode: 'UNLIMITED' | 'LIMITED';
  maxRegistrations: number | null; feeFen: 0; benefitMode: 'NONE'; registrationLimit: 'ONCE_PER_STUDENT';
}
export interface FreeRegistrationReceipt {
  registrationId: string; campaignId: string; versionId: string; studentId: string;
  status: 'REGISTERED' | 'CANCELLED'; version: number; registeredAt: string; cancelledAt: string | null;
}
export interface FreeRegistration extends FreeRegistrationReceipt {
  title: string; timezone: string; startsAt: string; endsAt: string; canCancel: boolean;
}
export interface FreeStudent {
  studentId: string; displayName: string; eligibility: 'ELIGIBLE' | 'ALREADY_REGISTERED';
  registration: FreeRegistrationReceipt | null;
}
export interface FreeCampaign {
  campaignId: string; versionId: string; configuration: FreeConfiguration; availability: FreeAvailability;
  registeredCount: number; remainingRegistrations: number | null; eligibleStudents: FreeStudent[];
}
export interface FreeCampaignSummary {
  campaignId: string; versionId: string; title: string; startsAt: string; endsAt: string; timezone: string;
  availability: FreeAvailability; registeredCount: number; maxRegistrations: number | null; remainingRegistrations: number | null;
}
export interface FreePage<T> {
  data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number };
}
let nextReadScopeId = 0;
export class FreeCampaignReadScope {
  private readonly id = ++nextReadScopeId;
  private generation = 0;
  getKey() { return `${this.id}:${this.generation}`; }
  invalidate() { this.generation += 1; }
}
interface Options {
  dataDriver: 'mock' | 'api'; apiBaseUrl?: string; accessToken: () => string;
  request?: SessionHttpRequest; isCurrent?: () => boolean; mockAccount?: () => string;
}
export const FREE_AVAILABILITY_LABELS: Record<FreeAvailability, string> = {
  CLOSED: '已下架', REPLACED: '版本已更新', NOT_STARTED: '未开始',
  ENDED: '已结束', FULL: '名额已满', AVAILABLE: '可报名',
};
export const isFreeCampaignId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const MAX_VERSION = 2_147_483_647;
const availability = Object.keys(FREE_AVAILABILITY_LABELS);
const receiptKeys = ['registrationId', 'campaignId', 'versionId', 'studentId', 'status', 'version', 'registeredAt', 'cancelledAt'];
const configurationKeys = ['title', 'campaignType', 'shareDescription', 'contactPhone', 'startsAt', 'endsAt',
  'timezone', 'capacityMode', 'maxRegistrations', 'feeFen', 'benefitMode', 'registrationLimit'];
function bad(response = true): never {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '活动响应格式无效，请重试' : '报名信息格式无效');
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Reflect.ownKeys(value).length !== fields.length ||
    !fields.every((key) => Object.prototype.hasOwnProperty.call(value, key))) bad();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, nonempty = false): string {
  if (typeof value !== 'string' || Array.from(value).length > max || value.includes('\u0000') ||
    /[\ud800-\udfff]/u.test(value) || (nonempty && !value.trim())) bad();
  return value;
}
function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) bad();
  return value as number;
}
function id(value: unknown): string { if (!isFreeCampaignId(value)) bad(); return value; }
function timestamp(value: unknown): string {
  if (typeof value !== 'string') bad();
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/.exec(value);
  if (!match) bad();
  const [, y, m, d, h, min, s, offset] = match;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > days ||
    Number(h) > 23 || Number(min) > 59 || Number(s) > 59 ||
    (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) ||
    !Number.isFinite(Date.parse(value))) bad();
  return value;
}
function timezone(value: unknown): string {
  const zone = text(value, 100, true);
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone)) bad();
  if (typeof Intl !== 'undefined') {
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: zone }); } catch { bad(); }
  }
  return zone;
}
function range(value: Record<string, unknown>) {
  timestamp(value.startsAt); timestamp(value.endsAt); timezone(value.timezone);
  if (Date.parse(String(value.endsAt)) <= Date.parse(String(value.startsAt))) bad();
}
function campaignImage(value: unknown, baseUrl: string): FreeCampaignImage | null {
  if (value === null) return null;
  const row = record(value, ['id', 'mimeType', 'sizeBytes', 'accessUrl', 'accessUrlExpiresAt']);
  if (typeof row.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id) ||
    !(row.mimeType === 'image/png' || row.mimeType === 'image/jpeg')) bad();
  integer(row.sizeBytes, 1, 3145728);
  const expiresAt = timestamp(row.accessUrlExpiresAt);
  if (!expiresAt.endsWith('Z') || typeof row.accessUrl !== 'string') bad();
  const signed = /^\/media\/partner-campaign-images\/([0-9a-fA-F-]+)\?expires=(\d+)&signature=([0-9a-f]{64})$/.exec(row.accessUrl);
  if (!signed || signed[0] !== row.accessUrl || signed[1] !== row.id ||
    !Number.isSafeInteger(Number(signed[2]))) bad();
  return { ...row, accessUrl: baseUrl + row.accessUrl } as unknown as FreeCampaignImage;
}
function configuration(value: unknown, baseUrl: string): FreeConfiguration {
  const hasContent = typeof value === 'object' && value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'activityContent');
  const hasImages = typeof value === 'object' && value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'images');
  const row = record(value, [...configurationKeys, ...(hasContent ? ['activityContent'] : []), ...(hasImages ? ['images'] : [])]);
  text(row.title, 40, true); text(row.shareDescription, 1000, true);
  if (row.contactPhone !== null) text(row.contactPhone, 30);
  range(row);
  if (row.campaignType !== 'FREE_REGISTRATION' || row.feeFen !== 0 || row.benefitMode !== 'NONE' ||
    row.registrationLimit !== 'ONCE_PER_STUDENT' ||
    !['LIMITED', 'UNLIMITED'].includes(String(row.capacityMode))) bad();
  if (row.capacityMode === 'UNLIMITED') { if (row.maxRegistrations !== null) bad(); }
  else integer(row.maxRegistrations, 1, MAX_VERSION);
  const activityContent = hasContent
    ? { activityContent: row.activityContent === null ? null : text(row.activityContent, 10000).trim() || null } : {};
  const images = hasImages ? record(row.images, ['cover', 'share']) : undefined;
  return { ...row, ...activityContent, ...(images ? { images: {
    cover: campaignImage(images.cover, baseUrl), share: campaignImage(images.share, baseUrl),
  } } : {}) } as unknown as FreeConfiguration;
}
function parseReceipt(value: unknown, extra: string[] = []): FreeRegistrationReceipt {
  const row = record(value, [...receiptKeys, ...extra]);
  ['registrationId', 'campaignId', 'versionId', 'studentId'].forEach((key) => id(row[key]));
  integer(row.version, 1, MAX_VERSION); timestamp(row.registeredAt);
  if (row.status === 'REGISTERED') { if (row.cancelledAt !== null) bad(); }
  else if (row.status === 'CANCELLED') {
    timestamp(row.cancelledAt);
    if (Date.parse(String(row.cancelledAt)) < Date.parse(String(row.registeredAt))) bad();
  } else bad();
  return row as unknown as FreeRegistrationReceipt;
}
function parseRegistration(value: unknown): FreeRegistration {
  const row = parseReceipt(value, ['title', 'timezone', 'startsAt', 'endsAt', 'canCancel']) as FreeRegistration;
  text(row.title, 40); range(row as unknown as Record<string, unknown>);
  if (typeof row.canCancel !== 'boolean' || (row.status === 'CANCELLED' && row.canCancel)) bad();
  return row;
}
function parseSummary(value: unknown): FreeCampaignSummary {
  const row = record(value, ['campaignId', 'versionId', 'title', 'startsAt', 'endsAt', 'timezone',
    'availability', 'registeredCount', 'maxRegistrations', 'remainingRegistrations']);
  id(row.campaignId); id(row.versionId); text(row.title, 40); range(row);
  if (!availability.includes(String(row.availability))) bad();
  integer(row.registeredCount);
  if (row.maxRegistrations !== null) integer(row.maxRegistrations, 1);
  if (row.remainingRegistrations !== null) integer(row.remainingRegistrations);
  if ((row.maxRegistrations === null) !== (row.remainingRegistrations === null)) bad();
  return row as unknown as FreeCampaignSummary;
}
function parseCampaign(value: unknown, baseUrl: string): FreeCampaign {
  const row = record(value, ['campaignId', 'versionId', 'configuration', 'availability',
    'registeredCount', 'remainingRegistrations', 'eligibleStudents']);
  const campaignId = id(row.campaignId); id(row.versionId);
  const settings = configuration(row.configuration, baseUrl);
  if (!availability.includes(String(row.availability))) bad();
  integer(row.registeredCount);
  if (row.remainingRegistrations !== null) integer(row.remainingRegistrations);
  if ((settings.capacityMode === 'UNLIMITED') !== (row.remainingRegistrations === null) ||
    !Array.isArray(row.eligibleStudents)) bad();
  const students = row.eligibleStudents.map((value) => {
    const student = record(value, ['studentId', 'displayName', 'eligibility', 'registration']);
    const studentId = id(student.studentId); text(student.displayName, 100);
    if (!['ELIGIBLE', 'ALREADY_REGISTERED'].includes(String(student.eligibility))) bad();
    if (student.registration !== null) {
      const registered = parseReceipt(student.registration);
      if (registered.studentId !== studentId || registered.campaignId !== campaignId ||
        student.eligibility !== 'ALREADY_REGISTERED') bad();
    }
    return student as unknown as FreeStudent;
  });
  if (new Set(students.map((student) => student.studentId)).size !== students.length) bad();
  return { ...row, configuration: settings, eligibleStudents: students } as unknown as FreeCampaign;
}
function parsePage<T>(value: Record<string, unknown>, page: number, parse: (row: unknown) => T): FreePage<T> {
  const meta = record(value.meta, ['page', 'pageSize', 'total', 'totalPages']);
  if (meta.page !== page || meta.pageSize !== 20 || !Array.isArray(value.data) || value.data.length > 20) bad();
  integer(meta.total); integer(meta.totalPages);
  if (meta.totalPages !== Math.ceil(Number(meta.total) / 20) || value.data.length > Number(meta.total)) bad();
  return { data: value.data.map(parse), meta: meta as unknown as FreePage<T>['meta'] };
}
export function freeCampaignTimeLabel(value: string, zone: string): string {
  try {
    return `${new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))}（${zone}）`;
  } catch { return `${new Date(value).toISOString().slice(0, 16).replace('T', ' ')} UTC（${zone}）`; }
}

export class ParentFreeCampaignService {
  readonly isMock: boolean;
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly defaultReadScope = new FreeCampaignReadScope();
  private readonly mock = new FreeCampaignMock();
  constructor(private readonly options: Options) { this.isMock = options.dataDriver === 'mock'; }
  createReadScope() { return new FreeCampaignReadScope(); }
  getSessionKey() {
    if (this.options.isCurrent && !this.options.isCurrent()) return '';
    return `${this.options.dataDriver}:${this.options.apiBaseUrl ?? ''}:${this.options.accessToken()}:${this.options.mockAccount?.() ?? 'PARENT'}`;
  }
  private owner() {
    const owner = this.getSessionKey();
    if (!owner || (!this.isMock && !this.options.accessToken().trim()) ||
      (this.isMock && this.options.mockAccount && this.options.mockAccount() !== 'PARENT')) {
      throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新，请重新登录');
    }
    return owner;
  }
  private validIds(...values: string[]) { if (!values.every(isFreeCampaignId)) bad(false); }
  private validKey(key: string) { if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) bad(false); }
  async listCampaigns(page: number, scope?: FreeCampaignReadScope): Promise<FreePage<FreeCampaignSummary>> {
    if (!Number.isSafeInteger(page) || page < 1) bad(false);
    const owner = this.owner();
    if (this.isMock) return this.mock.listCampaigns(owner, page);
    return this.send('GET', `/free-campaigns?page=${page}&pageSize=20`, (value) => parsePage(value, page, parseSummary),
      true, undefined, undefined, scope);
  }
  async getCampaign(campaignId: string, versionId?: string, scope?: FreeCampaignReadScope): Promise<FreeCampaign> {
    this.validIds(campaignId, ...(versionId ? [versionId] : []));
    const owner = this.owner();
    if (this.isMock) return this.mock.getCampaign(owner, campaignId, versionId);
    return this.send('GET', `/free-campaigns/${campaignId}${versionId ? `?versionId=${versionId}` : ''}`, (value, baseUrl) => {
      const row = parseCampaign(value.data, baseUrl);
      if (row.campaignId !== campaignId || (versionId && row.versionId !== versionId)) bad();
      return row;
    }, false, undefined, undefined, scope);
  }
  async listRegistrations(page: number, scope?: FreeCampaignReadScope): Promise<FreePage<FreeRegistration>> {
    if (!Number.isSafeInteger(page) || page < 1) bad(false);
    const owner = this.owner();
    if (this.isMock) return this.mock.listRegistrations(owner, page);
    return this.send('GET', `/campaign-registrations?page=${page}&pageSize=20`,
      (value) => parsePage(value, page, parseRegistration), true, undefined, undefined, scope);
  }
  async getRegistration(registrationId: string, scope?: FreeCampaignReadScope): Promise<FreeRegistration> {
    this.validIds(registrationId);
    const owner = this.owner();
    if (this.isMock) return this.mock.getRegistration(owner, registrationId);
    return this.send('GET', `/campaign-registrations/${registrationId}`, (value) => {
      const row = parseRegistration(value.data); if (row.registrationId !== registrationId) bad(); return row;
    }, false, undefined, undefined, scope);
  }
  async register(campaignId: string, versionId: string, studentId: string, key: string): Promise<FreeRegistrationReceipt> {
    this.validIds(campaignId, versionId, studentId); this.validKey(key);
    const owner = this.owner();
    if (this.isMock) return this.mock.register(owner, campaignId, versionId, studentId, key);
    return this.send('POST', `/free-campaigns/${campaignId}/registrations`, (value) => {
      const row = parseReceipt(value.data);
      if (row.campaignId !== campaignId || row.versionId !== versionId || row.studentId !== studentId || row.status !== 'REGISTERED') bad();
      return row;
    }, false, { versionId, studentId }, key);
  }
  async cancel(registrationId: string, version: number, key: string): Promise<FreeRegistrationReceipt> {
    this.validIds(registrationId); this.validKey(key);
    if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) bad(false);
    const owner = this.owner();
    if (this.isMock) return this.mock.cancel(owner, registrationId, version, key);
    return this.send('POST', `/campaign-registrations/${registrationId}/cancel`, (value) => {
      const row = parseReceipt(value.data); if (row.registrationId !== registrationId || row.status !== 'CANCELLED') bad(); return row;
    }, false, { expectedVersion: version }, key);
  }
  private send<T>(method: 'GET' | 'POST', path: string, parse: (value: Record<string, unknown>, baseUrl: string) => T,
    paginated = false, data?: unknown, key?: string, scope?: FreeCampaignReadScope): Promise<T> {
    const owner = this.owner();
    const base = this.options.apiBaseUrl?.trim().replace(/\/+$/, '');
    if (!base || !/^https?:\/\/(?:\[[0-9a-f:]+\]|[^/:\s?#@\\]+)(?::\d+)?(?:\/[^\s?#\\]*)?$/.test(base)) {
      return Promise.reject(new SessionServiceError(503, 'CONFIGURATION_REQUIRED', '活动服务尚未配置'));
    }
    const readScope = method === 'GET' ? scope ?? this.defaultReadScope : undefined;
    const readKey = readScope?.getKey();
    const fingerprint = JSON.stringify([owner, method, path, data, key, readKey]);
    const prior = this.pending.get(fingerprint); if (prior) return prior as Promise<T>;
    const pending = new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        try {
          if (this.owner() !== owner) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新，请重新登录');
          if (readScope && readScope.getKey() !== readKey) {
            throw new SessionServiceError(0, 'READ_INVALIDATED', '读取已失效，请重新读取');
          }
          action();
        } catch (error) { reject(error); }
      };
      const timer = setTimeout(() => finish(() => reject(new SessionServiceError(0, 'TIMEOUT', '请求结果暂未确认，请重试'))), 15_000);
      try {
        (this.options.request ?? defaultRequest)({
          url: `${base}/parents/me${path}`, method, data,
          header: { Authorization: `Bearer ${this.options.accessToken()}`, 'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}) },
          success: (response) => finish(() => {
            if (response.statusCode !== 200) {
              const body = response.data as { error?: { code?: unknown } } | null;
              const code = typeof body?.error?.code === 'string' ? body.error.code : 'FREE_CAMPAIGN_REQUEST_FAILED';
              reject(new SessionServiceError(response.statusCode, code, response.statusCode === 409
                ? '活动或报名状态已更新，请重新读取' : '活动请求失败，请重试'));
              return;
            }
            const envelope = record(response.data, paginated ? ['data', 'meta', 'requestId'] : ['data', 'requestId']);
            text(envelope.requestId, 128, true);
            resolve(parse(envelope, base));
          }),
          fail: () => finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应，请重试'))),
        });
      } catch { finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应，请重试'))); }
    }).finally(() => { if (this.pending.get(fingerprint) === pending) this.pending.delete(fingerprint); });
    this.pending.set(fingerprint, pending);
    return pending;
  }
}

let cached: { key: string; service: ParentFreeCampaignService } | undefined;
export function getParentFreeCampaignService(): ParentFreeCampaignService {
  const env = createParentRuntimeEnv();
  const base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  const key = `${env.dataDriver}:${base}`;
  if (!cached || cached.key !== key) cached = { key, service: new ParentFreeCampaignService({
    dataDriver: env.dataDriver, apiBaseUrl: base, accessToken: () => createParentRuntimeEnv().accessToken,
    mockAccount: () => createParentRuntimeEnv().mockWechatAccount,
    isCurrent: () => {
      const current = createParentRuntimeEnv();
      return `${current.dataDriver}:${current.apiBaseUrl.trim().replace(/\/+$/, '')}` === key;
    },
  }) };
  return cached.service;
}
