import * as fs from 'node:fs';
import * as path from 'node:path';
import { load as loadYaml } from 'js-yaml';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

interface OpenApiOperation {
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ $ref?: string; name?: string; schema?: OpenApiSchema }>;
  requestBody?: {
    content?: {
      'application/json'?: { schema?: OpenApiSchema };
    };
  };
  responses?: Record<string, unknown>;
}

interface OpenApiSchema {
  $ref?: string;
  allOf?: OpenApiSchema[];
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  type?: string;
  format?: string;
  maxItems?: number;
  uniqueItems?: boolean;
  enum?: string[];
}

interface OpenApiResponse {
  content?: {
    'application/json'?: {
      schema?: OpenApiSchema;
    };
  };
}

interface OpenApiDocument {
  security?: Array<Record<string, string[]>>;
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, OpenApiSchema> & {
      ErrorCode: { enum: string[] };
    };
  };
}

const teacherOperations = {
  '/auth/login': ['post'],
  '/auth/staff/bind': ['post'],
  '/me': ['get'],
  '/teachers/me/dashboard': ['get'],
  '/teachers/me/profile': ['get'],
  '/teachers/me/lesson-sessions': ['get'],
  '/teachers/me/lesson-sessions/{lessonSessionId}': ['get'],
  '/teachers/me/lesson-sessions/{lessonSessionId}/attendance': ['put'],
  '/teachers/me/lesson-sessions/{lessonSessionId}/complete': ['post'],
  '/teachers/me/lesson-sessions/{lessonSessionId}/reverse': ['post'],
  '/teachers/me/lesson-sessions/{lessonSessionId}/students/{studentId}/feedback':
    ['put'],
  '/teachers/me/lesson-sessions/{lessonSessionId}/students/{studentId}/feedback-images':
    ['post'],
  '/teachers/me/students': ['get'],
  '/teachers/me/students/{studentId}': ['get'],
  '/teachers/me/teaching-records': ['get'],
  '/teachers/me/lesson-ledger': ['get'],
  '/teachers/me/earnings/summary': ['get'],
  '/teachers/me/earning-rule': ['get'],
  '/teachers/me/earnings': ['get'],
  '/teachers/me/withdrawals': ['get', 'post'],
  '/teachers/me/withdrawals/{withdrawalId}/cancel': ['post'],
} as const;

const managementOperations = {
  '/management/dashboard': ['get'],
  '/management/profile': ['get'],
  '/management/campuses': ['get'],
  '/management/campuses/{campusId}': ['get'],
  '/management/campuses/{campusId}/customer-service-qr': ['post'],
  '/management/lesson-ledger': ['get'],
  '/management/lesson-ledger/adjustments': ['post'],
  '/management/system-settings': ['get'],
  '/management/role-permissions': ['get'],
  '/management/audit-logs': ['get'],
  '/management/earning-rules': ['get', 'post'],
  '/management/earning-rules/{ruleId}/activate': ['post'],
  '/management/earning-rules/{ruleId}/retire': ['post'],
  '/management/teacher-withdrawal-policies': ['get', 'post'],
  '/management/teacher-withdrawal-policies/{policyId}/activate': ['post'],
  '/management/teacher-withdrawal-policies/{policyId}/retire': ['post'],
  '/management/teacher-earnings': ['get'],
  '/management/teacher-earnings/{entryId}/approve': ['post'],
  '/management/teacher-earnings/{entryId}/reject': ['post'],
  '/management/withdrawals': ['get'],
  '/management/withdrawals/{withdrawalId}/approve': ['post'],
  '/management/withdrawals/{withdrawalId}/reject': ['post'],
  '/management/withdrawals/{withdrawalId}/mark-paying': ['post'],
  '/management/withdrawals/{withdrawalId}/mark-paid': ['post'],
  '/management/withdrawals/{withdrawalId}/mark-failed': ['post'],
  '/management/payout-proofs': ['post'],
} as const;

const mutationOperations = {
  '/teachers/me/lesson-sessions/{lessonSessionId}/attendance': 'put',
  '/teachers/me/lesson-sessions/{lessonSessionId}/complete': 'post',
  '/teachers/me/lesson-sessions/{lessonSessionId}/reverse': 'post',
  '/teachers/me/lesson-sessions/{lessonSessionId}/students/{studentId}/feedback':
    'put',
  '/teachers/me/withdrawals': 'post',
  '/teachers/me/withdrawals/{withdrawalId}/cancel': 'post',
} as const;

const listPaths = [
  '/teachers/me/lesson-sessions',
  '/teachers/me/students',
  '/teachers/me/teaching-records',
  '/teachers/me/lesson-ledger',
  '/teachers/me/earnings',
  '/teachers/me/withdrawals',
] as const;

