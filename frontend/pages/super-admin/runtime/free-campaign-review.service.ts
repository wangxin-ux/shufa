import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';

export type FreeCampaignReviewStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';
export interface FrozenFreeCampaignImage {
  id: string; mimeType: 'image/png' | 'image/jpeg'; sizeBytes: number;
  accessUrl: string; accessUrlExpiresAt: string;
}
export interface FrozenFreeCampaignConfiguration {
  title: string; campaignType: 'FREE_REGISTRATION'; shareDescription: string; contactPhone: string | null;
  activityContent?: string | null;
  images?: { cover: FrozenFreeCampaignImage | null; share: FrozenFreeCampaignImage | null };
  startsAt: string; endsAt: string; timezone: string; capacityMode: 'UNLIMITED' | 'LIMITED';
  maxRegistrations: number | null; feeFen: 0; benefitMode: 'NONE'; registrationLimit: 'ONCE_PER_STUDENT';
}
export interface FreeCampaignReviewSummary {
  versionId: string; campaignId: string; draftId: string; campusId: string; title: string;
  status: FreeCampaignReviewStatus; version: number; sequence: number; submittedAt: string;
  reviewedAt: string | null; reviewReason: string | null;
}
export interface FreeCampaignReviewDetail extends FreeCampaignReviewSummary {
  configuration: FrozenFreeCampaignConfiguration; sourceDraftVersion: number; campaignVersion: number;
  lifecycle: 'OPEN' | 'CLOSED'; publishedVersionId: string | null;
}
export interface FreeCampaignLifecycleReceipt { campaignId: string; lifecycle: 'CLOSED'; version: number }
export interface FreeCampaignReviewPage {
  data: FreeCampaignReviewSummary[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface FreeCampaignReviewPort {
  readonly isMock: boolean;
  getSessionKey(): string;
  invalidateReads(): void;
  list(page: number, status: FreeCampaignReviewStatus | ''): Promise<FreeCampaignReviewPage>;
  detail(versionId: string): Promise<FreeCampaignReviewDetail>;
  approve(versionId: string, version: number, key: string): Promise<FreeCampaignReviewSummary>;
  reject(versionId: string, version: number, reason: string, key: string): Promise<FreeCampaignReviewSummary>;
  close(campaignId: string, version: number, reason: string, key: string): Promise<FreeCampaignLifecycleReceipt>;
}

const MAX = 2_147_483_647;
const STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'];
const SUMMARY = ['versionId', 'campaignId', 'draftId', 'campusId', 'title', 'status', 'version',
  'sequence', 'submittedAt', 'reviewedAt', 'reviewReason'];
const DETAIL = [...SUMMARY, 'configuration', 'sourceDraftVersion', 'campaignVersion', 'lifecycle', 'publishedVersionId'];
const CONFIGURATION = ['title', 'campaignType', 'shareDescription', 'contactPhone', 'startsAt', 'endsAt',
  'timezone', 'capacityMode', 'maxRegistrations', 'feeFen', 'benefitMode', 'registrationLimit'];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]) =>
  Reflect.ownKeys(value).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const versionNumber = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX;
const text = (value: unknown, max: number, nonblank = false): value is string =>
  typeof value === 'string' && Array.from(value).length <= max && !value.includes('\u0000') &&
  !/[\ud800-\udfff]/u.test(value) && (!nonblank || Boolean(value.trim()));
