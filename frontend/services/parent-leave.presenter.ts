import { LeavePageView, LeaveRecord, LeaveWeekWarning } from '../types/parent';
import { formatDateTimeLabel } from '../utils/format';
import { getLeaveStatusLabel } from './parent-leave.workflow';

type LeaveTagTone = 'green' | 'orange' | 'red';

export interface ParentLeaveRecordModel extends LeaveRecord {
  statusLabel: string;
  tagTone: LeaveTagTone;
  dotColor: string;
  subtitle: string;
  reviewNote: string;
}

export interface ParentLeavePageModel {
  students: LeavePageView['students'];
  lessons: Array<LeavePageView['lessons'][number] & { label: string }>;
  records: ParentLeaveRecordModel[];
  cutoffText: string;
  recordsEmpty: boolean;
  contactWarning: LeaveWeekWarning | null;
  contactWarningText: string;
}

export function formatLeaveContactWarning(warning: LeaveWeekWarning | null): string {
  return warning ? `${warning.weekStart} 至 ${warning.weekEnd} 连续请假${warning.consecutiveCount}次，须电话沟通联系校区` : '';
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
  const contactWarning = page.weeklyWarnings?.[0] ?? null;
  return {
    contactWarning,
    contactWarningText: formatLeaveContactWarning(contactWarning),
    students: page.students.map((student) => ({ ...student })),
    lessons: page.lessons.map((lesson) => ({
      ...lesson,
      label: `${formatDateTimeLabel(lesson.startsAt)} · ${lesson.title}`,
    })),
    records: page.records.map((record) => {
      const statusLabel = getLeaveStatusLabel(record.status);
      const date = /^\d{4}-(\d{2})-(\d{2})(?: \d{2}:\d{2})?$/.exec(record.lessonTimeLabel);
      const dateLabel = date ? `${Number(date[1])}月${Number(date[2])}日` : record.lessonTimeLabel;
      return {
        ...record,
        ...getStatusStyle(record.status),
        statusLabel,
        subtitle: `${dateLabel} ${statusLabel}${record.status === 'approved' ? ' 不扣课时' : ''}`,
        reviewNote: record.reviewReason
          ? `${record.status === 'rejected' ? '驳回说明' : '审批说明'}：${record.reviewReason}`
          : '',
      };
    }),
    cutoffText: `须提前 ${page.cutoffHours} 小时提交`,
    recordsEmpty: page.records.length === 0,
  };
}
