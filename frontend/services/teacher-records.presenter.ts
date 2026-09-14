import { TeachingRecord } from '../types/teacher';
import { parseZonedDateTime } from '../utils/format';

export interface TeacherRecordItemModel {
  id: string;
  lessonSessionId: string;
  courseName: string;
  className: string;
  timeLabel: string;
  attendeeLabel: string;
  statusLabel: string;
  statusTone: 'success' | 'danger';
}

export function buildTeacherRecordPageModel(
  records: readonly TeachingRecord[],
): TeacherRecordItemModel[] {
  return records.map((record) => {
    const start = parseZonedDateTime(record.startsAt);
    const end = parseZonedDateTime(record.endsAt);
    return {
      id: record.id,
      lessonSessionId: record.lessonSessionId,
      courseName: record.courseName,
      className: record.className,
      timeLabel:
        start && end
          ? `${start.month}月${start.day}日 ${start.time}-${end.time}`
          : '时间待定',
      attendeeLabel: `${Math.max(0, Math.trunc(record.attendeeCount))} 人到课`,
      statusLabel: record.status === 'COMPLETED' ? '已完成' : '已撤销',
      statusTone: record.status === 'COMPLETED' ? 'success' : 'danger',
    };
  });
}

export function mergeTeacherRecordItems(
  current: readonly TeacherRecordItemModel[],
  incoming: readonly TeacherRecordItemModel[],
  page: number,
): TeacherRecordItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}
