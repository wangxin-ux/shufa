export interface NativeCampaignScope {
  parentId: string;
  loginCode: string;
  studentId: string;
  campaigns: Map<string, string>;
  registrations: Set<string>;
}

export interface NativeCampaignRequest {
  method: string;
  path: string;
  actorId?: string;
  body?: Record<string, unknown>;
}

export function assertFreeCampaignNativeTarget(env: NodeJS.ProcessEnv): URL {
  const target = assertPartnerPdfTestTarget(env);
  if (
    target.pathname !==
      '/education_app_test_partner_pdf_20261012contact_test' ||
    target.port !== '5433'
  )
    throw new Error('Approved free campaign native database required');
  return target;
}

export function isNativeCampaignRequestAllowed(
  scope: NativeCampaignScope,
  request: NativeCampaignRequest,
): boolean {
  const { method, path, body } = request;
  if (method === 'POST' && path === '/auth/login')
    return body?.code === scope.loginCode && Object.keys(body).length === 1;
  if (request.actorId !== scope.parentId) return false;
  if (
    method === 'GET' &&
    [
      '/parents/me/free-campaigns',
      '/parents/me/campaign-registrations',
    ].includes(path)
  )
    return true;
  const campaign =
    /^\/parents\/me\/free-campaigns\/([^/]+)(\/registrations)?$/.exec(path);
  if (campaign && scope.campaigns.has(campaign[1])) {
    if (method === 'GET' && !campaign[2]) return true;
    return (
      method === 'POST' &&
      campaign[2] === '/registrations' &&
      body?.versionId === scope.campaigns.get(campaign[1]) &&
      body?.studentId === scope.studentId &&
      Object.keys(body).length === 2
    );
  }
  const registration =
    /^\/parents\/me\/campaign-registrations\/([^/]+)(\/cancel)?$/.exec(path);
  return Boolean(
    registration &&
    scope.registrations.has(registration[1]) &&
    ((method === 'GET' && !registration[2]) ||
      (method === 'POST' &&
        registration[2] === '/cancel' &&
        Number.isSafeInteger(body?.expectedVersion) &&
        Number(body?.expectedVersion) > 0 &&
        Object.keys(body ?? {}).length === 1)),
  );
}
import { assertPartnerPdfTestTarget } from './partner-pdf-test-database';
