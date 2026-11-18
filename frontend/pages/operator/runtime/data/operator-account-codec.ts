import { OperatorDataSourceError } from './operator-data-source';
import {
  OPERATOR_ACCOUNT_CATEGORIES, type OperatorAccount, type OperatorAccountSubjects,
  type OperatorAccountQuery, type OperatorAccountSubjectQuery,
} from '../types/operator-account';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(v, k));
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && Number(v) >= min;
const signed = (v: unknown) => Number.isSafeInteger(v);
const historical = (v: unknown, check: (value: unknown) => boolean = integer) => v === null || check(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const entryType = (v: unknown) => OPERATOR_ACCOUNT_CATEGORIES.some(c => c.value !== '' && c.value === v);
function invalid(response = true): never {
  throw new OperatorDataSourceError(response ? 502 : 400,
    response ? 'INVALID_ACCOUNT_RESPONSE' : 'VALIDATION_FAILED',
    response ? '课时账户返回内容不一致，请重试' : '课时账户查询条件无效');
}
function validDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)) return false;
  const date = new Date(`${v}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}
function timestamp(v: unknown): v is string {
  return typeof v === 'string' &&
    /^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(v) &&
    validDate(v.slice(0, 10)) && Number.isFinite(Date.parse(v));
}
function validateQuery(query: unknown, subject: boolean): void {
  if (!record(query) || Object.keys(query).some(k => !(subject ?
    ['page', 'pageSize', 'query'] : ['page', 'pageSize', 'entryType', 'subjectId']).includes(k)) ||
    !integer(query.page, 1) || query.page > 2147483647 || !integer(query.pageSize, 1) || query.pageSize > 100 ||
    (query.page - 1) * query.pageSize > 2147483647) invalid(false);
  if (subject ? query.query !== undefined && (typeof query.query !== 'string' || query.query.length > 100) :
    (query.entryType !== undefined && !entryType(query.entryType)) ||
    (query.subjectId !== undefined && (typeof query.subjectId !== 'string' ||
      (query.subjectId !== 'UNCLASSIFIED' && !UUID4.test(query.subjectId))))) invalid(false);
}
export function validateOperatorAccountQuery(query: OperatorAccountQuery): void { validateQuery(query, false); }
export function validateOperatorAccountSubjectQuery(query: OperatorAccountSubjectQuery): void { validateQuery(query, true); }
function envelope(raw: unknown): Record<string, unknown> {
  if (!record(raw) || !('data' in raw) || Object.keys(raw).some(k => !['data', 'requestId'].includes(k)) ||
    ('requestId' in raw && typeof raw.requestId !== 'string') || !record(raw.data)) invalid();
  return raw.data;
}
function common(raw: Record<string, unknown>, items: unknown[], query: { page: number; pageSize: number }) {
  const meta = raw.meta;
  if (!record(meta) || !exact(meta, ['page', 'pageSize', 'total', 'totalPages']) ||
    meta.page !== query.page || meta.pageSize !== query.pageSize || !integer(meta.total) || !integer(meta.totalPages) ||
    meta.totalPages !== Math.ceil(meta.total / query.pageSize) ||
    items.length !== Math.max(0, Math.min(query.pageSize, meta.total - (query.page - 1) * query.pageSize)) ||
    !timestamp(raw.serverTime) || typeof raw.timezone !== 'string' || !raw.timezone.length) invalid();
}
export function parseOperatorAccountEnvelope(body: unknown, query: OperatorAccountQuery): OperatorAccount {
  const raw = envelope(body);
  const balances = ['mainBalanceUnits', 'giftBalanceUnits', 'totalBalanceUnits', 'mainReservedUnits', 'giftReservedUnits',
    'reservedTotalUnits', 'mainAvailableUnits', 'giftAvailableUnits', 'availableTotalUnits'];
  if (!exact(raw, [...balances, 'enrollmentSummary', 'lessonActivityTotals', 'items', 'meta', 'serverTime', 'timezone']) ||
    balances.some(k => !integer(raw[k])) || !record(raw.enrollmentSummary) ||
    !Array.isArray(raw.lessonActivityTotals) || raw.lessonActivityTotals.length !== 6 || !Array.isArray(raw.items)) invalid();
  const enrollment = raw.enrollmentSummary;
  if (!exact(enrollment, ['receivedAmountFen', 'refundedAmountFen', 'initialMainUnits', 'initialGiftUnits', 'pendingIssuanceCount']) ||
    ['receivedAmountFen', 'refundedAmountFen', 'initialMainUnits', 'initialGiftUnits'].some(k => !historical(enrollment[k])) ||
    !integer(enrollment.pendingIssuanceCount)) invalid();
  const categories = new Set();
  for (const total of raw.lessonActivityTotals) {
    if (!record(total) || !exact(total, ['entryType', 'mainDeltaUnits', 'giftDeltaUnits', 'totalDeltaUnits']) ||
      !entryType(total.entryType) || categories.has(total.entryType) ||
      ['mainDeltaUnits', 'giftDeltaUnits', 'totalDeltaUnits'].some(k => !historical(total[k], signed))) invalid();
    categories.add(total.entryType);
  }
  const ids = new Set();
  for (const item of raw.items) {
    if (!record(item) || !exact(item, ['id', 'studentId', 'studentName', 'packageName', 'subject', 'entryType',
      'bucket', 'deltaUnits', 'balanceBeforeUnits', 'balanceAfterUnits', 'reason', 'createdAt', 'paymentContext', 'teachingContext']) ||
      !uuid(item.id) || ids.has(item.id.toLowerCase()) || !uuid(item.studentId) || typeof item.studentName !== 'string' ||
      typeof item.packageName !== 'string' || !entryType(item.entryType) || !['MAIN', 'GIFT'].includes(String(item.bucket)) ||
      typeof item.bucket !== 'string' || !signed(item.deltaUnits) || !integer(item.balanceBeforeUnits) ||
      !integer(item.balanceAfterUnits) || (item.reason !== null && typeof item.reason !== 'string') || !timestamp(item.createdAt)) invalid();
    ids.add(item.id.toLowerCase());
    const subject = item.subject;
    if (subject !== null && (!record(subject) || !exact(subject, ['id', 'name']) || !uuid(subject.id) || typeof subject.name !== 'string')) invalid();
    if ((query.entryType && item.entryType !== query.entryType) ||
      (query.subjectId === 'UNCLASSIFIED' ? subject !== null : query.subjectId &&
        (!record(subject) || (subject.id as string).toLowerCase() !== query.subjectId.toLowerCase()))) invalid();
    const payment = item.paymentContext;
    if (payment !== null && (!record(payment) ||
      !(exact(payment, ['receivedOn']) && validDate(payment.receivedOn) ||
        exact(payment, ['paidAt']) && timestamp(payment.paidAt)))) invalid();
    const teaching = item.teachingContext;
    if (teaching !== null && (!record(teaching) || !exact(teaching, ['courseName', 'teacherName', 'lessonStartsAt']) ||
      typeof teaching.courseName !== 'string' || typeof teaching.teacherName !== 'string' || !timestamp(teaching.lessonStartsAt))) invalid();
  }
  common(raw, raw.items, query);
  return raw as unknown as OperatorAccount;
}
export function parseOperatorAccountSubjectsEnvelope(body: unknown, query: OperatorAccountSubjectQuery): OperatorAccountSubjects {
  const raw = envelope(body);
  if (!exact(raw, ['data', 'meta', 'serverTime', 'timezone']) || !Array.isArray(raw.data)) invalid();
  const ids = new Set();
  for (const item of raw.data) {
    if (!record(item) || !exact(item, ['id', 'name', 'isActive', 'version']) || !uuid(item.id) || ids.has(item.id.toLowerCase()) ||
      typeof item.name !== 'string' || item.name.length > 80 || typeof item.isActive !== 'boolean' || !integer(item.version, 1)) invalid();
    ids.add(item.id.toLowerCase());
  }
  common(raw, raw.data, query);
  return raw as unknown as OperatorAccountSubjects;
}
