import { createSuperAdminRuntimeEnv } from '../../../config/super-admin-env';
import { ApiPartnerApplicationReviewService, MockPartnerApplicationReviewService, type ReviewPort } from './partner-application-review.service';
let cached: { key: string; service: ReviewPort } | undefined;
export function getPartnerReviewRuntime(): ReviewPort {
  const env = createSuperAdminRuntimeEnv(); const baseUrl = env.apiBaseUrl.trim().replace(/\/+$/, '');
  const runtimeKey = JSON.stringify([env.dataDriver, baseUrl]);
  if (!cached || cached.key !== runtimeKey) {
    cached?.service.invalidateReads();
    const session = () => {
      const now = createSuperAdminRuntimeEnv();
      const same = now.dataDriver === env.dataDriver && now.apiBaseUrl.trim().replace(/\/+$/, '') === baseUrl;
      const token = same ? now.accessToken.trim() : '';
      return { token, key: env.dataDriver === 'mock' && same ? 'mock-review' : token ? `${runtimeKey}:${token}` : '' };
    };
    cached = { key: runtimeKey, service: env.dataDriver === 'mock' ? new MockPartnerApplicationReviewService(() => session().key)
      : new ApiPartnerApplicationReviewService({ baseUrl, session }) };
  }
  return cached.service;
}
