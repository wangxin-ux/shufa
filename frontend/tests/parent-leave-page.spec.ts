export {};
import * as fs from 'node:fs';
import * as path from 'node:path';
const leavePageLoad = jest.fn();
const leaveSubmit = jest.fn();
const leaveLogout = jest.fn();
jest.mock('../services/parent-runtime', () => ({ parentService: {
  loadLeavePage: (studentId?: string) => leavePageLoad(studentId),
  submitLeave: (...args: unknown[]) => leaveSubmit(...args),
} }));
jest.mock('../services/session.service', () => ({ sessionService: { logout: () => leaveLogout() } }));

describe('PDF leave page draft, polling and contact interactions', () => {
  it('exposes the existing submit component as a stable native target', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/parent/leave/index.wxml'), 'utf8');
    expect(markup).toMatch(/<parent-primary-button\s+id="parent-leave-submit"/);
    expect(markup).toMatch(/id="parent-leave-submit"[^>]*bind:tap="onSubmitTap"/);
    expect(markup).toMatch(/<picker id="parent-leave-student"/);
    expect(markup).toMatch(/<picker id="parent-leave-lesson"/);
  });
  let page: any;
  const warning = { weekStart: '2030-09-30', weekEnd: '2030-10-06', consecutiveCount: 2,
    lessonSessionIds: ['one', 'two'], campusName: '启明东校区', contactPhone: '0731-88886666' };
  const view = { students: [{ id: 'student', name: '陈晨' }, { id: 'other', name: '安然' }],
    lessons: [{ id: 'lesson', title: '硬笔书法', startsAt: '2030-10-02T06:00:00Z' }],
    records: [], cutoffHours: 2, weeklyWarnings: [] };
  beforeEach(() => {
    jest.useFakeTimers();
    leavePageLoad.mockReset().mockResolvedValue({ status: 'success', data: view });
    leaveSubmit.mockReset().mockResolvedValue({ status: 'success', data: {
      id: 'new-leave', courseName: '硬笔书法', lessonTimeLabel: '2030-10-02 14:00',
      reason: '家庭临时有事', status: 'pending', contactWarning: warning,
    } });
    leaveLogout.mockReset();
    (global as any).wx = { showModal: jest.fn(), makePhoneCall: jest.fn(), showToast: jest.fn(),
      reLaunch: jest.fn(), stopPullDownRefresh: jest.fn() };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (patch: unknown) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/parent/leave/index'));
  });
  afterEach(() => {
    page.onUnload?.();
    jest.useRealTimers();
    delete (global as any).wx;
    delete (global as any).Page;
  });
  it('preserves the reason during polling and fetches the selected student lessons', async () => {
    await page.loadLeavePage();
    page.onReasonInput({ detail: { value: '家庭临时有事' } });
    page.onShow();
    await jest.advanceTimersByTimeAsync(30000);
    expect(page.data.draft.reason).toBe('家庭临时有事');
    page.onStudentChange({ detail: { value: '1' } });
    await Promise.resolve();
    expect(leavePageLoad).toHaveBeenLastCalledWith('other');
    expect(page.data.draft.reason).toBe('家庭临时有事');
    page.onHide();
    const count = leavePageLoad.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60000);
    expect(leavePageLoad).toHaveBeenCalledTimes(count);
  });
  it('does not auto-dial or block a submitted leave when a contact warning is returned', async () => {
    await page.loadLeavePage();
    page.onReasonInput({ detail: { value: '家庭临时有事' } });
    await page.onSubmitTap();
    expect(leaveSubmit).toHaveBeenCalledTimes(1);
    expect(page.data.records[0].status).toBe('pending');
    expect((global as any).wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '须电话沟通联系校区', confirmText: '拨打电话',
      content: expect.stringContaining(warning.contactPhone),
    }));
    expect((global as any).wx.makePhoneCall).not.toHaveBeenCalled();
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    expect((global as any).wx.makePhoneCall).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: warning.contactPhone }));
  });
  it('keeps drafts on silent refresh error and handles 401', async () => {
    await page.loadLeavePage();
    page.onReasonInput({ detail: { value: '参加活动' } });
    leavePageLoad.mockResolvedValue({ status: 'error', message: '网络暂不可用' });
    await page.loadLeavePage(true);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.draft.reason).toBe('参加活动');
    expect(page.data.refreshError).toBe('网络暂不可用');
    leavePageLoad.mockResolvedValue({ status: 'error', message: '登录已失效', statusCode: 401 });
    await page.loadLeavePage(true);
    expect(leaveLogout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
  it('ignores a refresh response after hiding or unloading the page', async () => {
    await page.loadLeavePage();
    page.onReasonInput({ detail: { value: '保留草稿' } });
    let resolve!: (result: unknown) => void;
    leavePageLoad.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = page.loadLeavePage(true);
    page.onHide();
    resolve({ status: 'success', data: { ...view, records: [{ id: 'late' }] } });
    await pending;
    expect(page.data.records).toEqual([]);
    expect(page.data.draft.reason).toBe('保留草稿');
    const unloaded = page.loadLeavePage(true);
    page.onUnload();
    resolve({ status: 'error', statusCode: 401, message: '迟到的错误' });
    await unloaded;
    expect(leaveLogout).not.toHaveBeenCalled();
  });
  it('retains a successful record if the post-submit refresh fails and handles missing phone safely', async () => {
    await page.loadLeavePage();
    page.onReasonInput({ detail: { value: '家庭临时有事' } });
    leaveSubmit.mockResolvedValue({ status: 'success', data: {
      id: 'new-leave', courseName: '硬笔书法', lessonTimeLabel: '2030-10-02 14:00',
      reason: '家庭临时有事', status: 'pending', contactWarning: { ...warning, contactPhone: null },
    } });
    leavePageLoad.mockResolvedValue({ status: 'error', message: '稍后重试' });
    await page.onSubmitTap();
    expect(page.data.records).toHaveLength(1);
    expect((global as any).wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ confirmText: '知道了', showCancel: false }));
    page.onContactCampusTap();
    expect((global as any).wx.makePhoneCall).not.toHaveBeenCalled();
  });
  it('does not use an unrelated week warning when this submission explicitly has none', async () => {
    await page.loadLeavePage();
    page.onReasonInput({ detail: { value: '家庭临时有事' } });
    leaveSubmit.mockResolvedValue({ status: 'success', data: {
      id: 'new-leave', courseName: '硬笔书法', lessonTimeLabel: '2030-10-02 14:00',
      reason: '家庭临时有事', status: 'pending', contactWarning: null,
    } });
    leavePageLoad.mockResolvedValue({ status: 'success', data: { ...view, weeklyWarnings: [warning] } });
    await page.onSubmitTap();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
  });
});
