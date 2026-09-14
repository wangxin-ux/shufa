import * as fs from 'fs';
import * as path from 'path';
import {
  SessionHttpRequest,
  SessionService,
  SessionView,
} from '../services/session.service';

const staffSession: SessionView = {
  userId: 'staff-1',
  displayName: '林老师',
  roles: [{ code: 'TEACHER', campusId: 'campus-1' }],
};

const authEnvelope = (accessToken = 'staff-access-token') => ({
  data: {
    accessToken,
    refreshToken: 'staff-refresh-token',
    expiresInSeconds: 3600,
    me: staffSession,
  },
});

describe('WeChat staff quick login', () => {
  it('falls back from an expired cached token to silent wx.login and persists the new token', async () => {
    const storage = runtimeStorage({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: 'expired-token',
    });
    const requests: Parameters<SessionHttpRequest>[0][] = [];
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test/',
      accessToken: 'expired-token',
      storage: storage.adapter,
      loginCodeProvider: async () => 'fresh-login-code',
      request: (options) => {
        requests.push(options);
        if (options.url.endsWith('/me')) {
          options.success({ statusCode: 401, data: { code: 'UNAUTHORIZED' } });
          return;
        }
        options.success({ statusCode: 200, data: authEnvelope() });
      },
    });

    await expect(service.load()).resolves.toEqual(staffSession);
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/auth/wechat/login',
      data: { code: 'fresh-login-code' },
    });
    expect(storage.values.get('education.runtime')).toEqual({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: 'staff-access-token',
    });
  });

  it('treats an unbound WeChat identity as the normal phone authorization state', async () => {
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: '',
      loginCodeProvider: async () => 'unbound-login-code',
      request: (options) =>
        options.success({
          statusCode: 409,
          data: {
            code: 'STAFF_PHONE_BINDING_REQUIRED',
            message: 'Phone authorization is required',
          },
        }),
    });

    await expect(service.load()).resolves.toBeNull();
  });

  it('binds with a fresh login code and phone code without persisting either code', async () => {
    const storage = runtimeStorage({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
    });
    const requests: Parameters<SessionHttpRequest>[0][] = [];
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: '',
      storage: storage.adapter,
      loginCodeProvider: async () => 'fresh-bind-login-code',
      request: (options) => {
        requests.push(options);
        options.success({ statusCode: 200, data: authEnvelope('bound-token') });
      },
    });

    await expect(
      service.bindWechatStaffPhone('one-time-phone-code', 'bind-key'),
    ).resolves.toEqual(staffSession);
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/auth/wechat/staff/bind-phone',
      header: { 'Idempotency-Key': 'bind-key' },
      data: {
        code: 'fresh-bind-login-code',
        phoneCode: 'one-time-phone-code',
      },
    });
    expect(JSON.stringify([...storage.values.entries()])).not.toContain(
      'one-time-phone-code',
    );
    expect(JSON.stringify([...storage.values.entries()])).not.toContain(
      'fresh-bind-login-code',
    );
  });

  it.each([
    ['STAFF_ACCOUNT_UNAVAILABLE', '暂无对应工作人员账号，请联系管理员'],
    ['WECHAT_IDENTITY_CONFLICT', '该账号或微信已绑定，请联系管理员'],
    ['WECHAT_PROVIDER_RESPONSE_INVALID', '微信授权信息无效，请重试'],
  ])('maps %s to a stable Chinese message', async (code, message) => {
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: '',
      loginCodeProvider: async () => 'fresh-bind-login-code',
      request: (options) =>
        options.success({ statusCode: 409, data: { code, message: 'English' } }),
    });

    await expect(
      service.bindWechatStaffPhone('one-time-phone-code', 'bind-key'),
    ).rejects.toMatchObject({ code, message });
  });

  it('uses explicit API test-account mode without invoking wx.login', async () => {
    let loginCalls = 0;
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: '',
      testAccountSwitcherEnabled: true,
      mockWechatAccount: 'TEACHER',
      loginCodeProvider: async () => {
        loginCalls += 1;
        return 'must-not-run';
      },
    });

    await expect(service.load()).resolves.toBeNull();
    expect(loginCalls).toBe(0);
    expect(service.usesMockWechatSimulation()).toBe(true);
    expect(service.canSwitchTestAccount()).toBe(true);
    expect(service.listTestAccounts()).toContainEqual({
      code: 'TEACHER',
      label: '教师端',
    });
  });

  it('uses the native WeChat phone button and keeps authorization errors on the login view', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.ts'),
      'utf8',
    );
    const markup = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.wxml'),
      'utf8',
    );
    expect(markup).toContain('open-type="getPhoneNumber"');
    expect(markup).toContain('bindgetphonenumber="onWechatPhoneTap"');
    expect(markup).toContain('bindtap="onPhoneCodeLoginTap"');
    expect(markup).not.toContain('bindsubmit="onPhoneCodeLoginTap"');
    expect(markup).not.toContain('form-type="submit"');
    expect(markup).toContain('微信授权登录');
    expect(script).toContain('bindWechatStaffPhone');
    expect(script).toContain('loginWithTestPhoneCode');
    expect(script).not.toContain('requestMockPhoneAuthorization');
    expect(script).toContain("viewState: 'login'");
  });
});

function runtimeStorage(runtime: Record<string, unknown>) {
  const values = new Map<string, unknown>([['education.runtime', runtime]]);
  return {
    values,
    adapter: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
  };
}
