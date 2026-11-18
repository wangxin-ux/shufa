import { createPartnerRuntimeEnv } from '../../../config/partner-env';
import { type CampaignImage, type CampaignImages, type CampaignImageSlot, campaignImageSlot, parseCampaignImages } from './campaign-image';
import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';
import {
  getPartnerCampaignDraftService, normalizeCampaignBasics, normalizeCampaignContent,
  type PartnerCampaignDraftService, type CampaignBasics, type CampaignDraft, type CampaignDraftReceipt,
  type CampaignReviewStatus, type CampaignSubmissionSummary,
} from './partner-campaign-draft.service';
import { normalizeRegistrationForm } from './campaign-registration-form';

export interface FreeSettings {
  startsAt: string | null; endsAt: string | null;
  capacityMode: 'UNLIMITED' | 'LIMITED' | null; maxRegistrations: number | null;
}
export interface FreeConfiguration {
  draftId: string; version: number; campusTimezone: string; freeRegistration: FreeSettings;
  campaignId: string | null; publishedVersionId: string | null;
  publishedVersion: FreeReview | null;
  publishedShareImage: CampaignImage | null;
  campaignVersion: number | null; lifecycle: 'OPEN' | 'CLOSED' | null;
}
export interface FreeReview {
  versionId: string; campaignId: string; draftId: string; campusId: string; title: string;
  status: CampaignReviewStatus; version: number; sequence: number;
  submittedAt: string; reviewedAt: string | null; reviewReason: string | null;
}
export interface FreeRegistration {
  registrationId: string; versionId: string; status: 'REGISTERED' | 'CANCELLED';
  registeredAt: string; cancelledAt: string | null; studentName: string | null;
}
export interface FreePage<T> {
  data: T[]; meta: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface OwnedFreeCampaign {
  campaignId: string; versionId: string; draftId: string; sequence: number; title: string;
  startsAt: string; endsAt: string; timezone: string;
  availability: 'NOT_STARTED' | 'AVAILABLE' | 'FULL' | 'ENDED' | 'CLOSED';
  registeredCount: number; maxRegistrations: number | null; remainingRegistrations: number | null;
}
export function presentOwnedFreeCampaign(item: OwnedFreeCampaign) {
  const labels = { NOT_STARTED: '未开始', AVAILABLE: '可报名', FULL: '名额已满', ENDED: '已结束', CLOSED: '已关闭' };
  const format = (value: string) => new Intl.DateTimeFormat('zh-CN', {
    timeZone: item.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
  return {
    ...item, statusLabel: labels[item.availability], sequenceLabel: `第${item.sequence}版 · 已批准`,
    startsLabel: format(item.startsAt), endsLabel: format(item.endsAt),
    countLabel: item.maxRegistrations === null
      ? `已报名 ${item.registeredCount} · 不限名额`
      : `已报名 ${item.registeredCount} / ${item.maxRegistrations}`,
  };
}
const MAX = 2147483647;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: string[]) =>
  Object.keys(v).length === fields.length && fields.every((k) => Object.prototype.hasOwnProperty.call(v, k));
const integer = (v: unknown, min = 1) => Number.isInteger(v) && Number(v) >= min && Number(v) <= MAX;
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && Array.from(v).length <= max && !v.includes('\u0000') && !/[\ud800-\udfff]/u.test(v);
function fail(response = false): never {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '免费活动响应无效，请重试' : '免费活动时间或名额格式无效');
}
export function normalizeFreeInstant(v: unknown, response = false): string {
  if (typeof v !== 'string') fail(response);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) fail(response);
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (year < 1 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59 ||
      (m[8] !== 'Z' && (Number(m[8].slice(1, 3)) > 23 || Number(m[8].slice(4)) > 59)) ||
      !Number.isFinite(Date.parse(v))) fail(response);
  return new Date(v).toISOString();
}
export function normalizeFreeSettings(v: FreeSettings, response = false): FreeSettings {
  if (!object(v) || !exact(v, ['startsAt', 'endsAt', 'capacityMode', 'maxRegistrations'])) fail(response);
  const startsAt = v.startsAt === null ? null : normalizeFreeInstant(v.startsAt, response);
  const endsAt = v.endsAt === null ? null : normalizeFreeInstant(v.endsAt, response);
  if (![null, 'UNLIMITED', 'LIMITED'].includes(v.capacityMode) ||
      (v.maxRegistrations !== null && !integer(v.maxRegistrations)) ||
      (v.capacityMode === 'UNLIMITED' && v.maxRegistrations !== null) ||
      (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt))) fail(response);
  return { startsAt, endsAt, capacityMode: v.capacityMode, maxRegistrations: v.maxRegistrations };
}
function timezone(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 100 || !/^[A-Za-z0-9_+/-]+$/.test(v)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: v }).format(0); return true; } catch { return false; }
}
function configuration(v: unknown, id: string, base: string): FreeConfiguration {
  if (!object(v) || !exact(v, ['draftId', 'version', 'campusTimezone', 'freeRegistration',
    'campaignId', 'publishedVersionId', 'publishedVersion', 'publishedShareImage', 'campaignVersion', 'lifecycle']) ||
    v.draftId !== id || !integer(v.version) || !timezone(v.campusTimezone) ||
    (v.campaignId !== null && !uuid(v.campaignId)) ||
    (v.publishedVersionId !== null && !uuid(v.publishedVersionId)) ||
    (v.campaignVersion !== null && !integer(v.campaignVersion)) ||
    ![null, 'OPEN', 'CLOSED'].includes(v.lifecycle as null) ||
    (v.campaignId === null && (v.publishedVersionId !== null || v.campaignVersion !== null || v.lifecycle !== null)) ||
    (v.campaignId !== null && (v.campaignVersion === null || v.lifecycle === null))) fail(true);
  const publishedVersion = v.publishedVersion === null ? null : review(v.publishedVersion, id);
  if ((v.publishedVersionId === null) !== (publishedVersion === null) ||
    (publishedVersion === null && v.publishedShareImage !== null) ||
    (publishedVersion && (publishedVersion.versionId !== v.publishedVersionId ||
      publishedVersion.campaignId !== v.campaignId || publishedVersion.status !== 'APPROVED'))) fail(true);
  const publishedShareImage = parseCampaignImages({
    draftId: id, version: v.version, images: { cover: null, share: v.publishedShareImage },
  }, id, base).images.share;
  return { ...v, publishedVersion, publishedShareImage,
    freeRegistration: normalizeFreeSettings(v.freeRegistration as FreeSettings, true) } as FreeConfiguration;
}
function receipt(v: unknown, id: string, expected: number): CampaignDraftReceipt {
  if (!object(v) || !exact(v, ['draftId', 'status', 'version', 'createdAt', 'updatedAt']) ||
      v.draftId !== id || v.status !== 'DRAFT' || !integer(v.version) ||
      Number(v.version) < expected) fail(true);
  normalizeFreeInstant(v.createdAt, true); normalizeFreeInstant(v.updatedAt, true);
  return v as unknown as CampaignDraftReceipt;
}
function review(v: unknown, id: string): FreeReview {
  const fields = ['versionId', 'campaignId', 'draftId', 'campusId', 'title', 'status', 'version',
    'sequence', 'submittedAt', 'reviewedAt', 'reviewReason'];
  if (!object(v) || !exact(v, fields) || v.draftId !== id ||
      !['versionId', 'campaignId', 'campusId'].every((k) => uuid(v[k])) ||
      !text(v.title, 40) || !integer(v.version) || !integer(v.sequence) ||
      !['SUBMITTED', 'APPROVED', 'REJECTED'].includes(String(v.status)) ||
      (v.reviewReason !== null && !text(v.reviewReason, 1000))) fail(true);
  normalizeFreeInstant(v.submittedAt, true);
  if (v.reviewedAt !== null) normalizeFreeInstant(v.reviewedAt, true);
  if ((v.status === 'SUBMITTED' && (v.reviewedAt !== null || v.reviewReason !== null)) ||
      (v.status !== 'SUBMITTED' && v.reviewedAt === null) ||
      (v.status === 'REJECTED' && (!v.reviewReason || !String(v.reviewReason).trim())) ||
      (v.status === 'APPROVED' && v.reviewReason !== null)) fail(true);
  return v as unknown as FreeReview;
}
function registration(v: unknown): FreeRegistration {
  if (!object(v) || !exact(v, ['registrationId', 'versionId', 'status', 'registeredAt', 'cancelledAt', 'studentName']) ||
      !uuid(v.registrationId) || !uuid(v.versionId) || !['REGISTERED', 'CANCELLED'].includes(String(v.status)) ||
      (v.studentName !== null && !text(v.studentName, 100)) ||
      (v.status === 'REGISTERED' && v.cancelledAt !== null) ||
      (v.status === 'CANCELLED' && v.cancelledAt === null)) fail(true);
  normalizeFreeInstant(v.registeredAt, true);
  if (v.cancelledAt !== null && Date.parse(normalizeFreeInstant(v.cancelledAt, true)) < Date.parse(String(v.registeredAt))) fail(true);
  return v as unknown as FreeRegistration;
}
function ownedCampaign(v: unknown, phase: 'ONGOING' | 'ENDED'): OwnedFreeCampaign {
  if (!object(v) || !exact(v, ['campaignId', 'versionId', 'draftId', 'sequence', 'title',
    'startsAt', 'endsAt', 'timezone', 'availability', 'registeredCount', 'maxRegistrations', 'remainingRegistrations']) ||
    !['campaignId', 'versionId', 'draftId'].every((k) => uuid(v[k])) ||
    !integer(v.sequence) || !text(v.title, 40) || !v.title.trim() || !timezone(v.timezone) ||
    !(phase === 'ONGOING' ? ['NOT_STARTED', 'AVAILABLE', 'FULL'] : ['ENDED', 'CLOSED']).includes(String(v.availability)) ||
    !integer(v.registeredCount, 0) ||
    (v.maxRegistrations !== null && !integer(v.maxRegistrations)) ||
    (v.remainingRegistrations !== null && !integer(v.remainingRegistrations, 0))) fail(true);
  const start = normalizeFreeInstant(v.startsAt, true), end = normalizeFreeInstant(v.endsAt, true);
  if (Date.parse(end) <= Date.parse(start) ||
      (v.maxRegistrations === null ? v.remainingRegistrations !== null :
        v.remainingRegistrations !== Math.max(0, Number(v.maxRegistrations) - Number(v.registeredCount))) ||
      (v.availability === 'FULL' && (v.maxRegistrations === null || v.remainingRegistrations !== 0)) ||
      (v.availability === 'AVAILABLE' && v.remainingRegistrations === 0)) fail(true);
  return v as unknown as OwnedFreeCampaign;
}
function pagination<T>(v: Record<string, unknown>, page: number, parse: (row: unknown) => T): FreePage<T> {
  const m = v.meta;
  if (!Array.isArray(v.data) || !object(m) || !exact(m, ['page', 'pageSize', 'total', 'totalPages']) ||
      m.page !== page || m.pageSize !== 20 || !integer(m.total, 0) || !integer(m.totalPages, 0) ||
      m.totalPages !== Math.ceil(Number(m.total) / 20) ||
      v.data.length !== Math.min(20, Math.max(0, Number(m.total) - (page - 1) * 20))) fail(true);
  const rows = v.data.map(parse);
  return { data: rows, meta: m as unknown as FreePage<T>['meta'] };
}
type Basics = Pick<PartnerCampaignDraftService, 'get' | 'save' | 'create' | 'getSessionKey' | 'setMockFreeSummary'> &
  Partial<Pick<PartnerCampaignDraftService, 'saveContent' | 'saveRegistrationForm' | 'getImages' | 'uploadImage' | 'clearImage'>>;
