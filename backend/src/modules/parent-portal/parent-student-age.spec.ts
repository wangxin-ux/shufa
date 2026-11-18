import { calculateStudentAge } from './parent-student-age';

describe('parent student age in Asia/Shanghai', () => {
  it.each([
    ['2026-10-07T15:59:59Z', 8],
    ['2026-10-07T16:00:00Z', 9],
    ['2027-10-07T16:00:00Z', 10],
  ])('changes at the local birthday: %s', (now, expected) => {
    expect(calculateStudentAge(new Date('2017-10-08'), new Date(now))).toBe(
      expected,
    );
  });
  it('keeps a nonnegative fallback for missing or future dates', () => {
    expect(calculateStudentAge(null)).toBe(0);
    expect(
      calculateStudentAge(new Date('2027-01-01'), new Date('2026-10-08')),
    ).toBe(0);
  });
  it('does not increment a leap-day birthday before March in a non-leap year', () => {
    expect(
      calculateStudentAge(
        new Date('2020-02-29'),
        new Date('2026-02-28T08:00:00Z'),
      ),
    ).toBe(5);
    expect(
      calculateStudentAge(
        new Date('2020-02-29'),
        new Date('2026-03-01T08:00:00Z'),
      ),
    ).toBe(6);
  });
});
