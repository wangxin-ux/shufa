import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

interface OpenApiSchema {
  $ref?: string;
}

interface OpenApiOperation {
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ $ref?: string }>;
  requestBody?: {
    content?: { 'application/json'?: { schema?: OpenApiSchema } };
  };
  responses?: Record<string, unknown>;
}

interface OpenApiDocument {
  security?: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const operations = {
  '/partners/me/earnings/summary': ['get'],
  '/partners/me/earnings': ['get'],
  '/partners/me/earning-rule': ['get'],
  '/management/partner-earning-rules': ['get', 'post'],
  '/management/partner-earning-rules/{ruleId}/activate': ['post'],
  '/management/partner-earning-rules/{ruleId}/retire': ['post'],
  '/management/partner-earnings': ['get'],
  '/management/partner-earnings/{entryId}/approve': ['post'],
  '/management/partner-earnings/{entryId}/reject': ['post'],
} as const;

const mutations = [
  ['/management/partner-earning-rules', 'post', 'CreatePartnerEarningRuleRequest'],
  [
    '/management/partner-earning-rules/{ruleId}/activate',
    'post',
    'VersionedActionRequest',
  ],
  [
    '/management/partner-earning-rules/{ruleId}/retire',
    'post',
    'VersionedActionRequest',
  ],
  [
    '/management/partner-earnings/{entryId}/approve',
    'post',
    'VersionedActionRequest',
  ],
  [
    '/management/partner-earnings/{entryId}/reject',
    'post',
    'ReasonedActionRequest',
  ],
] as const;

function loadContract(): OpenApiDocument {
  const contractPath = path.resolve(__dirname, '../../contracts/openapi.yaml');
  return loadYaml(fs.readFileSync(contractPath, 'utf8')) as OpenApiDocument;
}

function hasBearerSecurity(
  document: OpenApiDocument,
  operation: OpenApiOperation,
): boolean {
  return (operation.security ?? document.security ?? []).some((item) =>
    Object.prototype.hasOwnProperty.call(item, 'bearerAuth'),
  );
}

describe('partner earnings OpenAPI and permission contract', () => {
  const document = loadContract();

  it.each(Object.entries(operations))(
    'declares and protects %s',
    (route, methods) => {
      expect(document.paths[route]).toBeDefined();
      for (const method of methods) {
        const operation = document.paths[route][method];
        expect(operation).toBeDefined();
        expect(hasBearerSecurity(document, operation)).toBe(true);
      }
    },
  );

  it.each(mutations)(
    'requires idempotency, versioned request data, and conflict response for %s',
    (route, method, schemaName) => {
      const operation = document.paths[route][method];
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            $ref: '#/components/parameters/IdempotencyKey',
          }),
        ]),
      );
      expect(
        operation.requestBody?.content?.['application/json']?.schema,
      ).toEqual({ $ref: `#/components/schemas/${schemaName}` });
      expect(operation.responses).toHaveProperty('409');
    },
  );

  it('keeps partner reads scoped and management permissions super-admin-only', () => {
    expect(ROLE_PERMISSION_MATRIX.PARTNER).toContain('PARTNER_EARNING_READ');
    expect(ROLE_PERMISSION_MATRIX.PARTNER).not.toEqual(
      expect.arrayContaining([
        'PARTNER_EARNING_RULE_MANAGE',
        'PARTNER_EARNING_REVIEW',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toEqual(
      expect.arrayContaining([
        'PARTNER_EARNING_RULE_MANAGE',
        'PARTNER_EARNING_REVIEW',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).not.toEqual(
      expect.arrayContaining([
        'PARTNER_EARNING_READ',
        'PARTNER_EARNING_RULE_MANAGE',
        'PARTNER_EARNING_REVIEW',
      ]),
    );
  });
});
