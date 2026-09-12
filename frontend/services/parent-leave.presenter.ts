import { LeavePageView, LeaveRecord } from '../types/parent';
import { formatDateTimeLabel } from '../utils/format';
import { getLeaveStatusLabel } from './parent-leave.workflow';

type LeaveTagTone = 'green' | 'orange' | 'red';

export interface ParentLeaveRecordModel extends LeaveRecord {
  statusLabel: string;
  tagTone: LeaveTagTone;
  dotColor: string;
  subtitle: string;
}

export interface ParentLeavePageModel {
  students: LeavePageView['students'];
  lessons: Array<LeavePageView['lessons'][number] & { label: string }>;
  records: ParentLeaveRecordModel[];
  cutoffText: string;
  recordsEmpty: boolean;
}

function getStatusStyle(status: LeaveRecord['status']): {
  tagTone: LeaveTagTone;
  dotColor: string;
} {
  if (status === 'approved') {
    return { tagTone: 'green', dotColor: '#23b574' };
  }
  if (status === 'rejected') {
    return { tagTone: 'red', dotColor: '#e5484d' };
  }
  return { tagTone: 'orange', dotColor: '#fe8419' };
}

export function buildParentLeavePageModel(page: LeavePageView): ParentLeavePageModel {
  return {
    students: page.students.map((student) => ({ ...student })),
    lessons: page.lessons.map((lesson) => ({
      ...lesson,
      label: `${formatDateTimeLabel(lesson.startsAt)} · ${lesson.title}`,
    })),
    records: page.records.map((record) => ({
      ...record,
      ...getStatusStyle(record.status),
      statusLabel: getLeaveStatusLabel(record.status),
      subtitle: `${record.lessonTimeLabel} · ${record.reason}${
        record.reviewReason
          ? ` · ${record.status === 'rejected' ? '驳回说明' : '审批说明'}：${record.reviewReason}`
          : ''
      }`,
    })),
    cutoffText: `须提前 ${page.cutoffHours} 小时提交`,
    recordsEmpty: page.records.length === 0,
  };
}
