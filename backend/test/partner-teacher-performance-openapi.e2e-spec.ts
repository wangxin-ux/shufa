import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';

describe('partner teacher performance contract', () => {
  const main = load(
    readFileSync(resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8'),
  ) as {
    paths: Record<string, { $ref?: string }>;
  };
  it.each([
    ['performance', 'performance'],
    ['evaluation', 'evaluation'],
    ['evaluation-history', 'history'],
  ])('registers the %s operation in the authoritative API', (path, anchor) => {
    expect(main.paths[`/partners/me/teachers/{teacherId}/${path}`]).toEqual({
      $ref: `./partner-teacher-performance.openapi.yaml#/${anchor}`,
    });
  });
});
