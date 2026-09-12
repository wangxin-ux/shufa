import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

interface ParameterRef {
  name?: string;
  $ref?: string;
}

interface OpenApiOperation {
  parameters?: ParameterRef[];
  requestBody?: unknown;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const contract = loadYaml(
  fs.readFileSync(
    path.resolve(__dirname, '../../contracts/openapi.yaml'),
    'utf8',
  ),
) as OpenApiDocument;

function hasParameter(operation: OpenApiOperation, name: string): boolean {
  return (operation.parameters ?? []).some(
    (parameter) =>
      parameter.name === name || parameter.$ref?.endsWith(`/${name}`),
  );
}

describe('roster exchange OpenAPI and permission contract', () => {
  it.each([
    ['/management/rosters/{kind}/template', 'get'],
    ['/management/rosters/{kind}/preview', 'post'],
    ['/management/rosters/{kind}/import', 'post'],
    ['/management/rosters/{kind}/entries', 'post'],
    ['/management/rosters/{kind}/export', 'get'],
    ['/management/rosters/teachers', 'get'],
    ['/campus-managers/me/rosters/{kind}/template', 'get'],
    ['/campus-managers/me/rosters/{kind}/preview', 'post'],
    ['/campus-managers/me/rosters/{kind}/import', 'post'],
    ['/campus-managers/me/rosters/{kind}/entries', 'post'],
    ['/campus-managers/me/rosters/{kind}/export', 'get'],
    ['/campus-managers/me/rosters/teachers', 'get'],
  ] as const)('declares %s %s', (route, method) => {
    expect(contract.paths[route]?.[method]).toBeDefined();
  });

  it('requires idempotency for quick entry and confirmation for full-phone export', () => {
    for (const prefix of ['/management', '/campus-managers/me']) {
      expect(
        hasParameter(
          contract.paths[`${prefix}/rosters/{kind}/entries`].post,
          'IdempotencyKey',
        ),
      ).toBe(true);
      expect(
        hasParameter(
          contract.paths[`${prefix}/rosters/{kind}/export`].get,
          'ConfirmedPhoneExport',
        ),
      ).toBe(true);
    }
  });

  it('keeps campus selection global and manager scope token-derived', () => {
    expect(
      hasParameter(
        contract.paths['/management/rosters/teachers'].get,
        'campusId',
      ),
    ).toBe(true);
    expect(
      hasParameter(
        contract.paths['/campus-managers/me/rosters/teachers'].get,
        'campusId',
      ),
    ).toBe(false);
    expect(
      hasParameter(
        contract.paths['/campus-managers/me/rosters/{kind}/export'].get,
        'campusId',
      ),
    ).toBe(false);
  });

  it('grants each roster permission only to its intended administrative role', () => {
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toEqual(
      expect.arrayContaining(['GLOBAL_ROSTER_MANAGE', 'GLOBAL_ROSTER_EXPORT']),
    );
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).toEqual(
      expect.arrayContaining(['CAMPUS_ROSTER_MANAGE', 'CAMPUS_ROSTER_EXPORT']),
    );
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).not.toContain(
      'GLOBAL_ROSTER_MANAGE',
    );
    for (const role of ['PARENT', 'TEACHER', 'PARTNER', 'OPERATOR'] as const) {
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain('GLOBAL_ROSTER_MANAGE');
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain('CAMPUS_ROSTER_MANAGE');
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain('GLOBAL_ROSTER_EXPORT');
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain('CAMPUS_ROSTER_EXPORT');
    }
  });
});
