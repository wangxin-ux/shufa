import { TeacherFeedbackRatings } from '../types/teacher-feedback';

export const TEACHER_RATING_FIELDS = [
  { field: 'classroomPerformance', label: '课堂表现' },
  { field: 'workCompletion', label: '作品完成' },
  { field: 'communication', label: '沟通互动' },
  { field: 'overall', label: '整体评价' },
] as const;

export const TEACHER_RATING_OPTIONS = [
  '未评分', ...Array.from({ length: 11 }, (_, value) => `${value / 2} 星`),
];

export interface TeacherRatingRow {
  field: keyof TeacherFeedbackRatings;
  label: string;
  ratingLabel: string;
  pickerIndex: number;
}

export function emptyTeacherRatings(): TeacherFeedbackRatings {
  return { classroomPerformance: null, workCompletion: null, communication: null, overall: null };
}

export function validTeacherRatings(value: unknown): value is TeacherFeedbackRatings {
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 4) return false;
  return TEACHER_RATING_FIELDS.every(({ field }) => {
    const score = (value as Record<string, unknown>)[field];
    return score === null || (typeof score === 'number' &&
      Number.isInteger(score) && score >= 0 && score <= 10);
  });
}

export function teacherRatingRows(
  ratings: TeacherFeedbackRatings | null | undefined,
): TeacherRatingRow[] {
  return TEACHER_RATING_FIELDS.map(({ field, label }) => {
    const value = ratings?.[field] ?? null;
    return { field, label, ratingLabel: value === null ? '未评分' : `${value / 2} 星`,
      pickerIndex: value === null ? 0 : value + 1 };
  });
}

/** 星级槽位：满星 / 半星 / 空星，供 PSD 五星图标位置渲染（原始分 0–10，半星粒度）。 */
export type TeacherRatingStarSlot = 'full' | 'half' | 'empty';

export const TEACHER_RATING_STAR_SLOTS: readonly TeacherRatingStarSlot[] = [
  'empty', 'empty', 'empty', 'empty', 'empty',
];

/**
 * 把 0–10 的原始评分换算成 5 个星位。
 * `null`（未评分）与越界值一律返回五星全空，不把缺失当零分以外的含义。
 */
export function teacherRatingStarSlots(
  value: number | null | undefined,
): TeacherRatingStarSlot[] {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return [...TEACHER_RATING_STAR_SLOTS];
  }
  const halves = Math.max(0, Math.min(10, Math.round(value)));
  return TEACHER_RATING_STAR_SLOTS.map((_, index) => {
    const remaining = halves - index * 2;
    if (remaining >= 2) {
      return 'full';
    }
    return remaining === 1 ? 'half' : 'empty';
  });
}
