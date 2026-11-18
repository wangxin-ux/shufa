import { SessionServiceError } from '../../../services/session.service';
import type { PartnerApplicantSessionService } from './partner-applicant-session.service';

export interface SubmissionReceipt {
  applicationId: string; submissionId: string; version: number; status: 'SUBMITTED'; submittedAt: string;
}
const uuid = (value: unknown): value is string => typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fields = ['applicationId', 'submissionId', 'version', 'status', 'submittedAt'];
function receipt(value: unknown, expectedVersion: number): SubmissionReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new SessionServiceError(502, 'INVALID_RESPONSE', '送审响应格式无效');
  const item = value as Record<string, unknown>;
  if (Reflect.ownKeys(item).length !== fields.length ||
      !Reflect.ownKeys(item).every((key) => typeof key === 'string' && fields.includes(key)) ||
      !uuid(item.applicationId) || !uuid(item.submissionId) || item.version !== expectedVersion + 1 ||
      item.status !== 'SUBMITTED' || typeof item.submittedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(item.submittedAt) ||
      !Number.isFinite(Date.parse(item.submittedAt)) ||
      new Date(item.submittedAt).toISOString().slice(0, 19) !== item.submittedAt.slice(0, 19))
    throw new SessionServiceError(502, 'INVALID_RESPONSE', '送审响应格式无效');
  return item as unknown as SubmissionReceipt;
}

export class PartnerApplicationSubmissionService {
  private readonly writes = new Map<string, { signature: string; promise: Promise<SubmissionReceipt> }>();
  constructor(private readonly sessions: Pick<PartnerApplicantSessionService, 'getSessionKey' | 'requestSubmission'>) {}
  submit(expectedVersion: number, key: string): Promise<SubmissionReceipt> {
    const session = this.sessions.getSessionKey();
    if (!session) return Promise.reject(new SessionServiceError(401, 'UNAUTHORIZED', '请先登录入驻申请'));
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 2_147_483_647 ||
        typeof key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(key))
      return Promise.reject(new SessionServiceError(400, 'BAD_REQUEST', '送审请求格式无效'));
    const signature = JSON.stringify([expectedVersion, key]);
    const existing = this.writes.get(session);
    if (existing) return existing.signature === signature ? existing.promise :
      Promise.reject(new SessionServiceError(409, 'SAVE_IN_PROGRESS', '送审处理中，请稍后重试'));
    const pending = this.sessions.requestSubmission(expectedVersion, key).then((value) => {
      if (this.sessions.getSessionKey() !== session)
        throw new SessionServiceError(409, 'SESSION_SUPERSEDED', '申请会话已更新');
      return receipt(value, expectedVersion);
    }).finally(() => { if (this.writes.get(session)?.promise === pending) this.writes.delete(session); });
    this.writes.set(session, { signature, promise: pending });
    return pending;
  }
}
