import {
  buildShanghaiRevenueRange,
  summarizeManagementRevenue,
} from './management-dashboard.service';

describe('management revenue dashboard', () => {
  it('uses Beijing natural-day boundaries for today, recent seven days, and month', () => {
    const now = new Date('2026-09-05T10:30:00+08:00');

    expect(buildShanghaiRevenueRange('TODAY', now)).toEqual({
      from: new Date('2026-09-05T00:00:00+08:00'),
      to: new Date('2026-09-06T00:00:00+08:00'),
    });
    expect(buildShanghaiRevenueRange('LAST_7_DAYS', now)).toEqual({
      from: new Date('2026-08-30T00:00:00+08:00'),
      to: new Date('2026-09-06T00:00:00+08:00'),
    });
    expect(buildShanghaiRevenueRange('CURRENT_MONTH', now)).toEqual({
      from: new Date('2026-09-01T00:00:00+08:00'),
      to: new Date('2026-10-01T00:00:00+08:00'),
    });
    expect(buildShanghaiRevenueRange('HISTORY', now)).toEqual({
      from: null,
      to: null,
    });
  });

  it('calculates the client example entirely in integer fen', () => {
    expect(
      summarizeManagementRevenue(
        [
          {
            id: 'campus-a',
            name: 'A校区',
            partnerCount: 1,
          },
        ],
        [
          {
            campusId: 'campus-a',
            entryType: 'ACCRUAL',
            amountFen: 100_000,
            unitPriceFen: 10_000,
            countedAttendeeCount: 50,
          },
        ],
      ),
    ).toEqual({
      partnerCount: 1,
      countedAttendeeCount: 50,
      grossLessonRevenueFen: 500_000,
      partnerEarningFen: 100_000,
      headquartersRetainedFen: 400_000,
      currency: 'CNY',
      campuses: [
        {
          campusId: 'campus-a',
          campusName: 'A校区',
          partnerCount: 1,
          countedAttendeeCount: 50,
          grossLessonRevenueFen: 500_000,
          partnerEarningFen: 100_000,
          headquartersRetainedFen: 400_000,
        },
      ],
    });
  });

  it('applies reversals in the period where the negative entry occurs', () => {
    expect(
      summarizeManagementRevenue(
        [{ id: 'campus-a', name: 'A校区', partnerCount: 1 }],
        [
          {
            campusId: 'campus-a',
            entryType: 'REVERSAL',
            amountFen: -1_000,
            unitPriceFen: 5_000,
            countedAttendeeCount: 1,
          },
        ],
      ).campuses[0],
    ).toMatchObject({
      countedAttendeeCount: -1,
      grossLessonRevenueFen: -5_000,
      partnerEarningFen: -1_000,
      headquartersRetainedFen: -4_000,
    });
  });
});
