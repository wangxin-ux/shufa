import {
  API_BASE, apiRuntime, campusMe, captureHeadquartersBootstrap, finishNewIdentity,
  flushBootstrap, HEADQUARTERS_URL, headquartersMe, OPERATOR_URL, outcome,
} from './operator-headquarters-bootstrap.fixture';
import type { BootstrapHost } from './operator-headquarters-bootstrap.fixture';

describe('headquarters shared bootstrap wiring through real modules', () => {
  let host: BootstrapHost | undefined;
  afterEach(() => { host?.close(); host = undefined; });

  it('HOST: captures real modules and an ordinary API session through wx only', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    expect(jest.isMockFunction(host.modules.resolveRoleBootstrap)).toBe(false);
    expect(jest.isMockFunction(host.service.load)).toBe(false);
    const page = host.instantiate();
    const pending = page.loadSession();
    expect(host.calls).toHaveLength(1);
    expect(host.calls[0]).toMatchObject({
      method: 'GET', url: `${API_BASE}/me`,
      header: { Authorization: 'Bearer synthetic-bootstrap-owner-a' },
    });
    host.replyMe(0, campusMe);
    await pending;
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: OPERATOR_URL });
  });

  it('routes a unique null-campus OPERATOR from actual /me through real resolver and bootstrap', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const page = host.instantiate();
    page.onLoad();
    expect(host.calls[0]).toMatchObject({ method: 'GET', url: `${API_BASE}/me` });
    host.replyMe(0, headquartersMe);
    await flushBootstrap();
    expect(host.modules.resolveRoleBootstrap(headquartersMe)).toEqual({ kind: 'navigate', url: HEADQUARTERS_URL });
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
    expect(host.calls.filter(call => call.method === 'POST')).toHaveLength(0);
  });

  it('preserves ordinary single-campus OPERATOR home', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const page = host.instantiate();
    const pending = page.loadSession();
    host.replyMe(0, campusMe);
    await pending;
    expect(host.modules.resolveRoleBootstrap(campusMe)).toEqual({ kind: 'navigate', url: OPERATOR_URL });
    expect(host.platform.reLaunch).toHaveBeenCalledTimes(1);
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: OPERATOR_URL });
  });

  it.each([
    ['missing-campus', [{ code: 'OPERATOR' }]],
    ['empty-campus', [{ code: 'OPERATOR', campusId: '' }]],
    ['mixed-null-operator', [{ code: 'OPERATOR', campusId: null }, { code: 'SUPER_ADMIN', campusId: null }]],
    ['mixed-campus-operator', [{ code: 'OPERATOR', campusId: campusMe.roles[0].campusId }, { code: 'TEACHER', campusId: campusMe.roles[0].campusId }]],
  ])('rejects malformed or mixed identity from /me: %s', async (_label, roles) => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const page = host.instantiate();
    const pending = page.loadSession();
    host.replyMe(0, { ...headquartersMe, roles });
    await pending;
    expect(page.data.viewState).toBe('forbidden');
    expect(host.platform.reLaunch).not.toHaveBeenCalled();
    expect(host.calls).toHaveLength(1);
  });

  it('keeps SUPER_ADMIN on its existing destination rather than treating it as headquarters operator', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const page = host.instantiate();
    const pending = page.loadSession();
    host.replyMe(0, { ...headquartersMe, roles: [{ code: 'SUPER_ADMIN', campusId: null }] });
    await pending;
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: '/pages/super-admin/home/index' });
    expect(host.platform.reLaunch).not.toHaveBeenCalledWith({ url: HEADQUARTERS_URL });
  });

  it('real shared logout clears the API token and selection after confirmation', async () => {
    host = captureHeadquartersBootstrap(apiRuntime(), 'OPERATOR');
    host.logout.methods.onLogoutTap();
    const modal = host.platform.showModal.mock.calls[0][0];
    modal.success({ confirm: true, cancel: false });
    expect(host.values.get('education.session.logged-out')).toBe(true);
    expect(host.values.get('education.test-account.current')).toBe('');
    expect(host.runtime().accessToken).toBe('');
    expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
    await expect(host.service.load()).resolves.toBeNull();
    expect(host.calls).toHaveLength(0);
  });

  it('cancelled real shared logout preserves the current identity', () => {
    host = captureHeadquartersBootstrap(apiRuntime(), 'OPERATOR');
    const before = host.snapshot();
    host.logout.methods.onLogoutTap();
    host.platform.showModal.mock.calls[0][0].success({ confirm: false, cancel: true });
    expect(host.snapshot()).toEqual(before);
    expect(host.platform.reLaunch).not.toHaveBeenCalled();
  });

  it.each(['success', 'unauthorized', 'network'] as const)(
    'old /me completion after logout and new login cannot mutate the new session: %s',
    async mode => {
      host = captureHeadquartersBootstrap(apiRuntime());
      const old = outcome(host.service.load());
      expect(host.calls).toHaveLength(1);
      host.service.logout();
      await finishNewIdentity(host);
      const before = host.snapshot();
      if (mode === 'network') host.calls[0].fail(new Error('synthetic-old-read-failure'));
      else host.replyMe(0, headquartersMe, mode === 'unauthorized' ? 401 : 200);
      const result = await old;
      expect(result.error).toBeInstanceOf(Error);
      expect(result.value).toBeUndefined();
      expect(host.snapshot()).toEqual(before);
      const fresh = host.service.load();
      expect(host.calls[2]).toMatchObject({ method: 'GET', header: { Authorization: 'Bearer synthetic-bootstrap-owner-b' } });
      host.replyMe(2, campusMe);
      await expect(fresh).resolves.toEqual(campusMe);
    },
  );

  it('a late older login response cannot replace the identity issued by the newer login', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const old = outcome(host.service.bindWechatStaffPhone('synthetic-old-phone-code'));
    await flushBootstrap();
    host.service.logout();
    await finishNewIdentity(host);
    const before = host.snapshot();
    host.replyLogin(0, headquartersMe, 'synthetic-old-login-token');
    expect((await old).error).toBeInstanceOf(Error);
    expect(host.snapshot()).toEqual(before);
  });

  it.each(['success', 'unauthorized', 'network'] as const)(
    'old bootstrap /me callback cannot write over or navigate after a newer identity: %s',
    async mode => {
      host = captureHeadquartersBootstrap(apiRuntime());
      const page = host.instantiate();
      const old = page.loadSession();
      host.service.logout();
      await finishNewIdentity(host);
      const fresh = page.loadSession();
      host.replyMe(2, campusMe);
      await fresh;
      expect(host.platform.reLaunch).toHaveBeenCalledWith({ url: OPERATOR_URL });
      const before = host.snapshot();
      const writes = page.setData.mock.calls.length;
      const navigations = host.platform.reLaunch.mock.calls.length;
      if (mode === 'network') host.calls[0].fail(new Error('synthetic-old-page-read-failure'));
      else host.replyMe(0, headquartersMe, mode === 'unauthorized' ? 401 : 200);
      await old;
      expect(host.snapshot()).toEqual(before);
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(host.platform.reLaunch).toHaveBeenCalledTimes(navigations);
    },
  );

  it('unloaded old bootstrap cannot write after logout and a new identity', async () => {
    host = captureHeadquartersBootstrap(apiRuntime());
    const page = host.instantiate();
    const pending = page.loadSession();
    page.onUnload();
    host.service.logout();
    await finishNewIdentity(host);
    const before = host.snapshot();
    const writes = page.setData.mock.calls.length;
    host.replyMe(0, headquartersMe);
    await pending;
    expect(host.snapshot()).toEqual(before);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(host.platform.reLaunch).not.toHaveBeenCalled();
  });
});
