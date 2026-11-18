import { assertTeacherPdfTestTarget } from './support/teacher-feedback-integration-target';

const execution = '57a981b7-54c5-434d-9193-15fb7c5e8b30';
const environment = (): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  AUTH_DRIVER: 'mock',
  PAYMENT_DRIVER: 'mock',
  MESSAGE_DRIVER: 'mock',
  DATABASE_URL:
    'postgresql://carchive:synthetic@127.0.0.1:55437/education_app_test_campus_archive_20261027_test',
  CAMPUS_ARCHIVE_TEST_DB_NAME:
    'education_app_test_campus_archive_20261027_test',
  TEACHER_FEEDBACK_INTEGRATION_EXECUTION: execution,
  TEACHER_FEEDBACK_RESOURCE_RUN: 'archive-4534b1ea9d',
  TEACHER_PDF_TEST_RUN_ID: 'main57a981b754c5',
  TEACHER_PDF_NATIVE_ENABLED: 'false',
  TEACHER_PDF_NATIVE_HISTORICAL_ONLY: 'false',
});

describe('coordinator feedback target without database connections', () => {
  it('accepts only the explicitly allocated coordinator target', () => {
    expect(assertTeacherPdfTestTarget(Object.freeze(environment())).port).toBe(
      '55437',
    );
  });
  it.each([
    ['NODE_ENV', 'development'],
    ['AUTH_DRIVER', 'wechat'],
    ['PAYMENT_DRIVER', 'wechat'],
    ['MESSAGE_DRIVER', 'wechat'],
    ['CAMPUS_ARCHIVE_TEST_DB_NAME', 'education_app'],
    ['TEACHER_FEEDBACK_INTEGRATION_EXECUTION', undefined],
    ['TEACHER_FEEDBACK_INTEGRATION_EXECUTION', 'old-run'],
    ['TEACHER_FEEDBACK_RESOURCE_RUN', 'teacher-owned'],
    ['TEACHER_PDF_TEST_RUN_ID', 'old-run'],
    ['TEACHER_PDF_NATIVE_ENABLED', 'true'],
    ['TEACHER_PDF_NATIVE_HISTORICAL_ONLY', 'true'],
  ])('rejects changed or absent %s', (key, value) => {
    expect(() =>
      assertTeacherPdfTestTarget({ ...environment(), [key]: value }),
    ).toThrow(/^Exact coordinator feedback integration target required$/);
  });
  it.each([
    'postgresql://carchive:synthetic@127.0.0.1:55435/education_app_test_teacher_pdf_run01_test',
    'postgresql://carchive:synthetic@127.0.0.1:55436/education_app_test_operator_pdf_20261026a06_test',
    'postgresql://other:synthetic@127.0.0.1:55437/education_app_test_campus_archive_20261027_test',
    'postgresql://carchive:synthetic@database.invalid:55437/education_app_test_campus_archive_20261027_test',
    'postgresql://carchive:synthetic@127.0.0.1:55437/education_app',
    'postgresql://carchive:synthetic@127.0.0.1:55437/education_app_test_campus_archive_20261027_test?schema=public',
  ])('rejects unallocated URLs without exposing credentials (%#)', (url) => {
    expect(() =>
      assertTeacherPdfTestTarget({ ...environment(), DATABASE_URL: url }),
    ).toThrow(/^Exact coordinator feedback integration target required$/);
  });
});
