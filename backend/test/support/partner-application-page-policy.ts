import { assertPartnerPdfTestTarget } from './partner-pdf-test-database';

export function assertApplicationPageTestTarget(env: NodeJS.ProcessEnv): URL {
  const target = assertPartnerPdfTestTarget(env);
  if (
    target.hostname !== '127.0.0.1' ||
    target.port !== '5433' ||
    target.pathname !== '/education_app_test_partner_pdf_20261012contact_test'
  )
    throw new Error('Exact application Page test database required');
  return target;
}
