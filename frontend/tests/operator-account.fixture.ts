export const ACCOUNT_QUERY = { page: 1, pageSize: 20 };
export const SUBJECT_ID = 'ac000000-0000-4000-8000-000000000001';
export const ENTRY_TYPES = ['GRANT', 'CONSUME', 'REVERSAL', 'ADJUSTMENT', 'REFUND', 'CORRECTION'] as const;
export function accountPage(query: { page?: number; pageSize?: number; entryType?: string; subjectId?: string } = {}, total = 21) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return {
    mainBalanceUnits: 12000, giftBalanceUnits: 3000, totalBalanceUnits: 15000,
    mainReservedUnits: 2000, giftReservedUnits: 1000, reservedTotalUnits: 3000,
    mainAvailableUnits: 10000, giftAvailableUnits: 2000, availableTotalUnits: 12000,
    enrollmentSummary: { receivedAmountFen: 800000, refundedAmountFen: 120000,
      initialMainUnits: 20000, initialGiftUnits: null, pendingIssuanceCount: 1 },
    lessonActivityTotals: ENTRY_TYPES.map((entryType, index) => ({
      entryType, mainDeltaUnits: index === 0 ? 30000 : -100, giftDeltaUnits: index === 5 ? null : 0,
      totalDeltaUnits: index === 5 ? null : index === 0 ? 30000 : -100,
    })),
    items: Array.from({ length: Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)) }, (_, index) => {
      const offset = (page - 1) * pageSize + index;
      return {
        id: `ac100000-0000-4000-8000-${String(offset + 1).padStart(12, '0')}`,
        studentId: 'ac200000-0000-4000-8000-000000000001',
        studentName: '合成学员', packageName: '合成创意主赠课包',
        subject: query.subjectId === 'UNCLASSIFIED' ? null : { id: query.subjectId ?? SUBJECT_ID, name: '创意（历史）' },
        entryType: query.entryType ?? ENTRY_TYPES[offset % 6], bucket: offset % 2 ? 'GIFT' : 'MAIN',
        deltaUnits: -100, balanceBeforeUnits: 200, balanceAfterUnits: 100, reason: offset % 2 ? null : '合成记录说明',
        createdAt: new Date(Date.UTC(2026, 9, 28, 9, 30 - offset)).toISOString(),
        paymentContext: offset === 0 ? { receivedOn: '2026-10-27' } : offset === 1 ? { paidAt: '2026-10-27T12:00:00Z' } : null,
        teachingContext: offset % 3 ? null : { courseName: '合成创意课', teacherName: '合成教师', lessonStartsAt: '2026-10-27T08:00:00Z' },
      };
    }),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    serverTime: '2026-10-28T09:30:00Z', timezone: 'Asia/Shanghai',
  };
}
export function accountSubjects(page = 1, total = 101, pageSize = 100) {
  return {
    data: Array.from({ length: Math.max(0, Math.min(pageSize, total - (page - 1) * pageSize)) }, (_, i) => ({
      id: `ac000000-0000-4000-8000-${String((page - 1) * pageSize + i + 1).padStart(12, '0')}`,
      name: `科目${(page - 1) * pageSize + i + 1}`, isActive: i % 2 === 0, version: 1,
    })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    serverTime: '2026-10-28T09:30:00Z', timezone: 'Asia/Shanghai',
  };
}
