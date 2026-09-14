import {
  formatDateLabel,
  formatDateTimeLabel,
  formatFenAmount,
  parseZonedDateTime,
} from '../utils/format';

describe('parent display formatting', () => {
  it('formats dates in the configured timezone', () => {
    const value = '2026-08-27T06:05:00.000Z';

    expect(formatDateLabel(value, 'Asia/Shanghai')).toBe('2026-08-27');
    expect(formatDateTimeLabel(value, 'Asia/Shanghai')).toBe('2026-08-27 14:05');
    expect(parseZonedDateTime('2026-08-30T06:00:00.000Z')).toEqual({
      year: 2026,
      month: 8,
      day: 30,
      time: '14:00',
      weekday: 0,
    });
  });

  it('formats integer fen without storing floating point money', () => {
    expect(formatFenAmount(480000)).toBe('¥4800.00');
    expect(formatFenAmount(5)).toBe('¥0.05');
    expect(formatFenAmount(-105)).toBe('-¥1.05');
  });

  it('rejects invalid dates and non-integer fen', () => {
    expect(() => formatDateLabel('not-a-date')).toThrow('无效日期');
    expect(parseZonedDateTime('not-a-date')).toBeNull();
    expect(() => formatFenAmount(1.5)).toThrow('金额必须是整数分');
  });
});
