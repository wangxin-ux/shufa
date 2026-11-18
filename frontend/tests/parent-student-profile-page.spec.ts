export {};
const studentProfileLoad = jest.fn();
const studentProfileUpdate = jest.fn();
const studentProfileLogout = jest.fn();
jest.mock('../services/parent-runtime', () => ({ parentService: {
  loadProfile: () => studentProfileLoad(),
  updateProfile: (...args: unknown[]) => studentProfileUpdate(...args),
} }));
jest.mock('../services/session.service', () => ({ sessionService: {
  logout: () => studentProfileLogout(),
} }));

describe('P5 identity editor draft and retry protection', () => {
  let page: any;
  const profile = { student: { id: 'student', name: '陈晨', age: 9,
    homeAddress: '启明路18号', profileVersion: 1 }, unreadMessageCount: 0 };
  beforeEach(() => {
    studentProfileLoad.mockReset().mockResolvedValue({ status: 'success', data: profile });
    studentProfileUpdate.mockReset().mockResolvedValue({ status: 'error', message: '网络请求失败' });
    studentProfileLogout.mockReset();
    (global as any).wx = { showToast: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn() };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (patch: unknown) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/parent/student-profile/index'));
  });
  afterEach(() => {
    page.onUnload?.();
    delete (global as any).wx;
    delete (global as any).Page;
  });
  const edit = () => {
    page.onEdit();
    page.onAgeInput({ detail: { value: '10' } });
    page.onAddressInput({ detail: { value: '新住址' } });
  };
  it('keeps editing fields when refreshed and cancels to the latest server values', async () => {
    await page.loadStudentProfile();
    edit();
    studentProfileLoad.mockResolvedValue({ status: 'success', data: {
      ...profile, student: { ...profile.student, age: 11, homeAddress: '后台住址', profileVersion: 2 },
    } });
    await page.loadStudentProfile();
    expect(page.data.isEditing).toBe(true);
    expect(page.data.studentAgeInput).toBe('10');
    expect(page.data.homeAddress).toBe('新住址');
    page.onCancel();
    expect(page.data.studentAgeInput).toBe('11');
    expect(page.data.homeAddress).toBe('后台住址');
  });
  it('keeps the same idempotency key for an unchanged failed retry but changes it for a new draft', async () => {
    await page.loadStudentProfile();
    edit();
    await page.onSave();
    await page.onSave();
    expect(studentProfileUpdate.mock.calls[1][1]).toBe(studentProfileUpdate.mock.calls[0][1]);
    expect(page.data.studentAgeInput).toBe('10');
    page.onAgeInput({ detail: { value: '12' } });
    await page.onSave();
    expect(studentProfileUpdate.mock.calls[2][1]).not.toBe(studentProfileUpdate.mock.calls[0][1]);
  });
  it('blocks duplicate submits and returns the saved version after success', async () => {
    await page.loadStudentProfile();
    edit();
    let resolve!: (result: unknown) => void;
    studentProfileUpdate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = page.onSave();
    await page.onSave();
    expect(studentProfileUpdate).toHaveBeenCalledTimes(1);
    resolve({ status: 'success', data: { ...profile, student: {
      ...profile.student, age: 10, homeAddress: '新住址', profileVersion: 2,
    } } });
    await pending;
    expect(page.data).toMatchObject({ submitting: false, isEditing: false, profileVersion: 2, studentAgeLabel: '10 岁' });
  });
  it('handles expiry by returning to the login page', async () => {
    studentProfileLoad.mockResolvedValue({ status: 'error', statusCode: 401, message: '登录失效' });
    await page.loadStudentProfile();
    expect(studentProfileLogout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
  it('does not replace local fields with an unloaded late response', async () => {
    await page.loadStudentProfile();
    edit();
    let resolve!: (result: unknown) => void;
    studentProfileLoad.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = page.loadStudentProfile();
    page.onUnload();
    resolve({ status: 'success', data: { ...profile, student: { ...profile.student, name: '迟到姓名' } } });
    await pending;
    expect(page.data.studentName).toBe('陈晨');
  });

  it('keeps the computed age read-only after setup and saves only address and version', async () => {
    studentProfileLoad.mockResolvedValue({ status: 'success', data: {
      ...profile, student: { ...profile.student, profileSetupCompleted: true },
    } });
    await page.loadStudentProfile();
    expect(page.data.profileSetupCompleted).toBe(true);
    edit();
    expect(page.data.studentAgeInput).toBe('9');
    await page.onSave();
    expect(studentProfileUpdate.mock.calls[0][0]).toEqual({ homeAddress: '新住址', expectedVersion: 1 });
    await page.onSave();
    expect(studentProfileUpdate.mock.calls[1][1]).toBe(studentProfileUpdate.mock.calls[0][1]);
  });

  it('keeps legacy age editing until setup is complete', async () => {
    await page.loadStudentProfile();
    edit();
    await page.onSave();
    expect(studentProfileUpdate.mock.calls[0][0]).toEqual({ age: 10, homeAddress: '新住址', expectedVersion: 1 });
  });

  it('discards a legacy age draft if refresh reports completed setup but preserves the address', async () => {
    await page.loadStudentProfile();
    edit();
    studentProfileLoad.mockResolvedValue({ status: 'success', data: {
      ...profile, student: { ...profile.student, age: 11, profileVersion: 2, profileSetupCompleted: true },
    } });
    await page.loadStudentProfile();
    expect(page.data).toMatchObject({ studentAgeInput: '11', studentAgeLabel: '11 岁', homeAddress: '新住址', isEditing: true });
    await page.onSave();
    expect(studentProfileUpdate.mock.calls[0][0]).toEqual({ homeAddress: '新住址', expectedVersion: 2 });
  });

  it.each([
    { status: 'success', data: profile },
    { status: 'error', statusCode: 401, message: '迟到失效' },
  ])('ignores all save callbacks after unload: $status', async (result) => {
    await page.loadStudentProfile();
    edit();
    let resolve!: (value: unknown) => void;
    studentProfileUpdate.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = page.onSave();
    page.onUnload();
    page.setData = jest.fn();
    resolve(result);
    await pending;
    expect(page.setData).not.toHaveBeenCalled();
    expect(studentProfileLogout).not.toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it('only renders the age input for an unfinished profile', () => {
    const template = require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../pages/parent/student-profile/index.wxml'), 'utf8',
    );
    expect(template).toMatch(/<input\s+wx:if="\{\{isEditing && !profileSetupCompleted\}\}"/);
    expect(template).toContain('{{studentAgeLabel}}');
  });
});
