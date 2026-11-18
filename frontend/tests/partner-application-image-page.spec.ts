export {};
const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({
  getPartnerApplicationRuntime: () => getRuntime(),
}));
const applicationId = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const storedFileId = 'a4b42383-8bd1-4f06-bf3c-a4e9c7426162';
const uploadId = '03f20536-7c49-4eb0-bc68-f66ce27a735a';
const file = { storedFileId, kind: 'BUSINESS_LICENSE', mimeType: 'image/png', sizeBytes: 100, width: 10, height: 10 };
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (value: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const failure = (statusCode: number) => Object.assign(new Error('合成材料请求失败'), { statusCode });
const emptyMaterials = () => ({
  applicationId, status: 'DRAFT', version: 1, readonly: false, materials: [], uploads: [],
});
describe('private materials in the application page', () => {
  let page: any;
  let runtime: any;
  let key: string;
  const flush = async () => { for (let index = 0; index < 30; index++) await Promise.resolve(); };
  const open = async () => {
    page.onLoad(); page.onShow(); await flush(); page.onMaterialsToggle?.(); await flush();
  };
  const choose = () => page.onMaterialChoose?.({ currentTarget: { dataset: { kind: 'BUSINESS_LICENSE' } } });
  const selected = () => (global as any).wx.chooseMedia.mock.calls.at(-1)[0].success({
    tempFiles: [{ tempFilePath: 'wxfile://synthetic.png', size: 100 }],
  });
  beforeEach(() => {
    key = '1:applicant-token';
    runtime = {
      formalArchive: false,
      sessions: {
        getSessionKey: () => key, invalidateReads: jest.fn(),
        loadMe: jest.fn().mockResolvedValue({ displayName: '申请人', formalAccountReady: false }),
        logout: jest.fn().mockImplementation(() => { key = ''; return Promise.resolve(); }),
      },
      applications: {
        load: jest.fn().mockResolvedValue({
          applicationId, status: 'DRAFT', version: 1,
          basicInformation: { institutionName: '合成机构' },
        }), saveBasics: jest.fn(),
      },
      materials: { load: jest.fn().mockResolvedValue(emptyMaterials()),
        reserve: jest.fn().mockImplementation((expectedVersion: number, kind: string, requestKey: string) =>
          Promise.resolve({ uploadId, storedFileId, kind, expectedVersion, requestKey, state: 'RESERVED' })),
        upload: jest.fn().mockResolvedValue(file),
        save: jest.fn().mockResolvedValue({ applicationId, version: 2, materialRecordId: uploadId }),
        preview: jest.fn().mockResolvedValue('wxfile://authorized.png') },
    };
    getRuntime.mockReset().mockReturnValue(runtime);
    (global as any).wx = {
      getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: 390 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, height: 32 }),
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      showModal: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
      chooseMedia: jest.fn(), previewImage: jest.fn(), stopPullDownRefresh: jest.fn(),
      getRandomValues: (input: any) => input.success({ randomValues: new Uint8Array(16).buffer }),
    };
    (global as any).getCurrentPages = () => [page];
    (global as any).Page = (config: any) => {
      page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = jest.fn((values: object) => Object.assign(page.data, values));
    };
    jest.isolateModules(() => require('../pages/partner/application/index'));
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).wx; delete (global as any).Page; delete (global as any).getCurrentPages;
  });
  it('reads the private material partition only after explicit expansion', async () => {
    page.onLoad(); page.onShow(); await flush();
    expect(runtime.materials.load).not.toHaveBeenCalled();
    page.onMaterialsToggle?.(); await flush();
    expect(runtime.materials.load).toHaveBeenCalledTimes(1);
    expect(page.data.materialsOpen).toBe(true);
  });
  it('chooses and uploads one private image, and marks it unsaved until section save', async () => {
    await open();
    const picking = choose(); await flush(); selected(); await picking;
    expect(runtime.materials.reserve).toHaveBeenCalledWith(1, 'BUSINESS_LICENSE', expect.any(String));
    expect(runtime.materials.upload).toHaveBeenCalledTimes(1);
    expect(page.data.materialsDraft).toEqual([file]);
    expect(page.data.materialsDirty).toBe(true);
    expect((global as any).wx.enableAlertBeforeUnload).toHaveBeenCalled();
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), version: 2, materials: [file] });
    runtime.applications.load.mockResolvedValueOnce({
      applicationId, version: 2, status: 'DRAFT', basicInformation: { institutionName: '合成机构' },
    });
    await page.onMaterialsSave?.(); await flush();
    expect(runtime.materials.save).toHaveBeenCalledWith(1, [{ storedFileId, kind: 'BUSINESS_LICENSE' }]);
    expect(page.data.materialsDirty).toBe(false);
    expect(page.data.version).toBe(2);
  });
  it('silently cancels native selection and never registers an upload', async () => {
    await open();
    const picking = choose(); await flush();
    (global as any).wx.chooseMedia.mock.calls[0][0].fail({ errMsg: 'chooseMedia:fail cancel' });
    await picking;
    expect(runtime.materials.reserve).not.toHaveBeenCalled();
    expect(page.data.materialsMessage).toBe('');
    expect(page.data.materialsDirty).toBe(false);
  });
  it.each(['throw', 'fail'])('releases a native choice after %s and allows an explicit retry', async (mode) => {
    await open();
    const native = (global as any).wx;
    native.chooseMedia.mockImplementationOnce((input: WechatMiniprogram.ChooseMediaOption) => {
      if (mode === 'throw') throw new Error('synthetic native choice failure');
      input.fail?.({ errMsg: 'chooseMedia:fail synthetic' });
    });
    await choose();
    expect(page.data.materialsWorking).toBe(false);
    expect(page.data.materialsPending).toBe(false);
    expect(page.data.materialsDirty).toBe(false);
    expect(page.data.materialsMessage).toMatch(/重试|失败/);
    expect(runtime.materials.reserve).not.toHaveBeenCalled();
    const retrying = choose(); await flush(); selected(); await retrying;
    expect(native.chooseMedia).toHaveBeenCalledTimes(2);
    expect(runtime.materials.reserve).toHaveBeenCalledTimes(1);
    expect(page.data.materialsDraft).toEqual([file]);
  });
  it.each([0, 3 * 1024 * 1024 + 1])('rejects a native choice of %s bytes without reserving an upload', async (size) => {
    await open();
    const picking = choose(); await flush();
    (global as any).wx.chooseMedia.mock.calls[0][0].success({
      tempFiles: [{ tempFilePath: 'wxfile://synthetic.png', size }],
    });
    await picking;
    expect(runtime.materials.reserve).not.toHaveBeenCalled();
    expect(runtime.materials.upload).not.toHaveBeenCalled();
    expect(page.data.materialsWorking).toBe(false);
    expect(page.data.materialsDirty).toBe(false);
    expect(page.data.materialsMessage).toContain('3MB');
  });
  it('accepts the exact native size limit and does not duplicate a selection callback', async () => {
    await open();
    const picking = choose(); await flush();
    const input = (global as any).wx.chooseMedia.mock.calls[0][0];
    const result = { tempFiles: [{ tempFilePath: 'wxfile://synthetic.png', size: 3 * 1024 * 1024 }] };
    input.success(result); input.success(result); input.fail({ errMsg: 'chooseMedia:fail synthetic' });
    await picking;
    expect(runtime.materials.reserve).toHaveBeenCalledTimes(1);
    expect(runtime.materials.upload).toHaveBeenCalledTimes(1);
    expect(page.data.materialsDraft).toEqual([file]);
    expect(page.data.materialsMessage).toContain('尚未保存');
  });
  it.each(['cancel', 'throw', 'fail'])('keeps the original recovery intent after native %s', async (mode) => {
    const intent = { uploadId, storedFileId, kind: file.kind, state: 'RESERVED',
      expectedVersion: 1, requestKey: applicationId };
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), uploads: [intent] });
    await open();
    const native = (global as any).wx;
    native.chooseMedia.mockImplementationOnce((input: WechatMiniprogram.ChooseMediaOption) => {
      if (mode === 'throw') throw new Error('synthetic recovery failure');
      input.fail?.({ errMsg: `chooseMedia:fail ${mode === 'cancel' ? 'cancel' : 'synthetic'}` });
    });
    const event = { currentTarget: { dataset: { id: uploadId } } };
    await page.onMaterialRecover(event);
    expect(page.data.materialsWorking).toBe(false);
    expect(page.data.materialsPending).toBe(false);
    expect(page.data.materialsUploads).toEqual([expect.objectContaining(intent)]);
    expect(page.data.materialsMessage === '').toBe(mode === 'cancel');
    expect(runtime.materials.reserve).not.toHaveBeenCalled();
    expect(runtime.materials.upload).not.toHaveBeenCalled();
    const retrying = page.onMaterialRecover(event); await flush(); selected(); await retrying;
    expect(runtime.materials.reserve).not.toHaveBeenCalled();
    expect(runtime.materials.upload).toHaveBeenCalledWith(expect.objectContaining(intent), 'wxfile://synthetic.png');
    expect(page.data.materialsDraft).toEqual([file]);
  });
  it('retains the same intent on failed transfer and retries without another reservation', async () => {
    await open();
    runtime.materials.upload.mockRejectedValueOnce(failure(503));
    const picking = choose(); await flush(); selected(); await picking;
    expect(page.data.materialsPending).toBe(true);
    expect(page.data.materialsDirty).toBe(true);
    await page.onMaterialRetryUpload?.();
    expect(runtime.materials.reserve).toHaveBeenCalledTimes(1);
    expect(runtime.materials.upload).toHaveBeenCalledTimes(2);
    expect(runtime.materials.upload.mock.calls[1][0].uploadId).toBe(uploadId);
    expect(page.data.materialsDraft).toEqual([file]);
  });
  it('allows reselecting a rejected RESERVED image under the same intent and preserves other successful files', async () => {
    const logo = { ...file, storedFileId: uploadId, kind: 'INSTITUTION_LOGO' };
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), materials: [logo] });
    await open();
    runtime.materials.upload.mockRejectedValueOnce(failure(400));
    const picking = choose(); await flush(); selected(); await picking;
    expect(page.data.materialsPending).toBe(false);
    expect(page.data.materialsDraft).toEqual([logo]);
    const recovering = page.onMaterialRecover?.({ currentTarget: { dataset: { id: uploadId } } });
    await flush();
    expect((global as any).wx.chooseMedia).toHaveBeenCalledTimes(2);
    (global as any).wx.chooseMedia.mock.calls.at(-1)[0].success({
      tempFiles: [{ tempFilePath: 'wxfile://replacement.png', size: 100 }],
    });
    await recovering;
    expect(runtime.materials.reserve).toHaveBeenCalledTimes(1);
    expect(runtime.materials.upload.mock.calls.at(-1)).toEqual([
      expect.objectContaining({ uploadId }), 'wxfile://replacement.png',
    ]);
    expect(page.data.materialsDraft).toEqual([logo, file]);
  });
  it.each(['recover', 'save'])('releases a wrong WRITING selection after 409 so the applicant can %s', async (action) => {
    const intent = { uploadId, storedFileId, kind: file.kind, state: 'WRITING',
      expectedVersion: 1, requestKey: applicationId };
    const logoId = '65a64b74-0cdb-49ac-909b-2e71c634d709';
    const logo = { ...file, storedFileId: logoId, kind: 'INSTITUTION_LOGO' };
    const logoIntent = { ...intent, uploadId: logoId, storedFileId: logoId,
      kind: logo.kind, requestKey: logoId, state: 'RESERVED' };
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), uploads: [intent] });
    await open();
    runtime.materials.reserve.mockResolvedValueOnce(logoIntent);
    runtime.materials.upload.mockResolvedValueOnce(logo);
    const picking = page.onMaterialChoose?.({ currentTarget: { dataset: { kind: logo.kind } } });
    await flush(); selected(); await picking;
    runtime.materials.upload.mockRejectedValueOnce(failure(409));
    const wrong = page.onMaterialRecover?.({ currentTarget: { dataset: { id: uploadId } } });
    await flush(); selected(); await wrong;
    expect(page.data.materialsNeedsRefresh).toBe(true);
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(),
      uploads: [intent, { ...logoIntent, state: 'COMPLETED' }] });
    await page.onMaterialsRetry?.();
    expect(page.data.materialsPending).toBe(false);
    expect(page.data.materialsDraft).toEqual([logo]);
    if (action === 'recover') {
      const recovering = page.onMaterialRecover?.({ currentTarget: { dataset: { id: uploadId } } });
      await flush();
      expect((global as any).wx.chooseMedia).toHaveBeenCalledTimes(3);
      (global as any).wx.chooseMedia.mock.calls.at(-1)[0].success({
        tempFiles: [{ tempFilePath: 'wxfile://original.png', size: 100 }],
      });
      await recovering;
      expect(runtime.materials.upload.mock.calls.at(-1)).toEqual([
        expect.objectContaining({ uploadId }), 'wxfile://original.png',
      ]);
      expect(page.data.materialsDraft).toEqual([logo, file]);
    } else {
      runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), version: 2,
        materials: [logo], uploads: [intent] });
      await page.onMaterialsSave?.(); await flush();
      expect(runtime.materials.save).toHaveBeenCalledWith(1,
        [{ storedFileId: logoId, kind: logo.kind }]);
    }
    expect(runtime.materials.reserve).toHaveBeenCalledTimes(1);
  });
  it('allows saving three successful photos after a fourth reservation hits the outstanding quota', async () => {
    await open();
    const photos = [storedFileId, uploadId, applicationId].map((id) =>
      ({ ...file, storedFileId: id, kind: 'ENVIRONMENT' }));
    const intents = photos.map((photo) => ({ uploadId: photo.storedFileId,
      storedFileId: photo.storedFileId, kind: photo.kind, state: 'RESERVED',
      expectedVersion: 1, requestKey: photo.storedFileId }));
    for (let index = 0; index < photos.length; index++) {
      runtime.materials.reserve.mockResolvedValueOnce(intents[index]);
      runtime.materials.upload.mockResolvedValueOnce(photos[index]);
      const picking = page.onMaterialChoose?.({ currentTarget: { dataset: { kind: 'ENVIRONMENT' } } });
      await flush(); selected(); await picking;
    }
    runtime.materials.reserve.mockRejectedValueOnce(failure(409));
    const rejected = page.onMaterialChoose?.({ currentTarget: { dataset: { kind: 'ENVIRONMENT' } } });
    await flush(); selected(); await rejected;
    expect(page.data.materialsNeedsRefresh).toBe(true);
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(),
      uploads: intents.map((intent) => ({ ...intent, state: 'COMPLETED' })) });
    await page.onMaterialsRetry?.();
    expect(page.data.materialsPending).toBe(false);
    expect(page.data.materialsDraft).toEqual(photos);
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), version: 2, materials: photos });
    await page.onMaterialsSave?.(); await flush();
    expect(runtime.materials.save).toHaveBeenCalledWith(1,
      photos.map(({ storedFileId, kind }) => ({ storedFileId, kind })));
    expect(runtime.materials.reserve).toHaveBeenCalledTimes(4);
    expect(runtime.materials.upload).toHaveBeenCalledTimes(3);
  });
  it('allows a fresh explicit selection at the latest version after reservation conflict', async () => {
    await open();
    page.onFieldInput({ currentTarget: { dataset: { field: 'institutionName' } },
      detail: { value: '机构未保存修改' } });
    runtime.materials.reserve.mockRejectedValueOnce(failure(409));
    const rejected = choose(); await flush(); selected(); await rejected;
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), version: 2 });
    await page.onMaterialsRetry?.();
    expect(page.data.materialsPending).toBe(false);
    expect(page.data.form.institutionName).toBe('机构未保存修改');
    const picking = choose(); await flush(); selected(); await picking;
    expect(runtime.materials.reserve.mock.calls.at(-1)).toEqual([
      2, file.kind, expect.any(String),
    ]);
    expect(runtime.materials.upload).toHaveBeenCalledTimes(1);
    expect(page.data.materialsDraft).toEqual([file]);
  });
  it('keeps successful references and basic edits when section saving fails or conflicts', async () => {
    await open();
    page.onFieldInput({ currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: '机构未保存修改' } });
    const picking = choose(); await flush(); selected(); await picking;
    runtime.materials.save.mockRejectedValueOnce(failure(503));
    await page.onMaterialsSave?.();
    expect(page.data.materialsDraft).toEqual([file]);
    runtime.materials.save.mockRejectedValueOnce(failure(409));
    await page.onMaterialsSave?.();
    expect(page.data.materialsNeedsRefresh).toBe(true);
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), version: 3 });
    await page.onMaterialsRetry?.();
    expect(page.data.materialsVersion).toBe(3);
    expect(page.data.materialsDraft).toEqual([file]);
    expect(page.data.materialsDirty).toBe(true);
    expect(page.data.form.institutionName).toBe('机构未保存修改');
  });
  it('blocks basic writes, banking, return and competing choices during material processing', async () => {
    await open();
    const picking = choose(); await flush();
    choose(); page.onBankToggle?.(); await page.onSave(); page.onBack();
    expect((global as any).wx.chooseMedia).toHaveBeenCalledTimes(1);
    expect(runtime.applications.saveBasics).not.toHaveBeenCalled();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
    selected(); await picking;
  });
  it.each([401, 403])('clears all private references after current material %s', async (status) => {
    await open();
    const picking = choose(); await flush(); selected(); await picking;
    runtime.materials.save.mockRejectedValueOnce(failure(status));
    await page.onMaterialsSave?.();
    expect(page.data.materialsDraft).toEqual([]);
    expect(page.data.materialsRows.every((row: any) => row.files.length === 0)).toBe(true);
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.bankForm.accountNumber).toBe('');
  });
  it('never applies a late hidden upload, resumes by the same intent, and preserves unsaved references', async () => {
    await open();
    const uploading = deferred(); runtime.materials.upload.mockReturnValueOnce(uploading.promise);
    const picking = choose(); await flush(); selected(); await flush();
    page.onHide(); uploading.resolve(file); await picking; await flush();
    expect(page.data.materialsDraft).toEqual([]);
    page.onShow(); await flush();
    expect(page.data.materialsPending).toBe(true);
    await page.onMaterialRetryUpload?.();
    expect(runtime.materials.reserve).toHaveBeenCalledTimes(1);
    expect(page.data.materialsDraft).toEqual([file]);
  });
  it('ignores an old native selection after logout or replacement by a new session', async () => {
    await open();
    const picking = choose(); await flush();
    page.clearPrivate(); key = '2:new-applicant';
    page.onShow(); await flush();
    selected(); await picking; await flush();
    expect(runtime.materials.reserve).not.toHaveBeenCalled();
    expect(page.data.form.institutionName).toBe('合成机构');
    expect(page.ownerKey).toBe('2:new-applicant');
    expect(page.data.materialsDraft).toEqual([]);
  });
  it('downloads saved previews with authorization and keeps late hidden previews from opening', async () => {
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), materials: [file] });
    await open();
    const download = deferred(); runtime.materials.preview.mockReturnValueOnce(download.promise);
    const pending = page.onMaterialPreview?.({ currentTarget: { dataset: { id: storedFileId } } }); await flush();
    page.onHide(); download.resolve('wxfile://old.png'); await pending;
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
  });
  it.each(['throw', 'fail'])('retains saved materials after native preview %s and permits retry', async (mode) => {
    runtime.materials.load.mockResolvedValueOnce({ ...emptyMaterials(), materials: [file] });
    await open();
    const native = (global as any).wx;
    native.previewImage.mockImplementationOnce((input: WechatMiniprogram.PreviewImageOption) => {
      if (mode === 'throw') throw new Error('synthetic preview failure');
      input.fail?.({ errMsg: 'previewImage:fail synthetic' });
    });
    const event = { currentTarget: { dataset: { id: storedFileId } } };
    await page.onMaterialPreview(event);
    expect(page.data.materialsWorking).toBe(false);
    expect(page.data.materialsDirty).toBe(false);
    expect(page.data.materialsDraft).toEqual([file]);
    expect(page.data.materialsMessage).toMatch(/重试|失败/);
    native.previewImage.mockImplementationOnce((input: WechatMiniprogram.PreviewImageOption) =>
      input.success?.({ errMsg: 'previewImage:ok' }));
    await page.onMaterialPreview(event);
    expect(runtime.materials.preview).toHaveBeenCalledTimes(2);
    expect(native.previewImage).toHaveBeenLastCalledWith(expect.objectContaining({
      current: 'wxfile://authorized.png', urls: ['wxfile://authorized.png'],
    }));
    expect(page.data.materialsWorking).toBe(false);
    expect(page.data.materialsMessage).toBe('');
  });
  it('previews an unsaved upload locally and preserves it after native failure', async () => {
    await open();
    const picking = choose(); await flush(); selected(); await picking;
    const native = (global as any).wx;
    native.previewImage.mockImplementationOnce((input: WechatMiniprogram.PreviewImageOption) =>
      input.fail?.({ errMsg: 'previewImage:fail synthetic' }));
    await page.onMaterialPreview({ currentTarget: { dataset: { id: storedFileId } } });
    expect(runtime.materials.preview).not.toHaveBeenCalled();
    expect(native.previewImage).toHaveBeenCalledWith(expect.objectContaining({
      current: 'wxfile://synthetic.png', urls: ['wxfile://synthetic.png'],
    }));
    expect(page.data.materialsDraft).toEqual([file]);
    expect(page.data.materialsDirty).toBe(true);
    expect(page.data.materialsWorking).toBe(false);
    expect(runtime.materials.save).not.toHaveBeenCalled();
  });
  it('prompts before discarding unsaved material references and clears references on confirmed logout', async () => {
    await open();
    const picking = choose(); await flush(); selected(); await picking;
    page.onBack();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: false });
    await page.onApplicantLogout();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true });
    await flush();
    expect(page.data.materialsDraft).toEqual([]);
    expect(page.data.materialsDirty).toBe(false);
  });
  it('never opens a material partition in a formal archive', async () => {
    runtime.formalArchive = true; runtime.materials = undefined;
    page.onLoad(); page.onShow(); await flush(); page.onMaterialsToggle?.(); await flush();
    expect(page.data.materialsOpen).toBe(false);
  });
});
