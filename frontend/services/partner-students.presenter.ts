import { PartnerBalanceBand, PartnerStudentQuery, PartnerStudent, PartnerStudentDetail } from '../types/partner';
import { presentLessonBalance } from './lesson-availability';
import {
  formatPartnerBirthDate,
  formatPartnerLessonUnits,
  formatPartnerAttendanceRate,
} from '../utils/partner-format';

export interface PartnerStudentItemModel {
  reservationLabel?: string;
  id: string;
  displayName: string;
  nameFontSize: number;
  lowBalance: boolean;
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
  balanceBand?: PartnerBalanceBand,
): PartnerStudentQuery {
  const query = normalizePartnerStudentSearch(value);
  return { page, pageSize, ...(query ? { query } : {}), ...(balanceBand ? { balanceBand } : {}) };
}

export const PARTNER_STUDENT_BALANCE_OPTIONS: Array<{ value: PartnerBalanceBand; label: string }> = [
  { value: 'ALL', label: '全部课时' },
  { value: 'ZERO', label: '零课时' },
  { value: 'LTE_FIVE', label: '≤5节' },
  { value: 'GT_FIVE', label: '>5节' },
];

export function buildPartnerStudentItems(
  students: readonly PartnerStudent[],
): PartnerStudentItemModel[] {
  return students.map((student) => ({
    id: student.id,
    displayName: student.displayName,
    nameFontSize: student.displayName.length <= 4 ? 78 : student.displayName.length <= 6 ? 56 : 36,
    lowBalance: partnerStudentAvailableUnits(student) <= 500,
    birthDateLabel: formatPartnerBirthDate(student.birthDate),
    classLabel:
      student.classNames.length > 0
        ? student.classNames.join('、')
        : '暂未分班',
    ...presentLessonBalance(student),
    totalBalanceLabel: formatPartnerLessonUnits(partnerStudentAvailableUnits(student)),
  }));
}

function partnerStudentAvailableUnits(student: PartnerStudent) {
  return student.availableTotalUnits ?? Math.max(0, student.totalBalanceUnits
    - (student.reservedTotalUnits ?? ((student.mainReservedUnits ?? 0) + (student.giftReservedUnits ?? 0))));
}

export function buildPartnerStudentExpansion(detail: PartnerStudentDetail) {
  return {
    photo: detail.photo,
    remainingLabel: formatPartnerLessonUnits(partnerStudentAvailableUnits(detail)),
    reservationLabel: presentLessonBalance(detail).reservationLabel ?? '',
    attendanceRateLabel: formatPartnerAttendanceRate(detail.attendance.attendanceRateBasisPoints),
    teacherLabel: [...new Set(detail.classes.map((item) => item.teacherName))].join('、') || '暂未分班',
  };
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
