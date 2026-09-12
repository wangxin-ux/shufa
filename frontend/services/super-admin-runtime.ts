import {
  createSuperAdminRuntimeEnv,
  SuperAdminRuntimeEnv,
} from '../config/super-admin-env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';
import {
  ApiSuperAdminDataSource,
  SuperAdminHttpRequest,
} from '../data/api-super-admin-data-source';
import { MockSuperAdminDataSource } from '../data/mock-super-admin-data-source';
import { SuperAdminService } from './super-admin.service';

export function createSuperAdminService(
  env: SuperAdminRuntimeEnv = createSuperAdminRuntimeEnv(),
  request?: SuperAdminHttpRequest,
): SuperAdminService {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) {
      throw new Error('总端 API 地址不能为空');
    }
    return new SuperAdminService(
      new ApiSuperAdminDataSource({
        baseUrl: env.apiBaseUrl,
        accessToken: createRuntimeAccessTokenProvider(env.accessToken),
        request,
      }),
    );
  }
  return new SuperAdminService(
    new MockSuperAdminDataSource({ scenario: env.mockScenario }),
  );
}

export const superAdminService = createSuperAdminService();
