import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

describe('independent operator read-only teacher archive contract', () => {
  const main = load(
    readFileSync(resolve(__dirname, '../../contracts/openapi.yaml'), 'utf8'),
  ) as { paths: Record<string, { $ref?: string }> };

  it.each([
    ['/operators/me/teacher-archives', 'list'],
    ['/operators/me/teacher-archives/{teacherId}/performance', 'performance'],
    [
      '/operators/me/teacher-archives/{teacherId}/evaluation-history',
      'history',
    ],
  ])('registers %s in the authoritative API', (path, anchor) => {
    expect(main.paths[path]).toEqual({
      $ref: `./operator-teacher-archive.openapi.yaml#/${anchor}`,
    });
  });

  it('grants the independent read permission without granting evaluation writes', () => {
    expect(ROLE_PERMISSION_MATRIX.OPERATOR).toContain('OPERATOR_TEACHER_READ');
    expect(ROLE_PERMISSION_MATRIX.OPERATOR).not.toContain(
      'PARTNER_TEACHER_EVALUATE',
    );
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).not.toContain(
      'OPERATOR_TEACHER_READ',
    );
    expect(ROLE_PERMISSION_MATRIX.PARENT).not.toContain(
      'OPERATOR_TEACHER_READ',
    );
  });

  it('defines only GET operations and closed response projections', () => {
    const path = resolve(
      __dirname,
      '../../contracts/operator-teacher-archive.openapi.yaml',
    );
    expect(existsSync(path)).toBe(true);
    const contract = load(readFileSync(path, 'utf8')) as {
      schemas: Record<string, { additionalProperties: boolean }>;
    } & Record<string, unknown>;
    for (const name of ['list', 'performance', 'history']) {
      expect(Object.keys(contract[name] as object)).toEqual(['get']);
    }
    for (const schema of Object.values(contract.schemas)) {
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
