import * as fs from 'fs';
import * as path from 'path';
import {
  buildTeacherSettingsModel,
  SessionService,
} from '../services/session.service';

describe('teacher settings', () => {
  it('builds identity, campus and environment labels from runtime data', () => {
    expect(
      buildTeacherSettingsModel(
        {
          displayName: '林老师',
          subjectLabel: '综合材料',
          campusName: '城东校区',
          responsibleStudentCount: 12,
          roleCode: 'TEACHER',
        },
        'mock',
      ),
    ).toEqual({
      displayName: '林老师',
      identityLabel: '授课老师 · 综合材料',
      campusLabel: '城东校区',
      environmentLabel: '本地演示数据',
    });
    expect(
      buildTeacherSettingsModel(
        {
          displayName: '林老师',
          subjectLabel: '综合材料',
          campusName: '城东校区',
          responsibleStudentCount: 12,
          roleCode: 'TEACHER',
        },
        'api',
      ).environmentLabel,
    ).toBe('接口联调');
  });

  it('persists logout and returns bootstrap as the only destination', async () => {
    const storage = new Map<string, unknown>();
    const service = new SessionService({
      dataDriver: 'mock',
      mockWechatAccount: 'TEACHER',
      storage: {
        get: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
      },
    });

    await service.loginWithMockWechat();
    expect(await service.load()).not.toBeNull();
    service.logout();
    expect(await service.load()).toBeNull();
    expect(service.logoutDestination).toBe('/pages/bootstrap/index');
  });

  it('clears the local mock identity on logout', async () => {
    const storage = new Map<string, unknown>([
      ['education.test-account.current', 'TEACHER'],
    ]);
    const service = new SessionService({
      dataDriver: 'mock',
      mockWechatAccount: 'TEACHER',
      storage: {
        get: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
      },
    });

    await expect(service.load()).resolves.toMatchObject({
      roles: [{ code: 'TEACHER', campusId: 'campus-east' }],
    });
    service.logout();
    expect(storage.get('education.test-account.current')).toBe('');
    await expect(service.load()).resolves.toBeNull();
  });

  it('keeps test-account selection available in development mode', async () => {
    const storage = new Map<string, unknown>();
    const service = new SessionService({
      dataDriver: 'mock',
      storage: {
        get: (key) => storage.get(key),
        set: (key, value) => storage.set(key, value),
      },
    });

    await service.loginWithMockWechat();
    expect(service.canSwitchTestAccount()).toBe(true);
    expect(service.listTestAccounts()).toContainEqual({
      code: 'PARENT',
      label: '家长端',
    });
    await expect(service.switchTestAccount('PARENT')).resolves.toMatchObject({
      roles: [{ code: 'PARENT', campusId: 'campus-east' }],
    });
  });

  it('uses the shared logout control without a second account-switch command', () => {
    const root = path.resolve(__dirname, '..');
    const logic = fs.readFileSync(
      path.join(root, 'pages/teacher/settings/index.ts'),
      'utf8',
    );
    const markup = fs.readFileSync(
      path.join(root, 'pages/teacher/settings/index.wxml'),
      'utf8',
    );
    const config = JSON.parse(
      fs.readFileSync(
        path.join(root, 'pages/teacher/settings/index.json'),
        'utf8',
      ),
    ) as { usingComponents?: Record<string, string> };
    expect(logic).not.toContain('sessionService.canSwitchTestAccount()');
    expect(logic).not.toContain('sessionService.prepareTestAccountSwitch()');
    expect(config.usingComponents?.['session-logout']).toBe(
      '/components/session-logout/session-logout',
    );
    expect(markup).not.toContain('onSwitchTestAccountTap');
    expect(markup).not.toContain('showTestAccountSwitcher');
    expect(markup).not.toMatch(/切换(?:本地)?测试账号|切换使用身份/);
    expect(markup).toContain('<session-logout');
    expect(markup).not.toMatch(/课时费|提现|财务/);
  });
});
