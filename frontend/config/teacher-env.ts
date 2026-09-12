import {
  LocalRuntimeOverrides,
  MockWechatAccount,
  readLocalRuntimeOverrides,
} from './local-runtime';

export type TeacherDataDriver = 'mock' | 'api';
export type TeacherMockScenario = 'normal' | 'empty' | 'error' | 'conflict';

export interface TeacherRuntimeEnv {
  dataDriver: TeacherDataDriver;
  mockScenario: TeacherMockScenario;
  apiBaseUrl: string;
  accessToken: string;
  enableTestAccountSwitcher: boolean;
  mockWechatAccount: MockWechatAccount;
}

export const DEFAULT_TEACHER_RUNTIME_ENV: Readonly<TeacherRuntimeEnv> =
  Object.freeze({
    dataDriver: 'mock',
    mockScenario: 'normal',
    apiBaseUrl: '',
    accessToken: '',
    enableTestAccountSwitcher: false,
    mockWechatAccount: 'PARENT',
  });

export function createTeacherRuntimeEnv(
  overrides: Partial<TeacherRuntimeEnv> = {},
  localOverrides: LocalRuntimeOverrides = readLocalRuntimeOverrides(),
): TeacherRuntimeEnv {
  return {
    dataDriver:
      overrides.dataDriver ??
      localOverrides.dataDriver ??
      DEFAULT_TEACHER_RUNTIME_ENV.dataDriver,
    mockScenario:
      overrides.mockScenario ?? DEFAULT_TEACHER_RUNTIME_ENV.mockScenario,
    apiBaseUrl:
      overrides.apiBaseUrl ??
      localOverrides.apiBaseUrl ??
      DEFAULT_TEACHER_RUNTIME_ENV.apiBaseUrl,
    accessToken:
      overrides.accessToken ??
      localOverrides.accessToken ??
      DEFAULT_TEACHER_RUNTIME_ENV.accessToken,
    enableTestAccountSwitcher:
      overrides.enableTestAccountSwitcher ??
      localOverrides.enableTestAccountSwitcher ??
      DEFAULT_TEACHER_RUNTIME_ENV.enableTestAccountSwitcher,
    mockWechatAccount:
      overrides.mockWechatAccount ??
      localOverrides.mockWechatAccount ??
      DEFAULT_TEACHER_RUNTIME_ENV.mockWechatAccount,
  };
}
