import { ACTIVITY_TYPES, type Summary } from './types';
const labels = ['历史发放', '消费', '撤销恢复', '退费', '纠错', '调整'];
export function hundredths(value: number | null, signed = false): string {
  if (value === null) return '待核对';
  const integer = BigInt(value), magnitude = integer < 0n ? -integer : integer;
  return `${integer < 0n ? '-' : signed && integer > 0n ? '+' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
}
function money(value: number | null) { return value === null ? '待核对' : `${hundredths(value)}元`; }
export function presentSummary(value: Summary) {
  const a = value.account, e = a.enrollmentSummary;
  return {
    asOf: `${new Date(value.serverTime).toISOString().slice(0, 19).replace('T', ' ')} UTC`,
    balances: [
      { label: '当前余额', main: hundredths(a.mainBalanceUnits), gift: hundredths(a.giftBalanceUnits), total: hundredths(a.totalBalanceUnits) },
      { label: '退费预留', main: hundredths(a.mainReservedUnits), gift: hundredths(a.giftReservedUnits), total: hundredths(a.reservedTotalUnits) },
      { label: '当前可用', main: hundredths(a.mainAvailableUnits), gift: hundredths(a.giftAvailableUnits), total: hundredths(a.availableTotalUnits) },
    ],
    enrollment: [
      { label: '累计报名实收', value: money(e.receivedAmountFen) }, { label: '累计实际退款', value: money(e.refundedAmountFen) },
      { label: '原始购买课时', value: hundredths(e.initialMainUnits) }, { label: '原始赠送课时', value: hundredths(e.initialGiftUnits) },
      { label: '已收款未发放', value: `${e.pendingIssuanceCount}笔` },
    ],
    activities: ACTIVITY_TYPES.map((key, index) => {
      const row = a.lessonActivityTotals.find(item => item.entryType === key)!;
      return { key, label: labels[index], main: hundredths(row.mainDeltaUnits, true),
        gift: hundredths(row.giftDeltaUnits, true), total: hundredths(row.totalDeltaUnits, true) };
    }),
    earnings: [
      { label: '预计内部收益', value: money(value.earnings.estimatedTotalFen) },
      { label: '其中待审', value: money(value.earnings.pendingReviewFen) },
    ],
  };
}
export function emptyPrivate() {
  return { campuses: [] as Array<{ id: string; name: string; timezone: string }>,
    totalSummary: null as import('./types').TotalSummary | null,
    campusSummary: null as import('./types').CampusSummary | null,
    totalPresentation: null as ReturnType<typeof presentSummary> | null,
    campusPresentation: null as ReturnType<typeof presentSummary> | null,
    query: '', appliedQuery: '', selectedCampusId: '', selectedCampusName: '', directoryPage: 0, directoryTotal: 0, hasMore: false,
    directoryState: 'loading', totalState: 'loading', campusState: 'empty',
    directoryError: '', totalError: '', campusError: '', errorMessage: '',
    loadingMore: false, tab: 'all', navigating: false };
}
