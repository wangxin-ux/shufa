import { createSuperAdminRuntimeEnv } from '../../../config/super-admin-env';
import { SessionService, sessionService } from '../../../services/session.service';
import { ApiFreeCampaignReviewService, MockFreeCampaignReviewService, type FreeCampaignReviewPort } from './free-campaign-review.service';

let cached: { key: string; service: FreeCampaignReviewPort } | undefined;
export function logoutFreeCampaignReviewer(): void {
  new SessionService({ dataDriver: createSuperAdminRuntimeEnv().dataDriver }, sessionService).logout();
}
function mockAccount(): string {
  try {
    if (wx.getStorageSync('education.session.logged-out') === true) return '';
    const account = wx.getStorageSync('education.test-account.current');
    return typeof account === 'string' ? account : '';
  } catch { return ''; }
}
export function getFreeCampaignReviewRuntime(): FreeCampaignReviewPort {
  const env = createSuperAdminRuntimeEnv();
  const baseUrl = env.apiBaseUrl.trim().replace(/\/+$/, '');
  const runtimeKey = JSON.stringify([env.dataDriver, baseUrl]);
  if (!cached || cached.key !== runtimeKey) {
    cached?.service.invalidateReads();
    const session = () => {
      const current = createSuperAdminRuntimeEnv();
      if (current.dataDriver !== env.dataDriver || current.apiBaseUrl.trim().replace(/\/+$/, '') !== baseUrl) return { key: '', token: '' };
      const token = current.accessToken.trim();
      const account = env.dataDriver === 'mock' ? mockAccount() : '';
      return { token, key: env.dataDriver === 'mock' ? account ? JSON.stringify([runtimeKey, token, account]) : ''
        : token ? JSON.stringify([runtimeKey, token]) : '' };
    };
    const mockSession = env.dataDriver === 'mock' ? new SessionService({ dataDriver: 'mock' }) : undefined;
    cached = { key: runtimeKey, service: env.dataDriver === 'mock'
      ? new MockFreeCampaignReviewService(() => session().key, async () => {
        const view = await mockSession!.load();
        return Boolean(view && view.roles.length === 1 && view.roles[0].code === 'SUPER_ADMIN' && view.roles[0].campusId === null);
      })
      : new ApiFreeCampaignReviewService({ baseUrl, session }) };
  }
  return cached.service;
}
