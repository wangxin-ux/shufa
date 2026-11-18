import type {
  OperatorTeacherArchive, OperatorTeacherRatings, OperatorTeacherEvaluationRevision, OperatorTeacherPerformance,
} from '../types/operator';
import { formatDateTimeLabel } from '../../../../utils/format';

function ratings(value: OperatorTeacherRatings) {
  const dimensions = [
    ['teachingRating', '教学质量'], ['communicationRating', '沟通反馈'],
    ['attendanceRating', '出勤表现'], ['overallRating', '综合评价'],
  ] as const;
  return dimensions.map(([key, label]) => {
    const halfStars = value[key];
    const valid = Number.isInteger(halfStars) && halfStars >= 1 && halfStars <= 10;
    return {
      key, label, valueLabel: valid ? `${halfStars / 2}星` : '未评分',
      stars: Array.from({ length: 5 }, (_, index) => ({
        index, fill: valid && halfStars >= (index + 1) * 2 ? 'full'
          : valid && halfStars === index * 2 + 1 ? 'half' : 'empty',
      })),
    };
  });
}

export function buildOperatorTeacherItems(items: readonly OperatorTeacherArchive[]) {
  return items.map((item) => ({
    id: item.id, displayName: item.displayName,
    specialtiesLabel: item.specialties.length ? item.specialties.join('、') : '专长未填写',
    classes: item.classes.map(({ id, className, courseName }) => ({ id, className, courseName })),
  }));
}

export function buildOperatorTeacherPerformance(item: OperatorTeacherPerformance) {
  return {
    periodMonth: item.periodMonth, timezone: item.timezone, asOfLabel: formatDateTimeLabel(item.asOf),
    scheduledLabel: String(item.scheduledLessonCount), completedLabel: String(item.completedLessonCount),
    completionLabel: item.completionRateBasisPoints === null ? '无计划' : `${item.completionRateBasisPoints / 100}%`,
    evaluation: item.evaluation === null ? null : {
      authorName: item.evaluation.authorName, periodMonth: item.evaluation.periodMonth,
      version: item.evaluation.version, guidance: item.evaluation.guidance,
      updatedLabel: formatDateTimeLabel(item.evaluation.updatedAt), ratings: ratings(item.evaluation),
    },
  };
}

export function buildOperatorTeacherHistory(items: readonly OperatorTeacherEvaluationRevision[]) {
  return items.map((item) => ({
    key: `${item.periodMonth}:${item.version}`, authorName: item.authorName,
    periodMonth: item.periodMonth, version: item.version, guidance: item.guidance,
    savedLabel: formatDateTimeLabel(item.savedAt), ratings: ratings(item),
  }));
}
