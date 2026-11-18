export const PARTNER_RANKING_METRICS = [
  { value: 'STUDENTS', label: '学生数量' },
  { value: 'PARTNER_EARNINGS', label: '校区收益' },
  { value: 'HEADQUARTERS_EARNINGS', label: '总部收益' },
] as const;
export type PartnerRankingMetric = typeof PARTNER_RANKING_METRICS[number]['value'];
export interface PartnerRankingRow {
  campusId: string;
  campusName: string;
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
  isOwnCampus: boolean;
}
export interface PartnerRankingPage {
  metric: PartnerRankingMetric;
  month: string;
  timezone: 'Asia/Shanghai';
  asOf: string;
  calculationVersion: string;
  availability: 'LIVE' | 'SNAPSHOT' | 'UNAVAILABLE';
  unavailableReason: 'HISTORY_UNAVAILABLE' | 'SOURCE_DATA_INVALID' | null;
  revisionId: string | null;
  data: PartnerRankingRow[];
  ownCampus: PartnerRankingRow | null;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
export interface PartnerRankingQuery {
  metric: PartnerRankingMetric;
  month: string;
  page?: number;
  pageSize?: number;
  revisionId?: string;
}
export function currentRankingMonth(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}
