import { parseZonedDateTime } from './format';

export function formatPartnerLessonUnits(units: number): string {
  const value = Math.trunc(units) / 100;
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatPartnerSignedLessonUnits(units: number): string {
  const value = formatPartnerLessonUnits(units);
  return units > 0 ? `+${value}` : value;
}

export function formatPartnerBirthDate(value: string | null): string {
  if (!value) return '出生日期未填写';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match
    ? `${Number(match[1])}年${Number(match[2])}月${Number(match[3])}日`
    : '出生日期未填写';
}

export function formatPartnerDateTime(
  value: string,
  timeZone = 'Asia/Shanghai',
): string {
  const parts = parseZonedDateTime(value, timeZone);
  return parts ? `${parts.month}月${parts.day}日 ${parts.time}` : '时间待定';
}

export function formatPartnerAttendanceRate(
  basisPoints: number | null,
): string {
  if (basisPoints === null) return '暂无数据';
  const value = Math.max(0, Math.trunc(basisPoints)) / 100;
  const label = Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${label}%`;
}
