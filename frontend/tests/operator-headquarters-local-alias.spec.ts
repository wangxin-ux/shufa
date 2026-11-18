import {
  aliasInput, apiRuntime, captureHeadquartersBootstrap, expectHeadquartersSession,
  flushBootstrap, HEADQUARTERS_ALIAS, HEADQUARTERS_URL, OPERATOR_URL, outcome,
} from './operator-headquarters-bootstrap.fixture';
import type { BootstrapHost } from './operator-headquarters-bootstrap.fixture';

describe('headquarters local alias through actual runtime and session', () => {
  let host: BootstrapHost | undefined;
  afterEach(() => { host?.close(); host = undefined; });

  it('accepts the local alias in actual runtime decoding without creating a ninth role', () => {
    host = captureHeadquartersBootstrap({
      dataDriver: 'mock', enableTestAccountSwitcher: true, mockWechatAccount: HEADQUARTERS_ALIAS,
    });
    expect(host.local.readLocalRuntimeOverrides()).toMatchObject({ mockWechatAccount: HEADQUARTERS_ALIAS });
    expect(host.teacher.createTeacherRuntimeEnv().mockWechatAccount).toBe(HEADQUARTERS_ALIAS);
  });

  it('lists headquarters separately and preserves ordinary operator when mock and raw switch are true', () => {
    host = captureHeadquartersBootstrap({ dataDriver: 'mock', enableTestAccountSwitcher: true });
    const accounts = host.service.listTestAccounts();
    expect(accounts.filter(account => String(account.code) === HEADQUARTERS_ALIAS)).toHaveLength(1);
    expect(accounts.find(account => String(account.code) === HEADQUARTERS_ALIAS)?.label).toMatch(/[\u4e00-\u9fff]/);
    expect(accounts).toContainEqual({ code: 'OPERATOR', label: '运营端' });
  });

  it('selects and restores the headquarters alias as exactly one null-campus OPERATOR', async () => {
    host = captureHeadquartersBootstrap({ dataDriver: 'mock', enableTestAccountSwitcher: true });
    const result = await outcome(host.service.switchTestAccount(aliasInput));
    expect(result.error).toBeUndefined();
    expectHeadquartersSession(result.value);
    expect(host.values.get('education.test-account.current')).toBe(HEADQUARTERS_ALIAS);
    expectHeadquartersSession(await host.service.load());
    const page = host.instantiate();
    await page.loadSession();
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
    expect(host.calls).toHaveLength(0);
    expect(host.platform.login).not.toHaveBeenCalled();
  });

  it('uses the explicit allowed raw default alias for mock login and bootstrap', async () => {
    host = captureHeadquartersBootstrap({
      dataDriver: 'mock', enableTestAccountSwitcher: true, mockWechatAccount: HEADQUARTERS_ALIAS,
    });
    const me = await host.service.loginWithMockWechat();
    expectHeadquartersSession(me);
    expect(host.values.get('education.test-account.current')).toBe(HEADQUARTERS_ALIAS);
    const page = host.instantiate();
    await page.loadSession();
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
    expect(host.calls).toHaveLength(0);
  });

  it('restores an already selected alias only in the explicitly enabled mock environment', async () => {
    host = captureHeadquartersBootstrap({ dataDriver: 'mock', enableTestAccountSwitcher: true }, HEADQUARTERS_ALIAS);
    expectHeadquartersSession(await host.service.load());
    expect(host.calls).toHaveLength(0);
  });

  const deniedSwitches: Array<[string, Record<string, unknown>]> = [
    ['missing', { dataDriver: 'mock' }],
    ['false', { dataDriver: 'mock', enableTestAccountSwitcher: false }],
    ['string-true', { dataDriver: 'mock', enableTestAccountSwitcher: 'true' }],
    ['numeric-one', { dataDriver: 'mock', enableTestAccountSwitcher: 1 }],
  ];
  it.each(deniedSwitches)('does not list a headquarters alias for raw switch %s', (_name, runtime) => {
    host = captureHeadquartersBootstrap(runtime);
    expect(host.service.listTestAccounts().map(account => String(account.code))).not.toContain(HEADQUARTERS_ALIAS);
  });
  it.each(deniedSwitches)('refuses selecting headquarters without storage mutations for raw switch %s', async (_name, runtime) => {
    host = captureHeadquartersBootstrap(runtime, 'OPERATOR');
    const before = host.snapshot();
    const result = await outcome(host.service.switchTestAccount(aliasInput));
    expect(result.error).toBeInstanceOf(Error);
    expect(host.snapshot()).toEqual(before);
    expect(result.error).not.toBeInstanceOf(TypeError);
    expect(host.calls).toHaveLength(0);
  });
  it.each(deniedSwitches)('refuses using the raw default headquarters alias for raw switch %s', async (_name, runtime) => {
    host = captureHeadquartersBootstrap({ ...runtime, mockWechatAccount: HEADQUARTERS_ALIAS });
    const before = host.snapshot();
    const result = await outcome(host.service.loginWithMockWechat());
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).not.toBeInstanceOf(TypeError);
    expect(host.snapshot()).toEqual(before);
    expect(host.calls).toHaveLength(0);
  });
  it.each(deniedSwitches)('does not restore a selected headquarters alias for raw switch %s', async (_name, runtime) => {
    host = captureHeadquartersBootstrap(runtime, HEADQUARTERS_ALIAS);
    await expect(host.service.load()).resolves.toBeNull();
    expect(host.calls).toHaveLength(0);
  });

  it('a constructor flag alone cannot enable the alias when raw runtime lacks the switch', async () => {
    host = captureHeadquartersBootstrap({ dataDriver: 'mock' });
    const service = new host.modules.SessionService({
      dataDriver: 'mock', testAccountSwitcherEnabled: true, mockWechatAccount: aliasInput,
    });
    const before = host.snapshot();
    const result = await outcome(service.switchTestAccount(aliasInput));
    expect(result.error).toBeInstanceOf(Error);
    expect(host.snapshot()).toEqual(before);
    expect(result.error).not.toBeInstanceOf(TypeError);
    expect(service.listTestAccounts().map(account => String(account.code))).not.toContain(HEADQUARTERS_ALIAS);
  });

  it.each([false, true])('API never lists a headquarters local alias, even with switch %s', enabled => {
    host = captureHeadquartersBootstrap(apiRuntime({ enableTestAccountSwitcher: enabled }));
    expect(host.service.listTestAccounts().map(account => String(account.code))).not.toContain(HEADQUARTERS_ALIAS);
  });

  it.each([false, true])('API switchTestAccount rejects the local alias before any POST, switch %s', async enabled => {
    host = captureHeadquartersBootstrap(apiRuntime({ enableTestAccountSwitcher: enabled }));
    const before = host.snapshot();
    const pending = outcome(host.service.switchTestAccount(aliasInput));
    await flushBootstrap();
    host.rejectUnexpectedPosts();
    const result = await pending;
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).not.toBeInstanceOf(TypeError);
    expect(host.calls).toHaveLength(0);
    expect(host.platform.login).not.toHaveBeenCalled();
    expect(host.snapshot()).toEqual(before);
  });

  it.each([false, true])('API mock login rejects the raw default local alias before any POST, switch %s', async enabled => {
    host = captureHeadquartersBootstrap(apiRuntime({
      enableTestAccountSwitcher: enabled, mockWechatAccount: HEADQUARTERS_ALIAS,
    }));
    const before = host.snapshot();
    const pending = outcome(host.service.loginWithMockWechat());
    await flushBootstrap();
    host.rejectUnexpectedPosts();
    const result = await pending;
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error).not.toBeInstanceOf(TypeError);
    expect(host.calls).toHaveLength(0);
    expect(host.platform.login).not.toHaveBeenCalled();
    expect(host.snapshot()).toEqual(before);
  });

  it('API does not restore a local selected alias as a headquarters session without /me', async () => {
    host = captureHeadquartersBootstrap(apiRuntime({ accessToken: '', enableTestAccountSwitcher: true }), HEADQUARTERS_ALIAS);
    await expect(host.service.load()).resolves.toBeNull();
    expect(host.calls).toHaveLength(0);
    expect(host.platform.login).not.toHaveBeenCalled();
  });

  it('ordinary mock OPERATOR remains single-campus home', async () => {
    host = captureHeadquartersBootstrap({
      dataDriver: 'mock', enableTestAccountSwitcher: true, mockWechatAccount: 'OPERATOR',
    });
    const me = await host.service.switchTestAccount('OPERATOR');
    expect(me.roles).toEqual([{ code: 'OPERATOR', campusId: 'campus-east' }]);
    const page = host.instantiate();
    await page.loadSession();
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: OPERATOR_URL });
    expect(host.calls).toHaveLength(0);
  });
});