function time(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,3}))?Z$/.exec(value);
  return Boolean(parts && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === `${parts[1]}.${(parts[2] ?? '').padEnd(3, '0')}Z`);
}
function timezone(value: unknown): value is string {
  if (!text(value, 100, true)) return false;
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: value }).format(new Date(0)); return true; } catch { return false; }
}
function failure(statusCode: number): SessionServiceError {
  return new SessionServiceError(statusCode, statusCode === 409 ? 'FREE_CAMPAIGN_VERSION_CONFLICT' : 'FREE_CAMPAIGN_REVIEW_UNAVAILABLE',
    [401, 403].includes(statusCode) ? '当前登录无活动审核权限，请重新登录'
      : statusCode === 409 ? '活动状态已更新，请重新读取' : '活动审核服务暂时不可用，请重试');
}
function invalid(): never { throw new SessionServiceError(502, 'INVALID_RESPONSE', '活动审核响应格式无效，请重试原操作'); }
function summary(value: unknown, fields: readonly string[] = SUMMARY): FreeCampaignReviewSummary {
  if (!record(value) || !exact(value, fields) ||
    !['versionId', 'campaignId', 'draftId', 'campusId'].every((field) => uuid(value[field])) ||
    !text(value.title, 40, true) || !STATUSES.includes(String(value.status)) ||
    !versionNumber(value.version) || !versionNumber(value.sequence) || !time(value.submittedAt) ||
    !(value.reviewedAt === null || time(value.reviewedAt)) ||
    !(value.reviewReason === null || text(value.reviewReason, 1000, true))) invalid();
  if (value.status === 'SUBMITTED' && (value.reviewedAt !== null || value.reviewReason !== null) ||
    value.status !== 'SUBMITTED' && value.reviewedAt === null ||
    value.status === 'REJECTED' && value.reviewReason === null) invalid();
  return Object.fromEntries(SUMMARY.map((field) => [field, value[field]])) as unknown as FreeCampaignReviewSummary;
}
function campaignImage(value: unknown, baseUrl: string): FrozenFreeCampaignImage | null {
  if (value === null) return null;
  if (!record(value) || !exact(value, ['id', 'mimeType', 'sizeBytes', 'accessUrl', 'accessUrlExpiresAt']) ||
    typeof value.id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id) ||
    !(value.mimeType === 'image/png' || value.mimeType === 'image/jpeg') ||
    !Number.isSafeInteger(value.sizeBytes) || Number(value.sizeBytes) < 1 || Number(value.sizeBytes) > 3145728 ||
    !time(value.accessUrlExpiresAt) || typeof value.accessUrl !== 'string') invalid();
  const signed = /^\/media\/partner-campaign-images\/([0-9a-fA-F-]+)\?expires=(\d+)&signature=([0-9a-f]{64})$/.exec(value.accessUrl);
  if (!signed || signed[0] !== value.accessUrl || signed[1] !== value.id ||
    !Number.isSafeInteger(Number(signed[2]))) invalid();
  return { ...value, accessUrl: baseUrl + value.accessUrl } as unknown as FrozenFreeCampaignImage;
}
function configuration(value: unknown, baseUrl: string): FrozenFreeCampaignConfiguration {
  if (!record(value)) invalid();
  const hasContent = Object.prototype.hasOwnProperty.call(value, 'activityContent');
  const hasImages = Object.prototype.hasOwnProperty.call(value, 'images');
  if (!exact(value, [...CONFIGURATION, ...(hasContent ? ['activityContent'] : []), ...(hasImages ? ['images'] : [])]) || !text(value.title, 40, true) ||
    !text(value.shareDescription, 1000, true) || !(value.contactPhone === null || text(value.contactPhone, 30)) ||
    value.campaignType !== 'FREE_REGISTRATION' || !time(value.startsAt) || !time(value.endsAt) ||
    Date.parse(value.endsAt) <= Date.parse(value.startsAt) || !timezone(value.timezone) ||
    value.feeFen !== 0 || value.benefitMode !== 'NONE' || value.registrationLimit !== 'ONCE_PER_STUDENT' ||
    !(value.capacityMode === 'UNLIMITED' && value.maxRegistrations === null ||
      value.capacityMode === 'LIMITED' && versionNumber(value.maxRegistrations))) invalid();
  if (hasContent && value.activityContent !== null && !text(value.activityContent, 10000)) invalid();
  const activityContent = hasContent ? {
    activityContent: value.activityContent === null ? null : (value.activityContent as string).trim() || null,
  } : {};
  if (hasImages && (!record(value.images) || !exact(value.images, ['cover', 'share']))) invalid();
  const images = hasImages ? value.images as Record<string, unknown> : undefined;
  return { ...value, ...activityContent, ...(images ? { images: {
    cover: campaignImage(images.cover, baseUrl), share: campaignImage(images.share, baseUrl),
  } } : {}) } as unknown as FrozenFreeCampaignConfiguration;
}
function detail(value: unknown, versionId: string, baseUrl: string): FreeCampaignReviewDetail {
  const row = summary(value, DETAIL);
  if (!record(value) || row.versionId !== versionId || !versionNumber(value.sourceDraftVersion) ||
    !versionNumber(value.campaignVersion) || !['OPEN', 'CLOSED'].includes(String(value.lifecycle)) ||
    !(value.publishedVersionId === null || uuid(value.publishedVersionId))) invalid();
  const frozen = configuration(value.configuration, baseUrl);
  if (frozen.title !== row.title) invalid();
  return { ...row, configuration: frozen, sourceDraftVersion: value.sourceDraftVersion,
    campaignVersion: value.campaignVersion, lifecycle: value.lifecycle as 'OPEN' | 'CLOSED',
    publishedVersionId: value.publishedVersionId };
}
export function normalizeFreeCampaignReviewReason(value: string): string {
  if (!text(value, 1000, true)) throw failure(400);
  return value.trim();
}
function actionInput(id: string, version: number, key: string) {
  if (!uuid(id) || !versionNumber(version) || version === MAX || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw failure(400);
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class ApiFreeCampaignReviewService implements FreeCampaignReviewPort {
  readonly isMock = false;
  private revision = 0;
  constructor(private readonly options: {
    baseUrl: string; session: () => { key: string; token: string }; request?: SessionHttpRequest;
  }) {}
  getSessionKey() { return this.options.session().key; }
  invalidateReads() { ++this.revision; }
  async list(page: number, status: FreeCampaignReviewStatus | ''): Promise<FreeCampaignReviewPage> {
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || status && !STATUSES.includes(status)) throw failure(400);
    const value = await this.send(`/management/campaign-reviews?page=${page}&pageSize=20${status ? `&status=${status}` : ''}`);
    this.envelope(value, true);
    if (!record(value) || !Array.isArray(value.data) || value.data.length > 20 || !record(value.meta) ||
      !exact(value.meta, ['page', 'pageSize', 'total', 'totalPages']) || value.meta.page !== page || value.meta.pageSize !== 20 ||
      !Number.isSafeInteger(value.meta.total) || Number(value.meta.total) < 0 ||
      value.meta.totalPages !== Math.ceil(Number(value.meta.total) / 20) ||
      value.data.length > Math.max(0, Math.min(20, Number(value.meta.total) - (page - 1) * 20))) invalid();
    const rows = value.data.map((row) => summary(row));
    if (rows.some((row) => status && row.status !== status) || new Set(rows.map((row) => row.versionId)).size !== rows.length) invalid();
    return { data: rows, meta: value.meta as unknown as FreeCampaignReviewPage['meta'] };
  }
  async detail(versionId: string): Promise<FreeCampaignReviewDetail> {
    if (!uuid(versionId)) throw failure(400);
    return detail(this.envelope(await this.send(`/management/campaign-reviews/${versionId}`)),
      versionId, this.options.baseUrl.trim().replace(/\/+$/, ''));
  }
  approve(versionId: string, version: number, key: string) {
    return this.review(versionId, version, key, 'approve');
  }
  reject(versionId: string, version: number, reason: string, key: string) {
    return this.review(versionId, version, key, 'reject', reason);
  }
  private async review(id: string, version: number, key: string, action: 'approve' | 'reject', reason?: string) {
    actionInput(id, version, key);
    const normalized = action === 'reject' ? normalizeFreeCampaignReviewReason(reason ?? '') : undefined;
    const row = summary(this.envelope(await this.send(`/management/campaign-reviews/${id}/${action}`,
      { expectedVersion: version, ...(normalized !== undefined ? { reason: normalized } : {}) }, key)));
    if (row.versionId !== id || row.version !== version + 1 || row.status !== (action === 'approve' ? 'APPROVED' : 'REJECTED') ||
      action === 'reject' && row.reviewReason !== normalized) invalid();
    return row;
  }
  async close(id: string, version: number, reason: string, key: string): Promise<FreeCampaignLifecycleReceipt> {
    actionInput(id, version, key);
    const value = this.envelope(await this.send(`/management/campaigns/${id}/close`,
      { expectedVersion: version, reason: normalizeFreeCampaignReviewReason(reason) }, key));
    if (!record(value) || !exact(value, ['campaignId', 'lifecycle', 'version']) ||
      value.campaignId !== id || value.lifecycle !== 'CLOSED' || value.version !== version + 1) invalid();
    return { campaignId: id, lifecycle: 'CLOSED', version: value.version as number };
  }
  private envelope(value: unknown, paginated = false): unknown {
    if (!record(value) || !exact(value, paginated ? ['data', 'meta', 'requestId'] : ['data', 'requestId']) ||
      !text(value.requestId, 128, true)) invalid();
    return value.data;
  }
  private send(path: string, body?: unknown, key?: string): Promise<unknown> {
    const session = this.options.session(); const revision = this.revision;
    if (!session.key || !session.token) return Promise.reject(failure(401));
    const baseUrl = this.options.baseUrl.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/(?:\[[0-9a-f:]+\]|[^/:\s?#@\\]+)(?::\d+)?(?:\/[^\s?#\\]*)?$/.test(baseUrl)) return Promise.reject(failure(400));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (response?: { statusCode: number; data: unknown }, error?: unknown) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (this.getSessionKey() !== session.key) {
          reject(new SessionServiceError(409, 'SESSION_SUPERSEDED', '登录已更新，请重新登录')); return;
        }
        if (body === undefined && revision !== this.revision) {
          reject(new SessionServiceError(409, 'READ_SUPERSEDED', '读取已失效')); return;
        }
        if (error || !response) reject(failure(0));
        else if (response.statusCode !== 200) reject(failure(response.statusCode));
        else resolve(response.data);
      };
      const timer = setTimeout(() => finish(undefined, true), 15_000);
      try {
        (this.options.request ?? defaultRequest)({
          url: baseUrl + path, method: body === undefined ? 'GET' : 'POST',
          header: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json',
            ...(key ? { 'Idempotency-Key': key } : {}) },
          data: body, success: (response) => finish(response), fail: () => finish(undefined, true),
        });
      } catch { finish(undefined, true); }
    });
  }
}

