import {
  LocalRuntimeOverrides,
  MockWechatAccount,
  readLocalRuntimeOverrides,
} from './local-runtime';

export type ParentDataDriver = 'mock' | 'api';
export type ParentMockScenario = 'normal' | 'empty' | 'error';

export interface ParentRuntimeEnv {
  dataDriver: ParentDataDriver;
  mockScenario: ParentMockScenario;
  apiBaseUrl: string;
  accessToken: string;
  enableTestAccountSwitcher: boolean;
  mockWechatAccount: MockWechatAccount;
}

export const DEFAULT_PARENT_RUNTIME_ENV: Readonly<ParentRuntimeEnv> = Object.freeze({
  dataDriver: 'mock',
  mockScenario: 'normal',
  apiBaseUrl: '',
  accessToken: '',
  enableTestAccountSwitcher: false,
  mockWechatAccount: 'PARENT',
});

export function createParentRuntimeEnv(
  overrides: Partial<ParentRuntimeEnv> = {},
  localOverrides: LocalRuntimeOverrides = readLocalRuntimeOverrides(),
): ParentRuntimeEnv {
  return {
    dataDriver:
      overrides.dataDriver ??
      localOverrides.dataDriver ??
      DEFAULT_PARENT_RUNTIME_ENV.dataDriver,
    mockScenario: overrides.mockScenario ?? DEFAULT_PARENT_RUNTIME_ENV.mockScenario,
    apiBaseUrl:
      overrides.apiBaseUrl ??
      localOverrides.apiBaseUrl ??
      DEFAULT_PARENT_RUNTIME_ENV.apiBaseUrl,
    accessToken:
      overrides.accessToken ??
      localOverrides.accessToken ??
      DEFAULT_PARENT_RUNTIME_ENV.accessToken,
    enableTestAccountSwitcher:
      overrides.enableTestAccountSwitcher ??
      localOverrides.enableTestAccountSwitcher ??
      DEFAULT_PARENT_RUNTIME_ENV.enableTestAccountSwitcher,
    mockWechatAccount:
      overrides.mockWechatAccount ??
      localOverrides.mockWechatAccount ??
      DEFAULT_PARENT_RUNTIME_ENV.mockWechatAccount,
  };
}
