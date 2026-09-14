import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';

interface OpenApiSchema {
  $ref?: string;
  allOf?: OpenApiSchema[];
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
  components: { schemas: Record<string, OpenApiSchema> };
}

const operations = {
  '/campus-managers/me/dashboard': ['get'],
  '/campus-managers/me/profile': ['get'],
  '/campus-managers/me/students': ['get', 'post'],
  '/campus-managers/me/students/{studentId}': ['get'],
  '/campus-managers/me/scheduling-options': ['get'],
  '/campus-managers/me/lesson-sessions': ['get', 'post'],
  '/campus-managers/me/lesson-sessions/{lessonSessionId}': ['patch'],
  '/campus-managers/me/lesson-sessions/{lessonSessionId}/cancel': ['post'],
  '/campus-managers/me/leave-requests': ['get'],
  '/campus-managers/me/leave-requests/{leaveRequestId}/approve': ['post'],
  '/campus-managers/me/leave-requests/{leaveRequestId}/reject': ['post'],
  '/campus-managers/me/warnings': ['get'],
  '/campus-managers/me/campus': ['get', 'patch'],
} as const;

const mutationOperations = [
  ['/campus-managers/me/students', 'post'],
  ['/campus-managers/me/lesson-sessions', 'post'],
  ['/campus-managers/me/lesson-sessions/{lessonSessionId}', 'patch'],
  ['/campus-managers/me/lesson-sessions/{lessonSessionId}/cancel', 'post'],
  ['/campus-managers/me/leave-requests/{leaveRequestId}/approve', 'post'],
  ['/campus-managers/me/leave-requests/{leaveRequestId}/reject', 'post'],
  ['/campus-managers/me/campus', 'patch'],
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

describe('campus manager OpenAPI contract', () => {
  const document = loadContract();

  it.each(Object.entries(operations))(
    'declares every campus manager operation for %s',
    (route, methods) => {
      expect(document.paths[route]).toBeDefined();
      for (const method of methods) {
        const operation = document.paths[route][method];
        expect(operation).toBeDefined();
        expect(hasBearerSecurity(document, operation)).toBe(true);
      }
    },
  );

  it('requires idempotency and conflict responses for every mutation', () => {
    for (const [route, method] of mutationOperations) {
      const operation = document.paths[route][method];
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            $ref: '#/components/parameters/IdempotencyKey',
          }),
        ]),
      );
      expect(operation.responses).toHaveProperty('409');
    }
  });

  it('uses versioned requests for schedule, review, and campus updates', () => {
    const versioned = mutationOperations.slice(2);
    for (const [route, method] of versioned) {
      const schema =
        document.paths[route][method].requestBody?.content?.['application/json']
          ?.schema;
      expect(JSON.stringify(schema)).toMatch(/version/i);
    }
  });
});
