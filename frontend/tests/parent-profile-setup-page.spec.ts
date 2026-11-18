export {};
const setupLoad = jest.fn();
const setupUpload = jest.fn();
const setupSave = jest.fn();
const setupLogout = jest.fn();
jest.mock('../services/parent-runtime', () => ({ parentService: {
  loadProfileSetup: () => setupLoad(),
  uploadStudentPhoto: (...args: unknown[]) => setupUpload(...args),
  completeProfileSetup: (...args: unknown[]) => setupSave(...args),
} }));
jest.mock('../services/session.service', () => ({ sessionService: { logout: () => setupLogout() } }));

describe('parent first-time bound-student profile setup', () => {
  let page: any;
  const student = { id: 'student', name: '陈晨', age: 9, birthDate: null, profileVersion: 1, photo: null };
  const photo = { id: 'existing-photo', accessUrl: 'https://example.test/student.png' };
  const deferred = () => {
    let resolve!: (result: any) => void;
    const promise = new Promise<any>((done) => { resolve = done; });
    return { promise, resolve };
  };
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T08:00:00+08:00'));
    setupLoad.mockReset().mockResolvedValue({ status: 'success', data: { required: true, student } });
    setupUpload.mockReset().mockResolvedValue({ status: 'success', data: { id: 'photo' } });
    setupSave.mockReset().mockResolvedValue({ status: 'error', statusCode: 503, message: '稍后重试' });
    setupLogout.mockReset();
    (global as any).wx = { reLaunch: jest.fn(), showToast: jest.fn(), previewImage: jest.fn(), stopPullDownRefresh: jest.fn(),
      chooseMedia: jest.fn((options: any) => options.success({ tempFiles: [{ tempFilePath: 'local-photo', size: 100 }] })),
      getImageInfo: jest.fn((options: any) => options.success({ type: 'jpeg' })),
    };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (patch: unknown) => Object.assign(page.data, patch);
    };
    const target = require('node:path').resolve(__dirname, '../pages/parent/profile-setup/index.ts');
    page = undefined;
    if (require('node:fs').existsSync(target)) jest.isolateModules(() => require(target));
  });
  afterEach(() => {
    page?.onUnload?.();
    jest.useRealTimers();
    delete (global as any).wx;
    delete (global as any).Page;
  });
  const load = async () => { expect(page).toBeDefined(); await page.loadSetup(); };
  it('recovers a failed home navigation after completion and can retry without saving again', async () => {
    await load();
    setupLoad.mockResolvedValue({ status: 'success', data: { required: false, student } });
    (global as any).wx.reLaunch.mockImplementationOnce((options: any) => options.fail?.({ errMsg: 'reLaunch:fail' }));
    await page.loadSetup();
    expect(page.disposed).toBe(false);
    expect(page.data).toMatchObject({ viewState: 'error', submitting: false });
    expect(page.data.errorMessage).toContain('重试');
    await page.loadSetup();
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(2);
    expect(setupSave).not.toHaveBeenCalled();
  });

  it('ignores a failed home navigation callback after unload', async () => {
    await load();
    let navigation: any;
    (global as any).wx.reLaunch.mockImplementation((options: any) => { navigation = options; });
    page.returnHome();
    page.onUnload();
    const update = jest.spyOn(page, 'setData');
    update.mockClear();
    navigation.fail?.({ errMsg: 'reLaunch:fail' });
    expect(typeof navigation.fail).toBe('function');
    expect(page.disposed).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  const fill = () => {
    page.onNameInput({ detail: { value: '新的姓名' } });
    page.onBirthDateChange({ detail: { value: '2017-10-08' } });
  };
  it('loads only the already bound child and skips setup when complete', async () => {
    await load();
    expect(page.data.student.id).toBe('student');
    setupLoad.mockResolvedValue({ status: 'success', data: { required: false, student } });
    await page.loadSetup();
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/parent/home/index' }));
  });
  it('requires name, birthday and photo and retries an uploaded file with the same mutation key', async () => {
    await load();
    await page.onSubmit();
    expect(setupSave).not.toHaveBeenCalled();
    page.onNameInput({ detail: { value: '陈晨' } });
    page.onBirthDateChange({ detail: { value: '2017-10-08' } });
    await page.onChoosePhoto();
    await page.onSubmit();
    await page.onSubmit();
    expect(setupUpload).toHaveBeenCalledTimes(1);
    expect(setupSave.mock.calls[0][0]).toBe('student');
    expect(setupSave.mock.calls[0][1]).toEqual({ name: '陈晨', birthDate: '2017-10-08', fileId: 'photo', expectedVersion: 1 });
    expect(setupSave.mock.calls[0][2]).toBe(setupSave.mock.calls[1][2]);
    expect(page.data).toMatchObject({ name: '陈晨', birthDate: '2017-10-08', fileId: 'photo', submitting: false });
    expect(page.data.message).toBe('稍后重试');
    setupSave.mockResolvedValue({ status: 'success', data: { required: false, student } });
    await page.onSubmit();
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/parent/home/index' }));
  });
  it('keeps entered fields and a valid staged photo on a version conflict and refreshes the version', async () => {
    await load();
    page.onNameInput({ detail: { value: '新的姓名' } });
    page.onBirthDateChange({ detail: { value: '2017-10-08' } });
    await page.onChoosePhoto();
    setupSave.mockResolvedValue({ status: 'error', statusCode: 409, code: 'STUDENT_PROFILE_VERSION_CONFLICT', message: '资料已更新' });
    setupLoad.mockResolvedValue({ status: 'success', data: { required: true, student: { ...student, profileVersion: 2 } } });
    await page.onSubmit();
    expect(page.data.name).toBe('新的姓名');
    expect(page.data.birthDate).toBe('2017-10-08');
    expect(page.data.student.profileVersion).toBe(2);
    expect(page.data.fileId).toBe('photo');
    expect(page.data.photoUrl).toBe('local-photo');
    await page.onSubmit();
    expect(setupUpload).toHaveBeenCalledTimes(1);
    expect(setupSave.mock.calls[1][1]).toMatchObject({ fileId: 'photo', expectedVersion: 2 });
    expect(setupSave.mock.calls[1][2]).not.toBe(setupSave.mock.calls[0][2]);
  });
  it('blocks duplicate actions while uploading, cancels cleanly, and rejects oversized photos', async () => {
    await load();
    let selected: any;
    (global as any).wx.chooseMedia.mockImplementation((options: any) => { selected = options; });
    const pending = page.onChoosePhoto();
    await page.onChoosePhoto();
    await page.onSubmit();
    expect((global as any).wx.chooseMedia).toHaveBeenCalledTimes(1);
    expect(setupSave).not.toHaveBeenCalled();
    selected.fail({ errMsg: 'chooseMedia:fail cancel' });
    await pending;
    expect(page.data.photoBusy).toBe(false);
    expect(page.data.message).toBe('');
    (global as any).wx.chooseMedia.mockImplementation((options: any) => options.success({ tempFiles: [{ tempFilePath: 'big', size: 3145729 }] }));
    await page.onChoosePhoto();
    expect(setupUpload).not.toHaveBeenCalled();
  });
  it('does not expose creation or binding and handles missing students and expired sessions', async () => {
    await load();
    setupLoad.mockResolvedValue({ status: 'empty', data: { required: false, student: null } });
    await page.loadSetup();
    expect(page.data.student).toBeNull();
    expect(page.onCreateStudent).toBeUndefined();
    expect(page.onBindStudent).toBeUndefined();
    setupLoad.mockResolvedValue({ status: 'error', statusCode: 401, message: '登录失效' });
    await page.loadSetup();
    expect(setupLogout).toHaveBeenCalled();
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it('reuses the current photo without uploading and changes the mutation key only for a changed draft', async () => {
    setupLoad.mockResolvedValue({ status: 'success', data: { required: true, student: { ...student, photo } } });
    await load();
    fill();
    await page.onSubmit();
    await page.onSubmit();
    expect(setupUpload).not.toHaveBeenCalled();
    expect(setupSave.mock.calls[0][1].fileId).toBe('existing-photo');
    expect(setupSave.mock.calls[0][2]).toBeTruthy();
    expect(setupSave.mock.calls[1][2]).toBe(setupSave.mock.calls[0][2]);
    page.onNameInput({ detail: { value: '另一姓名' } });
    await page.onSubmit();
    expect(setupSave.mock.calls[2][2]).not.toBe(setupSave.mock.calls[0][2]);
  });

  it.each(['', '2026-10-09', '1905-10-08', '2017-02-29', '2017-13-01', 'not-a-date'])(
    'rejects an empty, future, over-age or invalid birthday: %s', async (birthDate) => {
      await load();
      fill();
      await page.onChoosePhoto();
      page.onBirthDateChange({ detail: { value: birthDate } });
      await page.onSubmit();
      expect(setupSave).not.toHaveBeenCalled();
      expect(page.data.message).toBeTruthy();
    },
  );

  it.each(['1906-10-08', '2026-10-08', '2024-02-29'])('accepts valid boundary birthdays: %s', async (birthDate) => {
    await load();
    fill();
    await page.onChoosePhoto();
    page.onBirthDateChange({ detail: { value: birthDate } });
    await page.onSubmit();
    expect(setupSave).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank name even with a birthday and uploaded photo', async () => {
    await load();
    fill();
    await page.onChoosePhoto();
    page.onNameInput({ detail: { value: '   ' } });
    await page.onSubmit();
    expect(setupSave).not.toHaveBeenCalled();
  });

  it('requires a photo after name and birthday are filled', async () => {
    await load();
    fill();
    await page.onSubmit();
    expect(setupSave).not.toHaveBeenCalled();
    expect(page.data.message).toContain('照片');
  });

  it('accepts PNG at exactly 3 MB but rejects a non-JPEG/PNG image before upload', async () => {
    await load();
    (global as any).wx.getImageInfo.mockImplementation((options: any) => options.success({ type: 'gif' }));
    await page.onChoosePhoto();
    expect(setupUpload).not.toHaveBeenCalled();
    expect(page.data.message).toMatch(/JPEG.*PNG/);
    (global as any).wx.chooseMedia.mockImplementation((options: any) => options.success({
      tempFiles: [{ tempFilePath: 'png-without-extension', size: 3145728 }],
    }));
    (global as any).wx.getImageInfo.mockImplementation((options: any) => options.success({ type: 'png' }));
    await page.onChoosePhoto();
    expect(setupUpload).toHaveBeenCalledWith('student', 'png-without-extension');
  });

  it('keeps the previous photo and fields when a replacement upload fails', async () => {
    setupLoad.mockResolvedValue({ status: 'success', data: { required: true, student: { ...student, photo } } });
    await load();
    fill();
    setupUpload.mockResolvedValue({ status: 'error', message: '上传失败' });
    await page.onChoosePhoto();
    expect(page.data).toMatchObject({ name: '新的姓名', birthDate: '2017-10-08', photoBusy: false });
    await page.onSubmit();
    expect(setupSave.mock.calls[0][1].fileId).toBe('existing-photo');
  });

  it('blocks duplicate saves and field changes while saving', async () => {
    await load();
    fill();
    await page.onChoosePhoto();
    const saving = deferred();
    setupSave.mockReturnValue(saving.promise);
    const pending = page.onSubmit();
    page.onNameInput({ detail: { value: '迟到修改' } });
    page.onBirthDateChange({ detail: { value: '2020-01-01' } });
    await page.onChoosePhoto();
    await page.onSubmit();
    expect(setupSave).toHaveBeenCalledTimes(1);
    expect(setupUpload).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ name: '新的姓名', birthDate: '2017-10-08' });
    saving.resolve({ status: 'error', message: '保存失败' });
    await pending;
    expect(page.data.submitting).toBe(false);
  });

  it('refreshes an already-completed response before returning home', async () => {
    await load();
    fill();
    await page.onChoosePhoto();
    setupSave.mockResolvedValue({ status: 'error', statusCode: 409, code: 'PARENT_PROFILE_ALREADY_COMPLETED', message: '资料已完善' });
    setupLoad.mockResolvedValue({ status: 'success', data: { required: false, student: { ...student, photo } } });
    await page.onSubmit();
    expect(setupLoad).toHaveBeenCalledTimes(2);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/parent/home/index' }));
  });

  it('does not resend a stale version if the conflict refresh fails', async () => {
    await load();
    fill();
    await page.onChoosePhoto();
    setupSave.mockResolvedValue({ status: 'error', statusCode: 409, code: 'STUDENT_PROFILE_VERSION_CONFLICT', message: '资料已更新' });
    setupLoad.mockResolvedValue({ status: 'error', message: '刷新失败' });
    await page.onSubmit();
    expect(page.data).toMatchObject({ name: '新的姓名', birthDate: '2017-10-08', fileId: 'photo', photoUrl: 'local-photo' });
    await page.onSubmit();
    expect(setupSave).toHaveBeenCalledTimes(1);
    setupLoad.mockResolvedValue({ status: 'success', data: { required: true, student: { ...student, profileVersion: 2, photo } } });
    await page.loadSetup();
    await page.onSubmit();
    expect(setupSave.mock.calls[1][1]).toMatchObject({ name: '新的姓名', birthDate: '2017-10-08', expectedVersion: 2, fileId: 'photo' });
    expect(setupSave.mock.calls[1][2]).not.toBe(setupSave.mock.calls[0][2]);
  });

  it.each(['upload', 'save'])('logs out on an expired %s request', async (operation) => {
    await load();
    fill();
    if (operation === 'save') await page.onChoosePhoto();
    (operation === 'upload' ? setupUpload : setupSave).mockResolvedValue({ status: 'error', statusCode: 401, message: '登录失效' });
    await (operation === 'upload' ? page.onChoosePhoto() : page.onSubmit());
    expect(setupLogout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it('shows a Chinese missing-student state and offers logout rather than redirecting home', async () => {
    setupLoad.mockResolvedValue({ status: 'empty', data: { required: false, student: null } });
    await load();
    expect(page.data.emptyMessage).toContain('学员');
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    page.onLogout();
    expect(setupLogout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it.each([
    { status: 'success', data: { required: false, student } },
    { status: 'error', statusCode: 401, message: '迟到失效' },
  ])('ignores a load response after unload: $status', async (result) => {
    await load();
    const reading = deferred();
    setupLoad.mockReturnValue(reading.promise);
    const pending = page.loadSetup();
    page.onUnload();
    page.setData = jest.fn();
    reading.resolve(result);
    await pending;
    expect(page.setData).not.toHaveBeenCalled();
    expect(setupLogout).not.toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
  });

  it.each(['success', 'cancel'])('ignores a late photo chooser %s after unload', async (outcome) => {
    await load();
    let options: any;
    (global as any).wx.chooseMedia.mockImplementation((value: any) => { options = value; });
    const pending = page.onChoosePhoto();
    page.onUnload();
    page.setData = jest.fn();
    if (outcome === 'success') options.success({ tempFiles: [{ tempFilePath: 'late', size: 100 }] });
    else options.fail({ errMsg: 'chooseMedia:fail cancel' });
    await pending;
    expect(page.setData).not.toHaveBeenCalled();
    expect((global as any).wx.getImageInfo).not.toHaveBeenCalled();
    expect(setupUpload).not.toHaveBeenCalled();
  });

  it('does not upload after image inspection finishes on an unloaded page', async () => {
    await load();
    let options: any;
    (global as any).wx.getImageInfo.mockImplementation((value: any) => { options = value; });
    const pending = page.onChoosePhoto();
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    page.onUnload();
    page.setData = jest.fn();
    options.success({ type: 'jpeg' });
    await pending;
    expect(page.setData).not.toHaveBeenCalled();
    expect(setupUpload).not.toHaveBeenCalled();
  });

  it.each([
    ['upload', 'success'], ['upload', 'error'], ['save', 'success'], ['save', 'error'],
  ])('ignores a late %s %s after unload', async (operation, status) => {
    await load();
    fill();
    if (operation === 'save') await page.onChoosePhoto();
    const request = deferred();
    (operation === 'upload' ? setupUpload : setupSave).mockReturnValue(request.promise);
    const pending = operation === 'upload' ? page.onChoosePhoto() : page.onSubmit();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    page.onUnload();
    page.setData = jest.fn();
    request.resolve(status === 'error'
      ? { status: 'error', statusCode: 401, message: '迟到失效' }
      : { status: 'success', data: operation === 'upload' ? { id: 'late-photo' } : { required: false, student } });
    await pending;
    expect(page.setData).not.toHaveBeenCalled();
    expect(setupLogout).not.toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it('rejects a name over 100 characters but accepts 100 after trimming', async () => {
    await load();
    fill();
    await page.onChoosePhoto();
    page.onNameInput({ detail: { value: '陈'.repeat(101) } });
    await page.onSubmit();
    expect(setupSave).not.toHaveBeenCalled();
    expect(page.data.message).toContain('100');
    page.onNameInput({ detail: { value: ` ${'陈'.repeat(100)} ` } });
    await page.onSubmit();
    expect(setupSave).toHaveBeenCalledTimes(1);
    expect(setupSave.mock.calls[0][1].name).toBe('陈'.repeat(100));
  });

  it('preserves a failed-save draft and staged file across a manual refresh', async () => {
    await load();
    fill();
    await page.onChoosePhoto();
    await page.onSubmit();
    const key = setupSave.mock.calls[0][2];
    await page.loadSetup();
    expect(page.data).toMatchObject({ name: '新的姓名', birthDate: '2017-10-08', fileId: 'photo', photoUrl: 'local-photo' });
    await page.onSubmit();
    expect(setupSave.mock.calls[1][2]).toBe(key);
    expect(setupUpload).toHaveBeenCalledTimes(1);
  });

  it('clears a refresh error after recovery without replacing the draft', async () => {
    await load();
    fill();
    setupLoad.mockResolvedValueOnce({ status: 'error', message: '刷新失败' });
    await page.loadSetup();
    expect(page.data.message).toBe('刷新失败');
    await page.loadSetup();
    expect(page.data).toMatchObject({ name: '新的姓名', birthDate: '2017-10-08', message: '' });
  });

  it('keeps the newest load result when an older request finishes later', async () => {
    await load();
    const old = deferred();
    setupLoad.mockReturnValueOnce(old.promise);
    const pending = page.loadSetup();
    setupLoad.mockResolvedValueOnce({ status: 'success', data: { required: true, student: { ...student, profileVersion: 2 } } });
    await page.loadSetup();
    old.resolve({ status: 'error', statusCode: 401, message: '过时响应' });
    await pending;
    expect(page.data.student.profileVersion).toBe(2);
    expect(setupLogout).not.toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
  });

  it('renders native fields, the existing yellow shell and save button without creation or binding actions', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(__dirname, '../pages/parent/profile-setup');
    expect(fs.existsSync(path.join(root, 'index.wxml'))).toBe(true);
    const template = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'index.json'), 'utf8'));
    expect(template).toContain('bg="yellow"');
    expect(template).toContain('maxlength="100"');
    expect(template).toContain('mode="date"');
    expect(template).toContain('bind:tap="onSubmit"');
    expect(template).toContain('bindtap="onLogout"');
    expect(template).not.toMatch(/onCreateStudent|onBindStudent|mascot|新增学员|绑定孩子/);
    expect(config.usingComponents['parent-primary-button']).toBe('/components/parent-primary-button/parent-primary-button');
  });
});
