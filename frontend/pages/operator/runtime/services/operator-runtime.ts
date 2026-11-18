import {
  createOperatorRuntimeEnv,
  OperatorRuntimeEnv,
} from '../config/operator-env';
import {
  ApiOperatorDataSource,
  OperatorHttpRequest,
} from '../data/api-operator-data-source';
import { MockOperatorDataSource } from '../data/mock-operator-data-source';
import { OperatorService } from './operator.service';

export function createOperatorService(
  env: OperatorRuntimeEnv = createOperatorRuntimeEnv(),
  request?: OperatorHttpRequest,
  accessToken: string | (() => string) = env.accessToken,
): OperatorService {
  if (env.dataDriver === 'api') {
    if (!env.apiBaseUrl.trim()) {
      throw new Error('运营端 API 地址不能为空');
    }
    return new OperatorService(
      new ApiOperatorDataSource({
        baseUrl: env.apiBaseUrl.trim().replace(/\/+$/, ''),
        accessToken,
        request,
      }),
    );
  }
  return new OperatorService(
    new MockOperatorDataSource({ scenario: env.mockScenario }),
  );
}

