import {
  TeacherEarningEntry,
  TeacherEarningRuleView,
  TeacherEarningSummary,
  TeacherEarningStatus,
  TeacherWithdrawal,
  TeacherWithdrawalStatus,
} from '../types/teacher';
import {
  formatDateLabel,
  formatDateTimeLabel,
  formatFenAmount,
} from '../utils/format';

export type TeacherFinancialStatusTone =
  | 'success'
  | 'warning'
  | 'muted'
  | 'danger';

export interface TeacherFinancialStatusPresentation {
  label: string;
  tone: TeacherFinancialStatusTone;
}

export interface TeacherEarningRuleModel {
  configured: boolean;
  basisLabel: string;
  unitAmount: string;
  settlementLabel: string;
  effectiveFrom: string;
  scopeLabel: string;
}

export interface TeacherEarningSummaryItemModel {
  key: 'today' | 'week' | 'month' | 'estimated';
  label: string;
  value: string;
}

export interface TeacherEarningStatusItemModel {
  key: 'pending' | 'available' | 'withdrawing';
  label: string;
  value: string;
}

export interface TeacherEarningEntryModel {
  id: string;
  courseName: string;
  amount: string;
  timeLabel: string;
  basisLabel: string;
  basisDetail: string;
  entryTypeLabel: string;
  statusLabel: string;
  statusTone: TeacherFinancialStatusTone;
  reason: string;
}

export interface TeacherWithdrawalModel {
  id: string;
  requestNo: string;
  amount: string;
  requestedAt: string;
  statusLabel: string;
  statusTone: TeacherFinancialStatusTone;
  reason: string;
  canCancel: boolean;
  version: number;
}

export type TeacherWithdrawalAmountParseResult =
  | { ok: true; amountFen: number }
  | { ok: false; message: string };

const EARNING_STATUS_PRESENTATION: Record<
  TeacherEarningStatus,
  TeacherFinancialStatusPresentation
> = {
  PENDING_REVIEW: { label: '待审核', tone: 'warning' },
  AVAILABLE: { label: '可提现', tone: 'success' },
  REJECTED: { label: '已驳回', tone: 'danger' },
  REVERSED: { label: '已撤销', tone: 'muted' },
};

const WITHDRAWAL_STATUS_PRESENTATION: Record<
  TeacherWithdrawalStatus,
  TeacherFinancialStatusPresentation
> = {
  SUBMITTED: { label: '待审核', tone: 'warning' },
  APPROVED: { label: '已通过', tone: 'success' },
  PAYING: { label: '打款中', tone: 'warning' },
  PAID: { label: '已完成', tone: 'success' },
  CANCELLED: { label: '已取消', tone: 'muted' },
  REJECTED: { label: '已驳回', tone: 'danger' },
  FAILED: { label: '打款失败', tone: 'danger' },
};

const BASIS_LABELS: Record<TeacherEarningRuleView['basisType'], string> = {
  PER_COMPLETED_SESSION: '每完成一课次',
  PER_LESSON_UNIT: '按课时',
  PER_PRESENT_ATTENDEE: '按实际到课人数',
};

export const formatTeacherEarningAmount = formatFenAmount;

export function getTeacherEarningStatusPresentation(
  status: TeacherEarningStatus,
): TeacherFinancialStatusPresentation {
  return EARNING_STATUS_PRESENTATION[status];
}

export function getTeacherWithdrawalStatusPresentation(
  status: TeacherWithdrawalStatus,
): TeacherFinancialStatusPresentation {
  return WITHDRAWAL_STATUS_PRESENTATION[status];
}

export function buildTeacherEarningRuleModel(
  rule: TeacherEarningRuleView | null,
): TeacherEarningRuleModel {
  if (!rule) {
    return {
      configured: false,
      basisLabel: '待配置',
      unitAmount: '--',
      settlementLabel: '请联系管理员配置',
      effectiveFrom: '--',
      scopeLabel: '',
    };
  }

  return {
    configured: true,
    basisLabel: BASIS_LABELS[rule.basisType],
    unitAmount: formatFenAmount(rule.unitAmountFen),
    settlementLabel:
      rule.settlementDelayDays === 0
        ? '完成后可审核'
        : `完成后 ${rule.settlementDelayDays} 天可审核`,
    effectiveFrom: formatDateLabel(rule.effectiveFrom),
    scopeLabel: rule.teacherId ? '教师专属规则' : '校区默认规则',
  };
}

