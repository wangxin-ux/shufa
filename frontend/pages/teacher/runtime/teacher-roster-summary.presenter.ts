import { formatDateTimeLabel } from '../../../utils/format';

export interface TeacherRosterSummaryModel {
  known: boolean;
  hasWarning: boolean;
  expectedLabel: string;
  leaveLabel: string;
  warningLabel: string;
  sourceLabel: string;
  thresholdLabel: string;
  asOfLabel: string;
}

const FIELDS = ['expectedCount', 'leaveCount', 'warningCount', 'thresholdUnits', 'asOf', 'source'];
const unknownSummary = (): TeacherRosterSummaryModel => ({
  known: false, hasWarning: false,
  expectedLabel: '应到待核对', leaveLabel: '请假待核对',
  warningLabel: '当前预警待核对', sourceLabel: '名单来源待核对',
  thresholdLabel: '预警阈值待核对', asOfLabel: '计算时间待核对',
});
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    hour <= 23 && minute <= 59 && second <= 59;
}

export function presentTeacherRosterSummary(lesson: unknown): TeacherRosterSummaryModel {
  if (!lesson || typeof lesson !== 'object') return unknownSummary();
  const record = lesson as Record<string, unknown>;
  const raw = record.rosterSummary;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unknownSummary();
  const value = raw as Record<string, unknown>;
  const { expectedCount, leaveCount, warningCount, thresholdUnits, asOf, source } = value;
  const historical = record.status === 'COMPLETED' || record.status === 'REVERSED';
  if (!['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'REVERSED', 'CANCELLED'].includes(String(record.status)) ||
    Object.keys(value).some(key => !FIELDS.includes(key)) ||
    !isCount(expectedCount) || !isCount(leaveCount) || !isCount(warningCount) ||
    !isCount(thresholdUnits) || leaveCount > expectedCount || warningCount > expectedCount ||
    source !== (historical ? 'HISTORICAL_ATTENDANCE' : 'CURRENT') || !isTimestamp(asOf)) {
    return unknownSummary();
  }
  const fraction = String(thresholdUnits % 100).padStart(2, '0').replace(/0+$/, '');
  const threshold = String(Math.floor(thresholdUnits / 100)) + (fraction ? '.' + fraction : '');
  return {
    known: true, hasWarning: warningCount > 0,
    expectedLabel: `应到 ${expectedCount} 人`,
    leaveLabel: `请假 ${leaveCount} 人`,
    warningLabel: `当前预警 ${warningCount} 人`,
    sourceLabel: historical ? '历史点名名单' : '当前在班名单',
    thresholdLabel: `预警阈值 ${threshold} 节`,
    asOfLabel: `计算于 ${formatDateTimeLabel(asOf)}（北京时间）`,
  };
}
