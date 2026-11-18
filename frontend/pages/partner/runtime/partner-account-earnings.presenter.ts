import type { PartnerEarningEntry } from '../../../types/partner';
import { presentPartnerEarningEntry } from '../../../services/partner-earnings.presenter';
import { parseZonedDateTime } from '../../../utils/format';

function earningTime(value: string, timeZone: string): string {
  const parts = parseZonedDateTime(value, timeZone);
  return parts
    ? `${parts.year}年${parts.month}月${parts.day}日 ${parts.time}`
    : '时间待核对';
}

export function presentPartnerAccountEarning(entry: PartnerEarningEntry, timeZone: string) {
  const model = presentPartnerEarningEntry(entry);
  return {
    id: entry.id,
    courseName: entry.courseName,
    typeLabel: model.isReversal ? '收益冲正' : '合作收益',
    amountLabel: model.amountLabel,
    statusLabel: model.statusLabel,
    registeredAtLabel: earningTime(entry.createdAt, timeZone),
    completedAtLabel: earningTime(entry.completedAt, timeZone),
    tone: entry.amountFen < 0 ? 'negative' : entry.status === 'AVAILABLE' ? 'positive' : 'neutral',
  };
}
