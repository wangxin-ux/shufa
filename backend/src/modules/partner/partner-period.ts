export const PARTNER_REPORT_PERIODS = ['DAY', 'MONTH', 'QUARTER'] as const;

export type PartnerReportPeriod = (typeof PARTNER_REPORT_PERIODS)[number];

export interface PartnerPeriodRange {
  period: PartnerReportPeriod;
  anchorDate: string;
  start: Date;
  end: Date;
}

export function resolvePartnerPeriodRange(
  period: PartnerReportPeriod,
  anchorDate: string | undefined,
  timeZone: string,
  now = new Date(),
): PartnerPeriodRange {
  const anchor = anchorDate
    ? parseCalendarDate(anchorDate)
    : zonedDateParts(now, timeZone);
  const startMonth =
    period === 'QUARTER'
      ? Math.floor((anchor.month - 1) / 3) * 3 + 1
      : anchor.month;
  const startDay = period === 'DAY' ? anchor.day : 1;
  const start = zonedMidnightToUtc(
    anchor.year,
    startMonth,
    startDay,
    timeZone,
  );
  const next =
    period === 'DAY'
      ? new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day + 1))
      : new Date(
          Date.UTC(
            anchor.year,
            startMonth - 1 + (period === 'QUARTER' ? 3 : 1),
            1,
          ),
        );
  const end = zonedMidnightToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return {
    period,
    anchorDate: formatCalendarDate(anchor),
    start,
    end,
  };
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function formatCalendarDate(parts: {
  year: number;
  month: number;
  day: number;
}) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day,
  ).padStart(2, '0')}`;
}

function zonedDateParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function zonedMidnightToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): Date {
  const desired = Date.UTC(year, month - 1, day);
  let candidate = desired;
  for (let index = 0; index < 3; index += 1) {
    const observed = zonedDateTimeParts(new Date(candidate), timeZone);
    candidate +=
      desired -
      Date.UTC(
        observed.year,
        observed.month - 1,
        observed.day,
        observed.hour,
        observed.minute,
        observed.second,
      );
  }
  return new Date(candidate);
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}
