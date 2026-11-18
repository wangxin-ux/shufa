import path from 'node:path';
import { ApplicationPageTransport } from './support/partner-application-page-harness';
import { assertApplicationPageTestTarget } from './support/partner-application-page-policy';

const runner = jest.requireActual<{
  evidencePath(input: string, exists: (file: string) => boolean): string;
  redactDiagnostics(text: string): string;
}>('../../.tools-automation/run-partner-application-page.cjs');
const http = jest.requireActual<typeof import('node:http')>('node:http');
const root = path.resolve(__dirname, '../..');
const target = path.join(
  root,
  'docs/verification/partner-application-tcp-2026-10-15-database.log',
);
describe('application Page fixture safety without network or file writes', () => {
  const databaseEnv = {
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    PARTNER_PDF_TEST_DB_NAME:
      'education_app_test_partner_pdf_20261012contact_test',
    DATABASE_URL:
      'postgresql://127.0.0.1:5433/education_app_test_partner_pdf_20261012contact_test',
  };
  it('accepts only the approved database host, port and name', () => {
    expect(assertApplicationPageTestTarget(databaseEnv).port).toBe('5433');
    for (const address of [
      'localhost:5433/education_app_test_partner_pdf_20261012contact_test',
      '127.0.0.1:5434/education_app_test_partner_pdf_20261012contact_test',
      '127.0.0.1/education_app_test_partner_pdf_20261012contact_test',
      '127.0.0.1:5433/education_app_test_partner_pdf_other_test',
    ]) {
      expect(() =>
        assertApplicationPageTestTarget({
          ...databaseEnv,
          DATABASE_URL: `postgresql://${address}`,
          PARTNER_PDF_TEST_DB_NAME: address.split('/')[1],
        }),
      ).toThrow('Exact application Page test database required');
    }
  });
  it('keeps failure context while redacting credentials from diagnostics', () => {
    const output = runner.redactDiagnostics(
      'FAIL owned flow\nBearer synthetic-secret\n' +
        'eyJzeW50aGV0aWM.eyJmaXh0dXJl.c2lnbmF0dXJl\n' +
        'postgresql://synthetic:password@127.0.0.1:5433/test\n' +
        'Expected status 200; received 404',
    );
    expect(output).toContain('FAIL owned flow');
    expect(output).toContain('Expected status 200; received 404');
    expect(output).not.toMatch(
      /Bearer |synthetic-secret|eyJ|postgresql:|password/,
    );
  });
  it('accepts a new scoped evidence path and rejects overwrites', () => {
    expect(runner.evidencePath(target, () => false)).toBe(target);
    expect(() => runner.evidencePath(target, () => true)).toThrow();
  });
  it.each([
    '',
    'docs/verification/../partner-application-tcp-2026-10-15-escape.log',
    'docs/verification/nested/partner-application-tcp-2026-10-15-nested.log',
    'docs/verification/partner-application-tcp-2026-10-15-wrong.txt',
    'docs/verification/unrelated.log',
  ])('rejects an out-of-scope evidence destination (%#)', (input) => {
    expect(() =>
      runner.evidencePath(path.resolve(root, input), () => false),
    ).toThrow();
  });
  it.each([
    'https://127.0.0.1:3000',
    'http://localhost:3000',
    'http://example.com',
    'http://127.0.0.1:3000/',
    'http://user:pass@127.0.0.1:3000',
  ])('rejects a non-exact loopback origin (%#)', (origin) => {
    expect(
      () => new ApplicationPageTransport(origin, new Set(), new Set()),
    ).toThrow();
  });
  it.each([
    { url: 'http://example.com/partner-applicants/me' },
    { url: 'http://127.0.0.1:3001/partner-applicants/me' },
    { url: 'http://127.0.0.1:3000/partner-applicants/me#fragment' },
    { url: 'http://user:pass@127.0.0.1:3000/partner-applicants/me' },
    { url: 'http://127.0.0.1:3000/management/staff-accounts' },
    { url: 'http://127.0.0.1:3000/partners/me/withdrawals' },
    { url: 'http://127.0.0.1:3000/partner-applicants/me', token: 'unknown' },
    {
      url: 'http://127.0.0.1:3000/partner-applicants/auth/wechat',
      method: 'POST',
      code: 'unknown',
    },
    {
      url: 'http://127.0.0.1:3000/auth/wechat/login',
      method: 'POST',
      code: 'unknown',
    },
  ])('rejects an unowned request before creating a wire call (%#)', (input) => {
    const transport = new ApplicationPageTransport(
      'http://127.0.0.1:3000',
      new Set(['synthetic']),
      new Set(['mock-wechat-login:owned']),
    );
    expect(() =>
      transport.request({
        url: input.url,
        method: input.method === 'POST' ? 'POST' : 'GET',
        header: { Authorization: `Bearer ${input.token ?? 'synthetic'}` },
        data: input.code ? { code: input.code } : undefined,
        success: jest.fn(),
        fail: jest.fn(),
      }),
    ).toThrow('outside fixture scope');
    expect(transport.calls).toEqual([]);
  });
  it('rejects uploads from unknown paths or a different multipart field', () => {
    const transport = new ApplicationPageTransport(
      'http://127.0.0.1:3000',
      new Set(['synthetic']),
      new Set(),
    );
    const options = {
      url: 'http://127.0.0.1:3000/partner-applicants/me/application/material-uploads/11111111-1111-4111-8111-111111111111',
      header: { Authorization: 'Bearer synthetic' },
      filePath: 'wxfile://unknown',
      name: 'file',
    };
    transport.applications.set(
      'synthetic',
      '22222222-2222-4222-8222-222222222222',
    );
    transport.uploads.set(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
    expect(() => transport.upload(options)).toThrow('owned synthetic PNG');
    transport.images.set(options.filePath, Buffer.from('synthetic'));
    expect(() => transport.upload({ ...options, name: 'another' })).toThrow();
    expect(transport.calls).toEqual([]);
  });
  it.each(['preview', 'save'])(
    'rejects another owned applicant file before a %s wire call',
    (operation) => {
      const applicationId = '11111111-1111-4111-8111-111111111111';
      const otherApplicationId = '22222222-2222-4222-8222-222222222222';
      const fileId = '33333333-3333-4333-8333-333333333333';
      const transport = new ApplicationPageTransport(
        'http://127.0.0.1:3000',
        new Set(['synthetic']),
        new Set(),
      );
      transport.applications.set('synthetic', applicationId);
      transport.files.set(fileId, otherApplicationId);
      const request = jest.spyOn(http, 'request').mockImplementation(() => {
        throw new Error('Wire call must not start');
      });
      try {
        expect(() =>
          transport.request({
            url:
              'http://127.0.0.1:3000/partner-applicants/me/application/materials' +
              (operation === 'preview' ? `/${fileId}/content` : ''),
            method: operation === 'preview' ? 'GET' : 'PUT',
            header: { Authorization: 'Bearer synthetic' },
            data:
              operation === 'save'
                ? { expectedVersion: 1, materials: [{ storedFileId: fileId }] }
                : undefined,
            success: jest.fn(),
            fail: jest.fn(),
          }),
        ).toThrow('outside owned fixture scope');
        expect(request).not.toHaveBeenCalled();
        expect(transport.calls).toEqual([]);
      } finally {
        request.mockRestore();
      }
    },
  );
  it('limits drain time even if a request never completes', async () => {
    jest.useFakeTimers();
    const outgoing = {
      setTimeout: jest.fn(),
      on: jest.fn(),
      end: jest.fn(),
      destroy: jest.fn(),
    };
    const request = jest
      .spyOn(http, 'request')
      .mockReturnValue(
        outgoing as unknown as import('node:http').ClientRequest,
      );
    try {
      const transport = new ApplicationPageTransport(
        'http://127.0.0.1:3000',
        new Set(['synthetic']),
        new Set(),
      );
      transport.request({
        url: 'http://127.0.0.1:3000/me',
        method: 'GET',
        header: { Authorization: 'Bearer synthetic' },
        success: jest.fn(),
        fail: jest.fn(),
      });
      const drained = expect(transport.drain()).rejects.toThrow(
        'transport deadline exceeded',
      );
      await jest.advanceTimersByTimeAsync(12_000);
      await drained;
      expect(outgoing.destroy).toHaveBeenCalled();
    } finally {
      request.mockRestore();
      jest.useRealTimers();
    }
  });
  it('rejects binary downloads of JSON routes', () => {
    const transport = new ApplicationPageTransport(
      'http://127.0.0.1:3000',
      new Set(['synthetic']),
      new Set(),
    );
    expect(() =>
      transport.download({
        url: 'http://127.0.0.1:3000/partner-applicants/me',
        header: { Authorization: 'Bearer synthetic' },
      }),
    ).toThrow('image downloads');
    expect(transport.calls).toEqual([]);
  });
});
