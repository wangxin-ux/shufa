import { OperatorDataSourceError } from './operator-data-source';
import {
  OPERATOR_EARNING_STATUSES, OPERATOR_EARNING_TYPES,
  type OperatorEarningEntries, type OperatorEarningQuery, type OperatorEarningSummary,
} from '../types/operator-earning';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
const status = (value: unknown) => OPERATOR_EARNING_STATUSES.some(item => item.value !== '' && item.value === value);
const entryType = (value: unknown) => OPERATOR_EARNING_TYPES.some(item => item.value !== '' && item.value === value);
function invalid(response = true): never {
  throw new OperatorDataSourceError(response ? 502 : 400, response ? 'INVALID_EARNING_RESPONSE' : 'VALIDATION_FAILED',
    response ? '内部收益返回内容不一致，请重试' : '内部收益查询条件无效');
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' ||
      !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value)) return false;
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value.slice(0, 10) &&
    Number.isFinite(Date.parse(value));
}
function clock(value: Record<string, unknown>) {
  if (!timestamp(value.serverTime) || typeof value.timezone !== 'string' || !value.timezone.trim()) invalid();
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: value.timezone }).format(0); }
  catch { invalid(); }
}
function envelope(value: unknown): Record<string, unknown> {
  if (!record(value) || !record(value.data) || Object.keys(value).some(key => !['data', 'requestId'].includes(key)) ||
      ('requestId' in value && typeof value.requestId !== 'string')) invalid();
  return value.data;
}
export function validateOperatorEarningQuery(query: OperatorEarningQuery): void {
  if (!record(query) || Object.keys(query).some(key => !['page', 'pageSize', 'status', 'entryType'].includes(key)) ||
      !integer(query.page, 1) || query.page > 2147483647 || !integer(query.pageSize, 1) || query.pageSize > 100 ||
      (query.page - 1) * query.pageSize > 2147483647 ||
      (query.status !== undefined && !status(query.status)) || (query.entryType !== undefined && !entryType(query.entryType))) invalid(false);
}
export function parseOperatorEarningSummaryEnvelope(value: unknown): OperatorEarningSummary {
  const raw = envelope(value);
  if (!exact(raw, ['estimatedTotalFen', 'pendingReviewFen', 'currency', 'serverTime', 'timezone']) ||
      [raw.estimatedTotalFen, raw.pendingReviewFen].some(amount => amount !== null && !Number.isSafeInteger(amount)) ||
      raw.currency !== 'CNY') invalid();
  clock(raw);
  return raw as unknown as OperatorEarningSummary;
}
export function parseOperatorEarningEntriesEnvelope(value: unknown, query: OperatorEarningQuery): OperatorEarningEntries {
  const raw = envelope(value);
  if (!exact(raw, ['data', 'meta', 'serverTime', 'timezone']) || !Array.isArray(raw.data) || !record(raw.meta)) invalid();
  clock(raw);
  const meta = raw.meta;
  if (!exact(meta, ['page', 'pageSize', 'total', 'totalPages']) || meta.page !== query.page || meta.pageSize !== query.pageSize ||
      !integer(meta.total) || !integer(meta.totalPages) || meta.totalPages !== Math.ceil(meta.total / query.pageSize) ||
      raw.data.length !== Math.max(0, Math.min(query.pageSize, meta.total - (query.page - 1) * query.pageSize))) invalid();
  const ids = new Set<string>();
  let previous: { id: string; time: number } | undefined;
  for (const item of raw.data) {
    if (!record(item) || !exact(item, ['id', 'entryType', 'status', 'amountFen', 'createdAt', 'completedAt']) ||
        typeof item.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) ||
        ids.has(item.id.toLowerCase()) || !entryType(item.entryType) || !status(item.status) || !Number.isSafeInteger(item.amountFen) ||
        (item.entryType === 'ACCRUAL' ? Number(item.amountFen) < 1 : Number(item.amountFen) > -1 || item.status !== 'REVERSED') ||
        !timestamp(item.createdAt) || !timestamp(item.completedAt) ||
        (query.status && item.status !== query.status) || (query.entryType && item.entryType !== query.entryType)) invalid();
    const id = item.id.toLowerCase(), time = Date.parse(item.createdAt);
    if (previous && (previous.time < time || (previous.time === time && previous.id <= id))) invalid();
    previous = { id, time }; ids.add(id);
  }
  return raw as unknown as OperatorEarningEntries;
}
