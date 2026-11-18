import {
  ParentAttendanceStatus,
  ParentLessonStatus,
  ParentUpdatesView,
  ParentLessonReview,
} from '../types/parent';
import { formatDateTimeLabel, parseZonedDateTime } from '../utils/format';
import { normalizeStarRating, starRatingFills, starRatingLabel } from '../utils/star-rating';
import { teacherRatingRows, TeacherRatingRow } from '../utils/teacher-ratings';

export interface ParentUpdateRecordModel {
  lessonSessionId: string;
  courseName: string;
  teacherName: string;
  lessonTimeLabel: string;
  lessonDateLabel: string;
  courseFontSize: number;
  attendanceLabel: string;
  feedback: string;
  feedbackImages: ParentUpdatesView['records'][number]['feedbackImages'];
  statusLabel: string;
  statusTone: 'green' | 'gray';
  performanceRating: number | null;
  performanceRatingLabel: string;
  performanceStars: number[];
  teacherRatingRows: TeacherRatingRow[];
  feedbackAuthorName: string;
  campusName: string;
  review: ParentLessonReview | null;
  canReview: boolean;
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
      lessonDateLabel: (() => {
        const date = parseZonedDateTime(record.startsAt);
        return date ? `${date.month}月${date.day}日` : '时间待定';
      })(),
      courseFontSize: Math.max(
        30,
        Math.min(73, Math.floor(390 / Math.max(1, Array.from(record.courseName).length))),
      ),
      attendanceLabel: attendanceStatusLabel(record.attendanceStatus),
      feedback: record.feedback ?? '',
      feedbackImages: [...record.feedbackImages],
      performanceRating: normalizeStarRating(record.performanceRating),
      performanceRatingLabel: starRatingLabel(record.performanceRating),
      performanceStars: starRatingFills(record.performanceRating),
      teacherRatingRows: record.teacherRatings ? teacherRatingRows(record.teacherRatings) : [],
      feedbackAuthorName: record.feedbackAuthorName ?? record.teacherName,
      campusName: record.campusName ?? '',
      review: record.review ?? null,
      canReview: (record.canReview ?? (record.lessonStatus === 'COMPLETED' && record.attendanceStatus === 'PRESENT')) && !record.review,
      statusLabel: lessonStatusLabel(record.lessonStatus),
      statusTone: record.lessonStatus === 'REVERSED' ? 'gray' : 'green',
    })),
    isEmpty: view.records.length === 0,
  };
}
