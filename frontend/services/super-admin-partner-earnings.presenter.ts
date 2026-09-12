import {
  PartnerEarningStatus,
  SuperAdminPartnerEarning,
  SuperAdminPartnerEarningRule,
} from '../types/super-admin';
import { formatLocalDateTime } from '../utils/super-admin-format';

const STATUS_LABELS: Record<PartnerEarningStatus, string> = {
  PENDING_REVIEW: '待审核',
  AVAILABLE: '可结算',
  REJECTED: '已驳回',
  REVERSED: '已冲正',
};

export function formatSuperAdminPartnerMoney(fen: number): string {
  const sign = fen < 0 ? '-' : '';
  return `${sign}¥${(Math.abs(fen) / 100).toFixed(2)}`;
}

export function formatSuperAdminPartnerShare(basisPoints: number): string {
  const percentage = basisPoints / 100;
  const label = Number.isInteger(percentage)
    ? String(percentage)
    : percentage.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${label}%`;
}

export function presentSuperAdminPartnerRule(
  rule: SuperAdminPartnerEarningRule,
) {
  return {
    ...rule,
    unitPriceLabel: formatSuperAdminPartnerMoney(rule.unitPriceFen),
    shareLabel: formatSuperAdminPartnerShare(rule.shareBasisPoints),
    statusLabel: {
      DRAFT: '草稿',
      ACTIVE: '生效中',
      RETIRED: '已退役',
    }[rule.status],
    effectiveFromLabel: formatLocalDateTime(rule.effectiveFrom),
  };
}

export function presentSuperAdminPartnerEarning(
  entry: SuperAdminPartnerEarning,
) {
  return {
    ...entry,
    attendeeLabel: `${entry.countedAttendeeCount} 人`,
    unitPriceLabel: formatSuperAdminPartnerMoney(entry.unitPriceFen),
    shareLabel: formatSuperAdminPartnerShare(entry.shareBasisPoints),
    perAttendeeLabel: formatSuperAdminPartnerMoney(
      entry.perAttendeeAmountFen,
    ),
    amountLabel: formatSuperAdminPartnerMoney(entry.amountFen),
    statusLabel: STATUS_LABELS[entry.status],
    completedAtLabel: formatLocalDateTime(entry.completedAt),
    canReview:
      entry.entryType === 'ACCRUAL' && entry.status === 'PENDING_REVIEW',
  };
}
