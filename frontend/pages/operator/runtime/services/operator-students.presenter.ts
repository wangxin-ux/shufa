import { starRatingFills } from '../../../../utils/star-rating';
import {
  OperatorStudent,
  OperatorStudentDetail,
  OperatorStudentQuery,
  OperatorStudentArchive,
  OperatorStudentGrowth,
} from '../types/operator';
import { formatDateTimeLabel, formatFenAmount } from '../../../../utils/format';
import { formatPartnerAttendanceRate } from '../../../../utils/partner-format';

export interface OperatorStudentItemModel {
  id: string;
  displayName: string;
  ageLabel: string;
  classLabel: string;
  statusLabel: '在读';
}

export interface OperatorStudentDetailModel
  extends OperatorStudentItemModel {
  reservationLabel?: string;
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
  attendanceCountLabel: string;
  consumedUnitsLabel: string;
}

export function normalizeOperatorStudentSearch(value: string): string {
  return value.trim();
}

export function buildOperatorStudentQuery(
  value: string,
  page: number,
  pageSize: number,
): OperatorStudentQuery {
  const query = normalizeOperatorStudentSearch(value);
  return {
    page,
    pageSize,
    ...(query ? { query } : {}),
  };
}

function formatAge(value: number | null): string {
  return value === null || !Number.isSafeInteger(value) || value < 0 ? '年龄未填写' : `${value}岁`;
}

function formatLessonUnits(units: number): string {
  const value = Math.max(0, Math.trunc(units)) / 100;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function buildStudentItem(
  student: OperatorStudent,
): OperatorStudentItemModel {
  return {
    id: student.id,
    displayName: student.displayName,
    ageLabel: formatAge(student.ageYears),
    classLabel:
      student.classNames.length > 0
        ? student.classNames.join('、')
        : '暂未分班',
    statusLabel: '在读',
  };
}

export function buildOperatorStudentItems(
  students: readonly OperatorStudent[],
): OperatorStudentItemModel[] {
  return students.map(buildStudentItem);
}

export function buildOperatorStudentDetail(
  student: OperatorStudentDetail,
): OperatorStudentDetailModel {
  return {
    ...buildStudentItem(student),
    ...presentLessonBalance(student),
    attendanceCountLabel: String(
      Math.max(0, Math.trunc(student.recentAttendanceCount)),
    ),
    consumedUnitsLabel: formatLessonUnits(student.recentConsumedUnits),
  };
}

export type OperatorStudentArchiveModel = ReturnType<typeof buildOperatorStudentArchive>;
export type OperatorStudentGrowthModel = ReturnType<typeof buildOperatorStudentGrowth>[number];

export function buildOperatorStudentArchive(student: OperatorStudentArchive) {
  const enrollment = student.enrollmentSummary;
  return {
    id: student.id, displayName: student.displayName, statusLabel: '在读',
    ageLabel: formatAge(student.ageYears),
    classLabel: student.classes.length ? student.classes.map((item) => item.className).join('、') : '暂未分班',
    classes: student.classes,
    ...presentLessonBalance(student),
    receivedAmountLabel: enrollment.receivedAmountFen === null ? '待核对' : formatFenAmount(enrollment.receivedAmountFen),
    refundedAmountLabel: enrollment.refundedAmountFen === null ? '待核对' : formatFenAmount(enrollment.refundedAmountFen),
    initialMainLabel: enrollment.initialMainUnits === null ? '待核对' : formatLessonUnits(enrollment.initialMainUnits),
    initialGiftLabel: enrollment.initialGiftUnits === null ? '待核对' : formatLessonUnits(enrollment.initialGiftUnits),
    pendingIssuanceLabel: enrollment.pendingIssuanceCount > 0 ? `${enrollment.pendingIssuanceCount}笔收款待发课时` : '',
    warningLabel: student.lowBalance ? `课时预警 · 阈值 ${formatLessonUnits(student.warningThresholdUnits)} 节` : '',
    presentLabel: String(student.attendance.presentCount),
    absentLabel: String(student.attendance.absentCount),
    leaveLabel: String(student.attendance.leaveCount),
    recordedLabel: String(student.attendance.recordedCount),
    attendanceRateLabel: formatPartnerAttendanceRate(student.attendance.attendanceRateBasisPoints),
    calculatedAtLabel: formatDateTimeLabel(student.serverTime),
  };
}

function rating(value: number | null | undefined): string {
  return value === null || value === undefined ? '未评分' : `${value / 2}星`;
}

export function buildOperatorStudentGrowth(records: readonly OperatorStudentGrowth[]) {
  return records.map((record) => ({
    id: record.lessonSessionId,
    courseName: record.courseName, campusName: record.campusName, teacherName: record.teacherName,
    startsAtLabel: formatDateTimeLabel(record.startsAt),
    lessonStatusLabel: record.lessonStatus === 'REVERSED' ? '已撤销' : '已完成',
    attendanceLabel: record.attendanceStatus === null ? '出勤未记录'
      : ({ PRESENT: '到课', ABSENT: '缺勤', LEAVE: '请假' })[record.attendanceStatus],
    feedback: record.feedback ?? '暂无课堂反馈',
    feedbackAuthorLabel: record.feedbackAuthorName ?? '作者未记录',
    feedbackStateLabel: record.feedbackValid ? '有效反馈' : '反馈已失效',
    feedbackVersionLabel: `第${record.feedbackVersion}版`,
    feedbackUpdatedAtLabel: record.feedbackUpdatedAt ? formatDateTimeLabel(record.feedbackUpdatedAt) : '更新时间未记录',
    legacyRatingLabel: rating(record.performanceRating),
    teacherRatings: [
      { label: '课堂表现', value: rating(record.teacherRatings?.classroomPerformance), fills: starRatingFills(record.teacherRatings?.classroomPerformance) },
      { label: '作品完成', value: rating(record.teacherRatings?.workCompletion), fills: starRatingFills(record.teacherRatings?.workCompletion) },
      { label: '沟通互动', value: rating(record.teacherRatings?.communication), fills: starRatingFills(record.teacherRatings?.communication) },
      { label: '整体评价', value: rating(record.teacherRatings?.overall), fills: starRatingFills(record.teacherRatings?.overall) },
    ],
    hasReview: record.review !== null,
    reviewNote: record.review?.note || '暂无文字评价',
    reviewAuthorLabel: record.reviewAuthorName ?? '作者未记录',
    reviewStateLabel: record.review?.valid ? '有效评价' : '评价已失效',
    reviewCreatedAtLabel: record.review ? formatDateTimeLabel(record.review.createdAt) : '',
    reviewRatings: [
      { label: '教学质量', value: rating(record.review?.teaching), fills: starRatingFills(record.review?.teaching) },
      { label: '沟通反馈', value: rating(record.review?.communication), fills: starRatingFills(record.review?.communication) },
      { label: '教学环境', value: rating(record.review?.environment), fills: starRatingFills(record.review?.environment) },
      { label: '整体评价', value: rating(record.review?.overall), fills: starRatingFills(record.review?.overall) },
    ],
  }));
}

export function mergeOperatorStudentItems(
  current: readonly OperatorStudentItemModel[],
  incoming: readonly OperatorStudentItemModel[],
  page: number,
): OperatorStudentItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export class OperatorStudentSearchDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly callback: (query: string) => void,
    private readonly delayMs = 300,
  ) {}

  schedule(value: string): void {
    this.cancel();
    const query = normalizeOperatorStudentSearch(value);
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
import { presentLessonBalance } from '../../../../services/lesson-availability';
