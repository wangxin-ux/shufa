import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';

interface OpenApiOperation {
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ $ref?: string }>;
  responses?: Record<string, unknown>;
}

interface OpenApiSchema {
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  type?: string;
  maxItems?: number;
  items?: OpenApiSchema;
  $ref?: string;
}

interface OpenApiDocument {
  security?: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: { schemas: Record<string, OpenApiSchema> };
}

const parentOperations = {
  '/parents/me/campuses': ['get'],
  '/parents/me/home': ['get'],
  '/parents/me/hours': ['get'],
  '/parents/me/leave': ['get'],
  '/parents/me/leave-requests': ['post'],
  '/parents/me/profile': ['get', 'put'],
  '/parents/me/updates': ['get'],
} as const;

function loadContract(): OpenApiDocument {
  const contractPath = path.resolve(__dirname, '../../contracts/openapi.yaml');
  return loadYaml(fs.readFileSync(contractPath, 'utf8')) as OpenApiDocument;
}

describe('parent OpenAPI contract', () => {
  const document = loadContract();

  it.each(Object.entries(parentOperations))(
    'declares the parent operation for %s',
    (route, methods) => {
      expect(document.paths[route]).toBeDefined();
      for (const method of methods) {
        expect(document.paths[route][method]).toBeDefined();
      }
    },
  );

  it('protects every parent operation with bearer authentication', () => {
    for (const [route, methods] of Object.entries(parentOperations)) {
      for (const method of methods) {
        const operation = document.paths[route][method];
        const security = operation.security ?? document.security ?? [];
        expect(
          security.some((item) =>
            Object.prototype.hasOwnProperty.call(item, 'bearerAuth'),
          ),
        ).toBe(true);
        expect(operation.responses).toHaveProperty('401');
        expect(operation.responses).toHaveProperty('403');
      }
    }
  });

  it('requires idempotency and conflict handling for leave submission', () => {
    const operation = document.paths['/parents/me/leave-requests'].post;
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $ref: '#/components/parameters/IdempotencyKey',
        }),
      ]),
    );
    expect(operation.responses).toHaveProperty('409');
  });

  it('requires an idempotency key and version conflict handling for profile updates', () => {
    const operation = document.paths['/parents/me/profile'].put;
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $ref: '#/components/parameters/IdempotencyKey',
        }),
      ]),
    );
    expect(operation.responses).toHaveProperty('400');
    expect(operation.responses).toHaveProperty('409');
  });

  it('exposes editable age, address, and version fields only in the profile contract', () => {
    const student = document.components.schemas.ParentProfileStudentView;
    expect(student.required).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'age',
        'homeAddress',
        'profileVersion',
      ]),
    );
    expect(student.properties?.age).toMatchObject({
      type: 'integer',
      minimum: 0,
      maximum: 120,
    });
    expect(student.properties?.homeAddress).toMatchObject({
      type: ['string', 'null'],
      maxLength: 300,
    });

    const request = document.components.schemas.ParentProfileUpdateRequest;
    expect(request.required).toEqual(
      expect.arrayContaining(['age', 'homeAddress', 'expectedVersion']),
    );
  });

  it('keeps nullable manager review metadata in every parent leave record', () => {
    const schema = document.components.schemas.ParentLeaveRecordView;
    expect(schema.required).toEqual(
      expect.arrayContaining(['reviewerName', 'reviewedAt', 'reviewReason']),
    );
    expect(schema.properties).toEqual(
      expect.objectContaining({
        reviewerName: expect.any(Object) as unknown,
        reviewedAt: expect.any(Object) as unknown,
        reviewReason: expect.any(Object) as unknown,
      }),
    );
  });

  it.each([
    'ParentHomeView',
    'ParentCampusMapView',
    'ParentHoursView',
    'ParentLeavePageView',
    'ParentLeaveRecordView',
    'ParentProfileStudentView',
    'ParentProfileUpdateRequest',
    'ParentProfileView',
    'ParentUpdatesView',
  ])('declares schema %s', (schemaName) => {
    expect(document.components.schemas[schemaName]).toBeDefined();
  });

  it('returns bounded feedback images in parent classroom updates', () => {
    const schema = document.components.schemas.ParentUpdateRecordView;
    expect(schema.required).toEqual(expect.arrayContaining(['feedbackImages']));
    expect(schema.properties?.feedbackImages).toMatchObject({
      type: 'array',
      maxItems: 3,
      items: { $ref: '#/components/schemas/FeedbackImageView' },
    });
  });
});
