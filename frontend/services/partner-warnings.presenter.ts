import { PartnerSearchQuery, PartnerWarning } from '../types/partner';
import { presentLessonBalance } from './lesson-availability';
import { formatPartnerLessonUnits } from '../utils/partner-format';

export interface PartnerWarningItemModel {
  reservationLabel?: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
  thresholdLabel: string;
  urgencyLabel: '需关注';
}

export function buildPartnerWarningQuery(
  value: string,
  page: number,
  pageSize: number,
): PartnerSearchQuery {
  const query = value.trim();
  return { page, pageSize, ...(query ? { query } : {}) };
}

export function buildPartnerWarningItems(
  warnings: readonly PartnerWarning[],
): PartnerWarningItemModel[] {
  return warnings.map((warning) => ({
    studentId: warning.studentId,
    studentName: warning.studentName,
    classLabel:
      warning.classNames.length > 0
        ? warning.classNames.join('、')
        : '暂未分班',
    ...presentLessonBalance(warning),
    thresholdLabel: formatPartnerLessonUnits(warning.thresholdUnits),
    urgencyLabel: '需关注',
  }));
}

export function mergePartnerWarningItems(
  current: readonly PartnerWarningItemModel[],
  incoming: readonly PartnerWarningItemModel[],
  page: number,
): PartnerWarningItemModel[] {
  if (page <= 1) return [...incoming];
  const byId = new Map(current.map((item) => [item.studentId, item]));
  for (const item of incoming) byId.set(item.studentId, item);
  return [...byId.values()];
}
