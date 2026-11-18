import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { createAccountValidator } from './operator-pdf-test-account-contract';
import type {
  OperatorEarningSummary,
  OperatorEarningEntries,
} from '../../../frontend/pages/operator/runtime/types/operator-earning';

export function createMainReadValidator(root: string) {
  const dependencies = createRequire(
    createRequire(
      createRequire(__filename).resolve('@nestjs/cli/package.json'),
    ).resolve('@angular-devkit/core'),
  );
  type Validate = ((value: unknown) => boolean) & { errors: unknown };
  const { default: Ajv } = dependencies('ajv/dist/2020') as {
    default: new (options: object) => {
      addSchema(value: unknown, id: string): void;
      getSchema(ref: string): Validate;
    };
  };
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  (dependencies('ajv-formats') as (value: typeof ajv) => void)(ajv);
  const base = 'https://education.invalid/e01-e02/';
  for (const name of ['openapi.yaml', 'operator-earnings.openapi.yaml'])
    ajv.addSchema(
      load(readFileSync(resolve(root, 'contracts', name), 'utf8')),
      base + name,
    );
  function read<T>(section: string, value: unknown) {
    const validate = ajv.getSchema(
      `${base}operator-earnings.openapi.yaml#/${section}/get/responses/200/content/application~1json/schema`,
    );
    const before = JSON.stringify(value);
    if (!validate(value))
      throw new Error(
        `E02 response schema: ${JSON.stringify(validate.errors)}`,
      );
    if (JSON.stringify(value) !== before)
      throw new Error('E02 response schema mutated input');
    return (value as { data: T }).data;
  }
  return {
    ...createAccountValidator(root),
    earningSummary: (value: unknown) =>
      read<OperatorEarningSummary>('summary', value),
    earningEntries: (value: unknown) =>
      read<OperatorEarningEntries>('entries', value),
  };
}
