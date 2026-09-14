import { summarizeLessonBalances } from './lesson-balance';

describe('lesson balance read model', () => {
  it('keeps gross, reserved and available quantities separate', () => {
    expect(
      summarizeLessonBalances([
        {
          mainBalanceUnits: 1200,
          giftBalanceUnits: 300,
          mainReservedUnits: 200,
          giftReservedUnits: 100,
        },
        {
          mainBalanceUnits: 100,
          giftBalanceUnits: 0,
          mainReservedUnits: 0,
          giftReservedUnits: 0,
        },
      ]),
    ).toEqual({
      mainBalanceUnits: 1300,
      giftBalanceUnits: 300,
      totalBalanceUnits: 1600,
      mainReservedUnits: 200,
      giftReservedUnits: 100,
      reservedTotalUnits: 300,
      mainAvailableUnits: 1100,
      giftAvailableUnits: 200,
      availableTotalUnits: 1300,
    });
  });
  it('normalizes empty and pre-reservation fixtures to zero reserved', () => {
    expect(summarizeLessonBalances([])).toMatchObject({
      totalBalanceUnits: 0,
      reservedTotalUnits: 0,
      availableTotalUnits: 0,
    });
    expect(
      summarizeLessonBalances([{ mainBalanceUnits: 100, giftBalanceUnits: 0 }]),
    ).toMatchObject({ mainAvailableUnits: 100, mainReservedUnits: 0 });
  });
});
