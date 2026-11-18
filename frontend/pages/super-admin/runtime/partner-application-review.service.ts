import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';

export interface ReviewSummary {
  applicationId: string; submissionId: string; institutionName: string; version: number;
  status: string; submissionVersion: number; submittedAt: string;
}
export interface ReviewDetail extends Omit<ReviewSummary, 'institutionName'> {
  latest: boolean; basicInformation: Record<string, string | null>;
  materials: Array<{ storedFileId: string; kind: string; mimeType: string; sizeBytes: number; width: number; height: number }>;
  review: { reviewId: string; decision: string; reason: string; reviewedAt: string } | null;
}
export interface BankInformation { bankName: string | null; accountHolder: string | null; accountNumber: string | null }
export interface ApprovalReceipt {
  applicationId: string; submissionId: string; reviewId: string; userId: string; campusId: string;
  status: 'APPROVED'; version: number; reviewedAt: string;
}
export interface ReviewPort {
  getSessionKey(): string;
  invalidateReads(): void;
  list(page: number, status: string, query: string): Promise<{ data: ReviewSummary[]; meta: { page: number; totalPages: number } }>;
  detail(aid: string, sid: string): Promise<ReviewDetail>;
  bank(aid: string, sid: string): Promise<{ applicationId: string; submissionId: string; bankInformation: BankInformation }>;
  image(aid: string, sid: string, fid: string): Promise<string>;
  reject(aid: string, sid: string, version: number, reason: string, key: string): Promise<{ applicationId: string; submissionId: string; status: string; version: number }>;
  approve(aid: string, sid: string, version: number, key: string): Promise<ApprovalReceipt>;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const statuses = ['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'];
const time = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
function invalid(): never { throw new SessionServiceError(502, 'INVALID_RESPONSE', '审核响应格式无效'); }
const failure = (statusCode: number) => new SessionServiceError(statusCode, 'REVIEW_UNAVAILABLE',
  statusCode === 409 ? '申请已更新，请重新读取' : [401, 403].includes(statusCode) ? '当前登录无入驻审核权限' : '审核服务暂时不可用，请重试');

export class ApiPartnerApplicationReviewService implements ReviewPort {
  private revision = 0;
  private readonly request: SessionHttpRequest;
  constructor(private readonly options: {
    baseUrl: string; session: () => { key: string; token: string };
    request?: SessionHttpRequest; download?: (input: WechatMiniprogram.DownloadFileOption) => unknown;
  }) { this.request = options.request ?? defaultRequest; }
  getSessionKey() { return this.options.session().key; }
  invalidateReads() { ++this.revision; }
  private path(aid: string, sid: string) {
    if (!uuid(aid) || !uuid(sid)) throw failure(400);
    return `/management/partner-applications/${aid}/submissions/${sid}`;
  }
  async list(page = 1, status = 'SUBMITTED', query = '') {
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000 || (status && !statuses.includes(status)) || query.length > 200) throw failure(400);
    const envelope = await this.send(`/management/partner-applications?page=${page}&pageSize=20${status ? `&status=${status}` : ''}&query=${encodeURIComponent(query)}`);
    if (!record(envelope) || !exact(envelope, ['data', 'meta', 'requestId']) || !Array.isArray(envelope.data) || envelope.data.length > 20 ||
        typeof envelope.requestId !== 'string' || !record(envelope.meta) ||
        !exact(envelope.meta, ['page', 'pageSize', 'total', 'totalPages']) || envelope.meta.page !== page || envelope.meta.pageSize !== 20 ||
        !Number.isInteger(envelope.meta.total) || Number(envelope.meta.total) < 0 ||
        envelope.meta.totalPages !== Math.ceil(Number(envelope.meta.total) / 20)) invalid();
    for (const row of envelope.data) {
      if (!record(row) || !exact(row, ['applicationId', 'submissionId', 'institutionName', 'version', 'status', 'submissionVersion', 'submittedAt']) ||
          !uuid(row.applicationId) || !uuid(row.submissionId) || typeof row.institutionName !== 'string' || row.institutionName.length > 200 ||
          !Number.isInteger(row.version) || Number(row.version) < 1 || !statuses.includes(String(row.status)) ||
          !Number.isInteger(row.submissionVersion) || Number(row.submissionVersion) < 1 || !time(row.submittedAt)) invalid();
    }
    return { data: envelope.data as unknown as ReviewSummary[], meta: envelope.meta as unknown as { page: number; totalPages: number } };
  }
  async detail(aid: string, sid: string) {
    const value = this.unwrap(await this.send(this.path(aid, sid)));
    if (!record(value) || !exact(value, ['applicationId', 'submissionId', 'version', 'status', 'submissionVersion', 'submittedAt', 'latest', 'basicInformation', 'materials', 'review']) ||
        value.applicationId !== aid || value.submissionId !== sid || !Number.isInteger(value.version) || Number(value.version) < 1 ||
        !Number.isInteger(value.submissionVersion) || Number(value.submissionVersion) < 1 || !statuses.includes(String(value.status)) ||
        !time(value.submittedAt) || typeof value.latest !== 'boolean' || !record(value.basicInformation) ||
        !exact(value.basicInformation, ['institutionName', 'province', 'city', 'district', 'detailedAddress', 'contactPhone']) ||
        Object.values(value.basicInformation).some((field) => typeof field !== 'string' || field.length > 300) ||
        !Array.isArray(value.materials) || value.materials.length > 14) invalid();
    for (const file of value.materials) {
      if (!record(file) || !exact(file, ['storedFileId', 'kind', 'mimeType', 'sizeBytes', 'width', 'height']) ||
          !uuid(file.storedFileId) || !['BUSINESS_LICENSE', 'INSTITUTION_LOGO', 'LEGAL_ID_FRONT', 'LEGAL_ID_BACK', 'STORE_FRONT', 'ENVIRONMENT'].includes(String(file.kind)) ||
          !['image/png', 'image/jpeg'].includes(String(file.mimeType)) ||
          ['sizeBytes', 'width', 'height'].some((field) => !Number.isInteger(file[field]) || Number(file[field]) < 1)) invalid();
    }
    if (value.review !== null && (!record(value.review) || !exact(value.review, ['reviewId', 'decision', 'reason', 'reviewedAt']) ||
        !uuid(value.review.reviewId) || !['REJECTED', 'APPROVED'].includes(String(value.review.decision)) ||
        typeof value.review.reason !== 'string' || value.review.reason.length > 1000 || !time(value.review.reviewedAt))) invalid();
    return value as unknown as ReviewDetail;
  }
  async bank(aid: string, sid: string) {
    const value = this.unwrap(await this.send(`${this.path(aid, sid)}/bank-information`));
    if (!record(value) || !exact(value, ['applicationId', 'submissionId', 'bankInformation']) ||
        value.applicationId !== aid || value.submissionId !== sid || !record(value.bankInformation) ||
        !exact(value.bankInformation, ['bankName', 'accountHolder', 'accountNumber']) ||
        Object.values(value.bankInformation).some((field) => field !== null && (typeof field !== 'string' || field.length > 200))) invalid();
    return value as unknown as { applicationId: string; submissionId: string; bankInformation: BankInformation };
  }
  async image(aid: string, sid: string, fid: string) {
    if (!uuid(fid)) throw failure(400);
    const path = `${this.path(aid, sid)}/materials/${fid}/content`;
    const session = this.options.session(); const revision = this.revision;
    if (!session.token || !session.key) throw failure(401);
    const value = await new Promise<string>((resolve, reject) => {
      (this.options.download ?? ((input) => wx.downloadFile(input)))({
        url: this.options.baseUrl + path, header: { Authorization: `Bearer ${session.token}` },
        success: (res) => res.statusCode !== 200 ? reject(failure(res.statusCode))
          : typeof res.tempFilePath !== 'string' || !res.tempFilePath.trim() ? reject(failure(502)) : resolve(res.tempFilePath),
        fail: () => reject(failure(0)),
      });
    });
    this.current(session.key, revision); return value;
  }
  async reject(aid: string, sid: string, version: number, reason: string, key: string) {
    if (!Number.isInteger(version) || version < 1 || version >= 2_147_483_647 || !reason.trim() || reason.trim().length > 1000 || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw failure(400);
    const value = this.unwrap(await this.send(`${this.path(aid, sid)}/reject`, { expectedVersion: version, reason: reason.trim() }, key));
    if (!record(value) || !exact(value, ['applicationId', 'submissionId', 'reviewId', 'status', 'version', 'reviewedAt']) ||
        value.applicationId !== aid || value.submissionId !== sid || !uuid(value.reviewId) ||
        value.status !== 'REJECTED' || value.version !== version + 1 || !time(value.reviewedAt)) invalid();
    return value as unknown as { applicationId: string; submissionId: string; status: string; version: number };
  }
  async approve(aid: string, sid: string, version: number, key: string): Promise<ApprovalReceipt> {
    if (!Number.isInteger(version) || version < 1 || version >= 2_147_483_647 || !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw failure(400);
    const value = this.unwrap(await this.send(`${this.path(aid, sid)}/approve`, { expectedVersion: version }, key));
    if (!record(value) || !exact(value, ['applicationId', 'submissionId', 'reviewId', 'userId', 'campusId', 'status', 'version', 'reviewedAt']) ||
        value.applicationId !== aid || value.submissionId !== sid || !uuid(value.reviewId) || !uuid(value.userId) || !uuid(value.campusId) ||
        value.status !== 'APPROVED' || value.version !== version + 1 || !time(value.reviewedAt)) invalid();
    return value as unknown as ApprovalReceipt;
  }
  private unwrap(value: unknown) {
    if (!record(value) || !exact(value, ['data', 'requestId']) || typeof value.requestId !== 'string') invalid();
    return value.data;
  }
  private send(path: string, body?: unknown, key?: string) {
    const session = this.options.session(); const revision = this.revision;
    if (!session.token || !session.key) return Promise.reject(failure(401));
    return new Promise<unknown>((resolve, reject) => {
      this.request({ url: this.options.baseUrl + path, method: body ? 'POST' : 'GET',
        header: { Authorization: `Bearer ${session.token}`, ...(key ? { 'Idempotency-Key': key } : {}) }, data: body,
        success: (response) => {
          try { this.current(session.key, body ? undefined : revision); } catch (error) { reject(error); return; }
          if (response.statusCode !== 200) reject(failure(response.statusCode)); else resolve(response.data);
        }, fail: () => reject(failure(0)) });
    });
  }
  private current(key: string, revision?: number) {
    if (this.getSessionKey() !== key || (revision !== undefined && revision !== this.revision))
      throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '审核会话已更新');
  }
}

export class MockPartnerApplicationReviewService implements ReviewPort {
  constructor(private readonly session: () => string) {}
  getSessionKey() { return this.session(); }
  invalidateReads() {}
  list(page: number) { return Promise.resolve({ data: [], meta: { page, totalPages: 0 } }); }
  detail(): Promise<ReviewDetail> { return Promise.reject(failure(404)); }
  bank(): Promise<{ applicationId: string; submissionId: string; bankInformation: BankInformation }> { return Promise.reject(failure(404)); }
  image(): Promise<string> { return Promise.reject(failure(404)); }
  reject(): Promise<{ applicationId: string; submissionId: string; status: string; version: number }> { return Promise.reject(failure(404)); }
  approve(): Promise<ApprovalReceipt> { return Promise.reject(failure(404)); }
}
