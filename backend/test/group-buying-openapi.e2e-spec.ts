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
  security?: Array<Record<string, string[]>>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const parentReads = [
  ['/parents/me/group-campaigns', 'get'],
  ['/parents/me/group-campaigns/{campaignId}', 'get'],
  ['/parents/me/group-orders', 'get'],
] as const;

const promotionReads = [
  ['/teachers/me/group-campaigns', 'get'],
  ['/teachers/me/group-campaigns/{campaignId}', 'get'],
  ['/partners/me/group-campaigns', 'get'],
  ['/partners/me/group-campaigns/{campaignId}', 'get'],
] as const;

const parentWrites = [
  ['/parents/me/group-teams', 'post'],
  ['/parents/me/group-teams/{teamId}/members', 'post'],
  ['/parents/me/group-members/{memberId}/prepay', 'post'],
  ['/parents/me/group-members/{memberId}/mock-payment-confirmation', 'post'],
] as const;

const managementReads = [
  ['/management/group-campaigns', 'get'],
  ['/management/group-orders', 'get'],
] as const;

const managementWrites = [
  ['/management/group-campaigns', 'post'],
  ['/management/group-campaigns/{campaignId}', 'patch'],
  ['/management/group-campaigns/{campaignId}/activate', 'post'],
  ['/management/group-campaigns/{campaignId}/close', 'post'],
  ['/management/group-campaigns/{campaignId}/cancel', 'post'],
  ['/management/group-orders/{orderId}/refund', 'post'],
] as const;

function loadContract(): OpenApiDocument {
  const contractPath = path.resolve(__dirname, '../../contracts/openapi.yaml');
  return loadYaml(fs.readFileSync(contractPath, 'utf8')) as OpenApiDocument;
}

function hasParameter(operation: OpenApiOperation, name: string): boolean {
  return (operation.parameters ?? []).some(
    (parameter) =>
      parameter.name === name || parameter.$ref?.endsWith(`/${name}`),
  );
}

describe('group buying OpenAPI and permission contract', () => {
  const document = loadContract();

  it.each([...parentReads, ...promotionReads, ...managementReads])(
    'declares %s %s',
    (route, method) => {
      expect(document.paths[route]?.[method]).toBeDefined();
    },
  );

  it.each([...parentWrites, ...managementWrites])(
    'requires idempotency for %s %s',
    (route, method) => {
      const operation = document.paths[route]?.[method];
      expect(operation).toBeDefined();
      expect(hasParameter(operation, 'IdempotencyKey')).toBe(true);
    },
  );

  it('keeps pagination on collection reads', () => {
    for (const route of [
      '/parents/me/group-campaigns',
      '/parents/me/group-orders',
      '/teachers/me/group-campaigns',
      '/partners/me/group-campaigns',
      '/management/group-campaigns',
      '/management/group-orders',
    ]) {
      const operation = document.paths[route]?.get;
      expect(hasParameter(operation, 'Page')).toBe(true);
      expect(hasParameter(operation, 'PageSize')).toBe(true);
    }
  });

  it('exposes the signed payment notification without bearer auth', () => {
    expect(
      document.paths['/payments/wechat/notifications']?.post?.security,
    ).toEqual([]);
  });

  it('separates staff promotion reads from parent and management actions', () => {
    expect(ROLE_PERMISSION_MATRIX.PARENT).toEqual(
      expect.arrayContaining([
        'PARENT_GROUP_CAMPAIGN_READ',
        'PARENT_GROUP_ORDER_READ_OWN',
        'PARENT_GROUP_JOIN',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toEqual(
      expect.arrayContaining([
        'GROUP_CAMPAIGN_MANAGE',
        'GROUP_ORDER_READ',
        'GROUP_REFUND_MANAGE',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.TEACHER).toContain(
      'TEACHER_GROUP_CAMPAIGN_READ',
    );
    expect(ROLE_PERMISSION_MATRIX.PARTNER).toContain(
      'PARTNER_GROUP_CAMPAIGN_READ',
    );
    for (const role of ['PARTNER', 'TEACHER', 'CAMPUS_MANAGER'] as const) {
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain(
        'GROUP_CAMPAIGN_MANAGE',
      );
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain('PARENT_GROUP_JOIN');
    }
  });
});
