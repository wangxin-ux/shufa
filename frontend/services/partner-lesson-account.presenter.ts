import {
  PartnerLessonAccount,
  PartnerLessonLedgerEntry,
} from '../types/partner';
import {
  formatPartnerDateTime,
  formatPartnerLessonUnits,
  formatPartnerSignedLessonUnits,
} from '../utils/partner-format';

export interface PartnerLessonAccountSummaryModel {
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
}

export interface PartnerLessonAccountItemModel {
  id: string;
  studentName: string;
  packageName: string;
  typeLabel: string;
  bucketLabel: '主课时' | '赠送课时';
  deltaLabel: string;
  balanceAfterLabel: string;
  reasonLabel: string;
  timeLabel: string;
  tone: 'negative' | 'positive' | 'neutral';
}

const TYPE_LABELS: Record<PartnerLessonLedgerEntry['entryType'], string> = {
  CONSUME: '完成扣课',
  REVERSAL: '撤销返还',
  ADJUSTMENT: '课时调整',
  REFUND: '退课扣回',
  GRANT: '课时发放',
  CORRECTION: '收款纠错冲正',
};

export function buildPartnerLessonAccountPageModel(
  account: PartnerLessonAccount,
  timeZone = 'Asia/Shanghai',
): {
  summary: PartnerLessonAccountSummaryModel;
  items: PartnerLessonAccountItemModel[];
} {
  return {
    summary: {
      mainBalanceLabel: formatPartnerLessonUnits(account.mainBalanceUnits),
      giftBalanceLabel: formatPartnerLessonUnits(account.giftBalanceUnits),
      totalBalanceLabel: formatPartnerLessonUnits(account.totalBalanceUnits),
    },
    items: account.items.map((item) => ({
      id: item.id,
      studentName: item.studentName,
      packageName: item.packageName,
      typeLabel: TYPE_LABELS[item.entryType],
      bucketLabel: item.bucket === 'MAIN' ? '主课时' : '赠送课时',
      deltaLabel: formatPartnerSignedLessonUnits(item.deltaUnits),
      balanceAfterLabel: `剩余 ${formatPartnerLessonUnits(item.balanceAfterUnits)} 节`,
      reasonLabel: item.reason?.trim() || '未填写说明',
      timeLabel: formatPartnerDateTime(item.createdAt, timeZone),
      tone:
        item.deltaUnits < 0
          ? 'negative'
          : item.deltaUnits > 0
            ? 'positive'
            : 'neutral',
    })),
  };
}

export function mergePartnerLessonAccountItems(
  current: readonly PartnerLessonAccountItemModel[],
  incoming: readonly PartnerLessonAccountItemModel[],
  page: number,
): PartnerLessonAccountItemModel[] {
  if (page <= 1) return [...incoming];
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
