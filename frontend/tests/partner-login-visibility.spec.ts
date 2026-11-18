export {};

const logout = jest.fn();
jest.mock('../services/session.service', () => {
  class SessionService {
    constructor(_options: unknown, _auth?: unknown) {}
    logout() {
      logout();
    }
  }
  return {
    SessionService,
    sessionService: { logout: () => logout() },
    createSessionService: () => ({ logout: () => logout() }),
  };
});
jest.mock('../services/partner-runtime', () => ({
  partnerService: {},
}));

describe.each([
  'home', 'profile', 'students', 'student-detail', 'teachers', 'warnings',
  'attendance', 'operations', 'earnings', 'lesson-account', 'group-campaigns', 'group-detail',
])('partner %s login visibility', (route) => {
  let page: any;

  beforeEach(() => {
    logout.mockReset();
    (global as any).wx = { reLaunch: jest.fn() };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: { ...definition.data } };
      page.setData = jest.fn((values: object) => Object.assign(page.data, values));
    };
    jest.isolateModules(() => require(`../pages/partner/${route}/index`));
  });

  afterEach(() => {
    page.onUnload();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('preserves explicit foreground login recovery', () => {
    page.setData({ viewState: 'forbidden' });
    page.onLogin();
    expect(logout).toHaveBeenCalledTimes(1);
    // Some pages pass a `fail` recovery callback to reLaunch; assert the
    // destination only so both the plain and the fail-safe call styles pass.
    const [navigation] = (global as any).wx.reLaunch.mock.calls[0] ?? [];
    expect(navigation?.url).toBe('/pages/bootstrap/index');
  });

  it.each(['onHide', 'onUnload'])('ignores queued login events after %s', (lifecycle) => {
    page[lifecycle]();
    const writes = page.setData.mock.calls.length;
    page.onLogin();
    expect(logout).not.toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    expect(page.setData).toHaveBeenCalledTimes(writes);
  });
});
