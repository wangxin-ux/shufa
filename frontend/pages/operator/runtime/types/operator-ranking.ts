import type { OperatorPageMeta } from './operator';

export const OPERATOR_RANKING_METRICS = [
  { value: 'STUDENTS', label: '学员数' },
  { value: 'PARTNER_EARNINGS', label: '校区内部收益' },
  { value: 'HEADQUARTERS_EARNINGS', label: '总部收益' },
] as const;
export type OperatorRankingMetric = typeof OPERATOR_RANKING_METRICS[number]['value'];
export interface OperatorRankingQuery {
  metric: OperatorRankingMetric;
  month: string;
  page: number;
  pageSize: number;
  revisionId?: string;
}
export interface OperatorRankingRow {
  campusName: string;
  rank: number;
  rankDelta: number | null;
  isOwnCampus: boolean;
}
export interface OperatorRankingPage {
  metric: OperatorRankingMetric;
  month: string;
  timezone: 'Asia/Shanghai';
  asOf: string;
  calculationVersion: string;
  availability: 'LIVE' | 'SNAPSHOT' | 'UNAVAILABLE';
  unavailableReason: 'HISTORY_UNAVAILABLE' | 'SOURCE_DATA_INVALID' | null;
  revisionId: string | null;
  data: OperatorRankingRow[];
  ownCampus: OperatorRankingRow | null;
  meta: OperatorPageMeta;
}
export function currentOperatorRankingMonth(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
export function isOperatorRankingMonth(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value) &&
    value <= currentOperatorRankingMonth();
}
export function isOperatorRankingMetric(value: unknown): value is OperatorRankingMetric {
  return OPERATOR_RANKING_METRICS.some((item) => item.value === value);
}
