import { ACTIVITY_TYPES, type Account, type CampusSummary, type TotalSummary } from '../pages/operator/headquarters/types';
export const uuid = (index: number) => `71000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export const headquartersMe = () => ({
  userId: uuid(900), displayName: '总部测试运营', roles: [{ code: 'OPERATOR', campusId: null }],
});
export const campuses = (count = 23) => Array.from({ length: count }, (_, i) => ({
  id: uuid(i + 1), name: `合成校区${String(i + 1).padStart(2, '0')}`, timezone: 'Asia/Shanghai',
}));
export function account(multiplier = 1): Account {
  return {
    mainBalanceUnits: 10000 * multiplier, giftBalanceUnits: 2000 * multiplier, totalBalanceUnits: 12000 * multiplier,
    mainReservedUnits: 1000 * multiplier, giftReservedUnits: 200 * multiplier, reservedTotalUnits: 1200 * multiplier,
    mainAvailableUnits: 9000 * multiplier, giftAvailableUnits: 1800 * multiplier, availableTotalUnits: 10800 * multiplier,
    enrollmentSummary: {
      receivedAmountFen: 123456 * multiplier, refundedAmountFen: null,
      initialMainUnits: 15000 * multiplier, initialGiftUnits: null, pendingIssuanceCount: 2 * multiplier,
    },
    lessonActivityTotals: ACTIVITY_TYPES.map((entryType, i) => ({
      entryType, mainDeltaUnits: (i % 2 ? -100 : 200) * multiplier,
      giftDeltaUnits: (i % 2 ? -20 : 30) * multiplier, totalDeltaUnits: (i % 2 ? -120 : 230) * multiplier,
    })),
  };
}
export function campusSummary(index = 1): CampusSummary {
  return { campus: campuses()[index - 1], activeStudentCount: 37, todayLessonCount: 5, account: account(),
    earnings: { estimatedTotalFen: -1234, pendingReviewFen: null, currency: 'CNY' },
    serverTime: '2026-10-29T06:00:00.000Z' };
}
export function totalSummary(): TotalSummary {
  return { campusCount: 23, activeStudentCount: 851, todayLessonCount: 115,
    studentCountBasis: 'SUM_OF_CAMPUS_ACTIVE_STUDENT_RECORDS', account: account(23),
    earnings: { estimatedTotalFen: -28382, pendingReviewFen: null, currency: 'CNY' },
    serverTime: '2026-10-29T06:00:00.000Z' };
}
export function directory(page = 1, query = '', count = 23) {
  const rows = campuses(count).filter(row => row.name.includes(query));
  return { data: rows.slice((page - 1) * 20, page * 20),
    meta: { page, pageSize: 20, total: rows.length, totalPages: Math.ceil(rows.length / 20) } };
}
