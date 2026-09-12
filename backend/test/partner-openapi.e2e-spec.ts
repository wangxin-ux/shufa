import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';

interface OpenApiOperation {
  security?: Array<Record<string, string[]>>;
}

interface OpenApiDocument {
  security?: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const routes = [
  '/partners/me/dashboard',
  '/partners/me/profile',
  '/partners/me/students',
  '/partners/me/warnings',
  '/partners/me/attendance',
  '/partners/me/teachers',
  '/partners/me/lesson-account',
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

describe('partner OpenAPI contract', () => {
  const document = loadContract();

  it.each(routes)('declares the read-only partner route %s', (route) => {
    const pathItem = document.paths[route];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
    expect(hasBearerSecurity(document, pathItem.get)).toBe(true);
    expect(pathItem.post).toBeUndefined();
    expect(pathItem.put).toBeUndefined();
    expect(pathItem.patch).toBeUndefined();
    expect(pathItem.delete).toBeUndefined();
  });
});
