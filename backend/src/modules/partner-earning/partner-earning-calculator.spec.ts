import { calculatePartnerEarning } from './partner-earning-calculator';

describe('partner earning calculator', () => {
  it('calculates the confirmed 10 yuan, 40 percent, 10 attendee example', () => {
    expect(
      calculatePartnerEarning({
        unitPriceFen: 1000,
        shareBasisPoints: 4000,
        countedAttendeeCount: 10,
      }),
    ).toEqual({ perAttendeeAmountFen: 400, amountFen: 4000 });
  });

  it('rounds each attendee amount to fen before multiplying attendees', () => {
    expect(
      calculatePartnerEarning({
        unitPriceFen: 1,
        shareBasisPoints: 5000,
        countedAttendeeCount: 3,
      }),
    ).toEqual({ perAttendeeAmountFen: 1, amountFen: 3 });
  });

  it('returns zero total for no counted attendees without changing unit price', () => {
    expect(
      calculatePartnerEarning({
        unitPriceFen: 1000,
        shareBasisPoints: 4000,
        countedAttendeeCount: 0,
      }),
    ).toEqual({ perAttendeeAmountFen: 400, amountFen: 0 });
  });

  it.each([
    { unitPriceFen: 0, shareBasisPoints: 4000, countedAttendeeCount: 1 },
    { unitPriceFen: 1000, shareBasisPoints: 0, countedAttendeeCount: 1 },
    { unitPriceFen: 1000, shareBasisPoints: 10001, countedAttendeeCount: 1 },
    { unitPriceFen: 1000, shareBasisPoints: 4000, countedAttendeeCount: -1 },
  ])('rejects invalid integer input %#', (input) => {
    expect(() => calculatePartnerEarning(input)).toThrow(RangeError);
  });

  it('rejects unsafe intermediate and final amounts', () => {
    expect(() =>
      calculatePartnerEarning({
        unitPriceFen: Number.MAX_SAFE_INTEGER,
        shareBasisPoints: 10000,
        countedAttendeeCount: 2,
      }),
    ).toThrow(/safe integer/i);
  });
});
