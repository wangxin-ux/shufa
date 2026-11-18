import { DomainError } from '../../common/errors/domain-error';
import { ErrorCode } from '../../common/errors/error-codes';
import type { OperatorSeriesPatternDto } from './dto/operator-lesson-series.dto';

const DAY = 86_400_000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SHANGHAI_TIMEZONE = 'Asia/Shanghai' as const;

export function expandOperatorSeries(pattern: OperatorSeriesPatternDto) {
  const start = localDate(pattern.startDate);
  const end = localDate(pattern.endDate);
  const count = (end - start) / DAY + 1;
  if (count < 1 || count > 84)
    invalid('Choose at most 12 weeks (84 inclusive local dates)');
  if (
    ![1, 2].includes(pattern.intervalWeeks) ||
    !Array.isArray(pattern.weekdays) ||
    pattern.weekdays.length < 1 ||
    pattern.weekdays.length > 7 ||
    new Set(pattern.weekdays).size !== pattern.weekdays.length ||
    pattern.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  ) {
    invalid('Choose weekly or fortnightly distinct ISO weekdays');
  }
  if (
    !TIME.test(pattern.startTime) ||
    !TIME.test(pattern.endTime) ||
    pattern.endTime <= pattern.startTime
  ) {
    invalid('Choose a valid same-day local start and later end time');
  }
  const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * DAY;
  const sessions: Array<{ date: string; startsAt: Date; endsAt: Date }> = [];
  for (let day = start; day <= end; day += DAY) {
    const weekday = ((new Date(day).getUTCDay() + 6) % 7) + 1;
    const week = Math.floor((day - monday) / (7 * DAY));
    if (
      week % pattern.intervalWeeks !== 0 ||
      !pattern.weekdays.includes(weekday)
    )
      continue;
    const date = new Date(day).toISOString().slice(0, 10);
    sessions.push({
      date,
      startsAt: new Date(`${date}T${pattern.startTime}:00+08:00`),
      endsAt: new Date(`${date}T${pattern.endTime}:00+08:00`),
    });
  }
  if (sessions.length < 1 || sessions.length > 50)
    invalid('Choose between 1 and 50 sessions');
  return sessions;
}

function localDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Dates must be YYYY-MM-DD');
  const result = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  ) {
    invalid('The selected calendar date is invalid');
  }
  return result.getTime();
}

function invalid(message: string): never {
  throw new DomainError(ErrorCode.BAD_REQUEST, message, 400);
}
