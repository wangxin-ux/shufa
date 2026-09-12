import { DomainError } from '../../common/errors/domain-error';
import { resolveGroupBenefit } from './group-buying-settlement.service';

describe('group buying benefit tiers', () => {
  it.each([
    [1, { mainUnits: 100, giftUnits: 0 }],
    [2, { mainUnits: 100, giftUnits: 200 }],
    [3, { mainUnits: 100, giftUnits: 400 }],
  ] as const)('grants the fixed benefit for %i paid members', (count, benefit) => {
    expect(resolveGroupBenefit(count)).toEqual(benefit);
  });

  it.each([0, 4, 1.5])('rejects an invalid paid member count: %s', (count) => {
    expect(() => resolveGroupBenefit(count)).toThrow(DomainError);
  });
});
