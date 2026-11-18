export const CAMPUS_ARCHIVE_TEST_DATABASE =
  'education_app_test_campus_archive_20261027_test';

export function assertCampusArchiveTestTarget(env: NodeJS.ProcessEnv): URL {
  let target: URL;
  try {
    target = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new Error('Dedicated campus archive test database required');
  }
  if (
    env.NODE_ENV !== 'test' ||
    env.AUTH_DRIVER !== 'mock' ||
    env.PAYMENT_DRIVER !== 'mock' ||
    env.MESSAGE_DRIVER !== 'mock' ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['127.0.0.1', 'localhost'].includes(target.hostname) ||
    target.port !== '55437' ||
    target.pathname !== `/${CAMPUS_ARCHIVE_TEST_DATABASE}` ||
    env.CAMPUS_ARCHIVE_TEST_DB_NAME !== CAMPUS_ARCHIVE_TEST_DATABASE ||
    target.search !== '' ||
    target.hash !== ''
  ) {
    throw new Error('Dedicated campus archive test database required');
  }
  return target;
}
