import {
  PartnerOperationsSummary,
  PartnerPeriodQuery,
  PartnerReportPeriod,
} from '../types/partner';
import {
  formatPartnerAttendanceRate,
  formatPartnerLessonUnits,
} from '../utils/partner-format';

export const PARTNER_REPORT_PERIOD_OPTIONS: ReadonlyArray<{
  value: PartnerReportPeriod;
  label: string;
}> = [
  { value: 'DAY', label: '日' },
  { value: 'MONTH', label: '月' },
  { value: 'QUARTER', label: '季度' },
];

export function buildPartnerPeriodQuery(
  period: PartnerReportPeriod,
  anchorDate: string,
): PartnerPeriodQuery {
  return { period, ...(anchorDate ? { anchorDate } : {}) };
}

export function todayPartnerAnchorDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatPartnerPeriodLabel(
  period: PartnerReportPeriod,
  anchorDate: string,
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorDate);
  if (!match) return '所选周期';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (period === 'DAY') return `${year}年${month}月${day}日`;
  if (period === 'MONTH') return `${year}年${month}月`;
  return `${year}年第${Math.ceil(month / 3)}季度`;
}

export function buildPartnerOperationsPageModel(
  summary: PartnerOperationsSummary,
) {
  return {
    periodLabel: formatPartnerPeriodLabel(summary.period, summary.anchorDate),
    consumedLessonLabel: formatPartnerLessonUnits(
      summary.consumedLessonUnits,
    ),
    completedLessonCountLabel: String(summary.completedLessonCount),
    attendanceRateLabel: formatPartnerAttendanceRate(
      summary.attendanceRateBasisPoints,
    ),
    presentCountLabel: String(summary.presentCount),
    absentCountLabel: String(summary.absentCount),
    leaveCountLabel: String(summary.leaveCount),
    recordedCountLabel: String(summary.recordedCount),
    teacherMetrics: summary.teacherMetrics.map((item) => ({
      teacherId: item.teacherId,
      displayName: item.displayName,
      completedLessonCountLabel: `${item.completedLessonCount} 节`,
      attendeeCountLabel: `${item.attendeeCount} 人次`,
    })),
  };
}
