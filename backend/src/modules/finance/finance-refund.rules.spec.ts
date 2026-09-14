import { refundReferenceFen, refundTransition } from './finance-refund.rules';

describe('finance refund rules', () => {
  it('uses the original exact ratio and half-up rounding in integer fen', () => {
    expect(refundReferenceFen(10000, 300, 100)).toBe(3333);
    expect(refundReferenceFen(10001, 300, 200)).toBe(6667);
    expect(refundReferenceFen(1, 200, 100)).toBe(1);
    expect(refundReferenceFen(2147483647, 100000000, 100000000)).toBe(
      2147483647,
    );
  });

  it.each([
    [0, 100, 1],
    [10, 0, 1],
    [10, 100, 0],
    [10, 100, 101],
    [10, 100, 1.5],
    [Number.NaN, 100, 1],
  ])(
    'rejects invalid reference arguments %s/%s/%s',
    (amount, initial, units) => {
      expect(() => refundReferenceFen(amount, initial, units)).toThrow();
    },
  );

  it.each([
    ['SUBMITTED', 'APPROVE', 'APPROVED'],
    ['SUBMITTED', 'REJECT', 'REJECTED'],
    ['SUBMITTED', 'WITHDRAW', 'WITHDRAWN'],
    ['APPROVED', 'START_PAYMENT', 'PAYING'],
    ['APPROVED', 'REQUEST_CANCELLATION', 'CANCEL_REQUESTED'],
    ['CANCEL_REQUESTED', 'CONFIRM_CANCELLATION', 'CANCELLED'],
    ['CANCEL_REQUESTED', 'DENY_CANCELLATION', 'APPROVED'],
    ['PAYING', 'MARK_UNCERTAIN', 'UNCERTAIN'],
    ['PAYING', 'RECORD_PAYMENT', 'PAID'],
    ['UNCERTAIN', 'RECORD_PAYMENT', 'PAID'],
  ] as const)('transitions %s via %s to %s', (status, action, expected) => {
    expect(refundTransition(status, action)).toBe(expected);
  });

  it.each([
    ['PAYING', 'CONFIRM_CANCELLATION'],
    ['UNCERTAIN', 'WITHDRAW'],
    ['PAID', 'RECORD_PAYMENT'],
    ['SUBMITTED', 'RECORD_PAYMENT'],
    ['APPROVED', 'RECORD_PAYMENT'],
    ['REJECTED', 'APPROVE'],
    ['CANCEL_REQUESTED', 'START_PAYMENT'],
  ] as const)('rejects unsafe transition %s/%s', (status, action) => {
    expect(() => refundTransition(status, action)).toThrow();
  });
});
