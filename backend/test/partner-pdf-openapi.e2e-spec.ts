import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';
import { PARTNER_BALANCE_BANDS } from '../src/modules/partner/dto/partner-query.dto';
import { LessonLedgerEntryType } from '@prisma/client';

describe('partner PDF student query OpenAPI (no database connection)', () => {
  const document = load(
    fs.readFileSync(
      path.resolve(__dirname, '../../contracts/openapi.yaml'),
      'utf8',
    ),
  ) as {
    paths: Record<
      string,
      {
        get: {
          description?: string;
          parameters: Array<{
            name?: string;
            schema?: { enum?: string[]; default?: string; $ref?: string };
          }>;
          responses: Record<string, unknown>;
        };
      }
    >;
    components: {
      schemas: Record<
        string,
        {
          properties?: Record<string, unknown>;
          required?: string[];
          enum?: string[];
          unevaluatedProperties?: boolean;
          allOf?: Array<{ $ref?: string; required?: string[] }>;
        }
      >;
    };
  };

  it('keeps the server balance enum and default equal to the approved contract', () => {
    const operation = document.paths['/partners/me/students'].get;
    const filter = operation.parameters.find(
      (parameter) => parameter.name === 'balanceBand',
    );
    expect(filter?.schema).toMatchObject({
      enum: [...PARTNER_BALANCE_BANDS],
      default: 'ALL',
    });
    expect(operation.responses['400']).toBeDefined();
    expect(operation.responses['401']).toBeDefined();
    expect(operation.responses['403']).toBeDefined();
  });

  it('requires a minimal field-level nullable enrollment summary on student detail', () => {
    expect(
      document.components.schemas.PartnerStudentDetailView.allOf?.[1].required,
    ).toContain('enrollmentSummary');
    expect(document.components.schemas.PartnerEnrollmentSummary).toMatchObject({
      required: [
        'receivedAmountFen',
        'refundedAmountFen',
        'initialMainUnits',
        'initialGiftUnits',
        'pendingIssuanceCount',
      ],
      additionalProperties: false,
    });
    for (const key of [
      'receivedAmountFen',
      'refundedAmountFen',
      'initialMainUnits',
      'initialGiftUnits',
    ]) {
      expect(
        document.components.schemas.PartnerEnrollmentSummary.properties?.[key],
      ).toEqual({
        oneOf: [
          { type: 'integer', minimum: 0, maximum: 9007199254740991 },
          { type: 'null' },
        ],
      });
    }
  });

  it('separates partner history from the teacher ongoing promotion contract', () => {
    const partner = document.paths['/partners/me/group-campaigns'].get;
    expect(
      partner.parameters.find(({ name }) => name === 'phase')?.schema,
    ).toEqual({
      type: 'string',
      enum: ['ONGOING', 'ENDED'],
      default: 'ONGOING',
    });
    expect(partner.responses['400']).toBeDefined();
    expect(
      document.components.schemas.PartnerPromotionCampaignView,
    ).toMatchObject({
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['ACTIVE', 'CLOSED'] },
        canPromote: { type: 'boolean' },
      },
    });
    expect(
      document.components.schemas.PartnerPromotionCampaignView.required,
    ).toEqual(expect.arrayContaining(['status', 'canPromote']));
    expect(
      document.paths['/teachers/me/group-campaigns'].get.parameters.some(
        ({ name }) => name === 'phase',
      ),
    ).toBe(false);
    expect(
      document.components.schemas.GroupPromotionCampaignView.properties?.status,
    ).toEqual({
      type: 'string',
      enum: ['ACTIVE'],
    });
  });

  it('keeps ledger filtering on the existing enum without filtering campus balances', () => {
    const operation = document.paths['/partners/me/lesson-account'].get;
    const filter = operation.parameters.find(
      (parameter) => parameter.name === 'entryType',
    );
    expect(filter?.schema?.$ref).toBe(
      '#/components/schemas/LessonLedgerEntryType',
    );
    expect(document.components.schemas.LessonLedgerEntryType.enum).toEqual(
      Object.values(LessonLedgerEntryType),
    );
    expect(operation.description).toContain(
      'Campus balances remain unfiltered',
    );
    expect(operation.responses['400']).toBeDefined();
  });

  it('declares nullable linked teaching context without implying payment or historical name snapshots', () => {
    const entry = document.components.schemas.PartnerLessonLedgerEntryView;
    expect(entry.required).toContain('teachingContext');
    expect(entry).toMatchObject({
      properties: {
        teachingContext: {
          oneOf: [
            { $ref: '#/components/schemas/PartnerLedgerTeachingContext' },
            { type: 'null' },
          ],
        },
      },
    });
    expect(
      document.components.schemas.PartnerLedgerTeachingContext,
    ).toMatchObject({
      required: ['courseName', 'teacherName', 'lessonStartsAt'],
      additionalProperties: false,
      properties: { lessonStartsAt: { type: 'string', format: 'date-time' } },
    });
    expect(
      Object.keys(
        document.components.schemas.PartnerLedgerTeachingContext.properties ??
          {},
      ).sort(),
    ).toEqual(['courseName', 'lessonStartsAt', 'teacherName']);
  });

  it('distinguishes calendar receipt dates from successful payment instants in ledger context', () => {
    const entry = document.components.schemas.PartnerLessonLedgerEntryView;
    expect(entry.required).toContain('paymentContext');
    expect(entry.properties?.paymentContext).toMatchObject({
      oneOf: [
        { $ref: '#/components/schemas/PartnerLedgerPaymentContext' },
        { type: 'null' },
      ],
    });
    expect(
      document.components.schemas.PartnerLedgerPaymentContext,
    ).toMatchObject({
      oneOf: [
        {
          type: 'object',
          required: ['receivedOn'],
          properties: { receivedOn: { type: 'string', format: 'date' } },
          additionalProperties: false,
        },
        {
          type: 'object',
          required: ['paidAt'],
          properties: { paidAt: { type: 'string', format: 'date-time' } },
          additionalProperties: false,
        },
      ],
    });
  });

  it('requires a nonnegative profile count and permits only the seven approved campus fields', () => {
    const profile = document.components.schemas.PartnerProfileView;
    expect(profile).toMatchObject({
      required: ['displayName', 'roleCode', 'campus', 'activeStudentCount'],
      properties: { activeStudentCount: { type: 'integer', minimum: 0 } },
      additionalProperties: false,
    });
    const campus = profile.properties?.campus;
    expect(campus).toMatchObject({
      type: 'object',
      required: [
        'id',
        'code',
        'name',
        'timezone',
        'lessonWarningThresholdUnits',
        'contactPhone',
        'address',
      ],
      additionalProperties: false,
    });
    expect(campus).not.toHaveProperty('allOf');
    expect(
      Object.keys((campus as { properties: object }).properties).sort(),
    ).toEqual([
      'address',
      'code',
      'contactPhone',
      'id',
      'lessonWarningThresholdUnits',
      'name',
      'timezone',
    ]);
  });

  it('does not add client-controlled campus scope or an undefined subject identity', () => {
    const names = document.paths['/partners/me/students'].get.parameters.map(
      (parameter) => parameter.name,
    );
    expect(names).not.toContain('campusId');
    expect(names).not.toContain('subjectId');
  });

  it('keeps growth read-only with no client-selected campus scope', () => {
    const route = document.paths['/partners/me/students/{studentId}/growth'];
    expect(Object.keys(route)).toEqual(['get']);
    expect(route.get.parameters.map((parameter) => parameter.name)).toContain(
      'studentId',
    );
    expect(
      route.get.parameters.map((parameter) => parameter.name),
    ).not.toContain('campusId');
    for (const status of ['200', '400', '401', '403', '404']) {
      expect(route.get.responses[status]).toBeDefined();
    }
    const fields =
      document.components.schemas.PartnerStudentGrowthRecordView.properties;
    expect(fields).toHaveProperty('review');
    expect(fields).toHaveProperty('feedbackImages');
    for (const field of [
      'canReview',
      'parentUserId',
      'storageKey',
      'originalName',
      'homeAddress',
    ]) {
      expect(fields).not.toHaveProperty(field);
    }
    expect(
      document.paths['/media/student-photos/{storedFileId}'].get.description,
    ).toContain('PARTNER_STUDENT_READ');
  });

  it('closes list and detail schemas without inheriting the closed list object', () => {
    const schemas = document.components.schemas;
    expect(schemas.PartnerStudentView.unevaluatedProperties).toBe(false);
    expect(schemas.PartnerStudentDetailView.unevaluatedProperties).toBe(false);
    expect(schemas.PartnerStudentDetailView.allOf?.[0]).toEqual({
      $ref: '#/components/schemas/PartnerStudentBaseView',
    });
    expect(schemas.PartnerStudentDetailView.allOf?.[1].required).toContain(
      'photo',
    );
    expect(schemas.PartnerStudentBaseView.properties).toHaveProperty(
      'totalBalanceUnits',
    );
  });

  it('extends only dashboard highlights while retaining closed warning-list responses', () => {
    const schemas = document.components.schemas;
    expect(schemas.PartnerWarningView).toMatchObject({
      allOf: [{ $ref: '#/components/schemas/PartnerWarningBaseView' }],
      unevaluatedProperties: false,
    });
    expect(schemas.PartnerDashboardHighlightView).toMatchObject({
      allOf: [
        { $ref: '#/components/schemas/PartnerWarningBaseView' },
        {
          required: ['classes', 'attendance', 'enrollmentSummary'],
          properties: {
            classes: {
              items: { $ref: '#/components/schemas/PartnerStudentClassView' },
            },
            attendance: {
              $ref: '#/components/schemas/PartnerStudentAttendanceSummary',
            },
            enrollmentSummary: {
              $ref: '#/components/schemas/PartnerEnrollmentSummary',
            },
          },
        },
      ],
      unevaluatedProperties: false,
    });
    expect(schemas.PartnerWarningBaseView.properties).not.toHaveProperty(
      'attendance',
    );
    expect(schemas.PartnerWarningBaseView.properties).not.toHaveProperty(
      'enrollmentSummary',
    );
    expect(schemas.PartnerDashboardView.properties?.highlight).toEqual({
      oneOf: [
        { $ref: '#/components/schemas/PartnerDashboardHighlightView' },
        { type: 'null' },
      ],
    });
  });
});
