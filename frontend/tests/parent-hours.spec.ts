import {
  buildParentHoursPageModel,
  normalizeParentHoursFilter,
} from '../services/parent-hours.presenter';
import { ParentHoursView } from '../types/parent';

const hoursView: ParentHoursView = {
  remainingTotal: 99,
  paidHours: 10,
  giftHours: 8,
  paidAmountFen: 480000,
  validUntil: '2027-08-23',
  entries: [
    {
      id: 'debit-1',
      title: '创意书写',
      occurredAtLabel: '2026-08-27 14:00',
      detailLabel: '林老师',
      delta: -1,
    },
    {
      id: 'credit-1',
      title: '报名入账',
      occurredAtLabel: '2026-08-01 09:00',
      detailLabel: '购买课时',
      delta: 48,
    },
  ],
};

describe('parent hours page model', () => {
  it('uses the backend total and exposes gift cards only when gift hours are present', () => {
    const visible = buildParentHoursPageModel(hoursView, 'all');
    const hidden = buildParentHoursPageModel({ ...hoursView, giftHours: null }, 'all');

    expect(visible.remainingTotal).toBe(99);
    expect(visible.hourCards.map((card) => card.key)).toEqual(['paid', 'gift']);
    expect(hidden.remainingTotal).toBe(99);
    expect(hidden.hourCards.map((card) => card.key)).toEqual(['paid']);
  });

  it('filters debit and credit entries without changing source values', () => {
    const originalEntries = structuredClone(hoursView.entries);

    const debit = buildParentHoursPageModel(hoursView, 'debit');
    const credit = buildParentHoursPageModel(hoursView, 'credit');

    expect(debit.entries.map((entry) => entry.id)).toEqual(['debit-1']);
    expect(credit.entries.map((entry) => entry.id)).toEqual(['credit-1']);
    expect(hoursView.entries).toEqual(originalEntries);
  });

  it('formats money, validity date and signed deltas for display', () => {
    const model = buildParentHoursPageModel(hoursView, 'all');

    expect(model.paidAmountLabel).toBe('¥4800.00');
    expect(model.validUntilLabel).toBe('2027-08-23');
    expect(model.entries.map((entry) => entry.deltaLabel)).toEqual(['-1节', '+48节']);
  });

  it('accepts only the three supported page filters', () => {
    expect(normalizeParentHoursFilter('debit')).toBe('debit');
    expect(normalizeParentHoursFilter('credit')).toBe('credit');
    expect(normalizeParentHoursFilter('unknown')).toBe('all');
    expect(normalizeParentHoursFilter(undefined)).toBe('all');
  });
});
