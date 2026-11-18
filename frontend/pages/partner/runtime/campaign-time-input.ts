import { parseZonedDateTime } from '../../../utils/format';
import { normalizeFreeInstant } from './free-campaign.service';

export interface CampaignTimeInput { date: string; time: string }
export class CampaignTimeInputError extends Error {
  constructor(readonly code: 'INCOMPLETE' | 'INVALID' | 'NONEXISTENT' | 'AMBIGUOUS') {
    super(code);
  }
}
export const blankCampaignTime = (): CampaignTimeInput => ({ date: '', time: '' });

export function campaignTimeFromInstant(value: string, zone: string): CampaignTimeInput {
  if (!value) return blankCampaignTime();
  const parts = parseZonedDateTime(normalizeFreeInstant(value), zone);
  if (!parts) throw new CampaignTimeInputError('INVALID');
  return {
    date: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: parts.time,
  };
}

function utcTime(year: number, month: number, day: number, hour: number, minute: number, second = 0, ms = 0): number {
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(hour, minute, second, ms);
  return value.getTime();
}

export function campaignTimeToInstant(input: CampaignTimeInput, zone: string, previous = ''): string | null {
  if (!input.date && !input.time) return previous ? normalizeFreeInstant(previous) : null;
  if (!input.date || !input.time) throw new CampaignTimeInputError('INCOMPLETE');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.time))
    throw new CampaignTimeInputError('INVALID');
  const [year, month, day] = input.date.split('-').map(Number);
  const [hour, minute] = input.time.split(':').map(Number);
  const calendar = new Date(utcTime(year, month, day, hour, minute));
  if (year < 1 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day)
    throw new CampaignTimeInputError('INVALID');
  const original = previous ? normalizeFreeInstant(previous) : '';
  if (original) {
    const unchanged = campaignTimeFromInstant(original, zone);
    if (unchanged.date === input.date && unchanged.time === input.time) return original;
  }
  const originalDate = original ? new Date(original) : undefined;
  const target = utcTime(year, month, day, hour, minute, originalDate?.getUTCSeconds(), originalDate?.getUTCMilliseconds());
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, calendar: 'iso8601', numberingSystem: 'latn', era: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const wallTime = (instant: number): number => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    const localYear = parts.era === 'BC' ? 1 - Number(parts.year) : Number(parts.year);
    return utcTime(localYear, Number(parts.month), Number(parts.day), Number(parts.hour),
      Number(parts.minute), Number(parts.second), new Date(instant).getUTCMilliseconds());
  };
  // Probe both sides of a transition, then require an exact round trip; never guess through a gap or fold.
  const dayMs = 86400000;
  const offsets = new Set([-dayMs, 0, dayMs].map((distance) => wallTime(target + distance) - (target + distance)));
  const matches = [...offsets].map((offset) => target - offset).filter((candidate) => wallTime(candidate) === target);
  if (!matches.length) throw new CampaignTimeInputError('NONEXISTENT');
  if (matches.length !== 1) throw new CampaignTimeInputError('AMBIGUOUS');
  return normalizeFreeInstant(new Date(matches[0]).toISOString());
}
