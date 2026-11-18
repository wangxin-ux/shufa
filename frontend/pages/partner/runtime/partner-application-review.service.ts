import { SessionServiceError } from '../../../services/session.service';
import type { PartnerApplicantSessionService } from './partner-applicant-session.service';

export interface ApplicationHistory {
  applicationId: string | null; status: string | null; version: number; editSourceSubmissionId: string | null;
  data: Array<{ submissionId: string; submissionVersion: number; submittedAt: string; institutionName: string;
    review: { reviewId: string; decision: string; reason: string; reviewedAt: string } | null }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const time = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) && Number.isFinite(Date.parse(value));
const exact = (value: Record<string, unknown>, keys: string[]) => Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
function invalid(): never { throw new SessionServiceError(502, 'INVALID_RESPONSE', '审核响应格式无效'); }
export class PartnerApplicationReviewService {
  constructor(private readonly sessions: Pick<PartnerApplicantSessionService, 'getSessionKey' | 'requestHistory' | 'requestReopen'>) {}
  async history(page = 1): Promise<ApplicationHistory> {
    if (!Number.isInteger(page) || page < 1 || page > 1_000_000) invalid();
    const value = await this.sessions.requestHistory(page);
    if (!record(value) || !exact(value, ['applicationId', 'status', 'version', 'editSourceSubmissionId', 'data', 'meta']) ||
        !(value.applicationId === null || uuid(value.applicationId)) ||
        !(value.editSourceSubmissionId === null || uuid(value.editSourceSubmissionId)) ||
        ![null, 'DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'].includes(value.status as string | null) ||
        !Number.isInteger(value.version) || Number(value.version) < 0 || !Array.isArray(value.data) || value.data.length > 20 ||
        !record(value.meta) || !exact(value.meta, ['page', 'pageSize', 'total', 'totalPages']) || value.meta.page !== page ||
        value.meta.pageSize !== 20 || !Number.isInteger(value.meta.total) || Number(value.meta.total) < 0 ||
        value.meta.totalPages !== Math.ceil(Number(value.meta.total) / 20)) invalid();
    for (const row of value.data) {
      if (!record(row) || !exact(row, ['submissionId', 'submissionVersion', 'submittedAt', 'institutionName', 'review']) ||
          !uuid(row.submissionId) || !Number.isInteger(row.submissionVersion) || Number(row.submissionVersion) < 1 ||
          !time(row.submittedAt) || typeof row.institutionName !== 'string' || row.institutionName.length > 200) invalid();
      if (row.review !== null && (!record(row.review) || !exact(row.review, ['reviewId', 'decision', 'reason', 'reviewedAt']) ||
          !uuid(row.review.reviewId) || !['REJECTED', 'APPROVED'].includes(String(row.review.decision)) ||
          typeof row.review.reason !== 'string' || row.review.reason.length > 1000 || !time(row.review.reviewedAt))) invalid();
    }
    return value as unknown as ApplicationHistory;
  }
  async reopen(submissionId: string, expectedVersion: number, key: string) {
    if (!uuid(submissionId) || !Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 2_147_483_647 ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) invalid();
    const value = await this.sessions.requestReopen(submissionId, expectedVersion, key);
    if (!record(value) || !exact(value, ['applicationId', 'sourceSubmissionId', 'version', 'status']) ||
        !uuid(value.applicationId) || value.sourceSubmissionId !== submissionId ||
        value.version !== expectedVersion + 1 || value.status !== 'DRAFT') invalid();
    return value as unknown as { applicationId: string; sourceSubmissionId: string; version: number; status: 'DRAFT' };
  }
}
