export {};
const profilePageLoad = jest.fn();
const profilePageLogout = jest.fn();
jest.mock('../services/parent-runtime', () => ({ parentService: {
  loadProfile: () => profilePageLoad(),
} }));
jest.mock('../services/session.service', () => ({ sessionService: {
  logout: () => profilePageLogout(),
} }));

describe('PDF P5 menu and identity refresh', () => {
  let page: any;
  const profile = { student: { id: 'student', name: '陈晨', age: 9,
    homeAddress: '启明路18号', profileVersion: 1 }, unreadMessageCount: 0 };
  beforeEach(() => {
    jest.useFakeTimers();
    profilePageLoad.mockReset().mockResolvedValue({ status: 'success', data: profile });
    profilePageLogout.mockReset();
    (global as any).wx = { navigateTo: jest.fn(), showToast: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn() };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (patch: unknown) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/parent/profile/index'));
  });
  afterEach(() => {
    page.onUnload?.();
    jest.useRealTimers();
    delete (global as any).wx;
    delete (global as any).Page;
  });
  it('uses the five PDF menu rows and routes identity editing separately', async () => {
    await page.loadProfile();
    expect(page.data.actions.map((action: any) => action.label)).toEqual([
      '学员资料', '门店导航', '课时记录', '优惠活动', '购物商城',
    ]);
    const destinations = [
      ['student', '/pages/parent/updates/index'],
      ['campuses', '/pages/parent/courses/index?section=map'],
      ['hours', '/pages/parent/hours/index'],
      ['offers', '/pages/parent/courses/index'],
    ];
    for (const [key, url] of destinations) {
      page.onActionTap({ currentTarget: { dataset: { action: key } } });
      expect((global as any).wx.navigateTo).toHaveBeenLastCalledWith({ url });
    }
    const calls = (global as any).wx.navigateTo.mock.calls.length;
    page.onActionTap({ currentTarget: { dataset: { action: 'shop' } } });
    expect((global as any).wx.showToast).toHaveBeenLastCalledWith({ title: '待上架', icon: 'none' });
    page.onActionTap({ currentTarget: { dataset: { action: 'unknown' } } });
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(calls);
    page.onIdentityTap();
    expect((global as any).wx.navigateTo).toHaveBeenLastCalledWith({ url: '/pages/parent/student-profile/index' });
  });
  it('reloads after returning from editing and polls only while visible', async () => {
    await page.loadProfile();
    profilePageLoad.mockResolvedValue({ status: 'success', data: {
      ...profile, student: { ...profile.student, age: 10, profileVersion: 2 },
    } });
    page.onShow();
    await jest.advanceTimersByTimeAsync(0);
    expect(page.data.studentAgeLabel).toBe('10 岁');
    await jest.advanceTimersByTimeAsync(30000);
    expect(profilePageLoad).toHaveBeenCalledTimes(3);
    page.onHide();
    const calls = profilePageLoad.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60000);
    expect(profilePageLoad).toHaveBeenCalledTimes(calls);
  });
  it('uses the rounded source 95rpx short name without changing the long-name calculation', async () => {
    await page.loadProfile();
    expect(page.data.nameFontSize).toBe(95);
  });
  it('retains a long name and age with a content-based compact font', async () => {
    profilePageLoad.mockResolvedValue({ status: 'success', data: {
      ...profile, student: { ...profile.student, name: '陈晨同学超长姓名展示测试', age: 120 },
    } });
    await page.loadProfile();
    expect(page.data.studentName).toBe('陈晨同学超长姓名展示测试');
    expect(page.data.studentAgeLabel).toBe('120 岁');
    expect(page.data.nameFontSize).toBe(30);
  });
  it('preserves the last identity on refresh failure and routes 401 to login', async () => {
    await page.loadProfile();
    profilePageLoad.mockResolvedValue({ status: 'error', message: '网络暂不可用' });
    await page.loadProfile(true);
    expect(page.data.studentName).toBe('陈晨');
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshError).toBe('网络暂不可用');
    profilePageLoad.mockResolvedValue({ status: 'error', statusCode: 401, message: '登录失效' });
    await page.loadProfile(true);
    expect(profilePageLogout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
  it('does not accept late responses after hiding and disables empty identity editing', async () => {
    await page.loadProfile();
    let resolve!: (value: unknown) => void;
    profilePageLoad.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = page.loadProfile(true);
    page.onHide();
    resolve({ status: 'success', data: { ...profile, student: { ...profile.student, name: '迟到姓名' } } });
    await pending;
    expect(page.data.studentName).toBe('陈晨');
    profilePageLoad.mockResolvedValue({ status: 'empty', data: { student: null, unreadMessageCount: 0 } });
    await page.loadProfile();
    page.onIdentityTap();
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    expect(page.data.emptyMessage).toBe('暂未绑定学员');
  });
});
