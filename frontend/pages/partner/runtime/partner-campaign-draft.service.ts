import { createPartnerRuntimeEnv } from '../../../config/partner-env';
import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';
import { campaignImageSlot, parseCampaignImages, type CampaignImages, type CampaignImageSlot } from './campaign-image';
import { normalizeRegistrationForm, type RegistrationQuestion } from './campaign-registration-form';

export const CAMPAIGN_TYPES = [
  { value: 'REGULAR_GROUP', label: '常规拼团' },
  { value: 'MULTI_SPEC_GROUP', label: '多规格拼团' },
  { value: 'FLASH_SALE', label: '限时秒杀' },
  { value: 'MULTI_SPEC_REGISTRATION_FEE', label: '多规格报名费' },
  { value: 'FREE_REGISTRATION', label: '免费报名' },
] as const;
export type CampaignType = typeof CAMPAIGN_TYPES[number]['value'];
export interface CampaignBasics {
  title: string | null;
  campaignType: CampaignType | null;
  shareDescription: string | null;
  contactPhone: string | null;
}
export interface CampaignDraftReceipt {
  draftId: string;
  status: 'DRAFT';
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface CampaignDraft extends CampaignDraftReceipt {
  basicInformation: CampaignBasics; activityContent?: string | null; registrationForm?: RegistrationQuestion[];
}
export type CampaignReviewStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export interface CampaignSubmissionSummary {
  sequence: number;
  sourceDraftVersion: number;
  status: CampaignReviewStatus;
  reviewReason: string | null;
}
export interface CampaignDraftSummary extends CampaignDraftReceipt {
  title: string | null;
  campaignType: CampaignType | null;
  latestSubmission: CampaignSubmissionSummary | null;
  lifecycle: 'OPEN' | 'CLOSED' | null;
}
interface MockFreeSummary {
  sourceVersion: number;
  version: number;
  updatedAt: string;
  latestSubmission: CampaignSubmissionSummary | null;
  lifecycle: CampaignDraftSummary['lifecycle'];
}
export interface CampaignDraftPage {
  data: CampaignDraftSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
const FIELDS = ['title', 'campaignType', 'shareDescription', 'contactPhone'] as const;
const RECEIPT = ['draftId', 'status', 'version', 'createdAt', 'updatedAt'];
const LIMITS = { title: 40, shareDescription: 1000, contactPhone: 30 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_VERSION = 2_147_483_647;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[], required = allowed) =>
  Object.keys(value).every((key) => allowed.includes(key)) && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
function fail(response = false): never {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '活动草稿响应格式无效，请重试' : '活动基础信息格式或长度不符合要求');
}
export function normalizeCampaignContent(value: unknown, response = false): string | null {
  if (value !== null && typeof value !== 'string') fail(response);
  const text = typeof value === 'string' ? value.trim() || null : null;
  if ((response && text !== value) || (text !== null && (Array.from(text).length > 10000 ||
    text.includes('\u0000') || /[\ud800-\udfff]/u.test(text)))) fail(response);
  return text;
}

export function normalizeCampaignBasics(value: Partial<CampaignBasics>, response = false): CampaignBasics {
  if (!object(value) || !keys(value, FIELDS, response ? FIELDS : [])) fail(response);
  const result: CampaignBasics = { title: null, campaignType: null, shareDescription: null, contactPhone: null };
  for (const field of FIELDS) {
    const raw = value[field];
    if (raw !== null && raw !== undefined && typeof raw !== 'string') fail(response);
    const text = typeof raw === 'string' ? raw.trim() || null : null;
    if (response && text !== raw) fail(true);
    if (field === 'campaignType') {
      if (text !== null && !CAMPAIGN_TYPES.some((type) => type.value === text)) fail(response);
      result.campaignType = text as CampaignType | null;
    } else {
      if (text !== null && (Array.from(text).length > LIMITS[field] ||
        text.includes('\u0000') || /[\ud800-\udfff]/u.test(text))) fail(response);
      result[field] = text;
    }
  }
  return result;
}
function parseReceipt(value: unknown, extras: string[] = []): CampaignDraftReceipt {
  if (!object(value) || !keys(value, [...RECEIPT, ...extras]) ||
    typeof value.draftId !== 'string' || !UUID.test(value.draftId) || value.status !== 'DRAFT' ||
    !Number.isInteger(value.version) || Number(value.version) < 1 || Number(value.version) > MAX_VERSION ||
    !['createdAt', 'updatedAt'].every((field) => typeof value[field] === 'string' &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value[field]) &&
      Number.isFinite(Date.parse(value[field])))) fail(true);
  return {
    draftId: value.draftId as string, status: 'DRAFT', version: value.version as number,
    createdAt: value.createdAt as string, updatedAt: value.updatedAt as string,
  };
}
function parseSubmission(value: unknown, draftVersion: number): CampaignSubmissionSummary | null {
  if (value === null) return null;
  if (!object(value) || !keys(value, ['sequence', 'sourceDraftVersion', 'status', 'reviewReason']) ||
      ![value.sequence, value.sourceDraftVersion].every((n) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= MAX_VERSION) ||
      Number(value.sourceDraftVersion) > draftVersion ||
      !['SUBMITTED', 'APPROVED', 'REJECTED'].includes(String(value.status))) fail(true);
  const reason = value.reviewReason;
  if (value.status === 'REJECTED') {
    if (typeof reason !== 'string' || !reason.trim() || Array.from(reason).length > 1000 ||
        reason.includes('\u0000') || /[\ud800-\udfff]/u.test(reason)) fail(true);
  } else if (reason !== null) fail(true);
  return value as unknown as CampaignSubmissionSummary;
}
export function presentCampaignDraftSummary(item: CampaignDraftSummary) {
  const review = item.latestSubmission;
  const labels: Record<CampaignReviewStatus, string> = { SUBMITTED: '待审核', APPROVED: '已批准', REJECTED: '已驳回' };
  return {
    ...item,
    titleLabel: item.title || '未命名活动',
    typeLabel: campaignTypeLabel(item.campaignType),
    updatedLabel: campaignUpdatedLabel(item.updatedAt),
    reviewLabel: review ? `第${review.sequence}版 · ${labels[review.status]}` : '未送审',
    revisionLabel: review && item.version > review.sourceDraftVersion ? '草稿有后续修改，尚未送审' : '',
    reviewReason: review?.reviewReason ?? '',
    closed: item.lifecycle === 'CLOSED',
  };
}
export function campaignTypeLabel(value: CampaignType | null): string {
  return CAMPAIGN_TYPES.find((type) => type.value === value)?.label ?? '未选类型';
}
export function campaignUpdatedLabel(value: string): string {
  const date = new Date(Date.parse(value) + 8 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
interface Options {
  dataDriver: 'mock' | 'api';
  apiBaseUrl?: string;
  accessToken: () => string;
  request?: SessionHttpRequest;
  isCurrent?: () => boolean;
  upload?: (options: WechatMiniprogram.UploadFileOption) => unknown;
}
export class PartnerCampaignDraftService {
  private readonly mockDrafts = new Map<string, CampaignDraft>();
  private readonly mockReceipts = new Map<string, { fingerprint: string; receipt: CampaignDraftReceipt }>();
  private readonly mockFreeSummaries = new Map<string, MockFreeSummary>();
  private mockSequence = 0;
  constructor(private readonly options: Options) {}
  getSessionKey(): string {
    if (this.options.isCurrent && !this.options.isCurrent()) return '';
    return `${this.options.dataDriver}:${this.options.apiBaseUrl ?? ''}:${this.options.accessToken()}`;
  }
  setMockFreeSummary(id: string, summary: MockFreeSummary): void {
    if (this.options.dataDriver !== 'mock') return;
    const key = `${this.owner()}:${id}`;
    if (!this.mockDrafts.has(key)) return;
    this.mockFreeSummaries.set(key, {
      ...summary, latestSubmission: summary.latestSubmission ? { ...summary.latestSubmission } : null,
    });
  }
  private owner() {
    if (this.options.isCurrent && !this.options.isCurrent()) {
      throw new SessionServiceError(401, 'UNAUTHORIZED', '登录或服务配置已更新，请重新进入');
    }
    const owner = this.getSessionKey();
    if (this.options.dataDriver === 'api' && !this.options.accessToken().trim()) {
      throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已失效，请重新登录');
    }
    return owner;
  }
  async create(input: Partial<CampaignBasics>, key: string): Promise<CampaignDraftReceipt> {
    const fields = normalizeCampaignBasics(input);
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) fail();
    const owner = this.owner();
    if (this.options.dataDriver === 'api') {
      return parseReceipt((await this.send('POST', '', fields, key)).data);
    }
    const receiptKey = `${owner}:${key}`;
    const fingerprint = JSON.stringify(fields);
    const prior = this.mockReceipts.get(receiptKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) throw new SessionServiceError(409, 'IDEMPOTENCY_CONFLICT', '保存请求已变化');
      return { ...prior.receipt };
    }
    const timestamp = new Date().toISOString();
    const receipt: CampaignDraftReceipt = {
      draftId: `00000000-0000-4000-8000-${String(++this.mockSequence).padStart(12, '0')}`,
      status: 'DRAFT', version: 1, createdAt: timestamp, updatedAt: timestamp,
    };
    this.mockDrafts.set(`${owner}:${receipt.draftId}`, {
      ...receipt, basicInformation: { ...fields }, activityContent: null, registrationForm: [],
    });
    this.mockReceipts.set(receiptKey, { fingerprint, receipt: { ...receipt } });
    return receipt;
  }
  async get(id: string): Promise<CampaignDraft> {
    if (!UUID.test(id)) fail();
    const owner = this.owner();
    if (this.options.dataDriver === 'mock') {
      const draft = this.mockDrafts.get(`${owner}:${id}`);
      if (!draft) throw new SessionServiceError(404, 'RESOURCE_NOT_FOUND', '活动草稿不存在');
      return { ...draft, basicInformation: { ...draft.basicInformation },
        registrationForm: normalizeRegistrationForm(draft.registrationForm ?? []) };
    }
    const value = (await this.send('GET', `/${id}`)).data;
    const hasContent = object(value) && Object.prototype.hasOwnProperty.call(value, 'activityContent');
    const hasForm = object(value) && Object.prototype.hasOwnProperty.call(value, 'registrationForm');
    const receipt = parseReceipt(value, ['basicInformation', ...(hasContent ? ['activityContent'] : []),
      ...(hasForm ? ['registrationForm'] : [])]);
    if (receipt.draftId !== id || !object(value)) fail(true);
    return { ...receipt, basicInformation: normalizeCampaignBasics(value.basicInformation as CampaignBasics, true),
      ...(hasContent ? { activityContent: normalizeCampaignContent(value.activityContent, true) } : {}),
      ...(hasForm ? { registrationForm: normalizeRegistrationForm(value.registrationForm, true) } : {}) };
  }
  async save(id: string, version: number, input: Partial<CampaignBasics>): Promise<CampaignDraftReceipt> {
    if (!UUID.test(id) || !Number.isInteger(version) || version < 1 || version > MAX_VERSION) fail();
    const fields = normalizeCampaignBasics(input);
    const owner = this.owner();
    if (this.options.dataDriver === 'api') {
      const receipt = parseReceipt((await this.send('PUT', `/${id}/basic-information`, {
        expectedVersion: version, basicInformation: fields,
      })).data);
      if (receipt.draftId !== id) fail(true);
      return receipt;
    }
    const current = await this.get(id);
    const same = JSON.stringify(current.basicInformation) === JSON.stringify(fields);
    if (same && (version === current.version || version === current.version - 1)) {
      const { basicInformation: _, activityContent: _content, registrationForm: _form, ...receipt } = current;
      return receipt;
    }
    if (version !== current.version || current.version === MAX_VERSION) {
      throw new SessionServiceError(409, 'CONFLICT', '草稿已更新，请重新读取');
    }
    const next = { ...current, version: version + 1, updatedAt: new Date().toISOString(), basicInformation: fields };
    this.mockDrafts.set(`${owner}:${id}`, next);
    const { basicInformation: _, activityContent: _content, registrationForm: _form, ...receipt } = next;
    return receipt;
  }
  async saveContent(id: string, version: number, value: string | null): Promise<CampaignDraftReceipt> {
    if (!UUID.test(id) || !Number.isInteger(version) || version < 1 || version > MAX_VERSION) fail();
    const activityContent = normalizeCampaignContent(value);
    const owner = this.owner();
    if (this.options.dataDriver === 'api') {
      const result = parseReceipt((await this.send('PUT', `/${id}/content`, { expectedVersion: version, activityContent })).data);
      if (result.draftId !== id) fail(true);
      return result;
    }
    const current = await this.get(id);
    const same = (current.activityContent ?? null) === activityContent;
    if (same && (version === current.version || version === current.version - 1)) {
      const { basicInformation: _, activityContent: _content, registrationForm: _form, ...receipt } = current;
      return receipt;
    }
    if (version !== current.version || current.version === MAX_VERSION)
      throw new SessionServiceError(409, 'CONFLICT', '草稿已更新，请重新读取');
    const next = { ...current, activityContent, version: version + 1, updatedAt: new Date().toISOString() };
    this.mockDrafts.set(`${owner}:${id}`, next);
    const { basicInformation: _, activityContent: _content, registrationForm: _form, ...receipt } = next;
    return receipt;
  }
  async saveRegistrationForm(id: string, version: number, value: unknown): Promise<CampaignDraftReceipt> {
    if (!UUID.test(id) || !Number.isInteger(version) || version < 1 || version > MAX_VERSION) fail();
    const registrationForm = normalizeRegistrationForm(value);
    const owner = this.owner();
    if (this.options.dataDriver === 'api') {
      const receipt = parseReceipt((await this.send('PUT', `/${id}/registration-form`, {
        expectedVersion: version, registrationForm,
      })).data);
      if (receipt.draftId !== id || receipt.version < version || receipt.version > version + 1) fail(true);
      return receipt;
    }
    const current = await this.get(id);
    const same = JSON.stringify(current.registrationForm ?? []) === JSON.stringify(registrationForm);
    if (!(same && (version === current.version || version === current.version - 1)) &&
      (version !== current.version || current.version === MAX_VERSION))
      throw new SessionServiceError(409, 'CONFLICT', '草稿已更新，请重新读取');
    const next = same ? current : { ...current, registrationForm, version: version + 1, updatedAt: new Date().toISOString() };
    this.mockDrafts.set(`${owner}:${id}`, next);
    const { basicInformation: _, activityContent: _content, registrationForm: _form, ...receipt } = next;
    return receipt;
  }
  async getImages(id: string): Promise<CampaignImages> {
    if (!UUID.test(id)) fail();
    this.owner();
    return parseCampaignImages((await this.send('GET', `/${id}/images`)).data, id, this.options.apiBaseUrl ?? '');
  }
  async clearImage(id: string, version: number, slot: CampaignImageSlot): Promise<CampaignDraftReceipt> {
    if (!UUID.test(id) || !campaignImageSlot(slot) || !Number.isInteger(version) || version < 1 || version > MAX_VERSION) fail();
    const receipt = parseReceipt((await this.send('PUT', `/${id}/images/${slot}`, { expectedVersion: version })).data);
    if (receipt.draftId !== id || receipt.version < version || receipt.version > version + 1) fail(true);
    return receipt;
  }
  async uploadImage(id: string, version: number, slot: CampaignImageSlot, path: string, key: string): Promise<CampaignDraftReceipt> {
    if (!UUID.test(id) || !campaignImageSlot(slot) || !Number.isInteger(version) || version < 1 || version > MAX_VERSION ||
      typeof path !== 'string' || !path.trim() || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) fail();
    const owner = this.owner(), base = this.options.apiBaseUrl?.trim().replace(/\/+$/, '');
    if (!base || !/^https?:\/\/[^/?#@]+(?:\/[^?#]*)?$/.test(base)) fail();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        try {
          if (this.owner() !== owner) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新，请重新进入');
          action();
        } catch (error) { reject(error); }
      };
      const timer = setTimeout(() => finish(() => reject(new SessionServiceError(0, 'TIMEOUT', '图片保存结果暂未确认，请重试'))), 15000);
      try {
        (this.options.upload ?? (v => wx.uploadFile(v)))({
          url: `${base}/partners/me/campaign-drafts/${id}/images/${slot}`, filePath: path, name: 'file',
          formData: { expectedVersion: String(version) },
          header: { Authorization: `Bearer ${this.options.accessToken()}`, 'Idempotency-Key': key },
          success: response => finish(() => {
            if (response.statusCode !== 200) {
              reject(new SessionServiceError(response.statusCode, 'CAMPAIGN_IMAGE_FAILED', '图片保存失败，请重试')); return;
            }
            let value: unknown;
            try { value = JSON.parse(response.data); } catch { fail(true); }
            if (!object(value)) fail(true);
            const receipt = parseReceipt(value.data);
            if (receipt.draftId !== id || receipt.version < version || receipt.version > version + 1) fail(true);
            resolve(receipt);
          }),
          fail: () => finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '图片保存结果暂未确认，请重试'))),
        });
      } catch { finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '图片保存结果暂未确认，请重试'))); }
    });
  }
  async list(page: number, campaignType?: CampaignType): Promise<CampaignDraftPage> {
    if (!Number.isInteger(page) || page < 1 ||
      (campaignType !== undefined && !CAMPAIGN_TYPES.some(type => type.value === campaignType))) fail();
    const owner = this.owner();
    if (this.options.dataDriver === 'mock') {
      const rows = [...this.mockDrafts.entries()].filter(([key, draft]) => key.startsWith(`${owner}:`) &&
          (campaignType === undefined || draft.basicInformation.campaignType === campaignType))
        .map(([key, { basicInformation, activityContent: _content, registrationForm: _form, ...receipt }]): CampaignDraftSummary => {
          const overlay = this.mockFreeSummaries.get(key);
          return {
            ...receipt,
            title: basicInformation.title, campaignType: basicInformation.campaignType,
            version: receipt.version + (overlay ? overlay.version - overlay.sourceVersion : 0),
            updatedAt: overlay && overlay.updatedAt > receipt.updatedAt ? overlay.updatedAt : receipt.updatedAt,
            latestSubmission: overlay?.latestSubmission ? { ...overlay.latestSubmission } : null,
            lifecycle: overlay?.lifecycle ?? null,
          };
        }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.draftId.localeCompare(a.draftId));
      return {
        data: rows.slice((page - 1) * 20, page * 20),
        meta: { page, pageSize: 20, total: rows.length, totalPages: Math.ceil(rows.length / 20) },
      };
    }
    const envelope = await this.send('GET', `?page=${page}&pageSize=20${campaignType ? `&campaignType=${campaignType}` : ''}`);
    const meta = envelope.meta;
    if (!Array.isArray(envelope.data) || !object(meta) || !keys(meta, ['page', 'pageSize', 'total', 'totalPages']) ||
      meta.page !== page || meta.pageSize !== 20 ||
      ![meta.total, meta.totalPages].every((n) => Number.isSafeInteger(n) && Number(n) >= 0) ||
      meta.totalPages !== Math.ceil(Number(meta.total) / 20) || envelope.data.length > 20) fail(true);
    return {
      data: envelope.data.map((value: unknown) => {
        const receipt = parseReceipt(value, ['title', 'campaignType', 'latestSubmission', 'lifecycle']);
        if (!object(value)) fail(true);
        const fields = normalizeCampaignBasics({
          title: value.title, campaignType: value.campaignType, shareDescription: null, contactPhone: null,
        } as CampaignBasics, true);
        if (campaignType !== undefined && fields.campaignType !== campaignType) fail(true);
        const latestSubmission = parseSubmission(value.latestSubmission, receipt.version);
        if (![null, 'OPEN', 'CLOSED'].includes(value.lifecycle as null) ||
            (latestSubmission === null) !== (value.lifecycle === null)) fail(true);
        return { ...receipt, title: fields.title, campaignType: fields.campaignType,
          latestSubmission, lifecycle: value.lifecycle as CampaignDraftSummary['lifecycle'] };
      }),
      meta: meta as unknown as CampaignDraftPage['meta'],
    };
  }
  private send(
    method: 'GET' | 'POST' | 'PUT', path: string, data?: unknown, key?: string,
  ): Promise<Record<string, unknown>> {
    const owner = this.owner();
    const base = this.options.apiBaseUrl?.trim().replace(/\/+$/, '');
    if (!base || !/^https?:\/\//.test(base)) {
      return Promise.reject(new SessionServiceError(503, 'CONFIGURATION_REQUIRED', '活动服务尚未配置'));
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(() => reject(new SessionServiceError(0, 'TIMEOUT', '保存或读取暂未确认，请重试'))), 15_000);
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (this.owner() !== owner) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新，请重新进入');
          action();
        } catch (error) { reject(error); }
      };
      try {
        (this.options.request ?? defaultRequest)({
          url: `${base}/partners/me/campaign-drafts${path}`, method,
          header: { Authorization: `Bearer ${this.options.accessToken()}`, 'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}) },
          data,
          success: (response) => finish(() => {
            if (response.statusCode !== 200) {
              reject(new SessionServiceError(response.statusCode, 'CAMPAIGN_DRAFT_REQUEST_FAILED',
                response.statusCode === 409 ? '草稿已更新，请读取最新版本后核对修改' : '活动草稿请求失败，请重试'));
            } else if (!object(response.data)) fail(true);
            else resolve(response.data);
          }),
          fail: () => finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应，请重试'))),
        });
      } catch { finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应，请重试'))); }
    });
  }
}

let cached: { key: string; service: PartnerCampaignDraftService } | undefined;
export function getPartnerCampaignDraftService(): PartnerCampaignDraftService {
  const env = createPartnerRuntimeEnv();
  const base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  const key = `${env.dataDriver}:${base}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      service: new PartnerCampaignDraftService({
        dataDriver: env.dataDriver, apiBaseUrl: base,
        accessToken: () => createPartnerRuntimeEnv().accessToken,
        isCurrent: () => {
          const current = createPartnerRuntimeEnv();
          return `${current.dataDriver}:${current.apiBaseUrl.trim().replace(/\/+$/, '')}` === key;
        },
      }),
    };
  }
  return cached.service;
}
