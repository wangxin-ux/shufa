import {
  buildParentHoursPageModel,
  normalizeParentHoursFilter,
} from '../services/parent-hours.presenter';
import { ParentHoursView } from '../types/parent';
import { privateNumberAdvance } from './support/parent-pdf-number-metrics';

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
  it.each([44, 88, 444444, 888888, 4444.5])(
    'fits wide private-font digits in the original grant lane for %s', (grant) => {
      const model = buildParentHoursPageModel({
        ...hoursView, grantedPaidHours: grant, grantedGiftHours: grant,
      }, 'all');
      for (const card of model.hourCards) {
        expect(card.grantedLabel).toBe(String(grant));
        expect(privateNumberAdvance(card.grantedLabel, card.valueSize))
          .toBeLessThanOrEqual(204);
      }
    },
  );
  it.each([48, 999, 999999, 999.5])('fits the complete grant %s in the numeric lane', (grant) => {
    const model = buildParentHoursPageModel({
      ...hoursView, grantedPaidHours: grant, grantedGiftHours: grant,
    }, 'all');
    for (const card of model.hourCards) {
      expect(card.grantedLabel).toBe(String(grant));
      expect(privateNumberAdvance(card.grantedLabel, card.valueSize)).toBeLessThanOrEqual(204);
      if (grant === 48) expect(card.valueSize).toBe(139);
    }
  });
  it('uses the source grant size for ordinary values and keeps unknown grants distinct', () => {
    const known = buildParentHoursPageModel({
      ...hoursView, grantedPaidHours: 48, grantedGiftHours: 12,
    }, 'all');
    expect(known.hourCards.map((card) => card.valueSize)).toEqual([139, 139]);
    const zero = buildParentHoursPageModel({
      ...hoursView, grantedPaidHours: 0, grantedGiftHours: 0,
    }, 'all');
    expect(zero.hourCards.map((card) => card.valueSize)).toEqual([139, 139]);
    const unknown = buildParentHoursPageModel(hoursView, 'all');
    expect(unknown.hourCards[0]).toMatchObject({
      grantedLabel: '待核对', valueSize: 36, hasKnownGrant: false,
    });
  });
  it('shows original grants separately from available balances and never guesses missing history', () => {
    const known = buildParentHoursPageModel({
      ...hoursView, grantedPaidHours: 48, grantedGiftHours: 12,
    } as ParentHoursView, 'all');
    expect(known.hourCards[0]).toMatchObject({ grantedLabel: '48', remaining: 10 });
    expect(known.hourCards[1]).toMatchObject({ grantedLabel: '12', remaining: 8 });
    const unknown = buildParentHoursPageModel(hoursView, 'all');
    expect(unknown.hourCards[0]).toMatchObject({ grantedLabel: '待核对', remaining: 10 });
  });
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
    expect(model.entries[0]).toMatchObject({ subtitleLabel: '2026-08-27 14:00 林老师' });
  });

  it('uses the compact parent summary while preserving the full source description', () => {
    const entry = {
      ...hoursView.entries[0],
      summaryLabel: '8月27日 14:00 林老师',
      detailLabel: '林老师 · 正常上课',
    };
    const model = buildParentHoursPageModel({ ...hoursView, entries: [entry] }, 'all');
    expect(model.entries[0]).toMatchObject({
      subtitleLabel: '8月27日 14:00 林老师',
      detailLabel: '林老师 · 正常上课',
      delta: -1,
    });
    expect(entry.detailLabel).toBe('林老师 · 正常上课');
  });

  it('distinguishes a known zero grant from missing history without falling back to remaining hours', () => {
    const model = buildParentHoursPageModel({
      ...hoursView, grantedPaidHours: 0, grantedGiftHours: null,
    }, 'all');
    expect(model.hourCards).toEqual([
      expect.objectContaining({ grantedLabel: '0', hasKnownGrant: true, remaining: 10 }),
      expect.objectContaining({ grantedLabel: '待核对', hasKnownGrant: false, remaining: 8 }),
    ]);
  });

  it('accepts only the three supported page filters', () => {
    expect(normalizeParentHoursFilter('debit')).toBe('debit');
    expect(normalizeParentHoursFilter('credit')).toBe('credit');
    expect(normalizeParentHoursFilter('unknown')).toBe('all');
    expect(normalizeParentHoursFilter(undefined)).toBe('all');
  });
});
