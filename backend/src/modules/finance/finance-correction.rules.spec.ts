import {
  correctionEffectFen,
  correctionTransition,
} from './finance-correction.rules';

describe('finance correction rules', () => {
  it.each([
    ['SUBMITTED', 'APPROVE', 'APPROVED'],
    ['SUBMITTED', 'REJECT', 'REJECTED'],
    ['SUBMITTED', 'WITHDRAW', 'WITHDRAWN'],
    ['APPROVED', 'APPLY', 'APPLIED'],
  ] as const)('%s + %s -> %s', (status, action, expected) => {
    expect(correctionTransition(status, action)).toBe(expected);
  });

  it.each([
    ['VOID', 120000, null, -120000],
    ['REPLACE', 120000, 100000, -20000],
    ['REPLACE', 120000, 150000, 30000],
  ] as const)(
    'calculates a separate %s correction effect',
    (type, originalAmountFen, replacementAmountFen, expected) => {
      expect(
        correctionEffectFen(type, originalAmountFen, replacementAmountFen),
      ).toBe(expected);
    },
  );

  it.each([
    ['SUBMITTED', 'APPLY'],
    ['APPROVED', 'APPROVE'],
    ['APPLIED', 'WITHDRAW'],
  ] as const)('rejects invalid %s + %s transitions', (status, action) => {
    expect(() => correctionTransition(status, action)).toThrow(
      'Finance correction state does not allow this action',
    );
  });
});
