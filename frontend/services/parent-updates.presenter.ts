import {
  ParentAttendanceStatus,
  ParentLessonStatus,
  ParentUpdatesView,
} from '../types/parent';
import { formatDateTimeLabel } from '../utils/format';

export interface ParentUpdateRecordModel {
  lessonSessionId: string;
  courseName: string;
  teacherName: string;
  lessonTimeLabel: string;
  attendanceLabel: string;
  feedback: string;
  feedbackImages: ParentUpdatesView['records'][number]['feedbackImages'];
  statusLabel: string;
  statusTone: 'green' | 'gray';
}

export interface ParentUpdatesPageModel {
  records: ParentUpdateRecordModel[];
  isEmpty: boolean;
}

function lessonStatusLabel(status: ParentLessonStatus): string {
  return status === 'REVERSED' ? '已撤销' : '已完成';
}

function attendanceStatusLabel(status: ParentAttendanceStatus): string {
  if (status === 'PRESENT') {
    return '正常出勤';
  }
  if (status === 'LEAVE') {
    return '已请假';
  }
  if (status === 'ABSENT') {
    return '缺勤';
  }
  return '未记录';
}

export function buildParentUpdatesPageModel(
  view: ParentUpdatesView,
): ParentUpdatesPageModel {
  return {
    records: view.records.map((record) => ({
      lessonSessionId: record.lessonSessionId,
      courseName: record.courseName,
      teacherName: record.teacherName,
      lessonTimeLabel: formatDateTimeLabel(record.startsAt),
      attendanceLabel: attendanceStatusLabel(record.attendanceStatus),
      feedback: record.feedback ?? '',
      feedbackImages: [...record.feedbackImages],
      statusLabel: lessonStatusLabel(record.lessonStatus),
      statusTone: record.lessonStatus === 'REVERSED' ? 'gray' : 'green',
    })),
    isEmpty: view.records.length === 0,
  };
}
