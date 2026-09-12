import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { ManagementLessonLedgerQueryDto } from './management.dto';

describe('management lesson ledger query DTO', () => {
  it.each(['GRANT', 'REFUND', 'CORRECTION'] as const)(
    'accepts the %s entry type',
    (entryType) => {
      const query = new ManagementLessonLedgerQueryDto();
      query.entryType = entryType;

      expect(validateSync(query)).toHaveLength(0);
    },
  );

  it('rejects unknown entry types', () => {
    const query = new ManagementLessonLedgerQueryDto();
    query.entryType = 'UNKNOWN' as never;

    expect(validateSync(query)).not.toHaveLength(0);
  });
});
