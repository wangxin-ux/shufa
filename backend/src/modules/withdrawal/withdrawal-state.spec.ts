import { assertWithdrawalTransition } from './withdrawal-state';

describe('teacher withdrawal state machine', () => {
  it.each([
    ['SUBMITTED', 'APPROVED'],
    ['SUBMITTED', 'CANCELLED'],
    ['SUBMITTED', 'REJECTED'],
    ['APPROVED', 'PAYING'],
    ['APPROVED', 'FAILED'],
    ['PAYING', 'PAID'],
    ['PAYING', 'FAILED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(() => assertWithdrawalTransition(from, to)).not.toThrow();
  });

  it.each([
    ['SUBMITTED', 'PAID'],
    ['APPROVED', 'CANCELLED'],
    ['PAYING', 'REJECTED'],
    ['PAID', 'FAILED'],
    ['CANCELLED', 'SUBMITTED'],
    ['REJECTED', 'APPROVED'],
    ['FAILED', 'PAYING'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(() => assertWithdrawalTransition(from, to)).toThrow(
      'Withdrawal status transition is not allowed',
    );
  });
});
