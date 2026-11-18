export const RANKING_MONTH = '2026-10';
export const RANKING_REVISION = 'a3000000-0000-4000-8000-000000000001';
export const RANKING_QUERY = { metric: 'STUDENTS' as const, month: RANKING_MONTH, page: 1, pageSize: 20 };
export function rankingRows(total = 21) {
  return Array.from({ length: total }, (_, index) => ({
    campusName: index < 2 ? '同名示例校区' : `示例校区${index + 1}`,
    rank: index < 2 ? 1 : index, rankDelta: index === 0 ? null : index % 3 - 1,
    isOwnCampus: index === total - 1,
  }));
}
export function rankingPage(query: Partial<{ metric: string; month: string; page: number; pageSize: number; revisionId: string }> = {}, total = 21) {
  const q = { ...RANKING_QUERY, ...query };
  const rows = rankingRows(total);
  return {
    metric: q.metric, month: q.month, timezone: 'Asia/Shanghai',
    asOf: '2026-10-28T09:30:00.000Z', calculationVersion: 'synthetic-test-only',
    availability: 'LIVE', unavailableReason: null,
    revisionId: q.revisionId ?? RANKING_REVISION,
    data: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    ownCampus: rows.find((row) => row.isOwnCampus) ?? null,
    meta: { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
  };
}
export function unavailableRanking(reason = 'HISTORY_UNAVAILABLE', query = {}) {
  return { ...rankingPage(query, 0), availability: 'UNAVAILABLE', unavailableReason: reason, revisionId: null };
}
