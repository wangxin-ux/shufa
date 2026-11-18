import { formatDateTimeLabel, formatFenAmount } from '../../../../utils/format';
import { OPERATOR_EARNING_STATUSES, OPERATOR_EARNING_TYPES,
  type OperatorEarningEntry, type OperatorEarningSummary } from '../types/operator-earning';

export function earningTime(value: string, timezone: string) {
  return formatDateTimeLabel(value, timezone);
}
export function presentEarningSummary(summary: OperatorEarningSummary) {
  const amount = (value: number | null) => value === null ? '待核对' : formatFenAmount(value);
  return { estimatedLabel: amount(summary.estimatedTotalFen), pendingLabel: amount(summary.pendingReviewFen) };
}
export function presentEarningRow(row: OperatorEarningEntry, timezone: string) {
  return {
    id: row.id, createdAt: row.createdAt,
    typeLabel: OPERATOR_EARNING_TYPES.find(item => item.value === row.entryType)!.label,
    statusLabel: OPERATOR_EARNING_STATUSES.find(item => item.value === row.status)!.label,
    amountLabel: formatFenAmount(row.amountFen), negative: row.amountFen < 0,
    createdLabel: earningTime(row.createdAt, timezone), completedLabel: earningTime(row.completedAt, timezone),
  };
}
export function emptyEarnings() {
  return {
    summary: null as ReturnType<typeof presentEarningSummary> | null,
    rows: [] as Array<ReturnType<typeof presentEarningRow>>,
    summaryState: 'loading', detailState: 'loading',
    summaryError: '', detailError: '', errorMessage: '',
    summaryAsOfLabel: '', detailAsOfLabel: '', timezone: '', detailTimezone: '',
    page: 0, total: 0, hasMore: false, loadingMore: false,
    status: '' as typeof OPERATOR_EARNING_STATUSES[number]['value'], statusIndex: 0, statusLabel: '全部状态',
    entryType: '' as typeof OPERATOR_EARNING_TYPES[number]['value'], typeIndex: 0, typeLabel: '全部类型',
  };
}
