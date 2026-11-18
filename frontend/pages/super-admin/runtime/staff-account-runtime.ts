import { createSuperAdminRuntimeEnv, type SuperAdminRuntimeEnv } from '../../../config/super-admin-env';
import { ApiSuperAdminDataSource, type SuperAdminHttpRequest } from '../../../data/api-super-admin-data-source';
import { MockSuperAdminDataSource } from '../../../data/mock-super-admin-data-source';
import { SuperAdminService } from '../../../services/super-admin.service';

export type StaffAccountPort = Pick<SuperAdminService,
  'loadCampuses' | 'loadStaffAccounts' | 'createStaffAccount' | 'updateStaffAccountStatus' | 'unbindStaffWechat'>;
const keyOf = (env: SuperAdminRuntimeEnv) =>
  JSON.stringify([env.dataDriver, env.apiBaseUrl.trim().replace(/\/+$/, ''), env.accessToken.trim(), env.mockScenario]);
export const staffAccountSessionKey = () => keyOf(createSuperAdminRuntimeEnv());
let cached: { key: string; service: StaffAccountPort } | undefined;

export function getStaffAccountRuntime(): StaffAccountPort {
  const env = createSuperAdminRuntimeEnv(); const key = keyOf(env);
  if (cached?.key === key) return cached.service;
  const baseUrl = env.apiBaseUrl.trim().replace(/\/+$/, ''); const token = env.accessToken.trim();
  const request: SuperAdminHttpRequest = (input) => {
    const superseded = () => input.success({ statusCode: 409,
      data: { code: 'SESSION_SUPERSEDED', message: '登录已更新，请重新读取账号' } });
    if (key !== staffAccountSessionKey()) { superseded(); return; }
    if (!baseUrl || !token) {
      input.success({ statusCode: token ? 400 : 401, data: { code: 'STAFF_RUNTIME_UNAVAILABLE',
        message: token ? '总端 API 地址不能为空' : '总端登录已失效' } });
      return;
    }
    wx.request({
      url: input.url, method: input.method as WechatMiniprogram.RequestOption['method'], header: input.header,
      data: input.data as WechatMiniprogram.IAnyObject | undefined,
      success: (response) => {
        if (key !== staffAccountSessionKey()) { superseded(); return; }
        input.success({ statusCode: response.statusCode, data: response.data });
      },
      fail: (error) => { if (key === staffAccountSessionKey()) input.fail(error); else superseded(); },
    });
  };
  cached = { key, service: new SuperAdminService(env.dataDriver === 'api'
    ? new ApiSuperAdminDataSource({ baseUrl, accessToken: token, request })
    : new MockSuperAdminDataSource({ scenario: env.mockScenario })) };
  return cached.service;
}