function syntheticCandidates(): Map<string, FreeCampaignReviewDetail> {
  return new Map(['SUBMITTED', 'APPROVED', 'REJECTED'].map((state, index) => {
    const suffix = String(index + 1).padStart(12, '0');
    const id = `10000000-0000-4000-8000-${suffix}`;
    const row: FreeCampaignReviewDetail = {
      versionId: id, campaignId: `20000000-0000-4000-8000-${suffix}`,
      draftId: `30000000-0000-4000-8000-${suffix}`, campusId: '40000000-0000-4000-8000-000000000001',
      title: `合成免费活动${index + 1}`, status: state as FreeCampaignReviewStatus,
      version: state === 'SUBMITTED' ? 1 : 2, sequence: 1, submittedAt: '2026-10-13T00:00:00.000Z',
      reviewedAt: state === 'SUBMITTED' ? null : '2026-10-13T01:00:00.000Z',
      reviewReason: state === 'REJECTED' ? '合成演示：请补充活动说明' : null,
      configuration: { title: `合成免费活动${index + 1}`, campaignType: 'FREE_REGISTRATION',
        shareDescription: '合成演示活动说明', contactPhone: null,
        startsAt: '2026-10-13T00:00:00.000Z', endsAt: '2099-10-13T00:00:00.000Z', timezone: 'Asia/Shanghai',
        capacityMode: 'LIMITED', maxRegistrations: 20, feeFen: 0, benefitMode: 'NONE', registrationLimit: 'ONCE_PER_STUDENT' },
      sourceDraftVersion: 2, campaignVersion: state === 'APPROVED' ? 2 : 1,
      lifecycle: 'OPEN', publishedVersionId: state === 'APPROVED' ? id : null,
    };
    return [id, row];
  }));
}

