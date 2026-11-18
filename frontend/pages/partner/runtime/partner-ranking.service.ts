import { createPartnerRuntimeEnv } from '../../../config/partner-env';
import { defaultRequest, SessionServiceError, type SessionHttpRequest } from '../../../services/session.service';
import {
  currentRankingMonth, PARTNER_RANKING_METRICS,
  type PartnerRankingPage, type PartnerRankingQuery, type PartnerRankingRow,
} from './partner-ranking.types';

interface Options {
  dataDriver: 'mock' | 'api';
  apiBaseUrl?: string;
  accessToken: () => string;
  request?: SessionHttpRequest;
  isCurrent?: () => boolean;
  now?: () => Date;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).length === allowed.length && allowed.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const integer = (value: unknown, min = 0) => Number.isSafeInteger(value) && Number(value) >= min;
function invalid(response = true): never {
  throw new SessionServiceError(response ? 502 : 400, response ? 'INVALID_RESPONSE' : 'BAD_REQUEST',
    response ? '月榜数据格式异常，请重试' : '月榜查询条件无效');
}
function parseRow(value: unknown): PartnerRankingRow {
  if (!object(value) || !keys(value, ['campusId', 'campusName', 'rank', 'previousRank', 'rankDelta', 'isOwnCampus']) ||
    typeof value.campusId !== 'string' || !UUID.test(value.campusId) ||
    typeof value.campusName !== 'string' || !value.campusName.trim() || value.campusName.length > 200 ||
    !integer(value.rank, 1) || typeof value.isOwnCampus !== 'boolean' ||
    (value.previousRank !== null && !integer(value.previousRank, 1)) ||
    (value.previousRank === null ? value.rankDelta !== null
      : value.rankDelta !== Number(value.previousRank) - Number(value.rank))) invalid();
  return value as unknown as PartnerRankingRow;
}
function parsePage(raw: unknown, query: Required<Pick<PartnerRankingQuery, 'page' | 'pageSize'>> & PartnerRankingQuery) {
  if (!object(raw) || !keys(raw, ['metric', 'month', 'timezone', 'asOf', 'calculationVersion',
    'availability', 'unavailableReason', 'revisionId', 'data', 'ownCampus', 'meta']) ||
    raw.metric !== query.metric || raw.month !== query.month || raw.timezone !== 'Asia/Shanghai' ||
    typeof raw.asOf !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw.asOf) ||
    !Number.isFinite(Date.parse(raw.asOf)) || new Date(raw.asOf).toISOString() !== raw.asOf ||
    typeof raw.calculationVersion !== 'string' || !raw.calculationVersion.trim() ||
    !['LIVE', 'SNAPSHOT', 'UNAVAILABLE'].includes(String(raw.availability)) ||
    !Array.isArray(raw.data) || !object(raw.meta)) invalid();
  const meta = raw.meta;
  if (!keys(meta, ['page', 'pageSize', 'total', 'totalPages']) || meta.page !== query.page ||
    meta.pageSize !== query.pageSize || !integer(meta.total) || !integer(meta.totalPages) ||
    meta.totalPages !== Math.ceil(Number(meta.total) / query.pageSize) ||
    raw.data.length !== Math.max(0, Math.min(query.pageSize, Number(meta.total) - (query.page - 1) * query.pageSize))) invalid();
  if (raw.availability === 'UNAVAILABLE') {
    if (!['HISTORY_UNAVAILABLE', 'SOURCE_DATA_INVALID'].includes(String(raw.unavailableReason)) ||
      raw.revisionId !== null || raw.ownCampus !== null || meta.total !== 0) invalid();
  } else if (raw.unavailableReason !== null || typeof raw.revisionId !== 'string' || !UUID.test(raw.revisionId) ||
    (query.revisionId && raw.revisionId !== query.revisionId)) invalid();
  const data = raw.data.map(parseRow);
  const ownCampus = raw.ownCampus === null ? null : parseRow(raw.ownCampus);
  if ((ownCampus && !ownCampus.isOwnCampus) || new Set(data.map((row) => row.campusId)).size !== data.length ||
    data.some((row, index) => row.rank > Number(meta.total) ||
      (index > 0 && row.rank < data[index - 1].rank) ||
      (query.page === 1 && index === 0 && row.rank !== 1) ||
      row.isOwnCampus !== (ownCampus?.campusId === row.campusId) ||
      (row.isOwnCampus && (!ownCampus || row.rank !== ownCampus.rank ||
        row.campusName !== ownCampus.campusName || row.previousRank !== ownCampus.previousRank)))) invalid();
  return { ...raw, data, ownCampus } as unknown as PartnerRankingPage;
}

