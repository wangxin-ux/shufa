import {
  LocalRuntimeOverrides,
  readLocalRuntimeOverrides,
} from './local-runtime';

export type SuperAdminDataDriver = 'mock' | 'api';
export type SuperAdminMockScenario = 'normal' | 'empty' | 'error';

export interface SuperAdminRuntimeEnv {
  dataDriver: SuperAdminDataDriver;
  mockScenario: SuperAdminMockScenario;
  apiBaseUrl: string;
  accessToken: string;
}

export const DEFAULT_SUPER_ADMIN_RUNTIME_ENV: Readonly<SuperAdminRuntimeEnv> =
  Object.freeze({
    dataDriver: 'mock',
    mockScenario: 'normal',
    apiBaseUrl: '',
    accessToken: '',
  });

export function createSuperAdminRuntimeEnv(
  overrides: Partial<SuperAdminRuntimeEnv> = {},
  localOverrides: LocalRuntimeOverrides = readLocalRuntimeOverrides(),
): SuperAdminRuntimeEnv {
  return {
    dataDriver:
      overrides.dataDriver ??
      localOverrides.dataDriver ??
      DEFAULT_SUPER_ADMIN_RUNTIME_ENV.dataDriver,
    mockScenario:
      overrides.mockScenario ?? DEFAULT_SUPER_ADMIN_RUNTIME_ENV.mockScenario,
    apiBaseUrl:
      overrides.apiBaseUrl ??
      localOverrides.apiBaseUrl ??
      DEFAULT_SUPER_ADMIN_RUNTIME_ENV.apiBaseUrl,
    accessToken:
      overrides.accessToken ??
      localOverrides.accessToken ??
      DEFAULT_SUPER_ADMIN_RUNTIME_ENV.accessToken,
  };
}
