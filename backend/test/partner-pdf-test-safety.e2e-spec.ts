type ValidateTarget = (env: NodeJS.ProcessEnv) => URL;

const loadValidator = (): ValidateTarget =>
  (
    jest.requireActual('./support/partner-pdf-test-database') as {
      assertPartnerPdfTestTarget: ValidateTarget;
    }
  ).assertPartnerPdfTestTarget;

function isolatedEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    DATABASE_URL:
      'postgresql://fixture:synthetic@127.0.0.1:5432/education_app_test_partner_pdf_run01_test',
    PARTNER_PDF_TEST_DB_NAME: 'education_app_test_partner_pdf_run01_test',
  };
}

describe('partner PDF database safety gate (no database connection)', () => {
  it('accepts only an explicitly named local dedicated test database', () => {
    const result = loadValidator()(isolatedEnvironment());
    expect(result.pathname).toBe('/education_app_test_partner_pdf_run01_test');
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts loopback host %s with an identical database allowlist',
    (host) => {
      const env = isolatedEnvironment();
      env.DATABASE_URL =
        `postgres://fixture:synthetic@${host}:5432/${env.PARTNER_PDF_TEST_DB_NAME}`;
      expect(loadValidator()(env).hostname).toBe(host);
    },
  );

  it.each([
    '',
    'not-a-url',
    'file:///education_app_test_partner_pdf_run01_test',
    'postgresql://fixture:synthetic@database.example/education_app_test_partner_pdf_run01_test',
    'postgresql://fixture:synthetic@127.0.0.1/education_app',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_demo',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_parent_native_run01_test',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_partner_pdf_run01_test?schema=public',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_partner_pdf_run01_test#ignored',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_partner_pdf_run01_test/extra',
  ])('rejects an unsafe URL without echoing credentials (%#)', (databaseUrl) => {
    const env = { ...isolatedEnvironment(), DATABASE_URL: databaseUrl };
    expect(() => loadValidator()(env)).toThrow(
      'Dedicated partner PDF test database required',
    );
    try {
      loadValidator()(env);
    } catch (error) {
      expect(String(error)).not.toContain('synthetic');
      expect(String(error)).not.toContain(databaseUrl || 'fixture:');
    }
  });

  it.each([
    ['NODE_ENV', 'development'],
    ['AUTH_DRIVER', 'wechat'],
    ['PAYMENT_DRIVER', 'wechat'],
    ['MESSAGE_DRIVER', 'wechat'],
    ['PARTNER_PDF_TEST_DB_NAME', 'education_app'],
    ['PARTNER_PDF_TEST_DB_NAME', undefined],
  ])('rejects unsafe %s', (key, value) => {
    const env = isolatedEnvironment();
    env[key!] = value;
    expect(() => loadValidator()(env)).toThrow(
      'Dedicated partner PDF test database required',
    );
  });

  it('does not modify the supplied process configuration', () => {
    const env = Object.freeze(isolatedEnvironment());
    const before = { ...env };
    loadValidator()(env);
    expect(env).toEqual(before);
  });
});
