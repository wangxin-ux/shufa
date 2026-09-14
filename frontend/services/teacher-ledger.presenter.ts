import { TeacherLedgerRecord } from '../types/teacher';
import { parseZonedDateTime } from '../utils/format';

export interface TeacherLedgerItemModel {
  id: string;
  lessonSessionId: string;
  studentName: string;
  occurredAtLabel: string;
  typeLabel: string;
  bucketLabel: string;
  deltaLabel: string;
  tone: 'negative' | 'positive' | 'neutral';
}

const TYPE_LABELS: Record<TeacherLedgerRecord['entryType'], string> = {
  CONSUME: '扣课',
  REVERSAL: '撤销返还',
  ADJUSTMENT: '后台调整',
};

function formatOccurredAt(value: string): string {
  const parts = parseZonedDateTime(value);
  return parts ? `${parts.month}月${parts.day}日 ${parts.time}` : '时间待定';
}

export function buildTeacherLedgerPageModel(
  records: readonly TeacherLedgerRecord[],
): TeacherLedgerItemModel[] {
  return records.map((record) => ({
    id: record.id,
    lessonSessionId: record.lessonSessionId,
    studentName: record.studentName,
    occurredAtLabel: formatOccurredAt(record.occurredAt),
    typeLabel: TYPE_LABELS[record.entryType],
    bucketLabel: record.bucket === 'MAIN' ? '主课时' : '赠送课时',
    deltaLabel:
      record.deltaUnits > 0 ? `+${record.deltaUnits}` : String(record.deltaUnits),
    tone:
      record.deltaUnits < 0
        ? 'negative'
        : record.deltaUnits > 0
          ? 'positive'
          : 'neutral',
  }));
}

export function mergeTeacherLedgerItems(
  current: readonly TeacherLedgerItemModel[],
  incoming: readonly TeacherLedgerItemModel[],
  page: number,
): TeacherLedgerItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}