export function buildTeacherEarningSummaryModel(
  summary: TeacherEarningSummary,
): TeacherEarningSummaryItemModel[] {
  return ([
    ['today', '今日收益', summary.todayEstimatedFen],
    ['week', '本周收益', summary.weekEstimatedFen],
    ['month', '本月收益', summary.monthEstimatedFen],
    ['estimated', '累计收益', summary.estimatedTotalFen],
  ] as const).map(([key, label, amount]) => ({
    key, label, value: formatFenAmount(amount),
  }));
}

export function buildTeacherEarningStatusModel(
  summary: TeacherEarningSummary,
): TeacherEarningStatusItemModel[] {
  return ([
    ['pending', '待审核', summary.pendingReviewFen],
    ['available', '可提现', summary.availableFen],
    ['withdrawing', '提现中', summary.withdrawingFen],
  ] as const).map(([key, label, amount]) => ({
    key, label, value: formatFenAmount(amount),
  }));
}

function isKnownInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

export function buildTeacherEarningEntryModel(
  entry: TeacherEarningEntry,
): TeacherEarningEntryModel {
  const status = getTeacherEarningStatusPresentation(entry.status);
  const basis = entry.basisType;
  const unitAmount = isKnownInteger(entry.unitAmountFen, 1)
    ? formatFenAmount(entry.unitAmountFen) : '待核对';
  const basisDetail =
    basis === 'PER_LESSON_UNIT'
      ? `${isKnownInteger(entry.lessonUnits, 1)
          ? `${entry.lessonUnits / 100} 课时` : '课时待核对'} · 单价 ${unitAmount}`
      : basis === 'PER_PRESENT_ATTENDEE'
        ? `${isKnownInteger(entry.attendeeCount, 0)
            ? `${entry.attendeeCount} 人到课` : '人数待核对'} · 单价 ${unitAmount}`
        : `单价 ${unitAmount}`;
  return {
    id: entry.id,
    courseName: entry.courseName,
    amount: formatFenAmount(entry.amountFen),
    timeLabel: formatDateTimeLabel(entry.lessonStartsAt),
    basisLabel: typeof basis === 'string' && Object.prototype.hasOwnProperty.call(BASIS_LABELS, basis)
      ? BASIS_LABELS[basis] : '待核对',
    basisDetail,
    entryTypeLabel: entry.entryType === 'REVERSAL' ? '撤销冲正' : '课次收益',
    statusLabel: status.label,
    statusTone: status.tone,
    reason: entry.rejectionReason ?? '',
  };
}

export function buildTeacherWithdrawalModel(
  withdrawal: TeacherWithdrawal,
): TeacherWithdrawalModel {
  const status = getTeacherWithdrawalStatusPresentation(withdrawal.status);
  return {
    id: withdrawal.id,
    requestNo: withdrawal.requestNo,
    amount: formatFenAmount(withdrawal.amountFen),
    requestedAt: formatDateTimeLabel(withdrawal.requestedAt),
    statusLabel: status.label,
    statusTone: status.tone,
    reason: withdrawal.rejectionReason ?? withdrawal.failureReason ?? '',
    canCancel: withdrawal.status === 'SUBMITTED',
    version: withdrawal.version,
  };
}

export function parseTeacherWithdrawalYuan(
  input: string,
): TeacherWithdrawalAmountParseResult {
  const normalized = input.trim();
  if (/^\d+\.\d{3,}$/.test(normalized)) {
    return { ok: false, message: '金额最多保留两位小数' };
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return { ok: false, message: '请输入正确的提现金额' };
  }
  const [yuan, fraction = ''] = normalized.split('.');
  const amountFen = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountFen)) {
    return { ok: false, message: '提现金额超出支持范围' };
  }
  if (amountFen <= 0) {
    return { ok: false, message: '请输入大于 0 的提现金额' };
  }
  return { ok: true, amountFen };
}