interface Options {
  dataDriver: 'mock' | 'api'; apiBaseUrl?: string; accessToken: () => string;
  request?: SessionHttpRequest; isCurrent?: () => boolean; basics?: Basics;
}
interface MockDraft {
  version: number; sourceVersion: number; settings: FreeSettings; reviews: FreeReview[];
  campaignId: string | null; updatedAt: string;
  latestSubmission: CampaignSubmissionSummary | null;
}
const emptySettings = (): FreeSettings => ({ startsAt: null, endsAt: null, capacityMode: null, maxRegistrations: null });
export class PartnerFreeCampaignService {
  private readonly imageStates = new Map<string, CampaignImages['images']>();
  private readonly imageReceipts = new Map<string, { fingerprint: string; receipt: CampaignDraftReceipt }>();
  private imageSequence = 0;
  private readonly drafts = new Map<string, MockDraft>();
  private readonly submissions = new Map<string, { id: string; version: number; result: FreeReview }>();
  private readonly basics: Basics;
  constructor(private readonly options: Options) { this.basics = options.basics ?? getPartnerCampaignDraftService(); }
  getSessionKey() {
    if (this.options.isCurrent && !this.options.isCurrent()) return '';
    return `${this.options.dataDriver}:${this.options.apiBaseUrl ?? ''}:${this.options.accessToken()}`;
  }
  private owner() {
    const key = this.getSessionKey();
    if (!key || (this.options.dataDriver === 'api' && !this.options.accessToken().trim()))
      throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新，请重新登录');
    return key;
  }
  private validate(id: string, version?: number) {
    if (!uuid(id) || (version !== undefined && !integer(version))) fail();
    this.owner();
  }
  private async mockDraft(id: string) {
    const owner = this.owner();
    const draft = await this.basics.get(id);
    if (owner !== this.owner()) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新');
    const key = `${owner}:${id}`;
    let state = this.drafts.get(key);
    if (!state) {
      state = { version: draft.version, sourceVersion: draft.version, settings: emptySettings(),
        reviews: [], campaignId: null, updatedAt: draft.updatedAt, latestSubmission: null };
      this.drafts.set(key, state);
    } else if (draft.version !== state.sourceVersion) {
      state.version += draft.version - state.sourceVersion;
      state.sourceVersion = draft.version;
      state.updatedAt = draft.updatedAt;
    }
    this.syncMockSummary(id, state);
    return { draft, state };
  }
  private syncMockSummary(id: string, state: MockDraft) {
    this.basics.setMockFreeSummary(id, {
      sourceVersion: state.sourceVersion, version: state.version, updatedAt: state.updatedAt,
      latestSubmission: state.latestSubmission, lifecycle: state.campaignId ? 'OPEN' : null,
    });
  }
  // The existing mock owns basic fields; this local overlay owns the shared version added by free saves.
  async getBasicDraft(id: string): Promise<CampaignDraft> {
    this.validate(id);
    if (this.options.dataDriver === 'api') return this.basics.get(id);
    const { draft, state } = await this.mockDraft(id);
    return { ...draft, version: state.version, updatedAt: state.updatedAt };
  }
  async saveBasics(id: string, expectedVersion: number, input: CampaignBasics): Promise<CampaignDraftReceipt> {
    this.validate(id, expectedVersion);
    if (this.options.dataDriver === 'api') return this.basics.save(id, expectedVersion, input);
    const owner = this.owner();
    const { draft, state } = await this.mockDraft(id);
    const normalized = normalizeCampaignBasics(input);
    const same = JSON.stringify(draft.basicInformation) === JSON.stringify(normalized);
    if (same && (expectedVersion === state.version || expectedVersion === state.version - 1)) {
      const { basicInformation: _, activityContent: _content, registrationForm: _form, ...result } = draft;
      return { ...result, version: state.version, updatedAt: state.updatedAt };
    }
    if (expectedVersion !== state.version || state.version === MAX) this.conflict();
    const result = await this.basics.save(id, state.sourceVersion, normalized);
    if (owner !== this.owner()) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新');
    state.version += result.version - state.sourceVersion;
    state.sourceVersion = result.version; state.updatedAt = result.updatedAt;
    this.syncMockSummary(id, state);
    return { ...result, version: state.version };
  }
  async saveContent(id: string, expectedVersion: number, input: string | null): Promise<CampaignDraftReceipt> {
    this.validate(id, expectedVersion);
    const normalized = normalizeCampaignContent(input);
    if (!this.basics.saveContent) fail();
    if (this.options.dataDriver === 'api') return this.basics.saveContent(id, expectedVersion, normalized);
    const owner = this.owner();
    const { draft, state } = await this.mockDraft(id);
    if ((draft.activityContent ?? null) === normalized &&
      (expectedVersion === state.version || expectedVersion === state.version - 1)) {
      const { basicInformation: _, activityContent: _content, registrationForm: _form, ...result } = draft;
      return { ...result, version: state.version, updatedAt: state.updatedAt };
    }
    if (expectedVersion !== state.version || state.version === MAX) this.conflict();
    const result = await this.basics.saveContent(id, state.sourceVersion, normalized);
    if (owner !== this.owner()) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新');
    state.version += result.version - state.sourceVersion;
    state.sourceVersion = result.version; state.updatedAt = result.updatedAt;
    this.syncMockSummary(id, state);
    return { ...result, version: state.version };
  }
  async saveRegistrationForm(id: string, expectedVersion: number, input: unknown): Promise<CampaignDraftReceipt> {
    this.validate(id, expectedVersion);
    const normalized = normalizeRegistrationForm(input);
    if (!this.basics.saveRegistrationForm) fail();
    if (this.options.dataDriver === 'api') return this.basics.saveRegistrationForm(id, expectedVersion, normalized);
    const owner = this.owner();
    const { draft, state } = await this.mockDraft(id);
    if (JSON.stringify(draft.registrationForm ?? []) === JSON.stringify(normalized) &&
      (expectedVersion === state.version || expectedVersion === state.version - 1)) {
      const { basicInformation: _, activityContent: _content, registrationForm: _form, ...result } = draft;
      return { ...result, version: state.version, updatedAt: state.updatedAt };
    }
    if (expectedVersion !== state.version || state.version === MAX) this.conflict();
    const result = await this.basics.saveRegistrationForm(id, state.sourceVersion, normalized);
    if (owner !== this.owner()) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新');
    state.version += result.version - state.sourceVersion;
    state.sourceVersion = result.version; state.updatedAt = result.updatedAt;
    this.syncMockSummary(id, state);
    return { ...result, version: state.version };
  }
  async getConfiguration(id: string): Promise<FreeConfiguration> {
    this.validate(id);
    if (this.options.dataDriver === 'api') return configuration((await this.send('GET', id, 'free-registration')).data,
      id, this.options.apiBaseUrl?.trim().replace(/\/+$/, '') ?? '');
    const { state } = await this.mockDraft(id);
    return { draftId: id, version: state.version, campusTimezone: 'Asia/Shanghai',
      freeRegistration: { ...state.settings }, campaignId: state.campaignId, publishedVersionId: null, publishedVersion: null,
      publishedShareImage: null,
      campaignVersion: state.campaignId ? 1 : null, lifecycle: state.campaignId ? 'OPEN' : null };
  }
  async getImages(id: string): Promise<CampaignImages> {
    this.validate(id);
    if (this.options.dataDriver === 'api') {
      if (!this.basics.getImages) fail();
      return this.basics.getImages(id);
    }
    const { state } = await this.mockDraft(id);
    return { draftId: id, version: state.version, images: { ...(this.imageStates.get(`${this.owner()}:${id}`) ?? { cover: null, share: null }) } };
  }
  async uploadImage(id: string, expectedVersion: number, slot: CampaignImageSlot, path: string, key: string): Promise<CampaignDraftReceipt> {
    this.validate(id, expectedVersion);
    if (!campaignImageSlot(slot) || !path || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) fail();
    if (this.options.dataDriver === 'api') {
      if (!this.basics.uploadImage) fail();
      return this.basics.uploadImage(id, expectedVersion, slot, path, key);
    }
    const owner = this.owner(), fingerprint = JSON.stringify([id, expectedVersion, slot, path]);
    const prior = this.imageReceipts.get(`${owner}:${key}`);
    if (prior) {
      if (prior.fingerprint !== fingerprint) this.conflict();
      return { ...prior.receipt };
    }
    const { draft, state } = await this.mockDraft(id);
    if (expectedVersion !== state.version || state.version === MAX) this.conflict();
    state.version++; state.updatedAt = new Date().toISOString();
    const image = { id: `00000000-0000-4000-8000-${String(900000000000 + ++this.imageSequence)}`,
      mimeType: 'image/png' as const, sizeBytes: 1024, accessUrl: path, accessUrlExpiresAt: new Date(Date.now() + 900000).toISOString() };
    const images = this.imageStates.get(`${owner}:${id}`) ?? { cover: null, share: null };
    this.imageStates.set(`${owner}:${id}`, { ...images, [slot]: image });
    const result: CampaignDraftReceipt = { draftId: id, status: 'DRAFT', version: state.version,
      createdAt: draft.createdAt, updatedAt: state.updatedAt };
    this.imageReceipts.set(`${owner}:${key}`, { fingerprint, receipt: result });
    this.syncMockSummary(id, state);
    return { ...result };
  }
  async clearImage(id: string, expectedVersion: number, slot: CampaignImageSlot): Promise<CampaignDraftReceipt> {
    this.validate(id, expectedVersion);
    if (!campaignImageSlot(slot)) fail();
    if (this.options.dataDriver === 'api') {
      if (!this.basics.clearImage) fail();
      return this.basics.clearImage(id, expectedVersion, slot);
    }
    const { draft, state } = await this.mockDraft(id), owner = this.owner();
    const images = this.imageStates.get(`${owner}:${id}`) ?? { cover: null, share: null };
    if (!(images[slot] === null && [state.version, state.version - 1].includes(expectedVersion))) {
      if (expectedVersion !== state.version || state.version === MAX) this.conflict();
      state.version++; state.updatedAt = new Date().toISOString();
      this.imageStates.set(`${owner}:${id}`, { ...images, [slot]: null });
    }
    this.syncMockSummary(id, state);
    return { draftId: id, status: 'DRAFT', version: state.version, createdAt: draft.createdAt, updatedAt: state.updatedAt };
  }
  async saveConfiguration(id: string, expectedVersion: number, input: FreeSettings): Promise<CampaignDraftReceipt> {
    this.validate(id, expectedVersion);
    const normalized = normalizeFreeSettings(input);
    if (this.options.dataDriver === 'api') return receipt((await this.send('PUT', id, 'free-registration',
      { expectedVersion, freeRegistration: normalized })).data, id, expectedVersion);
    const { draft, state } = await this.mockDraft(id);
    if (draft.basicInformation.campaignType !== 'FREE_REGISTRATION') fail();
    const same = JSON.stringify(state.settings) === JSON.stringify(normalized);
    if (!(same && (expectedVersion === state.version || expectedVersion === state.version - 1))) {
      if (expectedVersion !== state.version || state.version === MAX) this.conflict();
      state.settings = normalized; state.version += 1; state.updatedAt = new Date().toISOString();
    }
    const { basicInformation: _, activityContent: _content, registrationForm: _form, ...result } = draft;
    this.syncMockSummary(id, state);
    return { ...result, version: state.version, updatedAt: state.updatedAt };
  }
  async submit(id: string, expectedVersion: number, key: string): Promise<FreeReview> {
    this.validate(id, expectedVersion);
    if (typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) fail();
    if (this.options.dataDriver === 'api') return review((await this.send('POST', id, 'submit', { expectedVersion }, key)).data, id);
    const owner = this.owner(), { draft, state } = await this.mockDraft(id);
    const replay = this.submissions.get(`${owner}:${key}`);
    if (replay) {
      if (replay.id !== id || replay.version !== expectedVersion) this.conflict();
      return { ...replay.result };
    }
    if (state.version !== expectedVersion || state.reviews.some((v) => v.status === 'SUBMITTED')) this.conflict();
    if (draft.basicInformation.campaignType !== 'FREE_REGISTRATION' || !draft.basicInformation.title ||
        !draft.basicInformation.shareDescription || !state.settings.startsAt || !state.settings.endsAt ||
        !state.settings.capacityMode || (state.settings.capacityMode === 'LIMITED' && !state.settings.maxRegistrations)) fail();
    if (Date.parse(state.settings.endsAt) <= Date.now()) this.conflict();
    state.campaignId ??= this.syntheticId();
    const result: FreeReview = { versionId: this.syntheticId(), campaignId: state.campaignId, draftId: id,
      campusId: '00000000-0000-4000-8000-000000000000', title: draft.basicInformation.title,
      status: 'SUBMITTED', version: 1, sequence: state.reviews.length + 1,
      submittedAt: new Date().toISOString(), reviewedAt: null, reviewReason: null };
    state.reviews.unshift(result);
    state.latestSubmission = { sequence: result.sequence, sourceDraftVersion: expectedVersion, status: result.status, reviewReason: null };
    this.syncMockSummary(id, state);
    this.submissions.set(`${owner}:${key}`, { id, version: expectedVersion, result });
    return { ...result };
  }
  async versions(id: string, page: number): Promise<FreePage<FreeReview>> {
    this.validate(id);
    if (!integer(page)) fail();
    if (this.options.dataDriver === 'api') {
      const result = pagination(await this.send('GET', id, `versions?page=${page}&pageSize=20`), page, (v) => review(v, id));
      if (new Set(result.data.map((v) => v.versionId)).size !== result.data.length) fail(true);
      return result;
    }
    const { state } = await this.mockDraft(id);
    return { data: state.reviews.slice((page - 1) * 20, page * 20).map((v) => ({ ...v })),
      meta: { page, pageSize: 20, total: state.reviews.length, totalPages: Math.ceil(state.reviews.length / 20) } };
  }
  async registrations(id: string, page: number, status?: FreeRegistration['status']): Promise<FreePage<FreeRegistration>> {
    this.validate(id);
    if (!integer(page) || (status !== undefined && status !== 'REGISTERED' && status !== 'CANCELLED')) fail();
    if (this.options.dataDriver === 'api') {
      const route = `registrations?page=${page}&pageSize=20${status === undefined ? '' : `&status=${status}`}`;
      const result = pagination(await this.send('GET', id, route), page, registration);
      if (new Set(result.data.map((v) => v.registrationId)).size !== result.data.length ||
        (status !== undefined && result.data.some((v) => v.status !== status))) fail(true);
      return result;
    }
    await this.mockDraft(id);
    return { data: [], meta: { page, pageSize: 20, total: 0, totalPages: 0 } };
  }
  async published(page: number, phase: 'ONGOING' | 'ENDED'): Promise<FreePage<OwnedFreeCampaign>> {
    this.owner();
    if (!integer(page) || (phase !== 'ONGOING' && phase !== 'ENDED')) fail();
    // This mock has no administrator approval command; submitted private drafts stay unpublished.
    if (this.options.dataDriver === 'mock') return {
      data: [], meta: { page, pageSize: 20, total: 0, totalPages: 0 },
    };
    const response = await this.sendPath('GET',
      `/partners/me/free-campaigns?page=${page}&pageSize=20&phase=${phase}`, true);
    const result = pagination(response, page, (row) => ownedCampaign(row, phase));
    if (new Set(result.data.map((row) => row.campaignId)).size !== result.data.length) fail(true);
    return result;
  }
  private syntheticId() {
    return '00000000-0000-4000-8000-' + Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }
  private conflict(): never { throw new SessionServiceError(409, 'FREE_CAMPAIGN_VERSION_CONFLICT', '活动已更新，请显式重读'); }
  private send(method: 'GET' | 'PUT' | 'POST', id: string, route: string, data?: unknown, key?: string): Promise<Record<string, unknown>> {
    return this.sendPath(method, `/partners/me/campaign-drafts/${id}/${route}`,
      route.startsWith('versions?') || route.startsWith('registrations?'), data, key);
  }
  private sendPath(method: 'GET' | 'PUT' | 'POST', path: string, paginated: boolean, data?: unknown, key?: string): Promise<Record<string, unknown>> {
    const owner = this.owner(), base = this.options.apiBaseUrl?.trim().replace(/\/+$/, '');
    if (!base || !/^https?:\/\//.test(base)) return Promise.reject(new SessionServiceError(503, 'CONFIGURATION_REQUIRED', '活动服务尚未配置'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        try {
          if (this.owner() !== owner) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新');
          action();
        } catch (error) { reject(error); }
      };
      const timer = setTimeout(() => finish(() => reject(new SessionServiceError(0, 'TIMEOUT', '活动请求结果暂未确认'))), 15000);
      try {
        (this.options.request ?? defaultRequest)({
          url: `${base}${path}`, method, data,
          header: { Authorization: `Bearer ${this.options.accessToken()}`, 'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}) },
          success: (res) => finish(() => {
            if (res.statusCode !== 200) reject(new SessionServiceError(res.statusCode, 'FREE_CAMPAIGN_REQUEST_FAILED', '免费活动请求失败，请重试'));
            else if (!object(res.data) || !exact(res.data, paginated
              ? ['data', 'meta', 'requestId'] : ['data', 'requestId']) ||
              !text(res.data.requestId, 128) || !res.data.requestId.trim()) fail(true);
            else resolve(res.data);
          }),
          fail: () => finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应'))),
        });
      } catch { finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应'))); }
    });
  }
}
let cached: { key: string; service: PartnerFreeCampaignService } | undefined;
export function getPartnerFreeCampaignService(): PartnerFreeCampaignService {
  const env = createPartnerRuntimeEnv(), base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  const key = `${env.dataDriver}:${base}`;
  if (!cached || cached.key !== key) cached = { key, service: new PartnerFreeCampaignService({
    dataDriver: env.dataDriver, apiBaseUrl: base, accessToken: () => createPartnerRuntimeEnv().accessToken,
    isCurrent: () => {
      const current = createPartnerRuntimeEnv();
      return `${current.dataDriver}:${current.apiBaseUrl.trim().replace(/\/+$/, '')}` === key;
    },
  }) };
  return cached.service;
}
