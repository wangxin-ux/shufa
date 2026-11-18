import type { NativeCampaignRequest } from './free-campaign-native-policy';

export interface PartnerFreeNativeScope {
  partnerId: string;
  loginCode: string;
  draftId: string;
  draftVersion: number;
  configuration?: {
    basics: {
      expectedVersion: number;
      basicInformation: Record<string, string | null>;
    };
    settings: {
      expectedVersion: number;
      freeRegistration: Record<string, string | number | null>;
    };
  };
}

function samePayload(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== 'object')
    return actual === expected;
  if (!actual || typeof actual !== 'object' || Array.isArray(actual))
    return false;
  const keys = Object.keys(expected);
  return (
    Object.keys(actual).length === keys.length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(actual, key) &&
        samePayload(
          (actual as Record<string, unknown>)[key],
          (expected as Record<string, unknown>)[key],
        ),
    )
  );
}

export function isPartnerFreeNativeRequestAllowed(
  scope: PartnerFreeNativeScope,
  request: NativeCampaignRequest,
): boolean {
  const { method, path, body } = request;
  if (method === 'POST' && path === '/auth/login')
    return body?.code === scope.loginCode && Object.keys(body).length === 1;
  if (request.actorId !== scope.partnerId || !scope.draftId) return false;
  const base = `/partners/me/campaign-drafts/${scope.draftId}`;
  if (method === 'GET')
    return ['', '/free-registration', '/versions', '/registrations'].some(
      (suffix) => path === base + suffix,
    );
  if (scope.configuration) {
    const { basics, settings } = scope.configuration;
    return (
      method === 'PUT' &&
      ((path === base + '/basic-information' &&
        basics.expectedVersion === scope.draftVersion &&
        samePayload(body, basics)) ||
        (path === base + '/free-registration' &&
          settings.expectedVersion === scope.draftVersion + 1 &&
          samePayload(body, settings)))
    );
  }
  return (
    method === 'POST' &&
    path === base + '/submit' &&
    body?.expectedVersion === scope.draftVersion &&
    Object.keys(body).length === 1
  );
}
