import {
  FeedbackImage,
  TeacherLessonDetail,
  TeachingRecord,
} from '../types/teacher';
import { parseZonedDateTime } from '../utils/format';

export interface TeacherFeedbackItemModel {
  id: string;
  lessonSessionId: string;
  courseName: string;
  className: string;
  timeLabel: string;
  attendeeLabel: string;
  progressLabel: string;
  statusLabel: '待填写' | '部分完成' | '已完成' | '已撤销';
  statusTone: 'warning' | 'success' | 'danger';
  actionLabel: '填写反馈' | '继续填写' | '查看反馈';
}

export interface TeacherFeedbackStudentModel {
  id: string;
  displayName: string;
  attendanceLabel: string;
  feedback: string | null;
  feedbackDraft: string;
  feedbackImages: FeedbackImage[];
  hasFeedback: boolean;
  readOnly: boolean;
}

const ATTENDANCE_LABELS: Record<string, string> = {
  PRESENT: '到课',
  LEAVE: '请假',
  ABSENT: '缺席',
};

function formatTimeRange(startsAt: string, endsAt: string): string {
  const start = parseZonedDateTime(startsAt);
  const end = parseZonedDateTime(endsAt);
  return start && end
    ? `${start.month}月${start.day}日 ${start.time}-${end.time}`
    : '时间待定';
}

export function buildTeacherFeedbackPageModel(
  records: readonly TeachingRecord[],
): TeacherFeedbackItemModel[] {
  return records.map((record) => {
    const required = Math.max(0, Math.trunc(record.feedbackRequiredCount));
    const completed = Math.min(
      required,
      Math.max(0, Math.trunc(record.feedbackCompletedCount)),
    );
    const reversed = record.status === 'REVERSED';
    const complete = required === 0 || completed >= required;
    const partial = completed > 0 && !complete;
    return {
      id: record.id,
      lessonSessionId: record.lessonSessionId,
      courseName: record.courseName,
      className: record.className,
      timeLabel: formatTimeRange(record.startsAt, record.endsAt),
      attendeeLabel: `${Math.max(0, Math.trunc(record.attendeeCount))} 人到课`,
      progressLabel: `已反馈 ${completed}/${required} 人`,
      statusLabel: reversed
        ? '已撤销'
        : complete
          ? '已完成'
          : partial
            ? '部分完成'
            : '待填写',
      statusTone: reversed ? 'danger' : complete ? 'success' : 'warning',
      actionLabel: reversed || complete
        ? '查看反馈'
        : partial
          ? '继续填写'
          : '填写反馈',
    };
  });
}

export function buildTeacherFeedbackStudentModels(
  detail: TeacherLessonDetail,
): TeacherFeedbackStudentModel[] {
  const readOnly = detail.status !== 'COMPLETED';
  return detail.students.map((student) => ({
    id: student.id,
    displayName: student.displayName,
    attendanceLabel: student.attendanceStatus
      ? ATTENDANCE_LABELS[student.attendanceStatus]
      : '未点名',
    feedback: student.feedback,
    feedbackDraft: student.feedback ?? '',
    feedbackImages: [...student.feedbackImages],
    hasFeedback: Boolean(student.feedback?.trim()),
    readOnly,
  }));
}

export function mergeTeacherFeedbackItems(
  current: readonly TeacherFeedbackItemModel[],
  incoming: readonly TeacherFeedbackItemModel[],
  page: number,
): TeacherFeedbackItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export function resolveTeacherFeedbackNavigation(
  lessonSessionId: string,
): { kind: 'navigate'; url: string } {
  return {
    kind: 'navigate',
    url: `/pages/teacher/feedback-detail/index?id=${encodeURIComponent(lessonSessionId)}`,
  };
}
