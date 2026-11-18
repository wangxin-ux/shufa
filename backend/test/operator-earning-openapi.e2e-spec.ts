import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { load } from 'js-yaml';

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
  for (const file of ['openapi.yaml', 'operator-earnings.openapi.yaml'])
    ajv.addSchema(
      load(readFileSync(resolve(__dirname, '../../contracts', file), 'utf8')),
      `${base}${file}`,
    );
  return ajv.getSchema(
    `${base}operator-earnings.openapi.yaml#/schemas/${name}`,
  );
}

describe('operator earning contract registration', () => {
  it('registers two independent operator reads', () => {
    const main = load(
      readFileSync(resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8'),
    ) as { paths: Record<string, unknown> };
    expect(main.paths['/operators/me/earnings/summary']).toEqual({
      $ref: './operator-earnings.openapi.yaml#/summary',
    });
    expect(main.paths['/operators/me/earnings']).toEqual({
      $ref: './operator-earnings.openapi.yaml#/entries',
    });
  });

  it('keeps unknown totals separate from zero and rejects leaked financial fields', () => {
    const validate = validator('Summary');
    const summary = {
      estimatedTotalFen: null,
      pendingReviewFen: 0,
      currency: 'CNY',
      serverTime: '2026-10-29T01:00:00+08:00',
      timezone: 'Asia/Shanghai',
    };
    expect({ valid: validate(summary), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
    for (const key of Object.keys(summary)) {
      const missing: Record<string, unknown> = { ...summary };
      delete missing[key];
      expect(validate(missing)).toBe(false);
    }
    for (const key of [
      'unitPriceFen',
      'shareBasisPoints',
      'availableFen',
      'campusId',
    ])
      expect(validate({ ...summary, [key]: 100 })).toBe(false);
    for (const amount of [0.1, Number.MAX_SAFE_INTEGER + 1, '0'])
      expect(validate({ ...summary, estimatedTotalFen: amount })).toBe(false);
  });

  it('accepts only minimal signed journal rows and bounded pages', () => {
    const validate = validator('Entries');
    const row = {
      id: '9480f230-ffb1-4298-a013-c8af1cc8011d',
      entryType: 'REVERSAL',
      status: 'REVERSED',
      amountFen: -1200,
      createdAt: '2026-10-29T00:00:00Z',
      completedAt: '2026-10-28T00:00:00Z',
    };
    const page = {
      data: [row],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      serverTime: '2026-10-29T01:00:00+08:00',
      timezone: 'Asia/Shanghai',
    };
    expect({ valid: validate(page), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
    for (const key of Object.keys(row)) {
      const missing: Record<string, unknown> = { ...row };
      delete missing[key];
      expect(validate({ ...page, data: [missing] })).toBe(false);
    }
    for (const key of [
      'teacherName',
      'actualAttendeeCount',
      'reviewReason',
      'ruleSnapshot',
    ])
      expect(validate({ ...page, data: [{ ...row, [key]: 'private' }] })).toBe(
        false,
      );
    for (const delta of [
      { amountFen: 0 },
      { amountFen: 100 },
      { status: 'AVAILABLE' },
      { amountFen: Number.MIN_SAFE_INTEGER - 1 },
      { entryType: 'OTHER' },
    ])
      expect(validate({ ...page, data: [{ ...row, ...delta }] })).toBe(false);
    expect(validate({ ...page, meta: { ...page.meta, pageSize: 101 } })).toBe(
      false,
    );
  });
});