export class PartnerRankingService {
  constructor(private readonly options: Options) {}
  getSessionKey(): string {
    if (this.options.isCurrent && !this.options.isCurrent()) return '';
    return `${this.options.dataDriver}:${this.options.apiBaseUrl ?? ''}:${this.options.accessToken()}`;
  }
  private owner(): string {
    const owner = this.getSessionKey();
    if (!owner || (this.options.dataDriver === 'api' && !this.options.accessToken().trim()))
      throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新，请重新登录');
    return owner;
  }
  async list(input: PartnerRankingQuery): Promise<PartnerRankingPage> {
    const now = this.options.now?.() ?? new Date();
    if (!object(input) || Object.keys(input).some((key) =>
      !['metric', 'month', 'page', 'pageSize', 'revisionId'].includes(key)) ||
      !PARTNER_RANKING_METRICS.some((metric) => metric.value === input.metric) ||
      !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(input.month) || input.month > currentRankingMonth(now) ||
      !integer(input.page ?? 1, 1) || !integer(input.pageSize ?? 20, 1) || (input.pageSize ?? 20) > 100 ||
      (input.revisionId !== undefined && !UUID.test(input.revisionId))) invalid(false);
    const query = { ...input, page: input.page ?? 1, pageSize: input.pageSize ?? 20 };
    const owner = this.owner();
    if (this.options.dataDriver === 'mock') return this.mock(query, now);
    const base = this.options.apiBaseUrl?.trim().replace(/\/+$/, '');
    if (!base || !/^https?:\/\//.test(base))
      throw new SessionServiceError(503, 'CONFIGURATION_REQUIRED', '月榜服务尚未配置');
    const search = `metric=${query.metric}&month=${query.month}&page=${query.page}&pageSize=${query.pageSize}` +
      (query.revisionId ? `&revisionId=${encodeURIComponent(query.revisionId)}` : '');
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (this.owner() !== owner) throw new SessionServiceError(401, 'UNAUTHORIZED', '登录已更新，请重新登录');
          action();
        } catch (error) { reject(error); }
      };
      const timer = setTimeout(() => finish(() => reject(
        new SessionServiceError(0, 'TIMEOUT', '月榜读取超时，请重试'))), 15_000);
      try {
        (this.options.request ?? defaultRequest)({
          url: `${base}/partners/me/rankings?${search}`, method: 'GET',
          header: { Authorization: `Bearer ${this.options.accessToken()}`, 'Content-Type': 'application/json' },
          success: (response) => finish(() => {
            if (response.statusCode !== 200) throw new SessionServiceError(response.statusCode,
              'RANKING_REQUEST_FAILED', response.statusCode === 401 ? '登录已失效，请重新登录'
                : response.statusCode === 403 ? '当前账号无权查看月榜' : '月榜读取失败，请重试');
            if (!object(response.data) || !Object.prototype.hasOwnProperty.call(response.data, 'data') ||
              Object.keys(response.data).some((key) => !['data', 'requestId'].includes(key)) ||
              (response.data.requestId !== undefined && typeof response.data.requestId !== 'string')) invalid();
            resolve(parsePage(response.data.data, query));
          }),
          fail: () => finish(() => reject(new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应，请重试'))),
        });
      } catch (error) { finish(() => reject(error instanceof SessionServiceError ? error
        : new SessionServiceError(0, 'NETWORK_ERROR', '网络暂未响应，请重试'))); }
    });
  }
  private mock(query: PartnerRankingQuery & { page: number; pageSize: number }, now: Date): PartnerRankingPage {
    const current = query.month === currentRankingMonth(now);
    const order = query.metric === 'STUDENTS' ? [1, 2, 3, 4] : query.metric === 'PARTNER_EARNINGS'
      ? [2, 3, 1, 4] : [3, 1, 2, 4];
    const rows = current ? order.map((id, index): PartnerRankingRow => ({
      campusId: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
      campusName: ['示例东校区', '示例西校区', '示例南校区', '示例北校区'][id - 1],
      rank: index + 1, previousRank: null, rankDelta: null, isOwnCampus: id === 1,
    })) : [];
    const revisionId = current ? `00000000-0000-4000-8000-00000000000${PARTNER_RANKING_METRICS.findIndex((m) => m.value === query.metric) + 1}` : null;
    if (query.revisionId && query.revisionId !== revisionId)
      throw new SessionServiceError(404, 'RESOURCE_NOT_FOUND', '月榜版本不存在，请刷新');
    return {
      metric: query.metric, month: query.month, timezone: 'Asia/Shanghai', asOf: now.toISOString(),
      calculationVersion: 'mock-monthly-rankings-v1', availability: current ? 'LIVE' : 'UNAVAILABLE',
      unavailableReason: current ? null : 'HISTORY_UNAVAILABLE', revisionId,
      data: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
      ownCampus: rows.find((row) => row.isOwnCampus) ?? null,
      meta: { page: query.page, pageSize: query.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / query.pageSize) },
    };
  }
}

export function createPartnerRankingService(): PartnerRankingService {
  const env = createPartnerRuntimeEnv();
  const base = env.apiBaseUrl.trim().replace(/\/+$/, '');
  return new PartnerRankingService({
    dataDriver: env.dataDriver, apiBaseUrl: base, accessToken: () => createPartnerRuntimeEnv().accessToken,
    isCurrent: () => {
      const current = createPartnerRuntimeEnv();
      return current.dataDriver === env.dataDriver && current.apiBaseUrl.trim().replace(/\/+$/, '') === base;
    },
  });
}
