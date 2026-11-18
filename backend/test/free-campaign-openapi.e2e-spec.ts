import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import {
  PartnerFreeCampaignController,
  PartnerPublishedFreeCampaignController,
  ManagementFreeCampaignController,
  ParentFreeCampaignController,
} from '../src/modules/group-buying/free-campaign.controllers';
import { ROLE_PERMISSION_MATRIX } from '../src/modules/iam/role-permission.matrix';

interface Schema {
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, unknown>;
}
interface Operation {
  description: string;
  security: object[];
  responses: Record<string, unknown>;
}
const file = (name: string): unknown =>
  load(readFileSync(resolve(__dirname, '../../contracts', name), 'utf8'));
describe('free-registration OpenAPI and controller boundary without database', () => {
  const root = file('openapi.yaml') as {
    paths: Record<string, { $ref: string }>;
  };
  const document = file('free-campaigns.openapi.yaml') as {
    schemas: Record<string, Schema>;
    [key: string]: unknown;
  };
  it('maps every implemented method and route to an authenticated explicit operation', () => {
    let operations = 0;
    for (const controller of [
      PartnerFreeCampaignController,
      PartnerPublishedFreeCampaignController,
      ManagementFreeCampaignController,
      ParentFreeCampaignController,
    ]) {
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const method = Object.getOwnPropertyDescriptor(
          controller.prototype,
          name,
        )?.value as unknown;
        if (typeof method !== 'function' || name === 'constructor') continue;
        const route = Reflect.getMetadata(PATH_METADATA, method) as
          string | undefined;
        if (route === undefined) continue;
        const http =
          (Reflect.getMetadata(METHOD_METADATA, method) as RequestMethod) ===
          RequestMethod.GET
            ? 'get'
            : (Reflect.getMetadata(
                  METHOD_METADATA,
                  method,
                ) as RequestMethod) === RequestMethod.PUT
              ? 'put'
              : 'post';
        const path = `/${prefix}/${route}`
          .replace(/\/+/g, '/')
          .replace(/\/$/, '')
          .replace(/:([A-Za-z]+)/g, '{$1}');
        expect(root.paths[path]).toBeDefined();
        const pointer = root.paths[path].$ref.split('#/')[1];
        const operation = (document[pointer] as Record<string, Operation>)[
          http
        ];
        expect(operation.security).toEqual([{ bearerAuth: [] }]);
        expect(operation.responses).toHaveProperty('401');
        expect(operation.responses).toHaveProperty('403');
        operations++;
      }
    }
    expect(operations).toBe(17);
  });
  it('keeps registration requests closed and forbids collecting new contact or financial fields', () => {
    expect(document.schemas.RegistrationInput).toMatchObject({
      additionalProperties: false,
      required: ['versionId', 'studentId'],
    });
    expect(Object.keys(document.schemas.RegistrationInput.properties!)).toEqual(
      ['versionId', 'studentId'],
    );
    expect(
      Object.keys(document.schemas.PartnerRegistration.properties!),
    ).toEqual([
      'registrationId',
      'versionId',
      'status',
      'registeredAt',
      'cancelledAt',
      'studentName',
    ]);
    expect(document.schemas.FrozenConfiguration.properties).toMatchObject({
      feeFen: { const: 0 },
      benefitMode: { const: 'NONE' },
      registrationLimit: { const: 'ONCE_PER_STUDENT' },
    });
  });
  it('returns the exact approved publication summary within configuration without requiring history traversal', () => {
    expect(document.schemas.DraftConfiguration.required).toContain(
      'publishedVersion',
    );
    expect(
      document.schemas.DraftConfiguration.properties?.publishedVersion,
    ).toEqual({
      oneOf: [{ $ref: '#/schemas/ReviewSummary' }, { type: 'null' }],
      description:
        'Exact approved publication summary, independent of history pagination.',
    });
    const operation = (document.configuration as { get: Operation }).get;
    expect(operation.description).toContain('RepeatableRead snapshot');
    expect(operation.description).toContain('never scan history pages');
  });
  it('projects only the frozen published share image using the existing signed image schema', () => {
    expect(document.schemas.DraftConfiguration.required).toContain(
      'publishedShareImage',
    );
    expect(
      document.schemas.DraftConfiguration.properties?.publishedShareImage,
    ).toMatchObject({
      oneOf: [
        { $ref: './partner-campaign-images.openapi.yaml#/schemas/Image' },
        { type: 'null' },
      ],
    });
    const operation = (document.configuration as { get: Operation }).get;
    expect(operation.description).toContain('publishedShareImage');
    expect(operation.description).toContain('never the private draft');
  });
  it('grants review only to SUPER_ADMIN and keeps partner and parent commands distinct', () => {
    expect(ROLE_PERMISSION_MATRIX.SUPER_ADMIN).toContain('CAMPAIGN_REVIEW');
    for (const role of [
      'PARENT',
      'PARTNER',
      'TEACHER',
      'HR',
      'FINANCE',
      'CAMPUS_MANAGER',
    ] as const)
      expect(ROLE_PERMISSION_MATRIX[role]).not.toContain('CAMPAIGN_REVIEW');
    expect(ROLE_PERMISSION_MATRIX.PARTNER).toContain('PARTNER_CAMPAIGN_SUBMIT');
    expect(ROLE_PERMISSION_MATRIX.PARTNER).not.toContain(
      'PARENT_CAMPAIGN_REGISTRATION_CREATE',
    );
    expect(ROLE_PERMISSION_MATRIX.PARENT).toContain(
      'PARENT_CAMPAIGN_REGISTRATION_CANCEL_OWN',
    );
    expect(
      (document.register as { post: Operation }).post.description,
    ).toContain('current sole campus PARENT');
  });
  it('defines an optional current registration status filter without changing the response or permissions', () => {
    const operation = (
      document.partnerRegistrations as {
        get: Operation & {
          parameters: Array<{
            name?: string;
            in?: string;
            required?: boolean;
            schema?: unknown;
          }>;
        };
      }
    ).get;
    expect(
      operation.parameters.find((parameter) => parameter.name === 'status'),
    ).toEqual({
      name: 'status',
      in: 'query',
      required: false,
      schema: { type: 'string', enum: ['REGISTERED', 'CANCELLED'] },
    });
    expect(operation.responses).toHaveProperty('400');
    const inputs = Reflect.getMetadata(
      'design:paramtypes',
      PartnerFreeCampaignController.prototype,
      'results',
    ) as Array<{ name: string }>;
    expect(inputs[2].name).toBe('FreeRegistrationQueryDto');
  });
});
