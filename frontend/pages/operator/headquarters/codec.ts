import { ACTIVITY_TYPES, type Account, type Campus, type CampusSummary, type Directory, type DirectoryQuery, type Summary, type TotalSummary } from './types';

export class HeadquartersError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message = '总部数据加载失败，请重试') { super(message); }
}
export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const validUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function invalid(): never { throw new HeadquartersError(502, 'HEADQUARTERS_RESPONSE_INVALID', '总部数据不完整，请重试'); }
function shape(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!record(value) || required.some(key => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid();
  return value;
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid();
  return value;
}
function nullable(value: unknown, signed = false): number | null {
  return value === null ? null : integer(value, signed ? Number.MIN_SAFE_INTEGER : 0);
}
function timestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function sum(main: number | null, gift: number | null, total: number | null): void {
  if (main === null || gift === null) { if (total !== null) invalid(); return; }
  if (total === null || !Number.isSafeInteger(main + gift) || main + gift !== total) invalid();
}
function envelope(value: unknown, page = false): Record<string, unknown> {
  const result = shape(value, page ? ['data', 'meta'] : ['data'], ['requestId']);
  if ('requestId' in result && typeof result.requestId !== 'string') invalid();
  return result;
}
function campus(value: unknown): Campus {
  const row = shape(value, ['id', 'name', 'timezone']);
  if (!validUuid(row.id) || typeof row.name !== 'string' || !row.name.trim() ||
    typeof row.timezone !== 'string' || !row.timezone.trim()) invalid();
  try { new Intl.DateTimeFormat('zh-CN', { timeZone: row.timezone as string }).format(0); } catch { invalid(); }
  return row as unknown as Campus;
}
export function validateQuery(query: DirectoryQuery): void {
  if (!query || !Number.isInteger(query.page) || query.page < 1 || query.page > 2147483647 ||
    !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100 ||
    typeof query.query !== 'string' || Array.from(query.query).length > 100) {
    throw new HeadquartersError(400, 'HEADQUARTERS_QUERY_INVALID', '校区名称最多输入100个字');
  }
}
export function parseDirectory(value: unknown, query: DirectoryQuery): Directory {
  validateQuery(query);
  const outer = envelope(value, true), meta = shape(outer.meta, ['page', 'pageSize', 'total', 'totalPages']);
  const page = integer(meta.page, 1), pageSize = integer(meta.pageSize, 1);
  const total = integer(meta.total), totalPages = integer(meta.totalPages);
  if (page !== query.page || pageSize !== query.pageSize || page > 2147483647 || pageSize > 100 ||
    totalPages !== Math.ceil(total / pageSize) || !Array.isArray(outer.data) ||
    outer.data.length !== Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize))) invalid();
  const data = outer.data.map(campus);
  if (new Set(data.map(row => row.id.toLowerCase())).size !== data.length) invalid();
  return { data, meta: { page, pageSize, total, totalPages } };
}
const balanceKeys = [
  'mainBalanceUnits', 'giftBalanceUnits', 'totalBalanceUnits',
  'mainReservedUnits', 'giftReservedUnits', 'reservedTotalUnits',
  'mainAvailableUnits', 'giftAvailableUnits', 'availableTotalUnits',
] as const;
function account(value: unknown): Account {
  const row = shape(value, [...balanceKeys, 'enrollmentSummary', 'lessonActivityTotals']);
  for (const key of balanceKeys) integer(row[key]);
  const result = row as unknown as Account;
  sum(result.mainBalanceUnits, result.giftBalanceUnits, result.totalBalanceUnits);
  sum(result.mainReservedUnits, result.giftReservedUnits, result.reservedTotalUnits);
  sum(result.mainAvailableUnits, result.giftAvailableUnits, result.availableTotalUnits);
  sum(result.mainReservedUnits, result.mainAvailableUnits, result.mainBalanceUnits);
  sum(result.giftReservedUnits, result.giftAvailableUnits, result.giftBalanceUnits);
  const enrollment = shape(row.enrollmentSummary, ['receivedAmountFen', 'refundedAmountFen', 'initialMainUnits', 'initialGiftUnits', 'pendingIssuanceCount']);
  for (const key of ['receivedAmountFen', 'refundedAmountFen', 'initialMainUnits', 'initialGiftUnits']) nullable(enrollment[key]);
  integer(enrollment.pendingIssuanceCount);
  if (!Array.isArray(row.lessonActivityTotals) || row.lessonActivityTotals.length !== ACTIVITY_TYPES.length) invalid();
  const seen = new Set<unknown>();
  for (const value of row.lessonActivityTotals) {
    const activity = shape(value, ['entryType', 'mainDeltaUnits', 'giftDeltaUnits', 'totalDeltaUnits']);
    if (!ACTIVITY_TYPES.includes(activity.entryType as typeof ACTIVITY_TYPES[number]) || seen.has(activity.entryType)) invalid();
    seen.add(activity.entryType);
    sum(nullable(activity.mainDeltaUnits, true), nullable(activity.giftDeltaUnits, true), nullable(activity.totalDeltaUnits, true));
  }
  return result;
}
function summary(value: unknown, kind: 'campus' | 'total'): Summary & Record<string, unknown> {
  const row = shape(value, ['activeStudentCount', 'todayLessonCount', 'account', 'earnings', 'serverTime',
    ...(kind === 'campus' ? ['campus'] : ['campusCount', 'studentCountBasis'])]);
  integer(row.activeStudentCount); integer(row.todayLessonCount); account(row.account);
  const earnings = shape(row.earnings, ['estimatedTotalFen', 'pendingReviewFen', 'currency']);
  nullable(earnings.estimatedTotalFen, true); nullable(earnings.pendingReviewFen, true);
  if (earnings.currency !== 'CNY' || !timestamp(row.serverTime)) invalid();
  return row as unknown as Summary & Record<string, unknown>;
}
export function parseCampusSummary(value: unknown, expectedId: string): CampusSummary {
  if (!validUuid(expectedId)) invalid();
  const row = summary(envelope(value).data, 'campus'), selected = campus(row.campus);
  if (selected.id.toLowerCase() !== expectedId.toLowerCase()) invalid();
  return row as unknown as CampusSummary;
}
export function parseTotalSummary(value: unknown): TotalSummary {
  const row = summary(envelope(value).data, 'total');
  integer(row.campusCount);
  if (row.studentCountBasis !== 'SUM_OF_CAMPUS_ACTIVE_STUDENT_RECORDS') invalid();
  if (row.campusCount === 0) {
    const fields = [row.activeStudentCount, row.todayLessonCount, row.earnings.estimatedTotalFen, row.earnings.pendingReviewFen,
      ...balanceKeys.map(key => row.account[key]), ...Object.values(row.account.enrollmentSummary),
      ...row.account.lessonActivityTotals.flatMap(item => [item.mainDeltaUnits, item.giftDeltaUnits, item.totalDeltaUnits])];
    if (fields.some(field => field !== 0)) invalid();
  }
  return row as unknown as TotalSummary;
}
