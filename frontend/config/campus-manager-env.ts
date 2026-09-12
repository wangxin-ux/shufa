import {
  LocalRuntimeOverrides,
  readLocalRuntimeOverrides,
} from './local-runtime';

export type CampusManagerDataDriver = 'mock' | 'api';
export type CampusManagerMockScenario = 'normal' | 'empty' | 'error';

export interface CampusManagerRuntimeEnv {
  dataDriver: CampusManagerDataDriver;
  mockScenario: CampusManagerMockScenario;
  apiBaseUrl: string;
  accessToken: string;
}

export const DEFAULT_CAMPUS_MANAGER_RUNTIME_ENV: Readonly<CampusManagerRuntimeEnv> =
  Object.freeze({
    dataDriver: 'mock',
    mockScenario: 'normal',
    apiBaseUrl: '',
    accessToken: '',
  });

export function createCampusManagerRuntimeEnv(
  overrides: Partial<CampusManagerRuntimeEnv> = {},
  localOverrides: LocalRuntimeOverrides = readLocalRuntimeOverrides(),
): CampusManagerRuntimeEnv {
  return {
    dataDriver:
      overrides.dataDriver ??
      localOverrides.dataDriver ??
      DEFAULT_CAMPUS_MANAGER_RUNTIME_ENV.dataDriver,
    mockScenario:
      overrides.mockScenario ??
      DEFAULT_CAMPUS_MANAGER_RUNTIME_ENV.mockScenario,
    apiBaseUrl:
      overrides.apiBaseUrl ??
      localOverrides.apiBaseUrl ??
      DEFAULT_CAMPUS_MANAGER_RUNTIME_ENV.apiBaseUrl,
    accessToken:
      overrides.accessToken ??
      localOverrides.accessToken ??
      DEFAULT_CAMPUS_MANAGER_RUNTIME_ENV.accessToken,
  };
}
