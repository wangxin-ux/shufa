import {
  TeacherRatingRow,
  TeacherRatingStarSlot,
  teacherRatingRows,
  teacherRatingStarSlots,
} from '../utils/teacher-ratings';
import {
  AttendanceStatus,
  FeedbackImage,
  TeacherStudent,
  TeacherStudentDetail,
  TeacherStudentQuery,
  TeacherStudentFeedbackHistory,
} from '../types/teacher';
import { parseZonedDateTime } from '../utils/format';

export interface TeacherStudentItemModel {
  id: string;
  displayName: string;
  classLabel: string;
  nextLessonLabel: string;
  nextLessonShortLabel: string;
  latestFeedbackLabel: string;
}

export interface TeacherStudentDetailPageModel {
  photoUrl: string;
  ageLabel: string;
  originalMainLabel: string;
  originalGiftLabel: string;
  receivedLabel: string;
  availableMainLabel: string;
  availableGiftLabel: string;
  remainingTotalLabel: string;
  warningLabel: string;
  balanceAsOfLabel: string;
  pendingIssuanceLabel: string;
  displayName: string;
  classLabel: string;
  classes: TeacherStudentDetail['classes'];
  nextLessonTitle: string;
  nextLessonClassLabel: string;
  nextLessonTime: string;
  attendanceSummary: string;
  attendanceRateLabel: string;
  recentAttendance: Array<{
    id: string;
    courseName: string;
    timeLabel: string;
    statusLabel: string;
    statusTone: 'success' | 'warning' | 'danger';
  }>;
  latestFeedbackContent: string;
  latestFeedbackMeta: string;
}

export interface TeacherStudentRatingRow extends TeacherRatingRow {
  stars: TeacherRatingStarSlot[];
}

export interface TeacherStudentFeedbackModel extends TeacherStudentFeedbackHistory {
  timeLabel: string;
  updatedLabel: string;
  statusLabel: string;
  legacyRatingLabel: string;
  teacherRatingRows: TeacherRatingRow[];
  /** 反馈卡右上元信息：班级 / 课程 / 日期 教师（对应 PSD 三行）。 */
  metaLines: string[];
  /** 整体星级（5 个槽位），无评分时全空。 */
  stars: TeacherRatingStarSlot[];
  /** 四项评分 + 五星槽位。 */
  ratingStarRows: TeacherStudentRatingRow[];
  /** 反馈卡左侧缩略图（取第一张），其余图片走 extraImages。 */
  mediaImage: FeedbackImage | null;
  extraImages: FeedbackImage[];
}

export function buildTeacherStudentFeedbackModels(
  records: readonly TeacherStudentFeedbackHistory[],
): TeacherStudentFeedbackModel[] {
  return records.map((record) => ({
    ...record,
    timeLabel: `${parseZonedDateTime(record.startsAt)?.year ?? ''}年${formatDateTime(record.startsAt, true)}`,
    updatedLabel: `${parseZonedDateTime(record.updatedAt)?.year ?? ''}年${formatDateTime(record.updatedAt, false)}`,
    statusLabel: record.lessonStatus === 'REVERSED' ? '已撤销 · 只读' : '已完成',
    teacherRatingRows: record.teacherRatings ? teacherRatingRows(record.teacherRatings) : [],
    metaLines: buildFeedbackMetaLines(record),
    stars: teacherRatingStarSlots(record.teacherRatings?.overall ?? record.performanceRating),
    ratingStarRows: record.teacherRatings
      ? teacherRatingRows(record.teacherRatings).map((row) => ({
        ...row,
        stars: teacherRatingStarSlots(record.teacherRatings?.[row.field] ?? null),
      }))
      : [],
    mediaImage: record.images[0] ?? null,
    extraImages: record.images.slice(1),
    legacyRatingLabel: record.performanceRating == null
      ? '历史单项未评分' : `历史单项评分 ${record.performanceRating / 2}星`,
  }));
}

function buildFeedbackMetaLines(record: TeacherStudentFeedbackHistory): string[] {
  const parts = parseZonedDateTime(record.startsAt);
  const dateLabel = parts ? `${parts.month}月${parts.day}日` : '';
  const author = record.feedbackAuthorName?.trim() ?? '';
  const dateAndAuthor = [dateLabel, author].filter(Boolean).join(' ');
  const lines = [record.className, record.courseName];
  if (dateAndAuthor) {
    lines.push(dateAndAuthor);
  }
  const kept = lines.filter((line) => line.trim().length > 0);
  // PSD 反馈卡右侧固定三行；缺数据时补空行，避免 WXML 取到 undefined。
  return [kept[0] ?? '', kept[1] ?? '', kept[2] ?? ''];
}

const CHINESE_WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function formatDateTime(value: string | null, includeWeekday: boolean): string {
  if (!value) {
    return '';
  }
  const parts = parseZonedDateTime(value);
  if (!parts) {
    return '';
  }
  return includeWeekday
    ? `${parts.month}月${parts.day}日 ${CHINESE_WEEKDAYS[parts.weekday]} ${parts.time}`
    : `${parts.month}月${parts.day}日 ${parts.time}`;
}

