const SAFETY_ERROR = 'Dedicated partner PDF test database required';

export function assertPartnerPdfTestTarget(env: NodeJS.ProcessEnv): URL {
  const reject = (): never => {
    throw new Error(SAFETY_ERROR);
  };
  let target: URL;
  try {
    target = new URL(env.DATABASE_URL ?? '');
  } catch {
    return reject();
  }

  if (
    env.NODE_ENV !== 'test' ||
    env.AUTH_DRIVER !== 'mock' ||
    env.PAYMENT_DRIVER !== 'mock' ||
    env.MESSAGE_DRIVER !== 'mock' ||
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
    !/^\/education_app_test_partner_pdf_[a-z0-9]+_test$/.test(target.pathname) ||
    target.pathname.slice(1) !== env.PARTNER_PDF_TEST_DB_NAME ||
    target.search !== '' ||
    target.hash !== ''
  ) {
    return reject();
  }
  return target;
}
