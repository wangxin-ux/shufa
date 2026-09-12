import {
  consumeLessonUnits,
  InsufficientLessonBalanceError,
  planPackageConsumption,
} from './lesson-ledger.service';

describe('lesson ledger allocation', () => {
  it('preserves reserved balances while consuming only available units', () => {
    const input = {
      ...packageFixture('reserved', 1200, 300),
      mainReservedUnits: 1100,
      giftReservedUnits: 100,
    };
    const result = planPackageConsumption(
      [input],
      250,
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(result.entries).toEqual([
      {
        packageId: 'reserved',
        bucket: 'MAIN',
        deltaUnits: -100,
        balanceBeforeUnits: 1200,
        balanceAfterUnits: 1100,
      },
      {
        packageId: 'reserved',
        bucket: 'GIFT',
        deltaUnits: -150,
        balanceBeforeUnits: 300,
        balanceAfterUnits: 150,
      },
    ]);
    expect(result.packages).toEqual([
      { packageId: 'reserved', mainBalanceUnits: 1100, giftBalanceUnits: 150 },
    ]);
    expect(input.mainBalanceUnits).toBe(1200);
    expect(input.giftReservedUnits).toBe(100);
  });

  it('reports available rather than gross units when a refund reservation blocks consumption', () => {
    const input = {
      ...packageFixture('reserved', 1200, 300),
      mainReservedUnits: 1200,
      giftReservedUnits: 200,
    };
    try {
      planPackageConsumption([input], 101, new Date('2026-09-01T00:00:00Z'));
      throw new Error('Expected insufficient balance');
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientLessonBalanceError);
      expect(error).toMatchObject({ availableUnits: 100, requiredUnits: 101 });
    }
  });

  it.each([-1, 1.5, 1201, Number.NaN])(
    'rejects invalid main reservations %s',
    (mainReservedUnits) => {
      expect(() =>
        planPackageConsumption(
          [{ ...packageFixture('bad', 1200, 300), mainReservedUnits }],
          100,
          new Date('2026-09-01T00:00:00Z'),
        ),
      ).toThrow(RangeError);
    },
  );

  it('orders packages with no expiry by validity then id, independent of input order', () => {
    const result = planPackageConsumption(
      [
        packageFixture('z-later', 100, 0, {
          validFrom: new Date('2026-08-20T00:00:00Z'),
        }),
        packageFixture('b-earlier', 100, 0),
        packageFixture('a-earlier', 100, 0),
      ],
      150,
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(result.entries.map((entry) => entry.packageId)).toEqual([
      'a-earlier',
      'b-earlier',
    ]);
  });

  it.each([-1, 1.5, 301, Number.NaN])(
    'rejects invalid gift reservations %s',
    (giftReservedUnits) => {
      expect(() =>
        planPackageConsumption(
          [{ ...packageFixture('bad', 1200, 300), giftReservedUnits }],
          100,
          new Date('2026-09-01T00:00:00Z'),
        ),
      ).toThrow(RangeError);
    },
  );

  it('skips fully reserved packages and spends all available main before any gift', () => {
    const packages = [
      {
        ...packageFixture('frozen', 100, 100),
        mainReservedUnits: 100,
        giftReservedUnits: 100,
      },
      {
        ...packageFixture('earliest', 100, 300, {
          expiresAt: new Date('2026-10-01T00:00:00Z'),
        }),
        mainReservedUnits: 100,
        giftReservedUnits: 100,
      },
      {
        ...packageFixture('later', 200, 100),
        mainReservedUnits: 50,
        giftReservedUnits: 0,
      },
    ];
    const original = packages.map((p) => ({ ...p }));
    const plan = planPackageConsumption(
      packages,
      400,
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(
      plan.entries.map(({ packageId, bucket, deltaUnits }) => ({
        packageId,
        bucket,
        deltaUnits,
      })),
    ).toEqual([
      { packageId: 'later', bucket: 'MAIN', deltaUnits: -150 },
      { packageId: 'earliest', bucket: 'GIFT', deltaUnits: -200 },
      { packageId: 'later', bucket: 'GIFT', deltaUnits: -50 },
    ]);
    expect(packages).toEqual(original);
  });
  it('splits main and gift units without mutating the input', () => {
    const balance = { mainUnits: 150, giftUnits: 100 };

    expect(consumeLessonUnits(balance, 200)).toEqual({
      entries: [
        { bucket: 'MAIN', deltaUnits: -150, balanceAfterUnits: 0 },
        { bucket: 'GIFT', deltaUnits: -50, balanceAfterUnits: 50 },
      ],
      balance: { mainUnits: 0, giftUnits: 50 },
    });
    expect(balance).toEqual({ mainUnits: 150, giftUnits: 100 });
  });

  it('consumes an exact main balance without a gift entry', () => {
    expect(consumeLessonUnits({ mainUnits: 200, giftUnits: 100 }, 200)).toEqual(
      {
        entries: [{ bucket: 'MAIN', deltaUnits: -200, balanceAfterUnits: 0 }],
        balance: { mainUnits: 0, giftUnits: 100 },
      },
    );
  });

  it('uses gift units when no main units remain', () => {
    expect(consumeLessonUnits({ mainUnits: 0, giftUnits: 100 }, 50)).toEqual({
      entries: [{ bucket: 'GIFT', deltaUnits: -50, balanceAfterUnits: 50 }],
      balance: { mainUnits: 0, giftUnits: 50 },
    });
  });

  it('rejects insufficient total balance', () => {
    expect(() =>
      consumeLessonUnits({ mainUnits: 50, giftUnits: 25 }, 100),
    ).toThrow(InsufficientLessonBalanceError);
  });

  it.each([0, -1])('rejects non-positive requested units: %s', (units) => {
    expect(() =>
      consumeLessonUnits({ mainUnits: 100, giftUnits: 0 }, units),
    ).toThrow('Lesson units must be a positive integer');
  });

  it('ignores inactive, future, and expired packages', () => {
    const at = new Date('2026-09-01T00:00:00Z');
    const result = planPackageConsumption(
      [
        packageFixture('active', 100, 0, {
          validFrom: new Date('2026-08-01T00:00:00Z'),
          expiresAt: new Date('2026-10-01T00:00:00Z'),
        }),
        packageFixture('stopped', 500, 0, { isActive: false }),
        packageFixture('future', 500, 0, {
          validFrom: new Date('2026-09-02T00:00:00Z'),
        }),
        packageFixture('expired', 500, 0, {
          expiresAt: new Date('2026-08-31T23:59:59Z'),
        }),
      ],
      100,
      at,
    );

    expect(result.entries).toEqual([
      expect.objectContaining({ packageId: 'active', deltaUnits: -100 }),
    ]);
  });

  it('uses earliest expiry within MAIN before consuming any GIFT units', () => {
    const at = new Date('2026-09-01T00:00:00Z');
    const result = planPackageConsumption(
      [
        packageFixture('later', 200, 0, {
          expiresAt: new Date('2026-12-01T00:00:00Z'),
        }),
        packageFixture('earliest', 100, 500, {
          expiresAt: new Date('2026-10-01T00:00:00Z'),
        }),
        packageFixture('no-expiry', 100, 0),
      ],
      250,
      at,
    );

    expect(result.entries).toEqual([
      expect.objectContaining({
        packageId: 'earliest',
        bucket: 'MAIN',
        deltaUnits: -100,
      }),
      expect.objectContaining({
        packageId: 'later',
        bucket: 'MAIN',
        deltaUnits: -150,
      }),
    ]);
    expect(result.entries.some(({ bucket }) => bucket === 'GIFT')).toBe(false);
  });
});

function packageFixture(
  id: string,
  mainBalanceUnits: number,
  giftBalanceUnits: number,
  overrides: Partial<{
    isActive: boolean;
    validFrom: Date;
    expiresAt: Date | null;
  }> = {},
) {
  return {
    id,
    mainBalanceUnits,
    giftBalanceUnits,
    isActive: true,
    validFrom: new Date('2026-08-01T00:00:00Z'),
    expiresAt: null,
    ...overrides,
  };
}
