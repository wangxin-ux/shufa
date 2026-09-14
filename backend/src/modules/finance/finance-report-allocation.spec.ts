import { allocateLessonConsumptionAmounts } from './finance-report-allocation';

const at = (day: number) =>
  new Date(`2026-09-${String(day).padStart(2, '0')}T08:00:00+08:00`);

describe('finance lesson-consumption amount allocation', () => {
  it('uses cumulative half-up differences and keeps reversals tied to the original row', () => {
    const result = allocateLessonConsumptionAmounts([
      {
        id: 'consume-1',
        coursePackageId: 'package-1',
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        reversalOfId: null,
        createdAt: at(1),
        issuance: { originalAmountFen: 10000, initialMainUnits: 300 },
      },
      {
        id: 'consume-2',
        coursePackageId: 'package-1',
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        reversalOfId: null,
        createdAt: at(2),
        issuance: { originalAmountFen: 10000, initialMainUnits: 300 },
      },
      {
        id: 'reverse-1',
        coursePackageId: 'package-1',
        entryType: 'REVERSAL',
        bucket: 'MAIN',
        deltaUnits: 100,
        reversalOfId: 'consume-1',
        createdAt: at(3),
        issuance: { originalAmountFen: 10000, initialMainUnits: 300 },
      },
      {
        id: 'consume-3',
        coursePackageId: 'package-1',
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        reversalOfId: null,
        createdAt: at(4),
        issuance: { originalAmountFen: 10000, initialMainUnits: 300 },
      },
      {
        id: 'consume-4',
        coursePackageId: 'package-1',
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        reversalOfId: null,
        createdAt: at(5),
        issuance: { originalAmountFen: 10000, initialMainUnits: 300 },
      },
    ]);

    expect([...result.entries()]).toEqual([
      ['consume-1', { amountFen: 3333, amountStatus: 'KNOWN' }],
      ['consume-2', { amountFen: 3334, amountStatus: 'KNOWN' }],
      ['reverse-1', { amountFen: -3333, amountStatus: 'KNOWN' }],
      ['consume-3', { amountFen: 3333, amountStatus: 'KNOWN' }],
      ['consume-4', { amountFen: 3333, amountStatus: 'KNOWN' }],
    ]);
  });

  it('keeps gifts zero-valued with a snapshot and marks every historical bucket without one pending', () => {
    const result = allocateLessonConsumptionAmounts([
      {
        id: 'gift-known',
        coursePackageId: 'package-known',
        entryType: 'CONSUME',
        bucket: 'GIFT',
        deltaUnits: -100,
        reversalOfId: null,
        createdAt: at(1),
        issuance: { originalAmountFen: 10000, initialMainUnits: 300 },
      },
      {
        id: 'main-pending',
        coursePackageId: 'package-old',
        entryType: 'CONSUME',
        bucket: 'MAIN',
        deltaUnits: -100,
        reversalOfId: null,
        createdAt: at(1),
        issuance: null,
      },
      {
        id: 'gift-pending',
        coursePackageId: 'package-old',
        entryType: 'CONSUME',
        bucket: 'GIFT',
        deltaUnits: -100,
        reversalOfId: null,
        createdAt: at(2),
        issuance: null,
      },
    ]);

    expect(result.get('gift-known')).toEqual({
      amountFen: 0,
      amountStatus: 'KNOWN',
    });
    expect(result.get('main-pending')).toEqual({
      amountFen: null,
      amountStatus: 'PENDING_CHECK',
    });
    expect(result.get('gift-pending')).toEqual({
      amountFen: null,
      amountStatus: 'PENDING_CHECK',
    });
  });
});