const requiredTeacherErrorCodes = [
  'LESSON_NOT_ASSIGNED',
  'LESSON_ALREADY_COMPLETED',
  'LESSON_VERSION_CONFLICT',
  'LESSON_REVERSAL_WINDOW_EXPIRED',
  'ATTENDANCE_INCOMPLETE',
  'INSUFFICIENT_LESSON_BALANCE',
  'FEEDBACK_NOT_ALLOWED',
  'FEEDBACK_IMAGE_INVALID',
  'FEEDBACK_IMAGE_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'EARNING_RULE_NOT_FOUND',
  'EARNING_RULE_OVERLAP',
  'EARNING_NOT_REVIEWABLE',
  'EARNING_ALREADY_REVIEWED',
  'EARNING_REVERSED',
  'WITHDRAWAL_AMOUNT_INVALID',
  'WITHDRAWAL_BALANCE_INSUFFICIENT',
  'WITHDRAWAL_FREQUENCY_EXCEEDED',
  'WITHDRAWAL_STATUS_CONFLICT',
  'WITHDRAWAL_SELF_REVIEW_FORBIDDEN',
  'PAYOUT_PROOF_REQUIRED',
  'PAYOUT_PROOF_INVALID',
] as const;

function loadContract(): OpenApiDocument {
  const contractPath = path.resolve(__dirname, '../../contracts/openapi.yaml');
  return loadYaml(fs.readFileSync(contractPath, 'utf8')) as OpenApiDocument;
}

function hasBearerSecurity(
  operation: OpenApiOperation,
  document: OpenApiDocument,
): boolean {
  const security = operation.security ?? document.security ?? [];
  return security.some((item) =>
    Object.prototype.hasOwnProperty.call(item, 'bearerAuth'),
  );
}

function referencesSchema(
  schema: OpenApiSchema | undefined,
  expectedRef: string,
  document: OpenApiDocument,
  visited = new Set<string>(),
): boolean {
  if (!schema) {
    return false;
  }

  if (schema.$ref === expectedRef) {
    return true;
  }

  if (
    schema.$ref?.startsWith('#/components/schemas/') &&
    !visited.has(schema.$ref)
  ) {
    visited.add(schema.$ref);
    const schemaName = schema.$ref.slice('#/components/schemas/'.length);
    if (
      referencesSchema(
        document.components.schemas[schemaName],
        expectedRef,
        document,
        visited,
      )
    ) {
      return true;
    }
  }

  return (
    schema.allOf?.some((item) =>
      referencesSchema(item, expectedRef, document, visited),
    ) ?? false
  );
}

