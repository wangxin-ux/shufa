import * as fs from 'fs';
import * as path from 'path';
import { SessionService } from '../services/session.service';

describe('development and formal login channels', () => {
  it('does not add a production demo-account endpoint', () => {
    const controllerSource = fs.readFileSync(
      path.resolve(__dirname, '../../backend/src/modules/auth/auth.controller.ts'),
      'utf8',
    );
    const contractSource = fs.readFileSync(
      path.resolve(__dirname, '../../contracts/openapi.yaml'),
      'utf8',
    );

    for (const source of [controllerSource, contractSource]) {
      expect(source).not.toContain('/auth/demo/login');
      expect(source).not.toContain('loginDemoAccount');
      expect(source).not.toContain('DemoAccountLoginRequest');
    }
  });

  it('supports an offline test account with a local phone code', async () => {
    const storage = runtimeStorage({ dataDriver: 'mock' });
    const service = new SessionService({
      dataDriver: 'mock',
      mockWechatAccount: 'CAMPUS_MANAGER',
      storage: storage.adapter,
    });

    await expect(
      service.requestTestPhoneCode('13800000004'),
    ).resolves.toEqual({ expiresInSeconds: 60 });
    await expect(service.load()).resolves.toBeNull();
    await expect(
      service.loginWithTestPhoneCode('13800000004', '123456'),
    ).resolves.toMatchObject({
      roles: [{ code: 'CAMPUS_MANAGER', campusId: 'campus-east' }],
    });
    expect(service.usesMockWechatSimulation()).toBe(true);
    expect(service.canSwitchTestAccount()).toBe(true);
    expect(service.listTestAccounts()).toEqual(
      expect.arrayContaining([
        { code: 'PARENT', label: '家长端' },
        { code: 'CAMPUS_MANAGER', label: '管理员端' },
      ]),
    );
    await expect(service.load()).resolves.toMatchObject({
      roles: [{ code: 'CAMPUS_MANAGER', campusId: 'campus-east' }],
    });
  });

  it.each([
    ['13800000001', 'PARENT', '陈家长', 'campus-east'],
    ['13800000002', 'PARTNER', '朱元璋', 'campus-east'],
    ['13800000003', 'TEACHER', '林老师', 'campus-east'],
    ['13800000004', 'CAMPUS_MANAGER', '周园长', 'campus-east'],
    ['13800000005', 'SUPER_ADMIN', '系统管理员', null],
    ['13800000006', 'HR', '何主管', null],
    ['13800000007', 'FINANCE', '钱会计', null],
    ['13800000008', 'PARENT', '何家长', 'campus-west'],
    ['13800000009', 'TEACHER', '周老师', 'campus-west'],
    ['13800000010', 'CAMPUS_MANAGER', '赵园长', 'campus-west'],
    ['13800000011', 'PARTNER', '孙经理', 'campus-west'],
  ] as const)(
    'maps local phone %s to %s with the expected identity and scope',
    async (phone, roleCode, displayName, campusId) => {
    const service = new SessionService({ dataDriver: 'mock' });

    const session = await service.loginWithTestPhoneCode(phone, '123456');

    expect(session).toMatchObject({
      displayName,
      roles: [{ code: roleCode, campusId }],
    });
    },
  );

  it.each([
    ['13800000001', '陈家长'],
    ['13800000002', '朱元璋'],
    ['13800000003', '林老师'],
    ['13800000004', '周园长'],
    ['13800000005', '系统管理员'],
    ['13800000006', '何主管'],
    ['13800000007', '钱会计'],
  ])('shows a natural display name for local phone %s', async (phone, displayName) => {
    const service = new SessionService({ dataDriver: 'mock' });

    const session = await service.loginWithTestPhoneCode(phone, '123456');

    expect(session.displayName).toBe(displayName);
    expect(session.displayName).not.toMatch(/测试账号|本地测试账号/);
  });

  it('uses the selected local account subject in API recording mode', async () => {
    const storage = runtimeStorage({
      dataDriver: 'api',
      apiBaseUrl: 'http://127.0.0.1:3000',
      accessToken: '',
    });
    const request = jest.fn((options) => {
      expect(options.url).toBe('http://127.0.0.1:3000/auth/login');
      expect(options.data).toEqual({ code: 'mock-demo-west-teacher' });
      options.success({
        statusCode: 200,
        data: {
          data: {
            accessToken: 'west-teacher-token',
            me: {
              userId: 'west-teacher-user',
              displayName: '周老师',
              roles: [{ code: 'TEACHER', campusId: 'campus-west' }],
            },
          },
        },
      });
    });
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'http://127.0.0.1:3000',
      testAccountSwitcherEnabled: true,
      storage: storage.adapter,
      request,
    });

    await expect(
      service.loginWithTestPhoneCode('13800000009', '123456'),
    ).resolves.toMatchObject({
      displayName: '周老师',
      roles: [{ code: 'TEACHER', campusId: 'campus-west' }],
    });
    expect(storage.values.get('education.runtime')).toMatchObject({
      accessToken: 'west-teacher-token',
    });
  });

  it('keeps test-account wording out of runtime-facing login copy', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../services/session.service.ts'),
      'utf8',
    );
    const hrPreparation = fs.readFileSync(
      path.resolve(__dirname, '../../backend/prisma/prepare-hr-demo.ts'),
      'utf8',
    );
    const financePreparation = fs.readFileSync(
      path.resolve(__dirname, '../../backend/prisma/prepare-finance-demo.ts'),
      'utf8',
    );

    expect([source, hrPreparation, financePreparation].join('\n')).not.toMatch(
      /测试账号|本地测试账号/,
    );
  });

  it('rejects code requests for unconfigured local phones', async () => {
    const service = new SessionService({ dataDriver: 'mock' });

    await expect(
      service.requestTestPhoneCode('13800000999'),
    ).rejects.toThrow('手机号或验证码错误');
  });

  it('clears the local token and mock identity on logout', async () => {
    const storage = runtimeStorage({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: 'old-token',
    });
    storage.values.set('education.test-account.current', 'TEACHER');
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: 'old-token',
      storage: storage.adapter,
    });

    service.logout();

    expect(storage.values.get('education.session.logged-out')).toBe(true);
    expect(storage.values.get('education.test-account.current')).toBe('');
    expect(storage.values.get('education.runtime')).toEqual({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: '',
    });
    await expect(service.load()).resolves.toBeNull();
  });

  it('renders a local phone-code form and keeps native phone authorization for formal mode', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.ts'),
      'utf8',
    );
    const markup = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.wxml'),
      'utf8',
    );

    expect(markup).toContain(
      'id="phone-code-login-submit"',
    );
    expect(markup).toContain('bindtap="onPhoneCodeLoginTap"');
    expect(markup).not.toContain('bindsubmit="onPhoneCodeLoginTap"');
    expect(markup).not.toContain('form-type="submit"');
    expect(markup).toContain('name="phone"');
    expect(markup).toContain('name="verificationCode"');
    expect(markup).toContain('bindtap="onRequestPhoneCodeTap"');
    expect(markup).not.toContain('name="account"');
    expect(markup).not.toContain('name="password"');
    expect(markup).toContain('open-type="getPhoneNumber"');
    expect(markup).toContain('bindgetphonenumber="onWechatPhoneTap"');
    expect(markup).not.toContain('微信快捷登录');
    expect(markup).not.toContain('wx:for="{{testAccounts}}"');
    expect(markup).not.toContain('onTestAccountTap');
    expect(script).toContain('sessionService.requestTestPhoneCode');
    expect(script).toContain('sessionService.loginWithTestPhoneCode');
    expect(script).not.toContain('loginWithTestCredentials');
    expect(script).not.toContain('requestMockPhoneAuthorization');
    expect(script).not.toContain('loginDemoAccount');
    expect(script).toContain('onPhoneCodeLoginTap');
  });

  it('uses a restrained platform-style login hierarchy', () => {
    const markup = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.wxss'),
      'utf8',
    );

    expect(markup).toContain("'手机号登录'");
    expect(markup).not.toContain('登录工作台');
    expect(markup).not.toContain('bootstrap__top');
    expect(markup).not.toContain('bootstrap__field-label');
    expect(markup).toContain(
      'disabled="{{!canSubmit || viewState === \'submitting\'}}"',
    );
    expect(markup).toContain('bootstrap__primary--disabled');
    expect(styles).toContain('background: #f6f7f9;');
    expect(styles).toMatch(
      /\.bootstrap__title\s*\{[^}]*font-family:\s*var\(--parent-font-display\)[^}]*font-weight:\s*400[^}]*line-height:\s*1\.2/s,
    );
    expect(styles).toMatch(
      /\.bootstrap::before\s*\{[^}]*background:\s*var\(--role-home-yellow-gradient\)/s,
    );
    expect(styles).toMatch(
      /\.bootstrap__field \+ \.bootstrap__field\s*\{[^}]*margin-top:\s*24rpx/s,
    );
    expect(styles).toMatch(
      /button\.bootstrap__primary--login\[disabled\]\s*\{[^}]*background:\s*#efb47e[^}]*opacity:\s*1/s,
    );
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
