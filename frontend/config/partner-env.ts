import {
  LocalRuntimeOverrides,
  readLocalRuntimeOverrides,
} from './local-runtime';

export type PartnerDataDriver = 'mock' | 'api';
export type PartnerMockScenario = 'normal' | 'empty' | 'error';

export interface PartnerRuntimeEnv {
  dataDriver: PartnerDataDriver;
  mockScenario: PartnerMockScenario;
  apiBaseUrl: string;
  accessToken: string;
}

export const DEFAULT_PARTNER_RUNTIME_ENV: Readonly<PartnerRuntimeEnv> =
  Object.freeze({
    dataDriver: 'mock',
    mockScenario: 'normal',
    apiBaseUrl: '',
    accessToken: '',
  });

export function createPartnerRuntimeEnv(
  overrides: Partial<PartnerRuntimeEnv> = {},
  localOverrides: LocalRuntimeOverrides = readLocalRuntimeOverrides(),
): PartnerRuntimeEnv {
  return {
    dataDriver:
      overrides.dataDriver ??
      localOverrides.dataDriver ??
      DEFAULT_PARTNER_RUNTIME_ENV.dataDriver,
    mockScenario:
      overrides.mockScenario ?? DEFAULT_PARTNER_RUNTIME_ENV.mockScenario,
    apiBaseUrl:
      overrides.apiBaseUrl ??
      localOverrides.apiBaseUrl ??
      DEFAULT_PARTNER_RUNTIME_ENV.apiBaseUrl,
    accessToken:
      overrides.accessToken ??
      localOverrides.accessToken ??
      DEFAULT_PARTNER_RUNTIME_ENV.accessToken,
  };
}
