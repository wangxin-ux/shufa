import {
  OperatorWarning,
  OperatorWarningQuery,
} from "../types/operator";

export interface OperatorWarningItemModel {
  reservationLabel?: string;
  studentId: string;
  studentName: string;
  classLabel: string;
  mainBalanceLabel: string;
  giftBalanceLabel: string;
  totalBalanceLabel: string;
  thresholdLabel: string;
  urgencyLabel: "需关注";
}

export function formatOperatorWarningUnits(units: number): string {
  const value = Math.max(0, Math.trunc(units)) / 100;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "");
}

export function buildOperatorWarningQuery(
  value: string,
  page: number,
  pageSize: number,
): OperatorWarningQuery {
  const query = value.trim();
  return { page, pageSize, ...(query ? { query } : {}) };
}

export function buildOperatorWarningItems(
  warnings: readonly OperatorWarning[],
): OperatorWarningItemModel[] {
  return warnings.map((warning) => ({
    studentId: warning.studentId,
    studentName: warning.studentName,
    classLabel:
      warning.classNames.length > 0
        ? warning.classNames.join("、")
        : "暂未分班",
    ...presentLessonBalance(warning),
    thresholdLabel: formatOperatorWarningUnits(warning.thresholdUnits),
    urgencyLabel: "需关注",
  }));
}

export function mergeOperatorWarningItems(
  current: readonly OperatorWarningItemModel[],
  incoming: readonly OperatorWarningItemModel[],
  page: number,
): OperatorWarningItemModel[] {
  if (page <= 1) {
    return [...incoming];
  }
  const byId = new Map(current.map((item) => [item.studentId, item]));
  for (const item of incoming) {
    byId.set(item.studentId, item);
  }
  return [...byId.values()];
}
import { presentLessonBalance } from '../../../../services/lesson-availability';
