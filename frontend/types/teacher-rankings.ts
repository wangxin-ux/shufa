export type TeacherRankingMetric = 'EARNINGS' | 'ATTENDANCE';
export interface TeacherRankingQuery {
  metric: TeacherRankingMetric;
  month?: string;
  page: number;
  pageSize: number;
  revision?: string;
}
export interface TeacherRankingRow {
  position: number;
  displayName: string;
  rank: number;
  previousRank: number | null;
  rankDelta: number | null;
  isSelf: boolean;
}
export interface TeacherRankingPage {
  metric: TeacherRankingMetric;
  month: string;
  timezone: string;
  asOf: string;
  revision: string;
  rows: TeacherRankingRow[];
  own: {
    value: number;
    rank: number | null;
    previousRank: number | null;
    rankDelta: number | null;
    hasActivity: boolean;
  };
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
