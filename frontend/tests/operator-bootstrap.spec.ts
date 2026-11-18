import { resolveLocalTestAccountCode, resolveRoleBootstrap, SessionService } from '../services/session.service';
import { capture, fixture, flush } from './operator-page-host';

describe('independent operator entry', () => {
  it.each(['__proto__', 'constructor', 'toString', 'UNKNOWN'])(
    'does not recognize inherited or unknown account keys: %s', value => {
      expect(resolveLocalTestAccountCode(value)).toBeUndefined();
    },
  );
  it('opens an independent operator page while preserving the manager entry', () => {
    expect(resolveRoleBootstrap({
      userId: 'operator', displayName: '运营',
      roles: [{ code: 'OPERATOR', campusId: 'campus-east' }],
    })).toEqual({ kind: 'navigate', url: '/pages/operator/home/index' });
    expect(resolveRoleBootstrap({
      userId: 'manager', displayName: '管理员',
      roles: [{ code: 'CAMPUS_MANAGER', campusId: 'campus-east' }],
    })).toEqual({ kind: 'navigate', url: '/pages/campus-manager/home/index' });
  });

  it('does not send a total account or a mixed identity to campus operator pages', () => {
    const headquarters = resolveRoleBootstrap({
      userId: 'headquarters', displayName: '总部运营',
      roles: [{ code: 'OPERATOR', campusId: null }],
    });
    expect(headquarters).toEqual({ kind: 'navigate', url: '/pages/operator/headquarters/index' });
    expect(headquarters).not.toEqual({ kind: 'navigate', url: '/pages/operator/home/index' });
    for (const roles of [
      [{ code: 'OPERATOR' as const, campusId: '' }],
      [
        { code: 'OPERATOR' as const, campusId: 'campus-east' },
        { code: 'CAMPUS_MANAGER' as const, campusId: 'campus-east' },
      ],
    ]) {
      expect(resolveRoleBootstrap({ userId: 'bad', displayName: '', roles }))
        .toEqual({ kind: 'forbidden' });
    }
  });

  it('offers a separate operator test identity only when test switching is enabled', () => {
    const mock = new SessionService({ dataDriver: 'mock' });
    expect(mock.listTestAccounts()).toContainEqual({ code: 'OPERATOR', label: '运营端' });
    const formal = new SessionService({ dataDriver: 'api', testAccountSwitcherEnabled: false });
    expect(formal.listTestAccounts()).toEqual([]);
  });

  it('opens and reloads the operator client from a separate local phone login', async () => {
    const values = new Map<string, unknown>();
    const service = new SessionService({
      dataDriver: 'mock',
      testAccountSwitcherEnabled: true,
      storage: {
        get: (key) => values.get(key),
        set: (key, value) => { values.set(key, value); },
      },
    });
    await expect(service.requestTestPhoneCode('13800000012'))
      .resolves.toEqual({ expiresInSeconds: 60 });
    const me = await service.loginWithTestPhoneCode('13800000012', '123456');
    expect(me.roles).toEqual([{ code: 'OPERATOR', campusId: 'campus-east' }]);
    expect(resolveRoleBootstrap(me))
      .toEqual({ kind: 'navigate', url: '/pages/operator/home/index' });
    expect(await service.load()).toEqual(me);
  });

  it('loads the actual operator home after logging in with the local phone', async () => {
    const host = capture(['home'], 'mock');
    try {
      const service = new SessionService({
        dataDriver: 'mock',
        testAccountSwitcherEnabled: true,
        storage: {
          get: (key) => host.values.get(key),
          set: (key, value) => { host.values.set(key, value); },
        },
      });
      await service.loginWithTestPhoneCode('13800000012', '123456');
      const page = host.instantiate();
      page.onLoad();
      page.onShow();
      await flush();
      expect(page.data).toMatchObject({
        viewState: 'ready',
        campusName: fixture.dashboard.campus.name,
        pendingCount: String(fixture.leaveRequests
          .filter(row => row.status === 'PENDING' && row.canReview === true).length),
      });
      expect(host.calls).toHaveLength(0);
    } finally { host.close(); }
  });

  it.each([
    ['13800000001', 'PARENT', 'east-parent', 'campus-east'],
    ['13800000002', 'PARTNER', 'east-partner', 'campus-east'],
    ['13800000003', 'TEACHER', 'east-teacher', 'campus-east'],
    ['13800000004', 'CAMPUS_MANAGER', 'east-campus-manager', 'campus-east'],
    ['13800000005', 'SUPER_ADMIN', 'super-admin', null],
    ['13800000006', 'HR', 'hr', null],
    ['13800000007', 'FINANCE', 'finance', null],
    ['13800000008', 'PARENT', 'west-parent', 'campus-west'],
    ['13800000009', 'TEACHER', 'west-teacher', 'campus-west'],
    ['13800000010', 'CAMPUS_MANAGER', 'west-campus-manager', 'campus-west'],
    ['13800000011', 'PARTNER', 'west-partner', 'campus-west'],
    ['13800000012', 'OPERATOR', 'east-operator', 'campus-east'],
  ] as const)('preserves local and API identity mappings for %s', async (phone, code, loginCode, campusId) => {
    const values = new Map<string, unknown>();
    const storage = { get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => { values.set(key, value); } };
    const mock = new SessionService({ dataDriver: 'mock', storage });
    const me = await mock.loginWithTestPhoneCode(phone, '123456');
    expect(me.roles).toEqual([{ code, campusId }]);
    expect(await mock.load()).toEqual(me);
    const request = jest.fn(options => options.success({ statusCode: 200,
      data: { data: { accessToken: 'synthetic-account-token', me } } }));
    const api = new SessionService({ dataDriver: 'api', apiBaseUrl: 'https://example.test',
      testAccountSwitcherEnabled: true, storage, request });
    expect(await api.loginWithTestPhoneCode(phone, '123456')).toEqual(me);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'POST', url: 'https://example.test/auth/login', data: { code: `mock-demo-${loginCode}` },
    }));
  });

  it.each(['13800000004', '13800000008', 'unknown'])(
    'rejects a different local identity %s at the actual operator home',
    async (account) => {
      const host = capture(['home'], 'mock');
      try {
        host.values.set('education.test-account.current', account);
        const page = host.instantiate();
        page.onLoad();
        page.onShow();
        await flush();
        expect(page.data).toMatchObject({ viewState: 'forbidden', campusName: '', stats: [] });
        expect(host.calls).toHaveLength(0);
      } finally { host.close(); }
    },
  );

  it('requires the explicit local test switch even for a valid operator phone', async () => {
    const host = capture(['home'], 'mock');
    try {
      host.values.set('education.test-account.current', '13800000012');
      host.change({ enableTestAccountSwitcher: false });
      const page = host.instantiate();
      page.onLoad();
      page.onShow();
      await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', campusName: '', stats: [] });
    } finally { host.close(); }
  });
});