export function normalizeTeacherStudentSearch(value: string): string {
  return value.trim();
}

export function buildTeacherStudentQuery(
  value: string,
  page: number,
  pageSize: number,
): TeacherStudentQuery {
  const query = normalizeTeacherStudentSearch(value);
  return {
    page,
    pageSize,
    ...(query ? { query } : {}),
  };
}

export function buildTeacherStudentPageModel(
  students: readonly TeacherStudent[],
): TeacherStudentItemModel[] {
  return students.map((student) => ({
    id: student.id,
    displayName: student.displayName,
    classLabel: student.classNames.length > 0 ? student.classNames.join('、') : '暂未分班',
    nextLessonLabel:
      formatDateTime(student.nextLessonAt, true) || '暂无后续课程',
    nextLessonShortLabel:
      formatDateTime(student.nextLessonAt, false) || '暂无后续课程',
    latestFeedbackLabel:
      formatDateTime(student.latestFeedbackAt, false) || '暂无课堂反馈',
  }));
}

function formatTimeRange(startsAt: string, endsAt: string): string {
  const start = parseZonedDateTime(startsAt);
  const end = parseZonedDateTime(endsAt);
  if (!start || !end) {
    return '时间待确认';
  }
  return `${start.month}月${start.day}日 ${CHINESE_WEEKDAYS[start.weekday]} ${start.time}-${end.time}`;
}

function attendanceStatus(status: AttendanceStatus) {
  const labels = {
    PRESENT: { statusLabel: '到课', statusTone: 'success' as const },
    LEAVE: { statusLabel: '请假', statusTone: 'warning' as const },
    ABSENT: { statusLabel: '缺勤', statusTone: 'danger' as const },
  };
  return labels[status];
}

export function buildTeacherStudentDetailPageModel(
  student: TeacherStudentDetail,
): TeacherStudentDetailPageModel {
  const nextLesson = student.nextLesson;
  const latestFeedback = student.latestFeedback;
  const archive = student.archive;
  const units = (value: number | null | undefined) => value == null ? '待核对' : `${value / 100}课时`;
  const amount = archive?.enrollment.receivedAmountFen;
  return {
    photoUrl: archive?.photo?.accessUrl ?? '',
    ageLabel: archive?.age == null ? '年龄待完善' : `${archive.age}岁`,
    originalMainLabel: units(archive?.enrollment.initialMainUnits),
    originalGiftLabel: units(archive?.enrollment.initialGiftUnits),
    receivedLabel: amount == null ? '待核对'
      : `¥${(amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    availableMainLabel: units(archive?.balance.mainAvailableUnits),
    availableGiftLabel: units(archive?.balance.giftAvailableUnits),
    remainingTotalLabel: units(archive?.balance.availableTotalUnits),
    warningLabel: archive?.balance.isWarning ? '课时预警' : '',
    balanceAsOfLabel: archive ? formatDateTime(archive.balance.asOf, false) : '',
    pendingIssuanceLabel: archive?.enrollment.pendingIssuanceCount
      ? `${archive.enrollment.pendingIssuanceCount}笔待发课` : '',
    displayName: student.displayName,
    classLabel:
      student.classNames.length > 0 ? student.classNames.join('、') : '暂未分班',
    classes: student.classes.map((item) => ({ ...item })),
    nextLessonTitle: nextLesson?.courseName ?? '暂无后续课程',
    nextLessonClassLabel: nextLesson?.className ?? '排课后会在这里显示',
    nextLessonTime: nextLesson
      ? formatTimeRange(nextLesson.startsAt, nextLesson.endsAt)
      : '时间待安排',
    attendanceSummary: `出勤 ${student.attendance.presentCount} 次 · 请假 ${student.attendance.leaveCount} 次 · 缺勤 ${student.attendance.absentCount} 次`,
    attendanceRateLabel: `${Math.round(student.attendance.attendanceRateBasisPoints / 100)}%`,
    recentAttendance: student.recentAttendance.map((item) => ({
      id: item.id,
      courseName: item.courseName,
      timeLabel: formatDateTime(item.startsAt, false) || '时间待确认',
      ...attendanceStatus(item.status),
    })),
    latestFeedbackContent: latestFeedback?.content ?? '暂无课堂反馈',
    latestFeedbackMeta: latestFeedback
      ? `${latestFeedback.courseName} · ${formatDateTime(latestFeedback.updatedAt, false)}`
      : '完成课堂反馈后会在这里显示',
  };
}

export function mergeTeacherStudentItems(
  current: readonly TeacherStudentItemModel[],
  incoming: readonly TeacherStudentItemModel[],
  page: number,
): TeacherStudentItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export class TeacherStudentSearchDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly callback: (query: string) => void,
    private readonly delayMs = 300,
  ) {}

  schedule(value: string): void {
    this.cancel();
    const query = normalizeTeacherStudentSearch(value);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.callback(query);
    }, this.delayMs);
  }

  cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
