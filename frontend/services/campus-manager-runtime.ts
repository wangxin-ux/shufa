import {
  createCampusManagerRuntimeEnv,
  CampusManagerRuntimeEnv,
} from '../config/campus-manager-env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';
import {
  ApiCampusManagerDataSource,
  CampusManagerHttpRequest,
} from '../data/api-campus-manager-data-source';
import { MockCampusManagerDataSource } from '../data/mock-campus-manager-data-source';
import { CampusManagerService } from './campus-manager.service';

export function createCampusManagerService(
  env: CampusManagerRuntimeEnv = createCampusManagerRuntimeEnv(),
  request?: CampusManagerHttpRequest,
): CampusManagerService {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) {
      throw new Error('管理员端 API 地址不能为空');
    }
    return new CampusManagerService(
      new ApiCampusManagerDataSource({
        baseUrl: env.apiBaseUrl,
        accessToken: createRuntimeAccessTokenProvider(env.accessToken),
        request,
      }),
    );
  }
  return new CampusManagerService(
    new MockCampusManagerDataSource({ scenario: env.mockScenario }),
  );
}

export const campusManagerService = createCampusManagerService();
