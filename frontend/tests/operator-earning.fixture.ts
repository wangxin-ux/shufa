export const EARNING_QUERY = { page: 1, pageSize: 20 };
export const earningSummary = () => ({
  estimatedTotalFen: 20888 as number | null, pendingReviewFen: 4088 as number | null,
  currency: 'CNY' as const, serverTime: '2026-10-29T04:00:00Z', timezone: 'Asia/Shanghai',
});
export function earningEntries(query: { page?: number; pageSize?: number; status?: string; entryType?: string } = {}, total = 21) {
  const page = query.page ?? 1, pageSize = query.pageSize ?? 20;
  return {
    data: Array.from({ length: Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)) }, (_, index) => {
      const offset = (page - 1) * pageSize + index;
      const entryType = query.entryType ?? (offset === 1 ? 'REVERSAL' : 'ACCRUAL');
      return {
        id: `ae100000-0000-4000-8000-${String(offset + 1).padStart(12, '0')}`,
        entryType, status: query.status ?? (entryType === 'REVERSAL' ? 'REVERSED' :
          ['PENDING_REVIEW', 'AVAILABLE', 'REJECTED', 'REVERSED'][offset % 4]),
        amountFen: entryType === 'REVERSAL' ? -100 : 100,
        createdAt: new Date(Date.UTC(2026, 9, 29, 4, 0, -offset)).toISOString(),
        completedAt: '2026-10-28T03:00:00+00:00',
      };
    }),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    serverTime: '2026-10-29T04:00:00Z', timezone: 'Asia/Shanghai',
  };
}
