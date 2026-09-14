import { PartnerSearchQuery, PartnerStudent } from '../types/partner';
import { presentLessonBalance } from './lesson-availability';
import {
  formatPartnerBirthDate,
  formatPartnerLessonUnits,
} from '../utils/partner-format';

export interface PartnerStudentItemModel {
  reservationLabel?: string;
  id: string;
  displayName: string;
  birthDateLabel: string;
  classLabel: string;
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
}

export function normalizePartnerStudentSearch(value: string): string {
  return value.trim();
}

export function buildPartnerStudentQuery(
  value: string,
  page: number,
  pageSize: number,
): PartnerSearchQuery {
  const query = normalizePartnerStudentSearch(value);
  return { page, pageSize, ...(query ? { query } : {}) };
}

export function buildPartnerStudentItems(
  students: readonly PartnerStudent[],
): PartnerStudentItemModel[] {
  return students.map((student) => ({
    id: student.id,
    displayName: student.displayName,
    birthDateLabel: formatPartnerBirthDate(student.birthDate),
    classLabel:
      student.classNames.length > 0
        ? student.classNames.join('、')
        : '暂未分班',
    ...presentLessonBalance(student),
  }));
}

export function mergePartnerStudentItems(
  current: readonly PartnerStudentItemModel[],
  incoming: readonly PartnerStudentItemModel[],
  page: number,
): PartnerStudentItemModel[] {
  if (page <= 1) return [...incoming];
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

export function resolvePartnerStudentDetailRoute(studentId: string): string {
  return `/pages/partner/student-detail/index?id=${encodeURIComponent(studentId)}`;
}

export class PartnerStudentSearchDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly callback: (query: string) => void,
    private readonly delayMs = 300,
  ) {}

  schedule(value: string): void {
    this.cancel();
    const query = normalizePartnerStudentSearch(value);
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
