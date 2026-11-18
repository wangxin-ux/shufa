import {
  allocateSettlement,
  assertPartnerWithdrawalTransition,
  isPartnerWithdrawalSimulation,
  settlementOccupies,
  shanghaiWithdrawalDay,
} from './partner-withdrawal-rules';

describe('partner withdrawal accounting rules', () => {
  it('permanently occupies paid allocations and retains unknown results', () => {
    for (const status of [
      'SUBMITTED',
      'APPROVED',
      'PAYING',
      'RECONCILING',
      'PAID',
    ])
      expect(settlementOccupies(status)).toBe(true);
    for (const status of ['CANCELLED', 'REJECTED', 'FAILED', 'INVALIDATED'])
      expect(settlementOccupies(status)).toBe(false);
  });
  it('allocates partial entitlements once in caller stable order', () => {
    expect(
      allocateSettlement(
        [
          { id: 'a', remainingFen: 5000 },
          { id: 'b', remainingFen: 8000 },
        ],
        10000,
      ),
    ).toEqual([
      { sourceId: 'a', amountFen: 5000 },
      { sourceId: 'b', amountFen: 5000 },
    ]);
    expect(() =>
      allocateSettlement([{ id: 'a', remainingFen: 2000 }], 8000),
    ).toThrow();
    for (const amount of [0, -1, 1.1, NaN, Number.MAX_SAFE_INTEGER])
      expect(() => allocateSettlement([], amount)).toThrow();
  });
  it('requires investigation before resolving an unknown payout', () => {
    expect(() =>
      assertPartnerWithdrawalTransition('PAYING', 'RECONCILING'),
    ).not.toThrow();
    expect(() =>
      assertPartnerWithdrawalTransition('RECONCILING', 'PAID'),
    ).not.toThrow();
    expect(() =>
      assertPartnerWithdrawalTransition('RECONCILING', 'FAILED'),
    ).not.toThrow();
    expect(() =>
      assertPartnerWithdrawalTransition('RECONCILING', 'PAYING'),
    ).toThrow();
    expect(() => assertPartnerWithdrawalTransition('PAID', 'FAILED')).toThrow();
    expect(() =>
      assertPartnerWithdrawalTransition('SUBMITTED', 'PAID'),
    ).toThrow();
  });
  it('does not enable mock funds outside the explicitly selected local isolated database', () => {
    const env = {
      NODE_ENV: 'test',
      AUTH_DRIVER: 'mock',
      PAYMENT_DRIVER: 'mock',
      PARTNER_WITHDRAWAL_DRIVER: 'mock',
      DATABASE_URL:
        'postgresql://synthetic:synthetic@127.0.0.1:5433/education_app_test_partner_pdf_withdrawal_test',
      PARTNER_PDF_TEST_DB_NAME:
        'education_app_test_partner_pdf_withdrawal_test',
    };
    expect(isPartnerWithdrawalSimulation(env)).toBe(true);
    for (const patch of [
      { NODE_ENV: 'production' },
      { PARTNER_WITHDRAWAL_DRIVER: undefined },
      { DATABASE_URL: env.DATABASE_URL.replace('127.0.0.1', 'example.org') },
      { PARTNER_PDF_TEST_DB_NAME: 'other_test' },
      { AUTH_DRIVER: 'wechat' },
      { DATABASE_URL: env.DATABASE_URL.replace('_withdrawal_test', '_demo') },
    ])
      expect(isPartnerWithdrawalSimulation({ ...env, ...patch })).toBe(false);
  });
  it('counts applications using the Beijing calendar day', () => {
    expect(
      shanghaiWithdrawalDay(
        new Date('2026-10-16T15:59:59Z'),
      ).start.toISOString(),
    ).toBe('2026-10-15T16:00:00.000Z');
    expect(
      shanghaiWithdrawalDay(
        new Date('2026-10-16T16:00:00Z'),
      ).start.toISOString(),
    ).toBe('2026-10-16T16:00:00.000Z');
  });
});
