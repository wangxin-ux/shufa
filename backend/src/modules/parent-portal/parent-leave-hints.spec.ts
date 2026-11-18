import { buildLeaveWeekWarnings, shanghaiNaturalWeek } from './parent-leave-hints';

const session = (id: string, startsAt: string, leaveStatuses: string[], attendanceStatus: string | null = null) =>
  ({ id, startsAt: new Date(startsAt), leaveStatuses, attendanceStatus });

describe('parent natural-week consecutive leave hints', () => {
  it('uses Shanghai Monday midnight and an exclusive next Monday boundary', () => {
    expect(shanghaiNaturalWeek(new Date('2030-10-06T15:59:59Z'))).toEqual({
      from: new Date('2030-09-29T16:00:00Z'), to: new Date('2030-10-06T16:00:00Z'),
      weekStart: '2030-09-30', weekEnd: '2030-10-06',
    });
    expect(shanghaiNaturalWeek(new Date('2030-10-06T16:00:00Z')).weekStart).toBe('2030-10-07');
  });
  it('counts each session once and uses the longest consecutive run, not weekly total', () => {
    const warnings = buildLeaveWeekWarnings([
      session('four', '2030-10-03T06:00:00Z', ['APPROVED']),
      session('one', '2030-10-01T06:00:00Z', ['PENDING', 'APPROVED']),
      session('two', '2030-10-02T06:00:00Z', ['PENDING']),
      session('normal', '2030-10-02T07:00:00Z', []),
      session('five', '2030-10-04T06:00:00Z', ['APPROVED']),
      session('six', '2030-10-05T06:00:00Z', ['PENDING']),
    ]);
    expect(warnings).toEqual([{
      weekStart: '2030-09-30', weekEnd: '2030-10-06', consecutiveCount: 3,
      lessonSessionIds: ['four', 'five', 'six'],
    }]);
  });
  it('lets rejected or actual non-leave attendance break continuity', () => {
    expect(buildLeaveWeekWarnings([
      session('one', '2030-10-01T06:00:00Z', ['PENDING']),
      session('rejected', '2030-10-02T06:00:00Z', ['REJECTED']),
      session('three', '2030-10-03T06:00:00Z', ['APPROVED']),
      session('present', '2030-10-04T06:00:00Z', ['APPROVED'], 'PRESENT'),
      session('five', '2030-10-05T06:00:00Z', ['APPROVED'], 'LEAVE'),
    ])).toEqual([]);
  });
  it('does not merge Sunday and Monday leave sessions across weeks', () => {
    expect(buildLeaveWeekWarnings([
      session('sun', '2030-10-06T15:00:00Z', ['APPROVED']),
      session('mon', '2030-10-06T16:00:00Z', ['PENDING']),
    ])).toEqual([]);
  });
});
