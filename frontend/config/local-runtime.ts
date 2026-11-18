export const LOCAL_RUNTIME_STORAGE_KEY = 'education.runtime';

export type MockWechatAccount =
  | 'PARENT'
  | 'PARTNER'
  | 'TEACHER'
  | 'CAMPUS_MANAGER'
  | 'OPERATOR'
  | 'OPERATOR_HEADQUARTERS'
  | 'SUPER_ADMIN'
  | 'HR'
  | 'FINANCE';

const MOCK_WECHAT_ACCOUNTS: readonly MockWechatAccount[] = [
  'PARENT',
  'PARTNER',
  'TEACHER',
  'CAMPUS_MANAGER',
  'OPERATOR',
  'OPERATOR_HEADQUARTERS',
  'SUPER_ADMIN',
  'HR',
  'FINANCE',
];

export interface LocalRuntimeOverrides {
  dataDriver?: 'mock' | 'api';
  apiBaseUrl?: string;
  accessToken?: string;
  enableTestAccountSwitcher?: boolean;
  mockWechatAccount?: MockWechatAccount;
  parentMockScenario?: 'visual' | 'profile-setup';
  partnerMockScenario?: 'visual';
}

export type RuntimeStorageReader = (key: string) => unknown;

function defaultStorageReader(key: string): unknown {
  return typeof wx === 'undefined' ? undefined : wx.getStorageSync(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readLocalRuntimeOverrides(
  getStorage: RuntimeStorageReader = defaultStorageReader,
): LocalRuntimeOverrides {
  let stored: unknown;
  try {
    stored = getStorage(LOCAL_RUNTIME_STORAGE_KEY);
  } catch {
    return {};
  }
  if (!isRecord(stored)) {
    return {};
  }

  const result: LocalRuntimeOverrides = {};
  if (stored.dataDriver === 'mock' || stored.dataDriver === 'api') {
    result.dataDriver = stored.dataDriver;
  }
  if (typeof stored.apiBaseUrl === 'string') {
    result.apiBaseUrl = stored.apiBaseUrl;
  }
  if (typeof stored.accessToken === 'string') {
    result.accessToken = stored.accessToken;
  }
  if (typeof stored.enableTestAccountSwitcher === 'boolean') {
    result.enableTestAccountSwitcher = stored.enableTestAccountSwitcher;
  }
  if (stored.parentMockScenario === 'visual' || stored.parentMockScenario === 'profile-setup') {
    result.parentMockScenario = stored.parentMockScenario;
  }
  if (stored.partnerMockScenario === 'visual') {
    result.partnerMockScenario = stored.partnerMockScenario;
  }
  if (
    typeof stored.mockWechatAccount === 'string' &&
    MOCK_WECHAT_ACCOUNTS.includes(stored.mockWechatAccount as MockWechatAccount)
  ) {
    result.mockWechatAccount = stored.mockWechatAccount as MockWechatAccount;
  }
  return result;
}

export function createRuntimeAccessTokenProvider(
  fallback: string,
): () => string {
  return () => readLocalRuntimeOverrides().accessToken ?? fallback;
}
