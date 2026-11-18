import {
  resolvePartnerPeriodRange,
  type PartnerReportPeriod,
} from './partner-period';

describe('partner calendar report boundaries', () => {
  it.each([
    [
      'DAY',
      '2024-02-29',
      'Asia/Shanghai',
      '2024-02-28T16:00:00.000Z',
      '2024-02-29T16:00:00.000Z',
    ],
    [
      'MONTH',
      '2026-12-31',
      'Asia/Shanghai',
      '2026-11-30T16:00:00.000Z',
      '2026-12-31T16:00:00.000Z',
    ],
    [
      'QUARTER',
      '2026-12-31',
      'Asia/Shanghai',
      '2026-09-30T16:00:00.000Z',
      '2026-12-31T16:00:00.000Z',
    ],
    [
      'DAY',
      '2026-03-08',
      'America/New_York',
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ],
    [
      'DAY',
      '2026-11-01',
      'America/New_York',
      '2026-11-01T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ],
  ])('resolves %s %s in %s', (period, anchorDate, zone, start, end) => {
    const result = resolvePartnerPeriodRange(
      period as PartnerReportPeriod,
      anchorDate,
      zone,
    );
    expect(result.anchorDate).toBe(anchorDate);
    expect(result.start.toISOString()).toBe(start);
    expect(result.end.toISOString()).toBe(end);
  });

  it('derives the default day from the campus timezone, not the server calendar', () => {
    const result = resolvePartnerPeriodRange(
      'DAY',
      undefined,
      'Asia/Shanghai',
      new Date('2026-10-08T20:00:00Z'),
    );
    expect(result.anchorDate).toBe('2026-10-09');
    expect(result.start.toISOString()).toBe('2026-10-08T16:00:00.000Z');
  });
});