describe('teacher OpenAPI contract', () => {
  const document = loadContract();

  it.each(Object.entries(teacherOperations))(
    'declares every teacher operation for %s',
    (route, methods) => {
      expect(document.paths[route]).toBeDefined();
      for (const method of methods) {
        expect(document.paths[route][method]).toBeDefined();
      }
    },
  );

  it('protects /me and every teacher operation with bearer authentication', () => {
    const protectedOperations = Object.entries(teacherOperations).filter(
      ([route]) => !route.startsWith('/auth/'),
    );

    for (const [route, methods] of protectedOperations) {
      for (const method of methods) {
        expect(hasBearerSecurity(document.paths[route][method], document)).toBe(
          true,
        );
      }
    }
  });

  it.each(Object.entries(managementOperations))(
    'declares every management operation for %s',
    (route, methods) => {
      expect(document.paths[route]).toBeDefined();
      for (const method of methods) {
        expect(document.paths[route][method]).toBeDefined();
        expect(hasBearerSecurity(document.paths[route][method], document)).toBe(
          true,
        );
      }
    },
  );

  it('requires the current version when a teacher cancels a withdrawal', () => {
    const operation =
      document.paths['/teachers/me/withdrawals/{withdrawalId}/cancel'].post;
    expect(
      operation.requestBody?.content?.['application/json']?.schema,
    ).toEqual({ $ref: '#/components/schemas/VersionedActionRequest' });
  });

  it('keeps restored receipt permissions isolated from teaching and campus management', () => {
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/finance/receipts',
        '/finance/receipts/export',
        '/finance/receipts/{receiptId}/issue-package',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.FINANCE).toEqual(
      expect.arrayContaining([
        'FINANCE_REFUND_READ',
        'FINANCE_REFUND_WRITE',
        'FINANCE_REFUND_PAY',
        'FINANCE_RECEIPT_READ',
        'FINANCE_RECEIPT_EXPORT',
        'FINANCE_RECEIPT_WRITE',
        'FINANCE_PACKAGE_ISSUE',
        'FINANCE_CORRECTION_READ',
        'FINANCE_CORRECTION_WRITE',
        'FINANCE_CORRECTION_APPLY',
        'FINANCE_REPORT_READ',
        'FINANCE_REPORT_EXPORT',
      ]),
    );
    const receiptPermissions = [
      'FINANCE_RECEIPT_READ',
      'FINANCE_RECEIPT_EXPORT',
      'FINANCE_RECEIPT_WRITE',
      'FINANCE_PACKAGE_ISSUE',
    ];
    for (const role of [
      'TEACHER',
      'CAMPUS_MANAGER',
      'SUPER_ADMIN',
      'HR',
    ] as const) {
      expect(
        ROLE_PERMISSION_MATRIX[role].some((permission) =>
          receiptPermissions.includes(permission),
        ),
      ).toBe(false);
    }
    expect(ROLE_PERMISSION_MATRIX.TEACHER).toEqual(
      expect.arrayContaining([
        'TEACHER_EARNING_READ_OWN',
        'TEACHER_WITHDRAWAL_CREATE',
      ]),
    );
    expect(ROLE_PERMISSION_MATRIX.CAMPUS_MANAGER).not.toEqual(
      expect.arrayContaining(['WITHDRAWAL_REVIEW']),
    );
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toEqual(
      expect.arrayContaining([
        'GLOBAL_DASHBOARD_READ',
        'EARNING_RULE_MANAGE',
        'TEACHER_EARNING_REVIEW',
        'WITHDRAWAL_REVIEW',
        'WITHDRAWAL_MARK_PAID',
      ]),
    );
  });

  it('requires Idempotency-Key and conflict responses for every teacher mutation', () => {
    for (const [route, method] of Object.entries(mutationOperations)) {
      const operation = document.paths[route][method];
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            $ref: '#/components/parameters/IdempotencyKey',
          }),
        ]),
      );
      for (const status of ['400', '401', '403', '404', '409']) {
        expect(operation.responses).toHaveProperty(status);
      }
    }
  });

  it('uses the paginated success envelope for every teacher list', () => {
    for (const route of listPaths) {
      const response = document.paths[route].get.responses?.[
        '200'
      ] as OpenApiResponse;
      const schema = response.content?.['application/json']?.schema;
      expect(
        referencesSchema(
          schema,
          '#/components/schemas/PaginatedSuccessEnvelope',
          document,
        ),
      ).toBe(true);
    }
  });

  it('declares the teacher conflict error codes centrally', () => {
    expect(document.components.schemas.ErrorCode.enum).toEqual(
      expect.arrayContaining(requiredTeacherErrorCodes),
    );
  });

  it('exposes refund and correction lesson-ledger entries to management clients', () => {
    const operation = document.paths['/management/lesson-ledger'].get;
    const entryTypeParameter = operation.parameters?.find(
      (parameter) => parameter.name === 'entryType',
    );

    expect(entryTypeParameter?.schema?.$ref).toBe(
      '#/components/schemas/LessonLedgerEntryType',
    );
    expect(
      document.components.schemas.ManagementLessonLedgerEntryView.properties
        ?.entryType?.$ref,
    ).toBe('#/components/schemas/LessonLedgerEntryType');
    expect(document.components.schemas.LessonLedgerEntryType.enum).toEqual(
      expect.arrayContaining(['GRANT', 'REFUND', 'CORRECTION']),
    );
  });

  it('defines bounded feedback images for upload, save, and signed reads', () => {
    expect(
      document.paths['/media/student-feedback/{storedFileId}']?.get,
    ).toBeDefined();

    const request = document.components.schemas.FeedbackUpsertRequest;
    expect(request.required).toEqual(['content', 'imageFileIds']);
    expect(request.properties?.imageFileIds).toMatchObject({
      type: 'array',
      maxItems: 3,
      uniqueItems: true,
    });
    expect(document.components.schemas.StudentFeedbackView.required).toEqual(
      expect.arrayContaining(['images']),
    );
    expect(document.components.schemas.TeacherLessonStudent.required).toEqual(
      expect.arrayContaining(['feedbackImages']),
    );
    expect(document.components.schemas.FeedbackImageView).toBeDefined();
  });

  it('defines campus customer-service QR upload and signed reads', () => {
    expect(
      document.paths['/management/campuses/{campusId}/customer-service-qr']
        ?.post,
    ).toBeDefined();
    expect(
      document.paths['/media/customer-service-qr/{storedFileId}']?.get,
    ).toBeDefined();
    expect(document.components.schemas.ErrorCode.enum).toContain(
      'CUSTOMER_SERVICE_QR_INVALID',
    );
    expect(
      document.components.schemas.ManagementCampusDetailView.allOf?.some(
        (schema) =>
          schema.required?.includes('customerServiceQrCodeUrl') ?? false,
      ),
    ).toBe(true);
  });
});
