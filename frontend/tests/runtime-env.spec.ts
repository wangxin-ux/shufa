import { createParentRuntimeEnv } from '../config/env';
import {
  LOCAL_RUNTIME_STORAGE_KEY,
  readLocalRuntimeOverrides,
} from '../config/local-runtime';
import { createTeacherRuntimeEnv } from '../config/teacher-env';

describe('local runtime configuration', () => {
  it('shares one validated API override across parent and teacher runtimes', () => {
    const getStorage = jest.fn((key: string) => {
      expect(key).toBe(LOCAL_RUNTIME_STORAGE_KEY);
      return {
        dataDriver: 'api',
        apiBaseUrl: 'http://localhost:3100',
        accessToken: 'local-token',
        enableTestAccountSwitcher: true,
        mockWechatAccount: 'TEACHER',
      };
    });
    const local = readLocalRuntimeOverrides(getStorage);

    expect(createParentRuntimeEnv({}, local)).toMatchObject({
      dataDriver: 'api',
      apiBaseUrl: 'http://localhost:3100',
      accessToken: 'local-token',
      enableTestAccountSwitcher: true,
      mockWechatAccount: 'TEACHER',
    });
    expect(createTeacherRuntimeEnv({}, local)).toMatchObject({
      dataDriver: 'api',
      apiBaseUrl: 'http://localhost:3100',
      accessToken: 'local-token',
      enableTestAccountSwitcher: true,
      mockWechatAccount: 'TEACHER',
    });
  });

  it('ignores malformed storage and lets explicit overrides win', () => {
    expect(
      readLocalRuntimeOverrides(() => ({
        dataDriver: 'production',
        apiBaseUrl: 123,
        accessToken: null,
        enableTestAccountSwitcher: 'yes',
        mockWechatAccount: 'UNKNOWN',
      })),
    ).toEqual({});

    expect(
      createParentRuntimeEnv(
        { dataDriver: 'mock', mockScenario: 'empty' },
        {
          dataDriver: 'api',
          apiBaseUrl: 'http://localhost:3100',
          accessToken: 'local-token',
        },
      ),
    ).toMatchObject({ dataDriver: 'mock', mockScenario: 'empty' });
  });
});
