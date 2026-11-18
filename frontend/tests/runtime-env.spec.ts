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

  it('accepts an explicit parent visual fixture without changing the API driver', () => {
    const local = readLocalRuntimeOverrides(() => ({
      dataDriver: 'api', parentMockScenario: 'visual', accessToken: 'local-token',
    }));
    expect(local).toMatchObject({ dataDriver: 'api', parentMockScenario: 'visual' });
    expect(createParentRuntimeEnv({}, local)).toMatchObject({
      dataDriver: 'api', mockScenario: 'visual', accessToken: 'local-token',
    });
    expect(createParentRuntimeEnv({ mockScenario: 'empty' }, local).mockScenario).toBe('empty');
    expect(readLocalRuntimeOverrides(() => ({ parentMockScenario: 'unknown' }))).toEqual({});
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
