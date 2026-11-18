import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const root = resolve(__dirname, '../../contracts');
const mainPath = resolve(root, 'openapi.yaml');
const contractPath = resolve(root, 'operator-account.openapi.yaml');
type Validate = ((value: unknown) => boolean) & { errors: unknown };

function validator(name: string) {
  const dependencies = createRequire(
    createRequire(
      createRequire(__filename).resolve('@nestjs/cli/package.json'),
    ).resolve('@angular-devkit/core'),
  );
  const { default: Ajv } = dependencies('ajv/dist/2020') as {
    default: new (options: object) => {
      addSchema(schema: unknown, id: string): void;
      getSchema(ref: string): Validate;
    };
  };
  const ajv = new Ajv({ strict: false, allErrors: true });
  (dependencies('ajv-formats') as (value: typeof ajv) => void)(ajv);
  const base = 'https://education.invalid/contracts/';
  ajv.addSchema(load(readFileSync(mainPath, 'utf8')), `${base}openapi.yaml`);
  ajv.addSchema(
    load(readFileSync(contractPath, 'utf8')),
    `${base}operator-account.openapi.yaml`,
  );
  return ajv.getSchema(`${base}operator-account.openapi.yaml#/schemas/${name}`);
}

describe('independent operator account contract', () => {
  it('registers only the two dedicated read routes in the main API', () => {
    const main = load(readFileSync(mainPath, 'utf8')) as {
      paths: Record<string, unknown>;
    };
    expect(main.paths['/operators/me/lesson-account']).toEqual({
      $ref: './operator-account.openapi.yaml#/account',
    });
    expect(main.paths['/operators/me/subjects']).toEqual({
      $ref: './operator-account.openapi.yaml#/subjects',
    });
  });

  it('requires nine reliable current values, nullable historical fields and exact rows', () => {
    const validate = validator('Account');
    const row = {
      id: '9480f230-ffb1-4298-a013-c8af1cc8011d',
      studentId: '530c99bb-23e9-48ca-bf2a-21d82a802f5d',
      studentName: 'Synthetic student',
      packageName: 'Synthetic package',
      subject: null,
      entryType: 'CONSUME',
      bucket: 'MAIN',
      deltaUnits: -100,
      balanceBeforeUnits: 200,
      balanceAfterUnits: 100,
      reason: null,
      createdAt: '2026-10-28T14:00:00.000Z',
      paymentContext: { receivedOn: '2026-10-01' },
      teachingContext: null,
    };
    const account = {
      mainBalanceUnits: 100,
      giftBalanceUnits: 0,
      totalBalanceUnits: 100,
      mainReservedUnits: 0,
      giftReservedUnits: 0,
      reservedTotalUnits: 0,
      mainAvailableUnits: 100,
      giftAvailableUnits: 0,
      availableTotalUnits: 100,
      enrollmentSummary: {
        receivedAmountFen: null,
        refundedAmountFen: 0,
        initialMainUnits: 200,
        initialGiftUnits: 0,
        pendingIssuanceCount: 0,
      },
      lessonActivityTotals: [
        'GRANT',
        'CONSUME',
        'REVERSAL',
        'ADJUSTMENT',
        'REFUND',
        'CORRECTION',
      ].map((entryType) => ({
        entryType,
        mainDeltaUnits: entryType === 'CONSUME' ? -100 : 0,
        giftDeltaUnits: null,
        totalDeltaUnits: null,
      })),
      items: [row],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      serverTime: '2026-10-28T14:00:00.000Z',
      timezone: 'Asia/Shanghai',
    };
    expect({ valid: validate(account), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
    for (const key of Object.keys(account)) {
      const missing: Record<string, unknown> = { ...account };
      delete missing[key];
      expect(validate(missing)).toBe(false);
    }
    for (const key of Object.keys(row)) {
      const missing: Record<string, unknown> = { ...row };
      delete missing[key];
      expect(validate({ ...account, items: [missing] })).toBe(false);
    }
    for (const key of ['phone', 'campusId', 'ruleSnapshot', 'proofFileId'])
      expect(
        validate({ ...account, items: [{ ...row, [key]: 'private' }] }),
      ).toBe(false);
    expect(validate({ ...account, mainBalanceUnits: null })).toBe(false);
    expect(
      validate({ ...account, mainBalanceUnits: Number.MAX_SAFE_INTEGER + 1 }),
    ).toBe(false);
    expect(
      validate({
        ...account,
        items: [
          {
            ...row,
            paymentContext: {
              receivedOn: '2026-10-01',
              paidAt: '2026-10-01T00:00:00Z',
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      validate({
        ...account,
        lessonActivityTotals: account.lessonActivityTotals.slice(1),
      }),
    ).toBe(false);
    const activity = validator('ActivityTotal');
    expect(
      activity({
        entryType: 'CONSUME',
        mainDeltaUnits: -9007199254740992,
        giftDeltaUnits: 0,
        totalDeltaUnits: null,
      }),
    ).toBe(false);
    expect(
      activity({
        entryType: 'ALL',
        mainDeltaUnits: 0,
        giftDeltaUnits: 0,
        totalDeltaUnits: 0,
      }),
    ).toBe(false);
  });

  it('requires a minimal subject directory with pagination, timezone and no private fields', () => {
    const validate = validator('Subjects');
    const page = {
      data: [
        {
          id: '91318488-932d-48d5-a447-6128146b698e',
          name: 'Archived',
          isActive: false,
          version: 2,
        },
      ],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      serverTime: '2026-10-28T14:00:00.000Z',
      timezone: 'Asia/Shanghai',
    };
    expect({ valid: validate(page), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
    expect(
      validate({
        ...page,
        data: [{ ...page.data[0], campusId: 'private', unitPriceFen: 100 }],
      }),
    ).toBe(false);
    expect(validate({ ...page, timezone: '' })).toBe(false);
    expect(validate({ ...page, meta: { ...page.meta, pageSize: 101 } })).toBe(
      false,
    );
  });
});
