import { createParentRuntimeEnv, ParentRuntimeEnv } from '../config/env';
import { createRuntimeAccessTokenProvider } from '../config/local-runtime';
import {
  ApiParentDataSource,
  ParentHttpRequest,
} from '../data/api-parent-data-source';
import { MockParentDataSource } from '../data/mock-parent-data-source';
import { ParentDataSource } from '../data/parent-data-source';
import { ParentService } from './parent.service';

export function createParentService(
  env: ParentRuntimeEnv = createParentRuntimeEnv(),
  request?: ParentHttpRequest,
): ParentService {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) {
      throw new Error('家长端 API 地址不能为空');
    }
    return new ParentService(
      new ApiParentDataSource({
        baseUrl: env.apiBaseUrl,
        accessToken: createRuntimeAccessTokenProvider(env.accessToken),
        request,
      }),
    );
  }

  return new ParentService(
    new MockParentDataSource({ scenario: env.mockScenario }),
  );
}

export function createParentDataSource(
  env: ParentRuntimeEnv = createParentRuntimeEnv(),
  request?: ParentHttpRequest,
): ParentDataSource {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) throw new Error('家长端 API 地址不能为空');
    return new ApiParentDataSource({
      baseUrl: env.apiBaseUrl,
      accessToken: createRuntimeAccessTokenProvider(env.accessToken),
      request,
    });
  }
  return new MockParentDataSource({ scenario: env.mockScenario });
}

export const parentDataSource = createParentDataSource();
export const parentService = new ParentService(parentDataSource);
