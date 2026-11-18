const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({
  getPartnerApplicationRuntime: () => getRuntime(),
}));

const draft = (name = '合成机构', status = 'DRAFT') => ({
  applicationId: '55883f08-c9f5-4f26-927c-82ea07cb8a02', status, version: 1,
  basicInformation: {
    institutionName: name, province: '浙江省', city: '杭州市',
    district: '西湖区', detailedAddress: '合成测试路一号',
  },
  createdAt: '2026-10-10T08:00:00.000Z', updatedAt: '2026-10-10T08:00:00.000Z',
});
const failure = (statusCode: number) => Object.assign(new Error('合成请求失败'), { statusCode });

describe('application native return alert for unsaved basics', () => {
  let definition: any;
  let page: any;
  let runtime: any;
  let sessionKey: string;
  let native: any;
  let instances: any[];
  const flush = async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  };
  const instantiate = () => {
    const instance = { ...definition, data: { ...definition.data, form: { ...definition.data.form } } };
    instance.setData = jest.fn((values: object) => Object.assign(instance.data, values));
    instances.push(instance);
    return instance;
  };
  const open = async (instance = page) => {
    instance.onLoad();
    instance.onShow();
    await flush();
  };
  const edit = (name = '未保存合成机构', instance = page) => instance.onFieldInput({
    currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: name },
  });
  beforeEach(() => {
    sessionKey = 'applicant-session';
    instances = [];
    runtime = {
      sessions: {
        getSessionKey: () => sessionKey,
        invalidateReads: jest.fn(),
        loadMe: jest.fn().mockResolvedValue({ displayName: '合成申请人', formalAccountReady: false }),
        logout: jest.fn().mockResolvedValue(undefined),
      },
      applications: {
        load: jest.fn().mockResolvedValue(draft()),
        saveBasics: jest.fn().mockResolvedValue(draft('未保存合成机构')),
      },
    };
    getRuntime.mockReset().mockReturnValue(runtime);
    native = {
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, height: 32 }),
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn(),
      showModal: jest.fn(),
      navigateBack: jest.fn(),
      reLaunch: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    (global as any).wx = native;
    (global as any).Page = (config: any) => { definition = config; };
    (global as any).getCurrentPages = () => [{}, page];
    jest.isolateModules(() => require('../pages/partner/application/index'));
    page = instantiate();
  });
  afterEach(() => {
    instances.forEach((instance) => instance.onUnload());
    delete (global as any).wx;
    delete (global as any).Page;
    delete (global as any).getCurrentPages;
  });

  it('enables once on dirty input and disables when the user restores saved values', async () => {
    await open();
    expect(native.enableAlertBeforeUnload).not.toHaveBeenCalled();
    edit();
    edit('再次修改合成机构');
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('未保存'),
    }));
    edit(' 合成机构 ');
    expect(page.data.dirty).toBe(false);
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
  });

  it('also protects changed region fields and removes protection after restoring them', async () => {
    await open();
    page.onRegionChange({ detail: { value: ['江苏省', '苏州市', '姑苏区'] } });
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    page.onRegionChange({ detail: { value: ['浙江省', '杭州市', '西湖区'] } });
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    page.onClearRegion();
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
  });

  it('keeps the alert during save and disables only after a successful saved readback', async () => {
    await open();
    edit();
    let resolve!: (value: unknown) => void;
    runtime.applications.saveBasics.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const saving = page.onSave();
    await flush();
    expect(native.disableAlertBeforeUnload).not.toHaveBeenCalled();
    resolve(draft('未保存合成机构'));
    await saving;
    expect(page.data.dirty).toBe(false);
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
  });

  it.each([409, 503])('retains protection and edits after save HTTP %s', async (code) => {
    await open();
    edit();
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(code));
    await page.onSave();
    expect(page.data.dirty).toBe(true);
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    expect(native.disableAlertBeforeUnload).not.toHaveBeenCalled();
  });

  it('clears protection with private data after authentication fails', async () => {
    await open();
    edit();
    runtime.applications.load.mockRejectedValueOnce(failure(401));
    await page.loadDraft(true);
    expect(page.data.dirty).toBe(false);
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
  });

  it('also disables after save HTTP 401 without retaining private edits', async () => {
    await open();
    edit();
    runtime.applications.saveBasics.mockRejectedValueOnce(failure(401));
    await page.onSave();
    expect(page.data).toMatchObject({ viewState: 'login', dirty: false });
    expect(page.data.form.institutionName).toBe('');
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
  });

  it('disables when the dirty form owner changes before another edit', async () => {
    await open();
    edit();
    sessionKey = 'another-applicant';
    edit('不允许跨身份保留');
    expect(page.data).toMatchObject({ viewState: 'login', dirty: false });
    expect(page.data.form.institutionName).toBe('');
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
  });

  it('disables immediately when an already dirty page switches to a readonly formal archive', async () => {
    await open();
    edit();
    runtime.formalArchive = true;
    const reading = page.loadDraft(true);
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    await reading;
    expect(page.data).toMatchObject({ formalArchive: true, readonly: true, dirty: false });
    expect(page.data.form.institutionName).toBe('合成机构');
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(1);
  });

  it('retries a current native enable failure only on a subsequent form change', async () => {
    await open();
    edit();
    native.enableAlertBeforeUnload.mock.calls[0][0].fail({ errMsg: 'native unavailable' });
    await flush();
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    edit('用户继续填写');
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
    expect(page.data.dirty).toBe(true);
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });

  it('disables while hidden and re-enables the retained draft on return without rereading', async () => {
    await open();
    edit();
    page.onHide();
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    page.onShow();
    await flush();
    expect(page.data.dirty).toBe(true);
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
    expect(runtime.applications.load).toHaveBeenCalledTimes(1);
    page.onUnload();
    page.onShow();
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(2);
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
  });

  it('keeps protection after a cancelled custom confirmation and disables before accepted navigation', async () => {
    await open();
    edit();
    page.onBack();
    native.showModal.mock.calls[0][0].success({ confirm: false });
    expect(native.disableAlertBeforeUnload).not.toHaveBeenCalled();
    page.onBack();
    native.showModal.mock.calls[1][0].success({ confirm: true });
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    expect(native.disableAlertBeforeUnload.mock.invocationCallOrder[0])
      .toBeLessThan(native.navigateBack.mock.invocationCallOrder[0]);
  });

  it('restores protection if both accepted navigation and its fallback fail', async () => {
    await open();
    edit();
    page.onBack();
    native.showModal.mock.calls[0][0].success({ confirm: true });
    native.navigateBack.mock.calls[0][0].fail();
    native.reLaunch.mock.calls[0][0].fail();
    expect(page.data.dirty).toBe(true);
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
  });

  it('never enables for readonly applicant or formal archives', async () => {
    runtime.applications.load.mockResolvedValueOnce(draft('合成机构', 'SUBMITTED'));
    await open();
    edit();
    expect(native.enableAlertBeforeUnload).not.toHaveBeenCalled();
    const formal = instantiate();
    runtime.formalArchive = true;
    await open(formal);
    edit('不允许修改', formal);
    expect(native.enableAlertBeforeUnload).not.toHaveBeenCalled();
  });

  it('preserves the custom confirmation when native APIs are absent or throw', async () => {
    await open();
    native.enableAlertBeforeUnload.mockImplementationOnce(() => { throw new Error('unavailable'); });
    expect(() => edit()).not.toThrow();
    page.onBack();
    native.showModal.mock.calls[0][0].success({ confirm: false });
    delete native.enableAlertBeforeUnload;
    delete native.disableAlertBeforeUnload;
    expect(() => edit('继续修改')).not.toThrow();
    page.onBack();
    expect(native.showModal).toHaveBeenCalledTimes(2);
    expect(page.data.dirty).toBe(true);
  });

  it('does not let a stale native failure disable a newer restored guard', async () => {
    await open();
    edit();
    const oldEnable = native.enableAlertBeforeUnload.mock.calls[0][0];
    page.onHide();
    page.onShow();
    await flush();
    oldEnable.fail({ errMsg: 'old native callback' });
    edit('再次修改');
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
  });

  it('does not retain another page instance native guard state', async () => {
    await open();
    edit();
    page.onHide();
    const other = instantiate();
    await open(other);
    edit('另一个页面修改', other);
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
    expect(page.data.form.institutionName).toBe('未保存合成机构');
  });

  it('ignores a hidden page disable failure so unloading it cannot clear a newer page guard', async () => {
    await open();
    edit();
    page.onHide();
    const oldDisable = native.disableAlertBeforeUnload.mock.calls[0][0];
    const other = instantiate();
    await open(other);
    edit('新页面修改', other);
    oldDisable.fail({ errMsg: 'hidden page callback' });
    page.onUnload();
    expect(native.disableAlertBeforeUnload).toHaveBeenCalledTimes(1);
    expect(native.enableAlertBeforeUnload).toHaveBeenCalledTimes(2);
    expect(other.data.dirty).toBe(true);
  });
});
