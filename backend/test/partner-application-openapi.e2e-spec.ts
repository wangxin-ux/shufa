import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';

interface Schema {
  type?: string | string[];
  maxLength?: number;
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, Schema>;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  $ref?: string;
}
interface Operation {
  security: Array<Record<string, string[]>>;
  responses: Record<string, unknown>;
  requestBody?: { content: { 'application/json': { schema: Schema } } };
}
interface Contract {
  application: { get: Operation };
  formalArchive?: { get: Operation };
  basicInformation: { put: Operation };
  bankInformation: { get: Operation; put: Operation };
  materials: { get: Operation; put: Operation };
  materialUploads: { post: Operation };
  materialUploadFile: { post: Operation };
  materialContent: { get: Operation };
  submit: { post: Operation };
  schemas: Record<string, Schema>;
}

describe('institution basic draft OpenAPI boundary', () => {
  const directory = path.resolve(__dirname, '../../contracts');
  const root = load(
    fs.readFileSync(path.join(directory, 'openapi.yaml'), 'utf8'),
  ) as {
    paths: Record<string, { $ref: string }>;
  };
  const document = load(
    fs.readFileSync(
      path.join(directory, 'partner-application.openapi.yaml'),
      'utf8',
    ),
  ) as Contract;

  it('registers separate review and own-history routes with closed approval and private list fields', () => {
    const review = load(
      fs.readFileSync(
        path.join(directory, 'partner-application-review.openapi.yaml'),
        'utf8',
      ),
    ) as {
      list: { get: Operation };
      reject: { post: Operation };
      history: { get: Operation };
      reopen: { post: Operation };
      schemas: Record<string, Schema>;
    };
    for (const [route, pointer] of [
      ['/management/partner-applications', 'list'],
      [
        '/management/partner-applications/{applicationId}/submissions/{submissionId}',
        'detail',
      ],
      [
        '/management/partner-applications/{applicationId}/submissions/{submissionId}/bank-information',
        'bank',
      ],
      [
        '/management/partner-applications/{applicationId}/submissions/{submissionId}/materials/{storedFileId}/content',
        'image',
      ],
      [
        '/management/partner-applications/{applicationId}/submissions/{submissionId}/reject',
        'reject',
      ],
      ['/partner-applicants/me/application/history', 'history'],
      ['/partner-applicants/me/application/reopen', 'reopen'],
    ])
      expect(root.paths[route].$ref).toBe(
        `./partner-application-review.openapi.yaml#/${pointer}`,
      );
    expect(review.list.get.security).toEqual([{ bearerAuth: [] }]);
    expect(review.history.get.security).toEqual([{ partnerApplicantAuth: [] }]);
    expect(review.reopen.post.security).toEqual([{ partnerApplicantAuth: [] }]);
    expect(review.schemas.Summary.additionalProperties).toBe(false);
    expect(review.schemas.Summary.properties).not.toHaveProperty(
      'bankInformation',
    );
    expect(review.schemas.Summary.properties).not.toHaveProperty(
      'contactPhone',
    );
    expect(review.schemas.ListEnvelope.properties).toHaveProperty('meta');
    expect(
      review.reject.post.requestBody?.content['application/json'].schema
        .additionalProperties,
    ).toBe(false);
    expect(
      root.paths[
        '/management/partner-applications/{applicationId}/submissions/{submissionId}/approve'
      ].$ref,
    ).toBe('./partner-application-review.openapi.yaml#/approve');
    expect(review.schemas.ApprovalReceipt.required).toEqual([
      'applicationId',
      'submissionId',
      'reviewId',
      'userId',
      'campusId',
      'status',
      'version',
      'reviewedAt',
    ]);
  });

  it('keeps the existing own read and basic save routes', () => {
    expect(root.paths['/partner-applicants/me/application'].$ref).toBe(
      './partner-application.openapi.yaml#/application',
    );
    expect(
      root.paths['/partner-applicants/me/application/basic-information'].$ref,
    ).toBe('./partner-application.openapi.yaml#/basicInformation');
  });
  it('registers restricted bank read/write with closed fields and a minimal save receipt', () => {
    expect(
      root.paths['/partner-applicants/me/application/bank-information'].$ref,
    ).toBe('./partner-application.openapi.yaml#/bankInformation');
    for (const operation of [
      document.bankInformation.get,
      document.bankInformation.put,
    ]) {
      expect(operation.security).toEqual([{ partnerApplicantAuth: [] }]);
      expect(operation.responses['503']).toBeDefined();
      expect(operation.responses['401']).toBeDefined();
    }
    const input =
      document.bankInformation.put.requestBody?.content['application/json']
        .schema;
    expect(input?.required).toEqual(['expectedVersion', 'bankInformation']);
    expect(input?.additionalProperties).toBe(false);
    expect(
      document.schemas.BankInformationInput.properties?.accountNumber,
    ).toEqual({
      type: ['string', 'null'],
      maxLength: 80,
    });
    expect(document.schemas.BankReceipt.required).toEqual([
      'applicationId',
      'version',
      'bankRecordId',
    ]);
    expect(
      Object.keys(document.schemas.BankReceipt.properties ?? {}).sort(),
    ).toEqual(['applicationId', 'bankRecordId', 'version']);
    expect(document.schemas.BankReceipt.additionalProperties).toBe(false);
  });
  it('registers restricted private material routes and closed metadata without public URLs', () => {
    for (const [route, pointer] of [
      ['/partner-applicants/me/application/materials', 'materials'],
      [
        '/partner-applicants/me/application/material-uploads',
        'materialUploads',
      ],
      [
        '/partner-applicants/me/application/material-uploads/{uploadId}',
        'materialUploadFile',
      ],
      [
        '/partner-applicants/me/application/materials/{storedFileId}/content',
        'materialContent',
      ],
    ])
      expect(root.paths[route].$ref).toBe(
        `./partner-application.openapi.yaml#/${pointer}`,
      );
    for (const operation of [
      document.materials.get,
      document.materials.put,
      document.materialUploads.post,
      document.materialUploadFile.post,
      document.materialContent.get,
    ]) {
      expect(operation.security).toEqual([{ partnerApplicantAuth: [] }]);
      expect(operation.responses['401']).toBeDefined();
      expect(operation.responses['503']).toBeDefined();
    }
    expect(document.schemas.MaterialKind.enum).toEqual([
      'BUSINESS_LICENSE',
      'INSTITUTION_LOGO',
      'LEGAL_ID_FRONT',
      'LEGAL_ID_BACK',
      'STORE_FRONT',
      'ENVIRONMENT',
    ]);
    expect(document.schemas.MaterialFile.required).toEqual([
      'storedFileId',
      'kind',
      'mimeType',
      'sizeBytes',
      'width',
      'height',
    ]);
    expect(document.schemas.MaterialFile.additionalProperties).toBe(false);
    expect(document.schemas.MaterialSaveInput.required).toEqual([
      'expectedVersion',
      'materials',
    ]);
    expect(document.schemas.MaterialReceipt.required).toEqual([
      'applicationId',
      'version',
      'materialRecordId',
    ]);
  });

  it('registers a read-only formal partner archive with the same minimal nullable response', () => {
    expect(root.paths['/partners/me/application']?.$ref).toBe(
      './partner-application.openapi.yaml#/formalArchive',
    );
    expect(document.formalArchive?.get.security).toEqual([{ bearerAuth: [] }]);
    expect(document.formalArchive?.get.responses['401']).toBeDefined();
    expect(document.formalArchive?.get.responses['403']).toBeDefined();
    expect(document.formalArchive?.get.responses['200']).toEqual(
      document.application.get.responses['200'],
    );
    expect(Object.keys(document.formalArchive ?? {})).toEqual(['get']);
  });
  it('requires a restricted, closed versioned submission and a minimal frozen receipt', () => {
    expect(root.paths['/partner-applicants/me/application/submit'].$ref).toBe(
      './partner-application.openapi.yaml#/submit',
    );
    const operation = document.submit.post;
    expect(operation.security).toEqual([{ partnerApplicantAuth: [] }]);
    const input = operation.requestBody?.content['application/json'].schema;
    expect(input?.required).toEqual(['expectedVersion']);
    expect(input?.additionalProperties).toBe(false);
    expect(Object.keys(input?.properties ?? {})).toEqual(['expectedVersion']);
    expect(document.schemas.SubmissionReceipt.required).toEqual([
      'applicationId',
      'submissionId',
      'version',
      'status',
      'submittedAt',
    ]);
    expect(document.schemas.SubmissionReceipt.additionalProperties).toBe(false);
    for (const code of ['400', '401', '404', '409', '503', '500'])
      expect(operation.responses[code]).toBeDefined();
  });

  it.each([document.application.get, document.basicInformation.put])(
    'requires the restricted applicant bearer and declares authentication failure %#',
    (operation) => {
      expect(operation.security).toEqual([{ partnerApplicantAuth: [] }]);
      expect(operation.responses['401']).toBeDefined();
    },
  );

  it('uses a closed versioned save envelope with no client-selected identity or status', () => {
    const schema =
      document.basicInformation.put.requestBody?.content['application/json']
        .schema;
    expect(schema?.required).toEqual(['expectedVersion', 'basicInformation']);
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual([
      'basicInformation',
      'expectedVersion',
    ]);
    expect(schema?.additionalProperties).toBe(false);
    expect(schema?.properties?.expectedVersion).toMatchObject({
      minimum: 0,
      maximum: 2147483647,
    });
    expect(document.basicInformation.put.responses['409']).toBeDefined();
    expect(document.basicInformation.put.responses['400']).toBeDefined();
  });

  it('keeps partial input and full output limited to institution basics', () => {
    const fields = [
      'city',
      'contactPhone',
      'detailedAddress',
      'district',
      'institutionName',
      'province',
    ];
    for (const key of ['BasicInformationInput', 'BasicInformation']) {
      expect(
        Object.keys(document.schemas[key].properties ?? {}).sort(),
      ).toEqual(fields);
      expect(document.schemas[key].additionalProperties).toBe(false);
    }
    expect(document.schemas.BasicInformationInput.required).toBeUndefined();
    expect(document.schemas.BasicInformation.required?.slice().sort()).toEqual(
      fields.filter((field) => field !== 'contactPhone'),
    );
  });

  it('keeps the optional owned contact as nullable bounded text in both directions', () => {
    for (const key of ['BasicInformationInput', 'BasicInformation']) {
      expect(document.schemas[key].properties?.contactPhone).toMatchObject({
        type: ['string', 'null'],
        maxLength: 30,
      });
    }
  });

  it('defines the draft lifecycle without adding review or upload grants', () => {
    expect(document.schemas.ApplicationStatus.enum).toEqual([
      'DRAFT',
      'SUBMITTED',
      'REJECTED',
      'APPROVED',
    ]);
    expect(document.schemas.Application.properties?.version).toMatchObject({
      minimum: 1,
      maximum: 2147483647,
    });
    expect(document.schemas.Application.additionalProperties).toBe(false);
  });
});
