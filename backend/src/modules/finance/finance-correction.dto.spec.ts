import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateFinanceCorrectionDto } from './finance-correction.dto';

const replacement = {
  campusId: '00000000-0000-4000-8000-000000000001',
  studentId: '00000000-0000-4000-8000-000000000002',
  amountFen: 100000,
  receivedOn: '2026-09-01',
  channel: 'BANK',
  proofFileId: '00000000-0000-4000-8000-000000000003',
  note: '更正后的收款',
  package: {
    name: '更正课包',
    mainUnits: 1000,
    giftUnits: 100,
    validFrom: '2026-09-01T00:00:00+08:00',
    expiresAt: null,
  },
};

function errors(input: object) {
  return validateSync(plainToInstance(CreateFinanceCorrectionDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('finance correction DTO', () => {
  it('rejects REPLACE when replacement.package is missing', () => {
    const withoutPackage: Partial<typeof replacement> = { ...replacement };
    delete withoutPackage.package;

    expect(
      errors({
        type: 'REPLACE',
        reason: '更正金额和课包',
        replacement: withoutPackage,
      }),
    ).not.toHaveLength(0);
  });

  it('accepts a complete REPLACE request', () => {
    expect(
      errors({
        type: 'REPLACE',
        reason: '更正金额和课包',
        replacement,
      }),
    ).toHaveLength(0);
  });
});
