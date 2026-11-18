export function assertTeacherPdfTestTarget(env: NodeJS.ProcessEnv): URL {
  const reject = (): never => {
    throw new Error('Dedicated teacher PDF test database required');
  };
  let target: URL;
  try {
    target = new URL(env.DATABASE_URL ?? '');
  } catch {
    return reject();
  }
  const runId = env.TEACHER_PDF_TEST_RUN_ID ?? '';
  const name = `education_app_test_teacher_pdf_${runId}_test`;
  if (
    env.NODE_ENV !== 'test' ||
    env.AUTH_DRIVER !== 'mock' ||
    env.PAYMENT_DRIVER !== 'mock' ||
    env.MESSAGE_DRIVER !== 'mock' ||
    !/^[a-z0-9]{1,26}$/.test(runId) ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    target.pathname !== `/${name}` ||
    env.TEACHER_PDF_TEST_DB_NAME !== name ||
    target.search !== '' ||
    target.hash !== ''
  ) {
    return reject();
  }
  return target;
}
