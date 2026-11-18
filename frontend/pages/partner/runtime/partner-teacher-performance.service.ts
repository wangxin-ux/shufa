import { createPartnerRuntimeEnv } from '../../../config/partner-env';
import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';

export const TEACHER_RATING_FIELDS = ['teachingRating', 'communicationRating', 'attendanceRating', 'overallRating'] as const;
export type RatingField = typeof TEACHER_RATING_FIELDS[number];
export interface TeacherEvaluationInput {
  periodMonth: string; expectedVersion: number;
  teachingRating: number; communicationRating: number; attendanceRating: number; overallRating: number; guidance: string;
}
export interface TeacherEvaluation extends Omit<TeacherEvaluationInput, 'expectedVersion'> {
  id: string; teacherId: string; version: number; authorName: string; canEdit: boolean; createdAt: string; updatedAt: string;
}
export interface TeacherPerformance {
  teacherId: string; periodMonth: string; timezone: string; asOf: string;
  scheduledLessonCount: number; completedLessonCount: number; completionRateBasisPoints: number | null;
  evaluation: TeacherEvaluation | null;
}
export type TeacherEvaluationRevision = Pick<TeacherEvaluation, RatingField | 'version' | 'guidance' | 'authorName'> & { savedAt: string };
export interface TeacherEvaluationHistory {
  data: TeacherEvaluationRevision[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
interface Options {
  dataDriver: 'api' | 'mock'; apiBaseUrl?: string; accessToken: () => string;
  isCurrent?: () => boolean; request?: SessionHttpRequest;
}
const MONTH = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: readonly string[]) =>
  Object.keys(v).length === fields.length && fields.every(k => Object.prototype.hasOwnProperty.call(v, k));
const integer = (v: unknown, min = 0, max = 2147483647) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
const timestamp = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export const validTeacherGuidance = (v: unknown): v is string =>
  typeof v === 'string' && Array.from(v).length <= 1000 && !/[\u0000\uD800-\uDFFF]/u.test(v);
const scores = (v: Record<string, unknown>) => TEACHER_RATING_FIELDS.every(k => integer(v[k], 1, 10));
const values = (v: Pick<TeacherEvaluationInput, RatingField | 'guidance'>) => ({
  teachingRating: v.teachingRating, communicationRating: v.communicationRating,
  attendanceRating: v.attendanceRating, overallRating: v.overallRating, guidance: v.guidance.trim(),
});
function invalid(response = true): never {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'VALIDATION_FAILED',
    response ? '教师评价返回结果待核对，请重试' : '请填写四项有效评分，指导意见最多1000字');
}
function failure(status: number) {
  return new SessionServiceError(status, 'TEACHER_EVALUATION_REQUEST_FAILED',
    status === 401 || status === 403 ? '当前登录无权查看或修改，请重新登录'
      : status === 409 ? '评价已更新，请重新读取后修改'
        : status === 400 ? '评分或指导意见不符合要求' : '请求未完成，请稍后重试');
}
function parseEvaluation(raw: unknown, teacherId: string, month?: string): TeacherEvaluation {
  if (!object(raw) || !exact(raw, ['id', 'teacherId', 'periodMonth', 'version', ...TEACHER_RATING_FIELDS,
    'guidance', 'authorName', 'canEdit', 'createdAt', 'updatedAt']) ||
    typeof raw.id !== 'string' || !UUID.test(raw.id) || raw.teacherId !== teacherId ||
    typeof raw.periodMonth !== 'string' || !MONTH.test(raw.periodMonth) || (month && raw.periodMonth !== month) ||
    !integer(raw.version, 1) || !scores(raw) || !validTeacherGuidance(raw.guidance) ||
    typeof raw.authorName !== 'string' || !raw.authorName.trim() || Array.from(raw.authorName).length > 100 ||
    typeof raw.canEdit !== 'boolean' || !timestamp(raw.createdAt) || !timestamp(raw.updatedAt) ||
    String(raw.updatedAt) < String(raw.createdAt)) invalid();
  return raw as unknown as TeacherEvaluation;
}
function parsePerformance(raw: unknown, id: string, month?: string): TeacherPerformance {
  if (!object(raw) || !exact(raw, ['teacherId', 'periodMonth', 'timezone', 'asOf',
    'scheduledLessonCount', 'completedLessonCount', 'completionRateBasisPoints', 'evaluation']) ||
    raw.teacherId !== id || typeof raw.periodMonth !== 'string' || !MONTH.test(raw.periodMonth) ||
    (month && raw.periodMonth !== month) || typeof raw.timezone !== 'string' || !timestamp(raw.asOf) ||
    !integer(raw.scheduledLessonCount) || !integer(raw.completedLessonCount) ||
    Number(raw.completedLessonCount) > Number(raw.scheduledLessonCount) ||
    (raw.scheduledLessonCount === 0 ? raw.completionRateBasisPoints !== null
      : raw.completionRateBasisPoints !== Math.round(Number(raw.completedLessonCount) * 10000 / Number(raw.scheduledLessonCount)))) invalid();
  try { new Intl.DateTimeFormat('en', { timeZone: raw.timezone }).format(); } catch { invalid(); }
  return { ...raw, evaluation: raw.evaluation === null ? null : parseEvaluation(raw.evaluation, id, String(raw.periodMonth)) } as unknown as TeacherPerformance;
}
function parseHistory(raw: Record<string, unknown>, page: number): TeacherEvaluationHistory {
  if (!exact(raw, ['data', 'meta', 'requestId']) || !Array.isArray(raw.data) || !object(raw.meta) ||
    !exact(raw.meta, ['page', 'pageSize', 'total', 'totalPages']) || raw.meta.page !== page || raw.meta.pageSize !== 20 ||
    !integer(raw.meta.total) || raw.meta.totalPages !== Math.ceil(Number(raw.meta.total) / 20) ||
    raw.data.length !== Math.max(0, Math.min(20, Number(raw.meta.total) - (page - 1) * 20))) invalid();
  const rows = raw.data.map((r: unknown) => {
    if (!object(r) || !exact(r, ['version', ...TEACHER_RATING_FIELDS, 'guidance', 'authorName', 'savedAt']) ||
      !integer(r.version, 1) || !scores(r) || !validTeacherGuidance(r.guidance) ||
      typeof r.authorName !== 'string' || !r.authorName.trim() || Array.from(r.authorName).length > 100 || !timestamp(r.savedAt)) invalid();
    return r as unknown as TeacherEvaluationRevision;
  });
  if (rows.some((r, index) => index > 0 && rows[index - 1].version <= r.version)) invalid();
  return { data: rows, meta: raw.meta as unknown as TeacherEvaluationHistory['meta'] };
}
const mockRecords = new Map<string, { evaluation: TeacherEvaluation; history: TeacherEvaluationRevision[] }>();
let mockId = 0;
export class PartnerTeacherPerformanceClient {
  constructor(private readonly options: Options) {}
  getSessionKey() {
    if (this.options.isCurrent && !this.options.isCurrent()) return '';
    const token = this.options.accessToken().trim();
    return this.options.dataDriver === 'api' && !token ? ''
      : JSON.stringify([this.options.dataDriver, this.options.apiBaseUrl ?? '', token]);
  }
  private target(id: string, month?: string) {
    if (typeof id !== 'string' || !id.trim() || (this.options.dataDriver === 'api' && !UUID.test(id)) ||
      (month !== undefined && (typeof month !== 'string' || !MONTH.test(month)))) invalid(false);
    const owner = this.getSessionKey();
    if (!owner) throw failure(401);
    return owner;
  }
  async performance(id: string, month?: string): Promise<TeacherPerformance> {
    const owner = this.target(id, month);
    if (this.options.dataDriver === 'mock') {
      const periodMonth = month ?? new Date(Date.now() + 28800_000).toISOString().slice(0, 7);
      return { teacherId: id, periodMonth, timezone: 'Asia/Shanghai', asOf: new Date().toISOString(),
        scheduledLessonCount: 0, completedLessonCount: 0, completionRateBasisPoints: null,
        evaluation: structuredCloneSafe(mockRecords.get(JSON.stringify([owner, id, periodMonth]))?.evaluation ?? null) };
    }
    const raw = await this.send(id, `/performance${month ? '?month=' + month : ''}`, owner);
    if (!exact(raw, ['data', 'requestId'])) invalid();
    return parsePerformance(raw.data, id, month);
  }
  async save(id: string, input: TeacherEvaluationInput): Promise<TeacherEvaluation> {
    const owner = this.target(id, input?.periodMonth);
    if (!object(input) || !exact(input, ['periodMonth', 'expectedVersion', ...TEACHER_RATING_FIELDS, 'guidance']) ||
      !MONTH.test(input.periodMonth) || !integer(input.expectedVersion, 0, 2147483646) ||
      !scores(input) || !validTeacherGuidance(input.guidance)) invalid(false);
    if (this.options.dataDriver === 'mock') {
      const key = JSON.stringify([owner, id, input.periodMonth]);
      const previous = mockRecords.get(key);
      const normalized = values(input);
      if (previous) {
        const same = TEACHER_RATING_FIELDS.every(k => previous.evaluation[k] === input[k]) && previous.evaluation.guidance === normalized.guidance;
        if (same && [previous.evaluation.version, previous.evaluation.version - 1].includes(input.expectedVersion))
          return structuredCloneSafe(previous.evaluation);
        if (previous.evaluation.version !== input.expectedVersion) throw failure(409);
      } else if (input.expectedVersion !== 0) throw failure(409);
      const now = new Date().toISOString();
      const evaluation: TeacherEvaluation = {
        ...normalized, teacherId: id, periodMonth: input.periodMonth, version: (previous?.evaluation.version ?? 0) + 1,
        id: previous?.evaluation.id ?? `00000000-0000-4000-8000-${String(++mockId).padStart(12, '0')}`,
        authorName: '本地演示评价人', canEdit: true, createdAt: previous?.evaluation.createdAt ?? now, updatedAt: now,
      };
      mockRecords.set(key, { evaluation, history: [{ ...normalized, version: evaluation.version, authorName: evaluation.authorName, savedAt: now }, ...(previous?.history ?? [])] });
      return structuredCloneSafe(evaluation);
    }
    const raw = await this.send(id, '/evaluation', owner, input);
    if (!exact(raw, ['data', 'requestId'])) invalid();
    const result = parseEvaluation(raw.data, id, input.periodMonth);
    if (!result.canEdit || ![input.expectedVersion, input.expectedVersion + 1].includes(result.version) ||
      TEACHER_RATING_FIELDS.some(k => result[k] !== input[k]) || result.guidance !== input.guidance.trim()) invalid();
    return result;
  }
  async history(id: string, month: string, page = 1): Promise<TeacherEvaluationHistory> {
    const owner = this.target(id, month);
    if (!integer(page, 1)) invalid(false);
    if (this.options.dataDriver === 'mock') {
      const rows = mockRecords.get(JSON.stringify([owner, id, month]))?.history ?? [];
      return structuredCloneSafe({ data: rows.slice((page - 1) * 20, page * 20),
        meta: { page, pageSize: 20, total: rows.length, totalPages: Math.ceil(rows.length / 20) } });
    }
    return parseHistory(await this.send(id, `/evaluation-history?month=${month}&page=${page}&pageSize=20`, owner), page);
  }
  private async send(id: string, suffix: string, owner: string, body?: TeacherEvaluationInput): Promise<Record<string, unknown>> {
    const base = this.options.apiBaseUrl?.trim().replace(/\/+$/, '');
    if (!base || !/^https?:\/\//.test(base)) throw failure(503);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (response?: { statusCode: number; data: unknown }) => {
        if (settled) return; settled = true; clearTimeout(timer);
        try {
          if (this.getSessionKey() !== owner) throw failure(401);
          if (!response || response.statusCode !== 200) throw failure(response?.statusCode ?? 0);
          if (!object(response.data) || typeof response.data.requestId !== 'string') invalid();
          resolve(response.data);
        } catch (e) { reject(e); }
      };
      const timer = setTimeout(() => finish(), 15000);
      try {
        if (this.getSessionKey() !== owner) throw failure(401);
        (this.options.request ?? defaultRequest)({
          url: `${base}/partners/me/teachers/${encodeURIComponent(id)}${suffix}`,
          method: body ? 'PUT' : 'GET', data: body,
          header: { Authorization: `Bearer ${this.options.accessToken()}`, 'Content-Type': 'application/json' },
          success: finish, fail: () => finish(),
        });
      } catch (e) {
        if (e instanceof SessionServiceError && !settled) { settled = true; clearTimeout(timer); reject(e); }
        else finish();
      }
    });
  }
}
function structuredCloneSafe<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function createPartnerTeacherPerformanceClient() {
  const env = createPartnerRuntimeEnv(), base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  return new PartnerTeacherPerformanceClient({
    dataDriver: env.dataDriver, apiBaseUrl: base, accessToken: () => createPartnerRuntimeEnv().accessToken,
    isCurrent: () => {
      const current = createPartnerRuntimeEnv();
      return current.dataDriver === env.dataDriver && current.apiBaseUrl.trim().replace(/\/+$/, '') === base;
    },
  });
}
