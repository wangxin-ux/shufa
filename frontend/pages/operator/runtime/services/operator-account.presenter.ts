import type { OperatorAccount, OperatorAccountLedgerRow } from '../types/operator-account';
import { OPERATOR_ACCOUNT_CATEGORIES } from '../types/operator-account';
import { formatDateTimeLabel, formatFenAmount } from '../../../../utils/format';

export function accountUnits(value: number | null, signed = false): string {
  if (value === null) return '待核对';
  const magnitude = Math.abs(value);
  return `${value < 0 ? '-' : signed && value > 0 ? '+' : ''}${Math.floor(magnitude / 100)}.${String(magnitude % 100).padStart(2, '0')}`;
}
export function accountTime(value: string, timezone: string): string {
  try { return formatDateTimeLabel(value, timezone); } catch { return '待核对'; }
}
export function presentOperatorAccountSummary(account: OperatorAccount) {
  const enrollment = account.enrollmentSummary;
  return {
    balances: [
      { label: '当前余额', main: accountUnits(account.mainBalanceUnits), gift: accountUnits(account.giftBalanceUnits), total: accountUnits(account.totalBalanceUnits) },
      { label: '退费预留', main: accountUnits(account.mainReservedUnits), gift: accountUnits(account.giftReservedUnits), total: accountUnits(account.reservedTotalUnits) },
      { label: '当前可用', main: accountUnits(account.mainAvailableUnits), gift: accountUnits(account.giftAvailableUnits), total: accountUnits(account.availableTotalUnits) },
    ],
    enrollment: [
      { label: '累计报名实收', value: enrollment.receivedAmountFen === null ? '待核对' : formatFenAmount(enrollment.receivedAmountFen) },
      { label: '累计实际退款', value: enrollment.refundedAmountFen === null ? '待核对' : formatFenAmount(enrollment.refundedAmountFen) },
      { label: '原始购买课时', value: accountUnits(enrollment.initialMainUnits) },
      { label: '原始赠送课时', value: accountUnits(enrollment.initialGiftUnits) },
      { label: '已收款未发放', value: `${enrollment.pendingIssuanceCount}笔` },
    ],
    activities: OPERATOR_ACCOUNT_CATEGORIES.filter(c => c.value !== '').map(category => {
      const row = account.lessonActivityTotals.find(item => item.entryType === category.value)!;
      return { key: row.entryType, label: row.entryType === 'GRANT' ? '历史累计发放' : category.label,
        main: accountUnits(row.mainDeltaUnits, true), gift: accountUnits(row.giftDeltaUnits, true),
        total: accountUnits(row.totalDeltaUnits, true) };
    }),
  };
}
export function presentOperatorAccountRow(row: OperatorAccountLedgerRow, timezone: string) {
  const payment = row.paymentContext;
  return {
    id: row.id, studentName: row.studentName, packageName: row.packageName,
    subjectLabel: row.subject?.name ?? '未归类',
    entryLabel: OPERATOR_ACCOUNT_CATEGORIES.find(c => c.value === row.entryType)!.label,
    bucketLabel: row.bucket === 'MAIN' ? '主课时' : '赠课时',
    deltaLabel: accountUnits(row.deltaUnits, true), deltaDirection: row.deltaUnits < 0 ? 'negative' : 'positive',
    beforeLabel: accountUnits(row.balanceBeforeUnits), afterLabel: accountUnits(row.balanceAfterUnits),
    reason: row.reason, createdLabel: accountTime(row.createdAt, timezone),
    paymentLabel: payment === null ? '缴费来源待核对' : 'receivedOn' in payment ?
      `缴费日期 ${payment.receivedOn}` : `缴费时间 ${accountTime(payment.paidAt, timezone)}`,
    teachingLabel: row.teachingContext ? `${row.teachingContext.courseName} · ${row.teachingContext.teacherName} · ${accountTime(row.teachingContext.lessonStartsAt, timezone)}` : '',
  };
}
export function emptyOperatorAccount() {
  return {
    summary: null as ReturnType<typeof presentOperatorAccountSummary> | null,
    rows: [] as Array<ReturnType<typeof presentOperatorAccountRow>>,
    summaryAsOfLabel: '', detailAsOfLabel: '', timezone: '', page: 0, total: 0, hasMore: false,
    errorMessage: '', refreshError: '', detailError: '', detailState: 'loading',
    loadingMore: false, refreshing: false,
    subjectsState: 'loading', subjectsError: '',
    subjectOptions: [] as Array<{ value: string; label: string }>,
    subjectId: '', subjectIndex: 0, subjectLabel: '全部科目',
    categoryIndex: 0, entryType: '' as '' | OperatorAccountLedgerRow['entryType'], categoryLabel: '全部类别',
  };
}
