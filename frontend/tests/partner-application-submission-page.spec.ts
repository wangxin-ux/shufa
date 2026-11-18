export {};
const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({ getPartnerApplicationRuntime: () => getRuntime() }));
const applicationId = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
describe('applicant submission page', () => {
  let page: any; let runtime: any; let key: string;
  beforeEach(() => {
    key = '1:synthetic';
    runtime = { formalArchive: false, sessions: { getSessionKey: () => key, invalidateReads: jest.fn(),
      loadMe: jest.fn().mockResolvedValue({ displayName: '申请人', formalAccountReady: false }) },
    applications: { load: jest.fn().mockResolvedValue({ applicationId, status: 'DRAFT', version: 8,
      basicInformation: { institutionName: '合成机构' } }), saveBasics: jest.fn() },
    submissions: { submit: jest.fn().mockResolvedValue({ applicationId, submissionId: applicationId,
      version: 9, status: 'SUBMITTED', submittedAt: '2026-10-13T00:00:00.000Z' }) } };
    getRuntime.mockReset().mockReturnValue(runtime);
    (global as any).wx = { getWindowInfo: () => ({ windowWidth: 390 }), getMenuButtonBoundingClientRect: () => ({ top: 32, height: 32 }),
      showModal: jest.fn(), stopPullDownRefresh: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
      getRandomValues: (input: any) => input.success({ randomValues: new Uint8Array(16).buffer }) };
    (global as any).Page = (config: any) => { page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch)); };
    (global as any).getCurrentPages = () => [page];
    jest.isolateModules(() => require('../pages/partner/application/index'));
  });
  afterEach(() => { page.onUnload(); delete (global as any).wx; delete (global as any).Page; delete (global as any).getCurrentPages; });
  const open = async () => { page.onLoad(); page.onShow(); await flush(); };
  const confirm = async () => {
    page.onSubmit?.(); await flush();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true, cancel: false });
    await flush();
  };
  it('confirms a saved version then freezes editing only after a valid receipt', async () => {
    await open(); await confirm();
    expect(runtime.submissions.submit).toHaveBeenCalledWith(8, expect.any(String));
    expect(page.data.readonly).toBe(true);
    expect(page.data.version).toBe(9);
    expect(page.data.statusLabel).toBe('待审核');
    await page.onSave(); expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
  });
  it.each(['dirty', 'bankDirty', 'materialsDirty', 'materialsPending'])('requires saving %s before any confirmation', async (field) => {
    await open(); page.data[field] = true; page.onSubmit?.(); await flush();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
    expect(runtime.submissions.submit).not.toHaveBeenCalled();
    expect(page.data.message).toContain('保存');
  });
  it('keeps the request key and version on an uncertain failure', async () => {
    await open();
    runtime.submissions.submit.mockRejectedValueOnce(Object.assign(new Error('请求失败'), { statusCode: 503 }));
    await confirm();
    expect(page.data.readonly).toBe(false);
    expect(page.data.submitUncertain).toBe(true);
    await page.onSave(); expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
    const first = runtime.submissions.submit.mock.calls[0];
    await confirm();
    expect(runtime.submissions.submit.mock.calls[1]).toEqual(first);
  });
  it('does not clear a newer owner when a pending submit completes', async () => {
    await open();
    let resolve!: (value: unknown) => void;
    runtime.submissions.submit.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    await confirm();
    key = '2:new-owner'; page.onHide(); page.onShow();
    resolve({ applicationId, submissionId: applicationId, version: 9, status: 'SUBMITTED', submittedAt: '2026-10-13T00:00:00.000Z' });
    await flush();
    expect(page.data.readonly).toBe(false);
    expect(page.data.statusLabel).not.toBe('待审核');
  });
  it('clears private basics immediately on show with a new session while old submit is pending', async () => {
    await open();
    let resolve!: (value: unknown) => void;
    runtime.submissions.submit.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    page.data.form.contactPhone = '000-00000000';
    await confirm();
    page.onHide(); key = '2:new-owner';
    runtime.applications.load.mockResolvedValue({ applicationId, version: 2, status: 'DRAFT',
      basicInformation: { institutionName: '新申请人机构', contactPhone: '000-00000001' } });
    page.onShow();
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.form.contactPhone).toBe('');
    await flush();
    expect(page.data.form.institutionName).toBe('新申请人机构');
    expect(page.data.submitting).toBe(false);
    resolve({ applicationId, submissionId: applicationId, version: 9, status: 'SUBMITTED', submittedAt: '2026-10-13T00:00:00.000Z' });
    await flush();
    expect(page.data.form.institutionName).toBe('新申请人机构');
    expect(page.data.statusLabel).toBe('草稿');
  });
  it.each([400, 409])('settles a definite hidden %s and allows editing after show', async (statusCode) => {
    await open();
    let reject!: (value: unknown) => void;
    runtime.submissions.submit.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    await confirm(); page.onHide();
    reject(Object.assign(new Error('资料不完整'), { statusCode }));
    await flush(); page.onShow(); await flush();
    expect(page.data.submitUncertain).toBe(false);
    expect(page.data.submitting).toBe(false); expect(page.editable()).toBe(true);
    page.onFieldInput({ currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: '可修正' } });
    expect(page.data.form.institutionName).toBe('可修正');
  });
  it('keeps draft editing available on a definite validation failure', async () => {
    await open();
    runtime.submissions.submit.mockRejectedValueOnce(Object.assign(new Error('请保存完整材料'), { statusCode: 400 }));
    await confirm();
    expect(page.data.readonly).toBe(false); expect(page.data.submitUncertain).toBe(false);
    expect(page.data.message).toBe('请保存完整材料');
    page.onFieldInput({ currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: '修改' } });
    expect(page.data.form.institutionName).toBe('修改');
  });
  it('requires reload after a stale version and preserves the current form', async () => {
    await open();
    runtime.submissions.submit.mockRejectedValueOnce(Object.assign(new Error('版本冲突'), { statusCode: 409 }));
    await confirm();
    expect(page.data.needsVersionRefresh).toBe(true); expect(page.data.form.institutionName).toBe('合成机构');
    expect(page.data.readonly).toBe(false);
  });
  it('treats a mismatched application receipt as uncertain and keeps editing locked', async () => {
    await open();
    runtime.submissions.submit.mockResolvedValueOnce({ applicationId: 'another', version: 9, status: 'SUBMITTED' });
    await confirm();
    expect(page.data.submitUncertain).toBe(true); expect(page.data.readonly).toBe(false);
  });
  it('rejects late 401 from a replaced owner without clearing the new form', async () => {
    await open();
    let reject!: (value: unknown) => void;
    runtime.submissions.submit.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    await confirm(); key = '2:new-owner'; page.onHide(); page.onShow();
    reject(Object.assign(new Error('拒绝'), { statusCode: 401 })); await flush();
    expect(page.data.viewState).not.toBe('login');
  });
  it('ignores a confirmation after hide or owner change', async () => {
    await open(); page.onSubmit?.(); await flush();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    key = '2:new-owner'; page.onHide();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true });
    await flush(); expect(runtime.submissions.submit).not.toHaveBeenCalled();
  });
  it('consumes each native confirmation callback once', async () => {
    await open(); page.onSubmit?.(); await flush();
    const dialog = (global as any).wx.showModal.mock.calls.at(-1)[0];
    dialog.success({ confirm: true }); dialog.success({ confirm: true });
    await flush(); expect(runtime.submissions.submit).toHaveBeenCalledTimes(1);
  });
  it('locks all writes and return while submit is pending, then reloads after hide', async () => {
    await open();
    let resolve!: (value: unknown) => void;
    runtime.submissions.submit.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    await confirm();
    expect(page.data.submitting).toBe(true);
    await page.onSave(); page.onBack(); expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
    expect((global as any).wx.reLaunch).not.toHaveBeenCalled();
    page.onHide(); page.onShow(); resolve({ applicationId, submissionId: applicationId, version: 9, status: 'SUBMITTED', submittedAt: '2026-10-13T00:00:00.000Z' });
    runtime.applications.load.mockResolvedValue({ applicationId, status: 'SUBMITTED', version: 9, basicInformation: { institutionName: '合成机构' } });
    await flush();
    expect(page.data.readonly).toBe(true); expect(page.data.submitting).toBe(false);
  });
  it.each([401, 403])('clears all private sections after current submission %s', async (statusCode) => {
    await open(); page.data.bankForm.accountNumber = '000001234';
    runtime.submissions.submit.mockRejectedValueOnce(Object.assign(new Error('拒绝'), { statusCode }));
    await confirm(); expect(page.data.viewState).toBe('login');
    expect(page.data.bankForm.accountNumber).toBe(''); expect(page.data.materialsDraft).toEqual([]);
  });
});
