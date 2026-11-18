type ValidateTarget = (env: NodeJS.ProcessEnv) => URL;

const validate = (env: NodeJS.ProcessEnv) =>
  jest
    .requireActual<{ assertTeacherPdfTestTarget: ValidateTarget }>(
      './support/teacher-pdf-test-database',
    )
    .assertTeacherPdfTestTarget(env);

function environment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    AUTH_DRIVER: 'mock',
    PAYMENT_DRIVER: 'mock',
    MESSAGE_DRIVER: 'mock',
    DATABASE_URL:
      'postgresql://fixture:synthetic@127.0.0.1:55435/education_app_test_teacher_pdf_run01_test',
    TEACHER_PDF_TEST_DB_NAME: 'education_app_test_teacher_pdf_run01_test',
    TEACHER_PDF_TEST_RUN_ID: 'run01',
  };
}

describe('teacher PDF database target gate without connections', () => {
  it.each(['127.0.0.1', 'localhost', '[::1]'])(
    'accepts explicit matching teacher targets on %s',
    (host) => {
      const env = environment();
      env.DATABASE_URL = env.DATABASE_URL!.replace('127.0.0.1', host);
      expect(validate(Object.freeze(env)).pathname).toBe(
        '/education_app_test_teacher_pdf_run01_test',
      );
    },
  );

  it.each([
    '',
    'invalid',
    'file:///education_app_test_teacher_pdf_run01_test',
    'postgresql://fixture:synthetic@database.invalid/education_app_test_teacher_pdf_run01_test',
    'postgresql://fixture:synthetic@127.0.0.1/education_app',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_partner_pdf_run01_test',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_teacher_pdf_run02_test',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_teacher_pdf_run01_test?schema=public',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_teacher_pdf_run01_test#ignored',
    'postgresql://fixture:synthetic@127.0.0.1/education_app_test_teacher_pdf_run01_test/extra',
  ])('rejects unsafe URLs without exposing credentials (%#)', (url) => {
    expect(() => validate({ ...environment(), DATABASE_URL: url })).toThrow(
      /^Dedicated teacher PDF test database required$/,
    );
  });

  it.each([
    ['NODE_ENV', 'development'],
    ['AUTH_DRIVER', 'wechat'],
    ['PAYMENT_DRIVER', 'wechat'],
    ['MESSAGE_DRIVER', 'wechat'],
    ['TEACHER_PDF_TEST_DB_NAME', 'education_app'],
    ['TEACHER_PDF_TEST_DB_NAME', undefined],
    ['TEACHER_PDF_TEST_RUN_ID', undefined],
    ['TEACHER_PDF_TEST_RUN_ID', 'run02'],
    ['TEACHER_PDF_TEST_RUN_ID', 'RUN01'],
    ['TEACHER_PDF_TEST_RUN_ID', '../run01'],
  ])('rejects unsafe or missing %s', (key, value) => {
    const env = environment();
    env[key] = value;
    expect(() => validate(env)).toThrow(
      /^Dedicated teacher PDF test database required$/,
    );
  });
});
