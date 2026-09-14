import { teacherEarningPeriodBounds } from './earning-query.service';

describe('teacher earning period bounds', () => {
  it('uses Shanghai calendar day, Monday week, and calendar month boundaries', () => {
    const bounds = teacherEarningPeriodBounds(
      new Date('2026-09-09T14:30:00+08:00'),
    );

    expect(bounds).toEqual({
      todayFrom: new Date('2026-09-08T16:00:00.000Z'),
      tomorrowFrom: new Date('2026-09-09T16:00:00.000Z'),
      weekFrom: new Date('2026-09-06T16:00:00.000Z'),
      nextWeekFrom: new Date('2026-09-13T16:00:00.000Z'),
      monthFrom: new Date('2026-08-31T16:00:00.000Z'),
      nextMonthFrom: new Date('2026-09-30T16:00:00.000Z'),
    });
  });
});
