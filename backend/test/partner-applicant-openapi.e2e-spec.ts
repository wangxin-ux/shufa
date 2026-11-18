import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';

interface Schema {
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
  $ref?: string;
}
interface Operation {
  security: Array<Record<string, string[]>>;
  responses: Record<
    string,
    { content?: { 'application/json': { schema: Schema } } }
  >;
  requestBody?: { content: { 'application/json': { schema: Schema } } };
}
interface ApplicantContract {
  login: { post: Operation };
  me: { get: Operation };
  logout: { post: Operation };
  schemas: Record<string, Schema>;
}
interface RootContract {
  paths: Record<string, { $ref: string }>;
  components: {
    securitySchemes: Record<string, { type: string; scheme: string }>;
  };
}

describe('restricted applicant OpenAPI contract', () => {
  const contracts = path.resolve(__dirname, '../../contracts');
  const root = load(
    fs.readFileSync(path.join(contracts, 'openapi.yaml'), 'utf8'),
  ) as RootContract;
  const document = load(
    fs.readFileSync(
      path.join(contracts, 'partner-applicants.openapi.yaml'),
      'utf8',
    ),
  ) as ApplicantContract;

  it('registers applicant routes with a separate restricted bearer scheme', () => {
    expect(root.paths['/partner-applicants/auth/wechat'].$ref).toBe(
      './partner-applicants.openapi.yaml#/login',
    );
    expect(root.paths['/partner-applicants/me'].$ref).toBe(
      './partner-applicants.openapi.yaml#/me',
    );
    expect(root.paths['/partner-applicants/auth/logout'].$ref).toBe(
      './partner-applicants.openapi.yaml#/logout',
    );
    expect(root.components.securitySchemes.partnerApplicantAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('accepts only the shared trusted code request without a formal bearer token', () => {
    expect(document.login.post.security).toEqual([]);
    expect(
      document.login.post.requestBody?.content['application/json'].schema.$ref,
    ).toBe('./openapi.yaml#/components/schemas/WechatLoginRequest');
  });

  it.each([document.me.get, document.logout.post])(
    'protects each private applicant operation %#',
    (operation) => {
      expect(operation.security).toEqual([{ partnerApplicantAuth: [] }]);
    },
  );

  it('returns a closed minimal identity without formal roles, scope or private material', () => {
    expect(document.schemas.Identity.additionalProperties).toBe(false);
    expect(document.schemas.Identity.required?.slice().sort()).toEqual([
      'applicantId',
      'displayName',
      'formalAccountReady',
    ]);
    expect(
      Object.keys(document.schemas.Identity.properties ?? {}).sort(),
    ).toEqual(['applicantId', 'displayName', 'formalAccountReady']);
  });

  it.each([
    document.schemas.SessionEnvelope,
    document.schemas.IdentityEnvelope,
    document.logout.post.responses['200'].content?.['application/json'].schema,
  ])(
    'matches the common response envelope and request identifier %#',
    (schema) => {
      expect(schema?.required).toEqual(['data', 'requestId']);
      expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
        'data',
        'requestId',
      ]);
      expect(schema?.additionalProperties).toBe(false);
    },
  );

  it('declares validation, identity conflict, admission and provider failure responses', () => {
    for (const status of ['400', '401', '409', '429', '500', '502', '503']) {
      expect(document.login.post.responses[status]).toBeDefined();
    }
    for (const status of ['429', '502', '503']) {
      expect(
        document.login.post.responses[status].content?.['application/json']
          .schema.$ref,
      ).toBe('./openapi.yaml#/components/schemas/ErrorEnvelope');
    }
  });
});