export class MockFreeCampaignReviewService implements FreeCampaignReviewPort {
  readonly isMock = true;
  private owners = new Map<string, Map<string, FreeCampaignReviewDetail>>();
  private receipts = new Map<string, { owner: string; input: string; receipt: FreeCampaignReviewSummary | FreeCampaignLifecycleReceipt }>();
  constructor(private readonly session: () => string, private readonly authorize?: () => Promise<boolean>) {}
  getSessionKey() { return this.session(); }
  invalidateReads() {}
  private async authorizedOwner() {
    const owner = this.getSessionKey();
    if (!owner) throw failure(401);
    const allowed = this.authorize ? await this.authorize() : true;
    if (this.getSessionKey() !== owner) throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '登录已更新，请重新登录');
    if (!allowed) throw failure(403);
    return owner;
  }
  private rows(owner: string) {
    if (this.getSessionKey() !== owner) throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '登录已更新，请重新登录');
    if (!this.owners.has(owner)) this.owners.set(owner, syntheticCandidates());
    return this.owners.get(owner)!;
  }
  async list(page: number, status: FreeCampaignReviewStatus | ''): Promise<FreeCampaignReviewPage> {
    if (!Number.isInteger(page) || page < 1 || status && !STATUSES.includes(status)) throw failure(400);
    const rows = [...this.rows(await this.authorizedOwner()).values()].filter((row) => !status || row.status === status);
    return { data: rows.slice((page - 1) * 20, page * 20).map((row) => summary(Object.fromEntries(
      SUMMARY.map((field) => [field, row[field as keyof FreeCampaignReviewDetail]])))),
    meta: { page, pageSize: 20, total: rows.length, totalPages: Math.ceil(rows.length / 20) } };
  }
  async detail(id: string) {
    const row = this.rows(await this.authorizedOwner()).get(id);
    if (!row) throw failure(404);
    return clone(row);
  }
  approve(id: string, version: number, key: string) { return this.review(id, version, key, 'approve'); }
  reject(id: string, version: number, reason: string, key: string) { return this.review(id, version, key, 'reject', reason); }
  private async review(id: string, version: number, key: string, action: 'approve' | 'reject', reason?: string) {
    actionInput(id, version, key);
    const normalized = action === 'reject' ? normalizeFreeCampaignReviewReason(reason ?? '') : null;
    const row = this.rows(await this.authorizedOwner()).get(id);
    if (!row) throw failure(404);
    return this.replay(`${id}/${action}:${key}`, JSON.stringify([version, normalized]), () => {
      if (row.version !== version || row.status !== 'SUBMITTED' ||
        action === 'approve' && (row.lifecycle !== 'OPEN' || Date.now() >= Date.parse(row.configuration.endsAt))) throw failure(409);
      row.status = action === 'approve' ? 'APPROVED' : 'REJECTED'; row.version += 1;
      row.reviewedAt = new Date().toISOString(); row.reviewReason = normalized;
      if (action === 'approve') { row.publishedVersionId = id; row.campaignVersion += 1; }
      return summary(Object.fromEntries(SUMMARY.map((field) => [field, row[field as keyof FreeCampaignReviewDetail]])));
    }) as FreeCampaignReviewSummary;
  }
  async close(id: string, version: number, reason: string, key: string): Promise<FreeCampaignLifecycleReceipt> {
    actionInput(id, version, key);
    const normalized = normalizeFreeCampaignReviewReason(reason);
    const row = [...this.rows(await this.authorizedOwner()).values()].find((item) => item.campaignId === id);
    if (!row) throw failure(404);
    return this.replay(`${id}/close:${key}`, JSON.stringify([version, normalized]), () => {
      if (row.campaignVersion !== version || row.lifecycle !== 'OPEN') throw failure(409);
      row.lifecycle = 'CLOSED'; row.campaignVersion += 1;
      return { campaignId: id, lifecycle: 'CLOSED', version: row.campaignVersion };
    }) as FreeCampaignLifecycleReceipt;
  }
  private replay(route: string, input: string, act: () => FreeCampaignReviewSummary | FreeCampaignLifecycleReceipt) {
    const owner = this.getSessionKey(); const previous = this.receipts.get(route);
    if (previous) {
      if (previous.owner !== owner || previous.input !== input) throw failure(409);
      return clone(previous.receipt);
    }
    const receipt = act(); this.receipts.set(route, { owner, input, receipt: clone(receipt) }); return clone(receipt);
  }
}
