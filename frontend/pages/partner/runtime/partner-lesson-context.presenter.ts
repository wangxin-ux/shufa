import {
  buildPartnerLessonAccountPageModel,
  PartnerLessonAccountItemModel,
} from '../../../services/partner-lesson-account.presenter';
import type { PartnerLessonAccount, PartnerLessonLedgerEntry } from '../../../types/partner';
import { formatPartnerDateTime } from '../../../utils/partner-format';
import { parseZonedDateTime } from '../../../utils/format';

export interface PartnerLessonContextItemModel extends PartnerLessonAccountItemModel {
  subjectLabel?: string;
  teachingLabel?: string;
  lessonTimeLabel?: string;
  paymentLabel?: string;
}

export interface PartnerLedgerTeachingContext {
  courseName: string;
  teacherName: string;
  lessonStartsAt: string;
}

export type PartnerLessonContextEntry = PartnerLessonLedgerEntry & {
  subject?: { id: string; name: string } | null;
  teachingContext?: PartnerLedgerTeachingContext | null;
  paymentContext?: { receivedOn: string } | { paidAt: string } | null;
};

export function presentPartnerLedgerPayment(entry: PartnerLessonLedgerEntry, timeZone: string): string {
  const context = (entry as PartnerLessonContextEntry).paymentContext;
  const unknown = '缴费日期待核对';
  if (!context) return unknown;
  if ('receivedOn' in context && !('paidAt' in context)) {
    const date = context.receivedOn;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return unknown;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return unknown;
    const [year, month, day] = date.split('-').map(Number);
    return `缴费日期 ${year}年${month}月${day}日`;
  }
  if ('paidAt' in context && !('receivedOn' in context)) {
    if (!/T.+(?:Z|[+-]\d{2}:\d{2})$/.test(context.paidAt)) return unknown;
    const parts = parseZonedDateTime(context.paidAt, timeZone);
    if (parts) return `缴费时间 ${parts.year}年${parts.month}月${parts.day}日 ${parts.time}`;
  }
  return unknown;
}

export function buildPartnerLessonContextPageModel(
  account: PartnerLessonAccount,
  timeZone = 'Asia/Shanghai',
) {
  const model = buildPartnerLessonAccountPageModel(account, timeZone);
  return {
    ...model,
    items: model.items.map((item, index): PartnerLessonContextItemModel => {
      const context = (account.items[index] as PartnerLessonContextEntry).teachingContext;
      return {
        ...item,
        subjectLabel: (account.items[index] as PartnerLessonContextEntry).subject?.name || '未归类',
        paymentLabel: presentPartnerLedgerPayment(account.items[index], timeZone),
        teachingLabel: context
          ? `${context.courseName} · ${context.teacherName}`
          : '未关联授课信息',
        lessonTimeLabel: context
          ? `授课时间 ${formatPartnerDateTime(context.lessonStartsAt, timeZone)}`
          : '',
      };
    }),
  };
}
