import {
  createPartnerRuntimeEnv,
  PartnerRuntimeEnv,
} from '../config/partner-env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';
import {
  ApiPartnerDataSource,
  PartnerHttpRequest,
} from '../data/api-partner-data-source';
import { MockPartnerDataSource } from '../data/mock-partner-data-source';
import { PartnerService } from './partner.service';

export function createPartnerService(
  env: PartnerRuntimeEnv = createPartnerRuntimeEnv(),
  request?: PartnerHttpRequest,
): PartnerService {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) {
      throw new Error('合作方端 API 地址不能为空');
    }
    return new PartnerService(
      new ApiPartnerDataSource({
        baseUrl: env.apiBaseUrl,
        accessToken: createRuntimeAccessTokenProvider(env.accessToken),
        request,
      }),
    );
  }
  return new PartnerService(
    new MockPartnerDataSource({ scenario: env.mockScenario }),
  );
}

export const partnerService = createPartnerService();
