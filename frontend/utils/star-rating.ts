export function normalizeStarRating(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10
    ? value
    : null;
}

export function starRatingLabel(value: number | null | undefined): string {
  const rating = normalizeStarRating(value);
  return rating === null ? '未评分' : `${rating / 2} 星`;
}

export function starRatingFills(value: number | null | undefined): number[] {
  const rating = normalizeStarRating(value) ?? 0;
  return [0, 1, 2, 3, 4].map((index) => Math.max(0, Math.min(2, rating - index * 2)) * 50);
}
