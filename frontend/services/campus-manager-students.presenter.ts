import {
  CampusManagerStudent,
  CampusManagerStudentDetail,
  CampusManagerStudentQuery,
} from '../types/campus-manager';

export interface CampusManagerStudentItemModel {
  id: string;
  displayName: string;
  birthDateLabel: string;
  classLabel: string;
  statusLabel: '在读';
}

export interface CampusManagerStudentDetailModel
  extends CampusManagerStudentItemModel {
  reservationLabel?: string;
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
  attendanceCountLabel: string;
  consumedUnitsLabel: string;
}

export function normalizeCampusManagerStudentSearch(value: string): string {
  return value.trim();
}

export function buildCampusManagerStudentQuery(
  value: string,
  page: number,
  pageSize: number,
): CampusManagerStudentQuery {
  const query = normalizeCampusManagerStudentSearch(value);
  return {
    page,
    pageSize,
    ...(query ? { query } : {}),
  };
}

function formatBirthDate(value: string | null): string {
  if (!value) {
    return '出生日期未填写';
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
    : '出生日期未填写';
}

function formatLessonUnits(units: number): string {
  const value = Math.max(0, Math.trunc(units)) / 100;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function buildStudentItem(
  student: CampusManagerStudent,
): CampusManagerStudentItemModel {
  return {
    id: student.id,
    displayName: student.displayName,
    birthDateLabel: formatBirthDate(student.birthDate),
    classLabel:
      student.classNames.length > 0
        ? student.classNames.join('、')
        : '暂未分班',
    statusLabel: '在读',
  };
}

export function buildCampusManagerStudentItems(
  students: readonly CampusManagerStudent[],
): CampusManagerStudentItemModel[] {
  return students.map(buildStudentItem);
}

export function buildCampusManagerStudentDetail(
  student: CampusManagerStudentDetail,
): CampusManagerStudentDetailModel {
  return {
    ...buildStudentItem(student),
    ...presentLessonBalance(student),
    attendanceCountLabel: String(
      Math.max(0, Math.trunc(student.recentAttendanceCount)),
    ),
    consumedUnitsLabel: formatLessonUnits(student.recentConsumedUnits),
  };
}

export function mergeCampusManagerStudentItems(
  current: readonly CampusManagerStudentItemModel[],
  incoming: readonly CampusManagerStudentItemModel[],
  page: number,
): CampusManagerStudentItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

export class CampusManagerStudentSearchDebouncer {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly callback: (query: string) => void,
    private readonly delayMs = 300,
  ) {}

  schedule(value: string): void {
    this.cancel();
    const query = normalizeCampusManagerStudentSearch(value);
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
import { presentLessonBalance } from './lesson-availability';
