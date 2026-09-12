import * as fs from 'fs';
import * as path from 'path';
import {
  resolveRoleBootstrap,
  SessionHttpRequest,
  SessionService,
  SessionView,
} from '../services/session.service';

const session = (roles: SessionView['roles']): SessionView => ({
  userId: 'user-1',
  displayName: '演示用户',
  roles,
});

describe('role bootstrap', () => {
  it('keeps the failed session view padded and centered in its own panel', () => {
    const markup = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.resolve(__dirname, '../pages/bootstrap/index.wxss'),
      'utf8',
    );

    expect(markup).toContain('bootstrap__state bootstrap__state--error');
    expect(markup).toContain('class="bootstrap__error-mark"');
    expect(styles).toMatch(
      /\.bootstrap\s*\{[^}]*padding:\s*env\(safe-area-inset-top\)\s+48rpx\s+calc\(env\(safe-area-inset-bottom\)\s*\+\s*64rpx\)/s,
    );
    expect(styles).toMatch(/\.bootstrap__state--error\s*\{[^}]*align-items:\s*center[^}]*width:\s*100%[^}]*background:\s*rgba\([^}]*box-shadow:/s);
    const errorButtonStyles = styles.match(
      /\.bootstrap__state--error\s+\.bootstrap__primary\s*\{([^}]*)\}/s,
    )?.[1] ?? '';
    expect(errorButtonStyles).toMatch(/height:\s*88rpx/);
    expect(errorButtonStyles).toMatch(/align-items:\s*center/);
    expect(errorButtonStyles).toMatch(/justify-content:\s*center/);
    expect(errorButtonStyles).toMatch(/line-height:\s*1/);
  });

  it('shows a login prompt when no session exists', () => {
    expect(resolveRoleBootstrap(null)).toEqual({ kind: 'login' });
  });

  it('uses the same WeChat login state for local and formal sessions', () => {
    expect(resolveRoleBootstrap(null)).toEqual({ kind: 'login' });
  });

  it('routes a single supported role to its home page', () => {
    expect(
      resolveRoleBootstrap(
        session([{ code: 'PARENT', campusId: 'campus-1' }]),
      ),
    ).toEqual({ kind: 'navigate', url: '/pages/parent/home/index' });
    expect(
      resolveRoleBootstrap(
        session([{ code: 'PARTNER', campusId: 'campus-1' }]),
      ),
    ).toEqual({ kind: 'navigate', url: '/pages/partner/home/index' });
    expect(
      resolveRoleBootstrap(
        session([{ code: 'TEACHER', campusId: 'campus-1' }]),
      ),
    ).toEqual({ kind: 'navigate', url: '/pages/teacher/home/index' });
    expect(
      resolveRoleBootstrap(
        session([{ code: 'CAMPUS_MANAGER', campusId: 'campus-1' }]),
      ),
    ).toEqual({ kind: 'navigate', url: '/pages/campus-manager/home/index' });
    expect(
      resolveRoleBootstrap(
        session([{ code: 'SUPER_ADMIN', campusId: null }]),
      ),
    ).toEqual({ kind: 'navigate', url: '/pages/super-admin/home/index' });
  });

  it('rejects multi-role sessions instead of exposing production role switching', () => {
    expect(
      resolveRoleBootstrap(
        session([
          { code: 'PARENT', campusId: 'campus-1' },
          { code: 'TEACHER', campusId: 'campus-1' },
        ]),
      ),
    ).toEqual({ kind: 'forbidden' });
    expect(
      resolveRoleBootstrap(
        session([
          { code: 'TEACHER', campusId: 'campus-1' },
          { code: 'OPERATOR', campusId: 'campus-1' },
        ]),
      ),
    ).toEqual({ kind: 'forbidden' });
  });

  it('rejects role scopes that do not match the routed client', () => {
    expect(
      resolveRoleBootstrap(session([{ code: 'PARENT', campusId: null }])),
    ).toEqual({ kind: 'forbidden' });
    expect(
      resolveRoleBootstrap(
        session([{ code: 'SUPER_ADMIN', campusId: 'campus-1' }]),
      ),
    ).toEqual({ kind: 'forbidden' });
  });

  it('forbids unsupported or missing roles without accepting a plaintext phone identity', () => {
    expect(resolveRoleBootstrap(session([]))).toEqual({ kind: 'forbidden' });
    const source = fs.readFileSync(
      path.resolve(__dirname, '../services/session.service.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/phoneNumber\s*:/);
  });

  it('registers bootstrap first while retaining every parent and teacher route', () => {
    const app = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'),
    ) as {
      pages: string[];
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const registeredPages = [
      ...app.pages,
      ...app.subPackages.flatMap(({ root, pages }) =>
        pages.map((page) => `${root}/${page}`),
      ),
    ];
    expect(app.pages[0]).toBe('pages/bootstrap/index');
    expect(registeredPages).toEqual(
      expect.arrayContaining([
        'pages/parent/home/index',
        'pages/parent/hours/index',
        'pages/parent/leave/index',
        'pages/parent/profile/index',
        'pages/partner/home/index',
        'pages/teacher/home/index',
        'pages/teacher/settings/index',
        'pages/campus-manager/home/index',
      ]),
    );
  });

  it('loads the API session from /me with bearer authentication', async () => {
    const requests: Parameters<SessionHttpRequest>[0][] = [];
    const request: SessionHttpRequest = (options) => {
      requests.push(options);
      options.success({
        statusCode: 200,
        data: {
          data: session([{ code: 'TEACHER', campusId: 'campus-1' }]),
          requestId: 'request-session-1',
        },
      });
    };
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test/api/',
      accessToken: 'teacher-token',
      request,
    });

    await expect(service.load()).resolves.toEqual(
      session([{ code: 'TEACHER', campusId: 'campus-1' }]),
    );
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://example.test/api/me',
      header: { Authorization: 'Bearer teacher-token' },
    });
  });

  it('lets local development sign in with a different account after logout', async () => {
    const storage = new Map<string, unknown>();
    const service = new SessionService({
      dataDriver: 'mock',
      mockWechatAccount: 'PARENT',
      storage: {
        get: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
      },
    });

    await expect(service.load()).resolves.toBeNull();
    expect(service.usesMockWechatSimulation()).toBe(true);
    expect(service.canSwitchTestAccount()).toBe(true);
    expect(service.listTestAccounts()).toEqual(
      expect.arrayContaining([
        { code: 'PARENT', label: '家长端' },
        { code: 'TEACHER', label: '教师端' },
        { code: 'CAMPUS_MANAGER', label: '管理员端' },
        { code: 'SUPER_ADMIN', label: '总端' },
        { code: 'HR', label: '人力端' },
        { code: 'FINANCE', label: '财务端' },
      ]),
    );

    await expect(
      service.loginWithTestPhoneCode('13800000003', '123456'),
    ).resolves.toMatchObject({
      userId: 'mock-teacher-user',
      roles: [{ code: 'TEACHER', campusId: 'campus-east' }],
    });
    service.logout();
    await expect(service.load()).resolves.toBeNull();
    await expect(
      service.loginWithTestPhoneCode('13800000001', '123456'),
    ).resolves.toMatchObject({
      userId: 'mock-parent-user',
      roles: [{ code: 'PARENT', campusId: 'campus-east' }],
    });
  });

  it('rejects an invalid local phone code without creating a session', async () => {
    const storage = new Map<string, unknown>();
    const service = new SessionService({
      dataDriver: 'mock',
      storage: {
        get: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
      },
    });

    await expect(
      service.loginWithTestPhoneCode('13800000003', '000000'),
    ).rejects.toThrow('手机号或验证码错误');
    await expect(service.load()).resolves.toBeNull();
  });

  it('uses the hidden API Mock adapter and caches only its issued token', async () => {
    const storage = new Map<string, unknown>([
      [
        'education.runtime',
        {
          dataDriver: 'api',
          apiBaseUrl: 'https://example.test',
          enableTestAccountSwitcher: true,
        },
      ],
    ]);
    const requests: Parameters<SessionHttpRequest>[0][] = [];
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: '',
      testAccountSwitcherEnabled: true,
      mockWechatAccount: 'PARENT',
      storage: {
        get: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
      },
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: {
            data: {
              accessToken: 'parent-api-token',
              refreshToken: 'refresh-token',
              expiresInSeconds: 3600,
              me: session([{ code: 'PARENT', campusId: 'campus-1' }]),
            },
            requestId: 'request-login-parent',
          },
        });
      },
    });

    await expect(
      service.requestTestPhoneCode('13800000001'),
    ).resolves.toEqual({ expiresInSeconds: 60 });
    expect(requests).toHaveLength(0);
    await expect(
      service.loginWithTestPhoneCode('13800000001', '123456'),
    ).resolves.toEqual(session([{ code: 'PARENT', campusId: 'campus-1' }]));
    expect(requests[0]).toMatchObject({
      method: 'POST',
      url: 'https://example.test/auth/login',
      data: { code: 'mock-demo-east-parent' },
    });
    expect(storage.get('education.runtime')).toEqual({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      enableTestAccountSwitcher: true,
      accessToken: 'parent-api-token',
    });
  });

  it('keeps the test account selector disabled in formal API mode', () => {
    const service = new SessionService({
      dataDriver: 'api',
      apiBaseUrl: 'https://example.test',
      accessToken: 'token',
    });

    expect(service.canSwitchTestAccount()).toBe(false);
    expect(service.usesMockWechatSimulation()).toBe(false);
    expect(service.listTestAccounts()).toEqual([]);
  });
});
