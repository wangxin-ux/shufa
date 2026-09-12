interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  time: string;
  weekday: number;
}

function getDateParts(value: string | number | Date, timeZone: string): DateParts {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('无效日期');
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

export function parseZonedDateTime(
  value: string | number | Date,
  timeZone = 'Asia/Shanghai',
): ZonedDateTimeParts | null {
  try {
    const parts = getDateParts(value, timeZone);
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    return {
      year,
      month,
      day,
      time: `${parts.hour}:${parts.minute}`,
      weekday: new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay(),
    };
  } catch {
    return null;
  }
}

export function formatDateLabel(
  value: string | number | Date,
  timeZone = 'Asia/Shanghai',
): string {
  const parts = getDateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatDateTimeLabel(
  value: string | number | Date,
  timeZone = 'Asia/Shanghai',
): string {
  const parts = getDateParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function formatFenAmount(amountFen: number): string {
  if (!Number.isSafeInteger(amountFen)) {
    throw new Error('金额必须是整数分');
  }

  const sign = amountFen < 0 ? '-' : '';
  const absoluteFen = Math.abs(amountFen);
  const yuan = Math.floor(absoluteFen / 100);
  const fen = String(absoluteFen % 100).padStart(2, '0');
  return `${sign}¥${yuan}.${fen}`;
}
