import {
  LocalRuntimeOverrides,
  readLocalRuntimeOverrides,
} from '../../../../config/local-runtime';

export type OperatorDataDriver = 'mock' | 'api';
export type OperatorMockScenario = 'normal' | 'empty' | 'error';

export interface OperatorRuntimeEnv {
  dataDriver: OperatorDataDriver;
  mockScenario: OperatorMockScenario;
  apiBaseUrl: string;
  accessToken: string;
}

export const DEFAULT_OPERATOR_RUNTIME_ENV: Readonly<OperatorRuntimeEnv> =
  Object.freeze({
    dataDriver: 'mock',
    mockScenario: 'normal',
    apiBaseUrl: '',
    accessToken: '',
  });

export function createOperatorRuntimeEnv(
  overrides: Partial<OperatorRuntimeEnv> = {},
  localOverrides: LocalRuntimeOverrides = readLocalRuntimeOverrides(),
): OperatorRuntimeEnv {
  return {
    dataDriver:
      overrides.dataDriver ??
      localOverrides.dataDriver ??
      DEFAULT_OPERATOR_RUNTIME_ENV.dataDriver,
    mockScenario:
      overrides.mockScenario ??
      DEFAULT_OPERATOR_RUNTIME_ENV.mockScenario,
    apiBaseUrl:
      overrides.apiBaseUrl ??
      localOverrides.apiBaseUrl ??
      DEFAULT_OPERATOR_RUNTIME_ENV.apiBaseUrl,
    accessToken:
      overrides.accessToken ??
      localOverrides.accessToken ??
      DEFAULT_OPERATOR_RUNTIME_ENV.accessToken,
  };
}
