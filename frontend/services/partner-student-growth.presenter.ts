import type { PartnerStudentGrowthRecord } from '../types/partner';
import { formatPartnerDateTime } from '../utils/partner-format';
import { starRatingFills, starRatingLabel } from '../utils/star-rating';

export function buildPartnerGrowthItems(
  records: readonly PartnerStudentGrowthRecord[],
  timeZone = 'Asia/Shanghai',
  sourcePage = 1,
) {
  return records.map((record) => ({
    id: record.lessonSessionId,
    sourcePage,
    courseName: record.courseName,
    campusName: record.campusName,
    teacherName: record.teacherName,
    timeLabel: formatPartnerDateTime(record.startsAt, timeZone),
    statusLabel: record.lessonStatus === 'REVERSED' ? '已撤销'
      : record.attendanceStatus === 'PRESENT' ? '已到课'
      : record.attendanceStatus === 'LEAVE' ? '请假'
      : record.attendanceStatus === 'ABSENT' ? '缺勤' : '已完课',
    reversed: record.lessonStatus === 'REVERSED',
    feedbackLabel: record.feedback || '暂无课堂反馈',
    performanceLabel: starRatingLabel(record.performanceRating),
    performanceFills: starRatingFills(record.performanceRating),
    images: record.feedbackImages,
    review: record.review ? {
      validLabel: record.review.valid && record.lessonStatus === 'COMPLETED' ? '家长评价' : '原评价已失效',
      note: record.review.note,
      ratings: [
        { key: 'teaching', label: '教学', value: starRatingLabel(record.review.teaching) },
        { key: 'communication', label: '课后沟通', value: starRatingLabel(record.review.communication) },
        { key: 'environment', label: '环境', value: starRatingLabel(record.review.environment) },
        { key: 'overall', label: '整体评价', value: starRatingLabel(record.review.overall) },
      ],
    } : null,
  }));
}

export type PartnerGrowthItem = ReturnType<typeof buildPartnerGrowthItems>[number];

export function mergePartnerGrowthItems(
  current: readonly PartnerGrowthItem[],
  incoming: readonly PartnerGrowthItem[],
  page: number,
): PartnerGrowthItem[] {
  if (page <= 1) return [...incoming];
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}
