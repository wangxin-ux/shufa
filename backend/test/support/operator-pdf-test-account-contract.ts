import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import type {
  OperatorAccount,
  OperatorAccountSubjects,
} from '../../../frontend/pages/operator/runtime/types/operator-account';

export function createAccountValidator(root: string) {
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
  (dependencies('ajv-formats') as (validator: typeof ajv) => void)(ajv);
  const base = 'https://education.invalid/e01/';
  for (const name of ['openapi.yaml', 'operator-account.openapi.yaml']) {
    ajv.addSchema(
      load(readFileSync(resolve(root, 'contracts', name), 'utf8')),
      base + name,
    );
  }
  function read<T>(section: string, body: unknown): T {
    const validate = ajv.getSchema(
      `${base}operator-account.openapi.yaml#/${section}/get/responses/200/content/application~1json/schema`,
    );
    const original = JSON.stringify(body);
    const valid = validate(body);
    if (JSON.stringify(body) !== original)
      throw new Error('E01 schema mutated response');
    if (!valid)
      throw new Error(
        `E01 response schema: ${JSON.stringify(validate.errors)}`,
      );
    return (body as { data: T }).data;
  }
  return {
    account: (body: unknown) => read<OperatorAccount>('account', body),
    subjects: (body: unknown) =>
      read<OperatorAccountSubjects>('subjects', body),
  };
}
