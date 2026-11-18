import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

const path = resolve(
  __dirname,
  '../../contracts/operator-rankings.openapi.yaml',
);

describe('operator minimal monthly ranking contract', () => {
  it('registers a dedicated endpoint in the authoritative API', () => {
    const main = load(
      readFileSync(resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8'),
    ) as { paths: Record<string, unknown> };
    expect(main.paths['/operators/me/rankings']).toEqual({
      $ref: './operator-rankings.openapi.yaml#/rankings',
    });
    expect(existsSync(path)).toBe(true);
  });

  it('accepts exact projections and rejects undeclared or missing fields', () => {
    const dependencies = createRequire(
      createRequire(
        createRequire(__filename).resolve('@nestjs/cli/package.json'),
      ).resolve('@angular-devkit/core'),
    );
    type Validate = ((value: unknown) => boolean) & { errors: unknown };
    const { default: Ajv } = dependencies('ajv/dist/2020') as {
      default: new (options: object) => {
        addSchema(schema: unknown, id: string): void;
        getSchema(ref: string): Validate;
      };
    };
    const validator = new Ajv({ strict: false, allErrors: true });
    (dependencies('ajv-formats') as (value: typeof validator) => void)(
      validator,
    );
    const id =
      'https://education.invalid/contracts/operator-rankings.openapi.yaml';
    validator.addSchema(load(readFileSync(path, 'utf8')), id);
    const validate = validator.getSchema(`${id}#/schemas/RankingPage`);
    const row = {
      campusName: 'Synthetic campus',
      rank: 1,
      rankDelta: null,
      isOwnCampus: true,
    };
    const page = {
      metric: 'STUDENTS',
      month: '2026-10',
      timezone: 'Asia/Shanghai',
      asOf: '2026-10-28T08:00:00.000Z',
      calculationVersion: 'monthly-rankings-2026-10-15-v1',
      availability: 'LIVE',
      unavailableReason: null,
      revisionId: '030d5faa-4055-4a7c-9a6e-bf22a5f34099',
      data: [row],
      ownCampus: row,
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    };
    expect({ valid: validate(page), errors: validate.errors }).toEqual({
      valid: true,
      errors: null,
    });
    for (const name of [
      'campusId',
      'previousRank',
      'value',
      'amountFen',
      'studentCount',
    ])
      expect(validate({ ...page, data: [{ ...row, [name]: 1 }] })).toBe(false);
    for (const name of Object.keys(row)) {
      const missing: Record<string, unknown> = { ...row };
      delete missing[name];
      expect(validate({ ...page, ownCampus: missing })).toBe(false);
    }
    expect(validate({ ...page, month: '0000-10' })).toBe(false);
    expect(
      validate({ ...page, revisionId: '030d5faa-4055-1a7c-9a6e-bf22a5f34099' }),
    ).toBe(false);
    expect(
      validate({
        ...page,
        availability: 'UNAVAILABLE',
        unavailableReason: 'HISTORY_UNAVAILABLE',
        revisionId: null,
        data: [],
        ownCampus: null,
        meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      }),
    ).toBe(true);
  });
});
