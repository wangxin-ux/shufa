import { OperatorDataSourceError } from './operator-data-source';
import {
  isOperatorRankingMetric, isOperatorRankingMonth,
  type OperatorRankingPage, type OperatorRankingQuery, type OperatorRankingRow,
} from '../types/operator-ranking';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).length === fields.length && fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && Number(value) >= min;
function invalid(response = true): never {
  throw new OperatorDataSourceError(response ? 502 : 400,
    response ? 'INVALID_RANKING_RESPONSE' : 'VALIDATION_FAILED',
    response ? '月榜返回内容不一致，请重试' : '月榜查询条件无效');
}
export function validateOperatorRankingQuery(query: OperatorRankingQuery): void {
  if (!record(query) || Object.keys(query).some((key) => !['metric', 'month', 'page', 'pageSize', 'revisionId'].includes(key)) ||
    !isOperatorRankingMetric(query.metric) || !isOperatorRankingMonth(query.month) ||
    !integer(query.page, 1) || !integer(query.pageSize, 1) || query.pageSize > 100 ||
    (query.revisionId !== undefined && (typeof query.revisionId !== 'string' || !UUID.test(query.revisionId)))) invalid(false);
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value);
  return !!match && Number(match[3]) <= new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() &&
    Number.isFinite(Date.parse(value));
}
function row(raw: unknown): OperatorRankingRow {
  if (!record(raw) || !exact(raw, ['campusName', 'rank', 'rankDelta', 'isOwnCampus']) ||
    typeof raw.campusName !== 'string' || !integer(raw.rank, 1) ||
    (raw.rankDelta !== null && !Number.isSafeInteger(raw.rankDelta)) || typeof raw.isOwnCampus !== 'boolean') invalid();
  return { campusName: raw.campusName, rank: raw.rank, rankDelta: raw.rankDelta as number | null, isOwnCampus: raw.isOwnCampus };
}
export function parseOperatorRankingEnvelope(envelope: unknown, query: OperatorRankingQuery): OperatorRankingPage {
  if (!record(envelope) || !Object.prototype.hasOwnProperty.call(envelope, 'data') ||
    Object.keys(envelope).some((key) => !['data', 'requestId'].includes(key)) ||
    ('requestId' in envelope && typeof envelope.requestId !== 'string')) invalid();
  const raw = envelope.data;
  if (!record(raw) || !exact(raw, ['metric', 'month', 'timezone', 'asOf', 'calculationVersion',
    'availability', 'unavailableReason', 'revisionId', 'data', 'ownCampus', 'meta']) ||
    raw.metric !== query.metric || raw.month !== query.month || raw.timezone !== 'Asia/Shanghai' ||
    !timestamp(raw.asOf) || typeof raw.calculationVersion !== 'string' ||
    typeof raw.availability !== 'string' || !['LIVE', 'SNAPSHOT', 'UNAVAILABLE'].includes(raw.availability) || !Array.isArray(raw.data) ||
    !record(raw.meta)) invalid();
  const meta = raw.meta;
  if (!exact(meta, ['page', 'pageSize', 'total', 'totalPages']) ||
    meta.page !== query.page || meta.pageSize !== query.pageSize || !integer(meta.total) || !integer(meta.totalPages) ||
    meta.totalPages !== Math.ceil(meta.total / query.pageSize) ||
    raw.data.length !== Math.max(0, Math.min(query.pageSize, meta.total - (query.page - 1) * query.pageSize))) invalid();
  if (raw.availability === 'UNAVAILABLE') {
    if (typeof raw.unavailableReason !== 'string' || !['HISTORY_UNAVAILABLE', 'SOURCE_DATA_INVALID'].includes(raw.unavailableReason) ||
      raw.revisionId !== null || raw.ownCampus !== null || meta.total !== 0 || meta.totalPages !== 0 || raw.data.length) invalid();
    // A fixed available revision cannot turn into an unavailable page halfway through.
    if (query.revisionId) invalid();
  } else if (raw.unavailableReason !== null || typeof raw.revisionId !== 'string' || !UUID.test(raw.revisionId) ||
    (query.revisionId && raw.revisionId !== query.revisionId)) invalid();
  const data = raw.data.map(row);
  const ownCampus = raw.ownCampus === null ? null : row(raw.ownCampus);
  const total = meta.total;
  if ((ownCampus && (!ownCampus.isOwnCampus || ownCampus.rank > total)) ||
    data.filter((item) => item.isOwnCampus).length > 1 ||
    data.some((item, index) => item.rank > total ||
      (index > 0 && item.rank < data[index - 1].rank) ||
      (query.page === 1 && index === 0 && item.rank !== 1) ||
      (item.isOwnCampus && (!ownCampus || item.campusName !== ownCampus.campusName ||
        item.rank !== ownCampus.rank || item.rankDelta !== ownCampus.rankDelta)))) invalid();
  return {
    metric: raw.metric as OperatorRankingPage['metric'], month: raw.month as string,
    timezone: 'Asia/Shanghai', asOf: raw.asOf, calculationVersion: raw.calculationVersion,
    availability: raw.availability as OperatorRankingPage['availability'],
    unavailableReason: raw.unavailableReason as OperatorRankingPage['unavailableReason'],
    revisionId: raw.revisionId as string | null, data, ownCampus,
    meta: { page: query.page, pageSize: query.pageSize, total: meta.total, totalPages: meta.totalPages },
  };
}
