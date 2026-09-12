import { presentLessonBalance } from '../services/lesson-availability';

describe('cross-role available lesson presentation', () => {
  it('uses backend available values, with gross and reserved values explicitly labelled', () => {
    expect(presentLessonBalance({
      mainBalanceUnits: 1200, giftBalanceUnits: 300, totalBalanceUnits: 1500,
      mainAvailableUnits: 1000, giftAvailableUnits: 200, availableTotalUnits: 1200,
      reservedTotalUnits: 300,
    })).toEqual({
      mainBalanceLabel: '10', giftBalanceLabel: '2', totalBalanceLabel: '12',
      reservationLabel: '可用 12 节 · 退课处理中 3 节 · 账面 15 节',
    });
  });
  it('preserves legacy fixture labels when reservations are zero', () => {
    expect(presentLessonBalance({ mainBalanceUnits: 100, giftBalanceUnits: 50, totalBalanceUnits: 150 }))
      .toEqual({ mainBalanceLabel: '1', giftBalanceLabel: '0.5', totalBalanceLabel: '1.5' });
  });
});
