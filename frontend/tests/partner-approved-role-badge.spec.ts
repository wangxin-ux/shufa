import * as fs from 'fs';
import * as path from 'path';

const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({
  getPartnerApplicationRuntime: () => getRuntime(),
}));

const root = path.resolve(__dirname, '..');
const componentPath = path.join(root, 'pages/partner/components/approved-role-badge/index.ts');
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('server-confirmed formal partner identity badge', () => {
  let badge: any;
  let definition: any;
  let runtime: any;
  let key: string;
  const flush = async () => {
    for (let count = 0; count < 12; count++) await Promise.resolve();
  };
  const open = async () => {
    definition.lifetimes.attached.call(badge);
    definition.pageLifetimes.show.call(badge);
    await flush();
  };
  beforeEach(() => {
    jest.useFakeTimers();
    key = 'formal:synthetic-token';
    runtime = {
      formalArchive: true,
      sessions: {
        getSessionKey: () => key,
        loadMe: jest.fn().mockResolvedValue({ displayName: '合成正式合作方', formalAccountReady: true }),
        invalidateReads: jest.fn(), login: jest.fn(), logout: jest.fn(),
      },
    };
    getRuntime.mockReset().mockReturnValue(runtime);
    (global as any).wx = {
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 47 }),
      getMenuButtonBoundingClientRect: () => ({ top: 51, left: 272, height: 32 }),
    };
    (global as any).Component = (config: any) => {
      definition = config;
      badge = { ...config.methods, data: { ...config.data } };
      badge.setData = jest.fn((patch: object) => Object.assign(badge.data, patch));
    };
    expect(fs.existsSync(componentPath)).toBe(true);
    jest.isolateModules(() => require(componentPath));
  });
  afterEach(() => {
    definition?.lifetimes.detached.call(badge);
    definition = undefined;
    delete (global as any).wx;
    delete (global as any).Component;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('starts hidden and waits for the trusted formal profile, with one initial read', async () => {
    const pending = deferred();
    runtime.sessions.loadMe.mockReturnValue(pending.promise);
    await open();
    expect(badge.data.approved).toBe(false);
    expect(runtime.sessions.loadMe).toHaveBeenCalledTimes(1);
    pending.resolve({ formalAccountReady: true });
    await flush();
    expect(badge.data.approved).toBe(true);
    expect(runtime.sessions.login).not.toHaveBeenCalled();
    expect(runtime.sessions.logout).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED'])(
    'does not promote applicant credentials even with status %s or a ready formal account',
    async (status) => {
      runtime.formalArchive = false;
      runtime.applicationStatus = status;
      runtime.sessions.loadMe.mockResolvedValue({ formalAccountReady: true });
      await open();
      expect(badge.data.approved).toBe(false);
      expect(runtime.sessions.loadMe).not.toHaveBeenCalled();
    },
  );

  it('does not read without a valid formal credential', async () => {
    key = '';
    await open();
    expect(runtime.sessions.loadMe).not.toHaveBeenCalled();
    expect(badge.data.approved).toBe(false);
  });

  it.each([401, 403, 500])('fails closed and clears an earlier badge after identity failure %s', async (statusCode) => {
    await open();
    expect(badge.data.approved).toBe(true);
    runtime.sessions.loadMe.mockRejectedValue(Object.assign(new Error('合成拒绝'), { statusCode }));
    definition.pageLifetimes.show.call(badge);
    expect(badge.data.approved).toBe(false);
    await flush();
    expect(badge.data.approved).toBe(false);
  });

  it('handles synchronous runtime and identity transport failures without an unhandled rejection', async () => {
    getRuntime.mockImplementationOnce(() => { throw new Error('配置不可用'); });
    definition.lifetimes.attached.call(badge);
    await flush();
    expect(badge.data.approved).toBe(false);
    runtime.sessions.loadMe.mockImplementation(() => { throw new Error('传输不可用'); });
    await badge.refreshApproval();
    expect(badge.data.approved).toBe(false);
  });

  it('requires the formal readiness fact even after a successful read', async () => {
    runtime.sessions.loadMe.mockResolvedValue({ formalAccountReady: false });
    await open();
    expect(badge.data.approved).toBe(false);
  });

  it.each(['hide', 'detached'])('ignores an identity response after %s without invalidating shared application reads', async (action) => {
    const pending = deferred();
    runtime.sessions.loadMe.mockReturnValue(pending.promise);
    await open();
    if (action === 'hide') definition.pageLifetimes.hide.call(badge);
    else definition.lifetimes.detached.call(badge);
    badge.setData.mockClear();
    pending.resolve({ formalAccountReady: true });
    await flush();
    expect(badge.setData).not.toHaveBeenCalled();
    expect(runtime.sessions.invalidateReads).not.toHaveBeenCalled();
  });

  it('rejects a response for a replaced credential or runtime', async () => {
    const first = deferred();
    runtime.sessions.loadMe.mockReturnValueOnce(first.promise);
    await open();
    key = 'formal:new-synthetic-token';
    first.resolve({ formalAccountReady: true });
    await flush();
    expect(badge.data.approved).toBe(false);
    const second = deferred();
    runtime.sessions.loadMe.mockReturnValueOnce(second.promise);
    const pending = badge.refreshApproval();
    await flush();
    getRuntime.mockReturnValue({ ...runtime });
    second.resolve({ formalAccountReady: true });
    await pending;
    expect(badge.data.approved).toBe(false);
  });

  it('refreshes on return and ignores an old hidden-instance response', async () => {
    const old = deferred();
    runtime.sessions.loadMe.mockReturnValueOnce(old.promise);
    await open();
    definition.pageLifetimes.hide.call(badge);
    definition.pageLifetimes.show.call(badge);
    await flush();
    expect(badge.data.approved).toBe(true);
    const writes = badge.setData.mock.calls.length;
    old.resolve({ formalAccountReady: false });
    await flush();
    expect(badge.setData).toHaveBeenCalledTimes(writes);
    expect(badge.data.approved).toBe(true);
  });

  it('clears an already displayed badge when the visible page becomes forbidden', async () => {
    await open();
    expect(badge.data.approved).toBe(true);
    expect(definition.properties?.blocked).toBeDefined();
    const observer = definition.properties.blocked.observer;
    badge.data.blocked = true;
    observer.call(badge, true);
    expect(badge.data.approved).toBe(false);
    await badge.refreshApproval();
    expect(runtime.sessions.loadMe).toHaveBeenCalledTimes(1);
  });

  it('does not show a late identity response after the page becomes forbidden', async () => {
    const pending = deferred();
    runtime.sessions.loadMe.mockReturnValue(pending.promise);
    await open();
    expect(definition.properties?.blocked).toBeDefined();
    badge.data.blocked = true;
    definition.properties.blocked.observer.call(badge, true);
    pending.resolve({ formalAccountReady: true });
    await flush();
    expect(badge.data.approved).toBe(false);
  });

  it('does not read while initially blocked or while hidden after the block is removed', async () => {
    badge.data.blocked = true;
    await open();
    expect(runtime.sessions.loadMe).not.toHaveBeenCalled();
    definition.pageLifetimes.hide.call(badge);
    badge.data.blocked = false;
    definition.properties.blocked.observer.call(badge, false);
    await flush();
    expect(runtime.sessions.loadMe).not.toHaveBeenCalled();
    definition.pageLifetimes.show.call(badge);
    await flush();
    expect(badge.data.approved).toBe(true);
  });

  it('cleans up its local watch on hide, block, refresh and detach without polling the API', async () => {
    await open();
    expect(jest.getTimerCount()).toBe(1);
    jest.advanceTimersByTime(2500);
    expect(runtime.sessions.loadMe).toHaveBeenCalledTimes(1);
    definition.pageLifetimes.hide.call(badge);
    expect(jest.getTimerCount()).toBe(0);
    definition.pageLifetimes.show.call(badge);
    await flush();
    expect(jest.getTimerCount()).toBe(1);
    const pending = deferred();
    runtime.sessions.loadMe.mockReturnValue(pending.promise);
    const refresh = badge.refreshApproval();
    expect(jest.getTimerCount()).toBe(0);
    pending.resolve({ formalAccountReady: true });
    await refresh;
    expect(jest.getTimerCount()).toBe(1);
    badge.data.blocked = true;
    definition.properties.blocked.observer.call(badge, true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not let a queued timer from an earlier identity clear the new badge', async () => {
    const scheduled = jest.spyOn(global, 'setInterval');
    await open();
    const oldTick = scheduled.mock.calls[0][0] as () => void;
    key = 'formal:new-visible-identity';
    await badge.refreshApproval();
    expect(badge.data.approved).toBe(true);
    oldTick();
    expect(badge.data.approved).toBe(true);
    expect(jest.getTimerCount()).toBe(1);
    scheduled.mockRestore();
  });

  it.each(['runtime', 'key'])('fails closed when the local identity watch throws for %s', async (failure) => {
    await open();
    if (failure === 'runtime') getRuntime.mockImplementation(() => { throw new Error('不可用'); });
    else runtime.sessions.getSessionKey = () => { throw new Error('不可用'); };
    expect(() => jest.advanceTimersByTime(500)).not.toThrow();
    expect(badge.data.approved).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['logout', 'token', 'runtime'])(
    'clears an already displayed badge after visible identity change %s without another request',
    async (change) => {
      await open();
      expect(badge.data.approved).toBe(true);
      if (change === 'logout') key = '';
      else if (change === 'token') key = 'formal:replacement';
      else getRuntime.mockReturnValue({ ...runtime });
      jest.advanceTimersByTime(1000);
      await flush();
      expect(badge.data.approved).toBe(false);
      expect(runtime.sessions.loadMe).toHaveBeenCalledTimes(1);
      definition.lifetimes.detached.call(badge);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('starts a fresh formal identity read on return without invalidating an application read', async () => {
    const { PartnerFormalArchiveSession } = require('../pages/partner/runtime/partner-formal-archive-session');
    const requests: any[] = [];
    const storage = {
      get: (name: string) => name === 'education.runtime'
        ? { dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3000', accessToken: 'synthetic-formal' }
        : undefined,
      set: jest.fn(), remove: jest.fn(),
    };
    runtime.sessions = new PartnerFormalArchiveSession({
      apiBaseUrl: 'http://127.0.0.1:3000', storage,
      request: (options: any) => requests.push(options),
    });
    const invalidate = jest.spyOn(runtime.sessions, 'invalidateReads');
    const application = runtime.sessions.requestApplication('GET');
    await open();
    expect(requests).toHaveLength(2);
    definition.pageLifetimes.hide.call(badge);
    definition.pageLifetimes.show.call(badge);
    await flush();
    expect(requests).toHaveLength(3);
    requests[1].success({ statusCode: 200, data: { data: {
      roleCode: 'PARTNER', displayName: '旧合成合作方', campus: { id: 'synthetic-campus' },
    } } });
    await flush();
    expect(badge.data.approved).toBe(false);
    const currentIdentity = runtime.sessions.loadMe();
    expect(requests).toHaveLength(3);
    const refusal = expect(currentIdentity).rejects.toMatchObject({ statusCode: 403 });
    requests[2].success({ statusCode: 403, data: { code: 'FORBIDDEN' } });
    requests[0].success({ statusCode: 200, data: { data: null } });
    await expect(application).resolves.toBeNull();
    await refusal;
    await flush();
    expect(badge.data.approved).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it.each([375, 390, 430])('places a stable badge outside the capsule at width %s', async (windowWidth) => {
    (global as any).wx.getWindowInfo = () => ({ windowWidth, statusBarHeight: 47 });
    (global as any).wx.getMenuButtonBoundingClientRect = () => ({
      top: 51, left: windowWidth - 103, height: 32,
    });
    await open();
    expect(badge.data).toMatchObject({ topPx: 51, rightPx: 111 });
    const badgeRight = windowWidth - badge.data.rightPx;
    expect(badgeRight).toBeLessThan(windowWidth - 103);
    expect(badgeRight - 102 * windowWidth / 750).toBeGreaterThan(150);
  });

  it('uses safe layout fallbacks when native capsule metrics are unavailable', async () => {
    (global as any).wx.getMenuButtonBoundingClientRect = () => { throw new Error('未提供'); };
    await open();
    expect(badge.data).toMatchObject({ topPx: 55, rightPx: 100 });
  });
});

describe('partner identity badge page integration', () => {
  it('includes the private badge in partner pages, never in the login or another role', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
    const pages: string[] = config.subPackages.find((entry: any) => entry.root === 'pages/partner').pages;
    for (const page of pages) {
      const base = path.join(root, 'pages/partner', page);
      const json = JSON.parse(fs.readFileSync(`${base}.json`, 'utf8'));
      const template = fs.readFileSync(`${base}.wxml`, 'utf8');
      if (page === 'login/index') {
        expect(template).not.toContain('partner-approved-role-badge');
        continue;
      }
      expect(json.usingComponents['partner-approved-role-badge']).toBe('/pages/partner/components/approved-role-badge/index');
      expect(template.includes('<partner-approved-role-badge')).toBe(true);
      expect(template).toContain('blocked="{{viewState === \'forbidden\'}}"');
    }
    const template = fs.readFileSync(path.join(root, 'pages/partner/application/index.wxml'), 'utf8');
    expect(template).not.toContain('class="application__role">合作方');
    const css = fs.readFileSync(path.join(root, 'pages/partner/components/approved-role-badge/index.wxss'), 'utf8');
    expect(css).toMatch(/width:\s*102rpx/);
    expect(css).toMatch(/height:\s*88rpx/);
    expect(css).toContain('pointer-events: none');
  });
});
