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
}

interface OpenApiDocument {
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const parentReads = [
  ['/parents/me/course-products', 'get'],
  ['/parents/me/course-products/{courseProductId}', 'get'],
  ['/parents/me/enrollment-orders', 'get'],
  ['/parents/me/enrollment-orders/{orderId}', 'get'],
] as const;

const parentMutations = [
  ['/parents/me/enrollment-orders', 'post'],
  ['/parents/me/enrollment-orders/{orderId}/payment-proofs', 'post'],
  ['/parents/me/enrollment-orders/{orderId}/cancel', 'post'],
] as const;

const managementReads = [
  ['/management/course-products', 'get'],
  ['/management/enrollment-orders', 'get'],
  ['/management/enrollment-orders/{orderId}', 'get'],
] as const;

const managementMutations = [
  ['/management/course-products', 'post'],
  ['/management/course-products/{courseProductId}', 'patch'],
  ['/management/course-products/{courseProductId}/activate', 'post'],
  ['/management/course-products/{courseProductId}/retire', 'post'],
  ['/management/enrollment-orders/{orderId}/approve', 'post'],
  ['/management/enrollment-orders/{orderId}/reject', 'post'],
  ['/management/enrollment-orders/{orderId}/void', 'post'],
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

describe('course mall OpenAPI and permission contract', () => {
  const document = loadContract();

  it.each([...parentReads, ...managementReads])(
    'declares %s %s',
    (route, method) => {
      expect(document.paths[route]?.[method]).toBeDefined();
    },
  );

  it.each([...parentMutations, ...managementMutations])(
    'requires idempotency for %s %s',
    (route, method) => {
      const operation = document.paths[route]?.[method];
      expect(operation).toBeDefined();
      expect(hasParameter(operation, 'IdempotencyKey')).toBe(true);
    },
  );

  it('keeps pagination on all collection reads', () => {
    for (const route of [
      '/parents/me/course-products',
      '/parents/me/enrollment-orders',
      '/management/course-products',
      '/management/enrollment-orders',
    ]) {
      const operation = document.paths[route]?.get;
      expect(hasParameter(operation, 'Page')).toBe(true);
      expect(hasParameter(operation, 'PageSize')).toBe(true);
    }
  });

  it('keeps enrollment and finance oversight permissions on separate roles', () => {
    expect(ROLE_PERMISSION_MATRIX.PARENT).toEqual(
      expect.arrayContaining([
        'PARENT_COURSE_PRODUCT_READ',
        'PARENT_ENROLLMENT_ORDER_CREATE',
        'PARENT_ENROLLMENT_ORDER_READ_OWN',
        'PARENT_PAYMENT_PROOF_UPLOAD_OWN',
        'PARENT_ENROLLMENT_ORDER_CANCEL_OWN',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toEqual(
      expect.arrayContaining([
        'COURSE_PRODUCT_MANAGE',
        'ENROLLMENT_ORDER_REVIEW',
        'ENROLLMENT_ORDER_VOID',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.PARENT).not.toContain(
      'FINANCE_OVERSIGHT_READ',
    );
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).not.toContain(
      'FINANCE_OVERSIGHT_READ',
    );
    expect(ROLE_PERMISSION_MATRIX.FINANCE).toEqual(
      expect.arrayContaining([
        'FINANCE_OVERSIGHT_READ',
        'FINANCE_OVERSIGHT_EXPORT',
      ]),
    );
  });
});
