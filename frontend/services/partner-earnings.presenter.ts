import {
  PartnerEarningEntry,
  PartnerEarningRule,
  PartnerEarningStatus,
  PartnerEarningSummary,
} from '../types/partner';
import { formatPartnerDateTime } from '../utils/partner-format';

const STATUS_LABELS: Record<PartnerEarningStatus, string> = {
  PENDING_REVIEW: '待审核',
  AVAILABLE: '可结算',
  REJECTED: '已驳回',
  REVERSED: '已冲正',
};

export function formatPartnerEarningMoney(fen: number): string {
  const sign = fen < 0 ? '-' : '';
  return `${sign}¥${(Math.abs(fen) / 100).toFixed(2)}`;
}

export function formatPartnerShare(basisPoints: number): string {
  const percentage = basisPoints / 100;
  const label = Number.isInteger(percentage)
    ? String(percentage)
    : percentage.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${label}%`;
}

export function partnerEarningStatusLabel(
  status: PartnerEarningStatus,
): string {
  return STATUS_LABELS[status];
}

export function presentPartnerEarningSummary(summary: PartnerEarningSummary) {
  return {
    estimatedTotalLabel: formatPartnerEarningMoney(summary.estimatedTotalFen),
    pendingReviewLabel: formatPartnerEarningMoney(summary.pendingReviewFen),
    availableLabel: formatPartnerEarningMoney(summary.availableFen),
    reversedNetLabel: formatPartnerEarningMoney(summary.reversedNetFen),
  };
}

export function presentPartnerEarningRule(rule: PartnerEarningRule | null) {
  if (!rule) {
    return null;
  }
  return {
    ...rule,
    unitPriceLabel: formatPartnerEarningMoney(rule.unitPriceFen),
    shareLabel: formatPartnerShare(rule.shareBasisPoints),
    attendanceLabel: rule.countedAttendanceStatuses.includes('PRESENT')
      ? '实际到课'
      : '按配置状态',
    effectiveFromLabel: formatPartnerDateTime(rule.effectiveFrom),
  };
}

export function presentPartnerEarningEntry(entry: PartnerEarningEntry) {
  return {
    ...entry,
    attendeeLabel: `${entry.countedAttendeeCount} 人`,
    unitPriceLabel: formatPartnerEarningMoney(entry.unitPriceFen),
    shareLabel: formatPartnerShare(entry.shareBasisPoints),
    perAttendeeLabel: formatPartnerEarningMoney(entry.perAttendeeAmountFen),
    amountLabel: formatPartnerEarningMoney(entry.amountFen),
    statusLabel: partnerEarningStatusLabel(entry.status),
    completedAtLabel: formatPartnerDateTime(entry.completedAt),
    isReversal: entry.entryType === 'REVERSAL',
  };
}
