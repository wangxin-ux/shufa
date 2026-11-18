export {};
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';

describe('partner campaign save-all workflow with actual Page and services', () => {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  let page: any;
  let runtime: { dataDriver: string; accessToken: string };
  const event = (field: string, value: string, part?: string) => ({
    currentTarget: { dataset: { field, part } }, detail: { value },
  });
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  const fill = () => {
    page.onInput(event('title', ' 合成免费活动 '));
    page.onInput(event('shareDescription', '合成报名说明'));
    page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
    page.onFreeTimeChange(event('startsAt', '2099-10-13', 'date'));
    page.onFreeTimeChange(event('startsAt', '08:30', 'time'));
    page.onFreeTimeChange(event('endsAt', '2099-10-14', 'date'));
    page.onFreeTimeChange(event('endsAt', '09:45', 'time'));
    page.onCapacityChange({ detail: { value: 'LIMITED' } });
    page.onFreeInput(event('maxRegistrations', '12'));
  };
  const saveAll = () => {
    expect(typeof page.onSaveAll).toBe('function');
    return page.onSaveAll() as Promise<void>;
  };
  const questions = () => [
    { id: 'name', kind: 'TEXT', label: '姓名', hint: '合成备注', required: true, options: [] },
    { id: 'class', kind: 'SINGLE_CHOICE', label: '班次', hint: '', required: false, options: ['上午', '下午'] },
  ];
  const changeQuestions = (value = questions()) => {
    expect(typeof page.onRegistrationFormChange).toBe('function');
    page.onRegistrationFormChange({ detail: { questions: value } });
  };
  beforeEach(() => {
    runtime = { dataDriver: 'mock', accessToken: '' };
    for (const key of ['wx', 'Page', 'getCurrentPages']) previous.set(key, Object.getOwnPropertyDescriptor(host, key));
    host.wx = {
      getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined,
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 290, height: 32 }),
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      showShareMenu: jest.fn(), hideShareMenu: jest.fn(), showModal: jest.fn(),
      navigateBack: jest.fn(), reLaunch: jest.fn(),
    };
    host.getCurrentPages = () => [{}, page];
    host.Page = (definition: object & { data: object }) => {
      page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
    jest.isolateModules(() => require('../pages/partner/campaign-editor/index'));
    page.onLoad({});
    page.onShow();
  });
  afterEach(() => {
    page.onUnload();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(host, key, descriptor);
      else Reflect.deleteProperty(host, key);
    }
    previous.clear();
  });

  it('accepts the whole free form before creating a draft or guessing its timezone', () => {
    const create = jest.spyOn(page.runtime, 'create');
    fill();
    expect(page.data).toMatchObject({ draftId: '', campusTimezone: '', dirty: true, freeDirty: true });
    expect(page.data.freeTimes).toEqual({
      startsAt: { date: '2099-10-13', time: '08:30' },
      endsAt: { date: '2099-10-14', time: '09:45' },
    });
    expect(create).not.toHaveBeenCalled();
  });
  const chooseImage = async (slot = 'cover', cancel = false) => {
    (host.wx as any).chooseMedia = (v: any) => cancel ? v.fail({ errMsg: 'chooseMedia:fail cancel' }) :
      v.success({ tempFiles: [{ tempFilePath: `wxfile://synthetic-${slot}.png`, size: 1024 }], type: 'image' });
    (host.wx as any).getImageInfo = (v: any) => v.success({
      width: slot === 'cover' ? 750 : 800, height: slot === 'cover' ? 1125 : 600, type: 'png',
    });
    expect(typeof page.onImageChoose).toBe('function');
    await page.onImageChoose({ currentTarget: { dataset: { slot } } });
  };
  it.each(['REGULAR_GROUP', 'MULTI_SPEC_GROUP', 'FLASH_SALE', 'MULTI_SPEC_REGISTRATION_FEE', 'FREE_REGISTRATION'])(
    'saves and reopens the same private questions for %s', async type => {
      page.onTypeChange({ detail: { value: type } });
      changeQuestions();
      expect(page.data.registrationDirty).toBe(true);
      page.onEditorTab({ currentTarget: { dataset: { tab: 'preview' } } });
      expect(page.data.registrationQuestions).toEqual(questions());
      page.onEditorTab({ currentTarget: { dataset: { tab: 'edit' } } });
      await saveAll();
      expect(page.data).toMatchObject({ registrationDirty: false, registrationSaveUnknown: false,
        message: '全部草稿已保存', registrationQuestions: questions() });
      expect(await page.freeRuntime.getBasicDraft(page.data.draftId)).toMatchObject({ registrationForm: questions() });
      await page.load(false);
      expect(page.data.registrationQuestions).toEqual(questions());
    },
  );
  it('retries only the original template and version after losing its save reply', async () => {
    fill(); changeQuestions();
    const original = page.freeRuntime.saveRegistrationForm.bind(page.freeRuntime);
    const save = jest.spyOn(page.freeRuntime, 'saveRegistrationForm').mockImplementationOnce(async (...args: unknown[]) => {
      await original(...args); throw { statusCode: 0 };
    });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(page.data.registrationSaveUnknown).toBe(true);
    expect(settings).not.toHaveBeenCalled();
    changeQuestions([]);
    expect(page.data.registrationQuestions).toEqual(questions());
    await saveAll();
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(page.data).toMatchObject({ registrationDirty: false, registrationSaveUnknown: false });
    expect(settings).toHaveBeenCalledTimes(1);
  });
  it('keeps unsaved questions on a conflict and allows reread then save', async () => {
    fill(); await saveAll(); changeQuestions();
    jest.spyOn(page.freeRuntime, 'saveRegistrationForm').mockRejectedValueOnce({ statusCode: 409 });
    await saveAll();
    expect(page.data).toMatchObject({ registrationDirty: true, needsVersionRefresh: true });
    await page.onReload();
    expect(page.data.registrationQuestions).toEqual(questions());
    await saveAll();
    expect(page.data).toMatchObject({ registrationDirty: false, needsVersionRefresh: false });
  });
  it('rejects incomplete questions before creating a draft and clears them on identity change', async () => {
    changeQuestions([{ ...questions()[0], label: '' }]);
    const create = jest.spyOn(page.runtime, 'create');
    await saveAll();
    expect(create).not.toHaveBeenCalled();
    expect(page.data.message).toMatch(/表单/);
    runtime = { ...runtime, accessToken: 'synthetic-new-owner' }; page.onShow();
    expect(page.data).toMatchObject({ registrationQuestions: [], registrationDirty: false, viewState: 'forbidden' });
  });
  it('stops later writes after hiding during a form save and safely replays it on return', async () => {
    fill(); changeQuestions();
    const original = page.freeRuntime.saveRegistrationForm.bind(page.freeRuntime);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const save = jest.spyOn(page.freeRuntime, 'saveRegistrationForm').mockImplementationOnce(async (...args: unknown[]) => {
      await wait; return original(...args);
    });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    const pending = saveAll();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    page.onHide(); release(); await pending;
    expect(settings).not.toHaveBeenCalled();
    page.onShow(); await flush();
    expect(page.data.registrationSaveUnknown).toBe(true);
    expect(page.data.saving).toBe(false);
    const template = readFileSync(join(__dirname, '../pages/partner/campaign-editor/index.wxml'), 'utf8');
    const disabled = template.match(/<button\b[^>]*\bid="free-save"[^>]*disabled="\{\{(.+?)\}\}"/)?.[1];
    expect(disabled).toBeDefined();
    expect(new Script(`(${disabled})`).runInNewContext(page.data)).toBe(false);
    await saveAll();
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(page.data).toMatchObject({ registrationDirty: false, registrationSaveUnknown: false });
  });
  it('ignores an old-owner form result and clears questions after a credential change', async () => {
    changeQuestions();
    const original = page.freeRuntime.saveRegistrationForm.bind(page.freeRuntime);
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const save = jest.spyOn(page.freeRuntime, 'saveRegistrationForm').mockImplementationOnce(async (...args: unknown[]) => {
      const result = await original(...args); await wait; return result;
    });
    const pending = saveAll();
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    page.onHide(); runtime = { ...runtime, accessToken: 'new-form-owner' };
    page.onShow(); release(); await pending;
    expect(page.data).toMatchObject({ viewState: 'forbidden', registrationQuestions: [], registrationDirty: false });
  });
  it('saves selected images with the same draft, reloads them and preserves text', async () => {
    fill(); page.onContentInput(event('', '保留独立正文'));
    await chooseImage();
    expect(page.data.imageDirty).toBe(true);
    await saveAll();
    expect(page.data).toMatchObject({ imageDirty: false, imageSaveUnknown: false, content: '保留独立正文',
      message: '全部草稿已保存' });
    expect((await page.freeRuntime.getImages(page.data.draftId)).images.cover).toMatchObject({ mimeType: 'image/png' });
    await page.load(false);
    expect(page.data.imagePreviews.cover).toBe('wxfile://synthetic-cover.png');
  });
  it('opens mismatched photos for cropping and cancels without changing the previous image', async () => {
    await chooseImage();
    const original = page.data.imagePreviews.cover;
    await chooseImage('cover', true);
    expect(page.data.imagePreviews.cover).toBe(original);
    (host.wx as any).chooseMedia = (v: any) => v.success({
      tempFiles: [{ tempFilePath: 'wxfile://wrong-size.png', size: 1024 }], type: 'image',
    });
    (host.wx as any).getImageInfo = (v: any) => v.success({ width: 800, height: 600, type: 'png' });
    await page.onImageChoose({ currentTarget: { dataset: { slot: 'cover' } } });
    expect(page.data.imagePreviews.cover).toBe(original);
    expect(page.data).toMatchObject({ imageChoosing: true, imageCropSource: 'wxfile://wrong-size.png', imageCropSlot: 'cover' });
    page.onShow(); await flush();
    expect(page.data.imageChoosing).toBe(true);
    await page.onSaveAll();
    expect(page.data.draftId).toBe('');
    page.onImageCropCancel({ detail: { source: 'wxfile://wrong-size.png' } });
    expect(page.data).toMatchObject({ imageChoosing: false, imageCropSource: '', imagePreviews: { cover: original } });
  });
  it('accepts only the current crop, saves its output and reopens it', async () => {
    await chooseImage();
    page.onImageCrop({ currentTarget: { dataset: { slot: 'cover' } } });
    const source = page.data.imageCropSource;
    expect(source).toBe('wxfile://synthetic-cover.png');
    page.onImageCropConfirm({ detail: { source: 'old-source', slot: 'cover', path: 'stale.jpg' } });
    expect(page.data.imageCropSource).toBe(source);
    page.onImageCropConfirm({ detail: { source, slot: 'share', path: 'wrong-slot.jpg' } });
    expect(page.data.imageCropSource).toBe(source);
    page.onImageCropConfirm({ detail: { source, slot: 'cover', path: 'wxfile://cropped.jpg' } });
    expect(page.data).toMatchObject({ imageChoosing: false, imageCropSource: '', imageDirty: true });
    await saveAll(); await page.load(false);
    expect(page.data.imagePreviews.cover).toBe('wxfile://cropped.jpg');
  });
  it('discards private crop state on identity change and ignores its delayed result', async () => {
    await chooseImage();
    page.onImageCrop({ currentTarget: { dataset: { slot: 'cover' } } });
    const source = page.data.imageCropSource;
    page.onHide(); runtime = { ...runtime, accessToken: 'new-crop-owner' }; page.onShow();
    page.onImageCropConfirm({ detail: { source, slot: 'cover', path: 'old-private-crop.jpg' } });
    expect(page.data).toMatchObject({ viewState: 'forbidden', imageChoosing: false,
      imageCropSource: '', imagePreviews: { cover: '', share: '' }, imageDirty: false });
  });
  it('saves both slots in version order and can clear the cover while retaining the share image', async () => {
    fill(); await chooseImage(); await chooseImage('share');
    const upload = jest.spyOn(page.freeRuntime, 'uploadImage');
    await saveAll();
    expect(upload.mock.calls.map((call: unknown[]) => [call[1], call[2]])).toEqual([[1, 'cover'], [2, 'share']]);
    expect(page.data).toMatchObject({ version: 4, imageDirty: false, freeDirty: false });
    page.onImageClear({ currentTarget: { dataset: { slot: 'cover' } } });
    await saveAll();
    const view = await page.freeRuntime.getImages(page.data.draftId);
    expect(view.images).toMatchObject({ cover: null, share: { accessUrl: 'wxfile://synthetic-share.png' } });
    expect(page.data.imagePreviews).toEqual({ cover: '', share: 'wxfile://synthetic-share.png' });
  });
  it('preserves a local image after a version conflict until an explicit reread and save', async () => {
    fill(); await saveAll(); await chooseImage();
    jest.spyOn(page.freeRuntime, 'uploadImage').mockRejectedValueOnce({ statusCode: 409 });
    await saveAll();
    expect(page.data).toMatchObject({ imageDirty: true, needsVersionRefresh: true, imageSaveUnknown: false });
    await page.onReload();
    expect(page.data.imagePreviews.cover).toBe('wxfile://synthetic-cover.png');
    await saveAll();
    expect(page.data).toMatchObject({ imageDirty: false, needsVersionRefresh: false, message: '全部草稿已保存' });
  });
  it('retains native picker results delivered while the page is hidden', async () => {
    let finish!: (value: unknown) => void;
    (host.wx as any).chooseMedia = (v: any) => { finish = v.success; };
    (host.wx as any).getImageInfo = (v: any) => v.success({ width: 750, height: 1125, type: 'png' });
    const pending = page.onImageChoose({ currentTarget: { dataset: { slot: 'cover' } } });
    page.onHide();
    finish({ tempFiles: [{ tempFilePath: 'wxfile://native-hidden.png', size: 1024 }], type: 'image' });
    await pending;
    page.onShow(); await flush();
    expect(page.data).toMatchObject({ imageChoosing: false, imageDirty: true,
      imagePreviews: { cover: 'wxfile://native-hidden.png' } });
  });
  it('ignores a picker result after the account changes while hidden', async () => {
    let finish!: (value: unknown) => void;
    (host.wx as any).chooseMedia = (v: any) => { finish = v.success; };
    const pending = page.onImageChoose({ currentTarget: { dataset: { slot: 'cover' } } });
    page.onHide(); runtime = { ...runtime, accessToken: 'synthetic-new-owner' };
    finish({ tempFiles: [{ tempFilePath: 'wxfile://private-old.png', size: 1024 }], type: 'image' });
    await pending;
    page.onShow(); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', imageDirty: false,
      imagePreviews: { cover: '', share: '' } });
  });
  it.each(['cover', 'share'])('retries the exact %s file and version after its reply is lost, before free settings', async slot => {
    fill(); await chooseImage(slot);
    const original = page.freeRuntime.uploadImage.bind(page.freeRuntime);
    const save = jest.spyOn(page.freeRuntime, 'uploadImage').mockImplementationOnce(async (...args: unknown[]) => {
      await original(...args); throw { statusCode: 0 };
    });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(page.data.imageSaveUnknown).toBe(true); expect(settings).not.toHaveBeenCalled();
    await saveAll();
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(page.data).toMatchObject({ imageSaveUnknown: false, imageDirty: false });
    expect(settings).toHaveBeenCalledTimes(1);
  });
  it('clears selected image data on identity change', async () => {
    await chooseImage();
    runtime = { ...runtime, accessToken: 'new-owner' }; page.onShow();
    expect(page.data).toMatchObject({ viewState: 'forbidden', imagePreviews: { cover: '', share: '' }, imageDirty: false });
  });
  it.each(['REGULAR_GROUP', 'MULTI_SPEC_GROUP', 'FLASH_SALE', 'MULTI_SPEC_REGISTRATION_FEE', 'FREE_REGISTRATION'])(
    'saves and reopens the independent body with the shared %s editor', async (type) => {
      page.onTypeChange({ detail: { value: type } });
      page.onInput(event('title', '合成正文活动'));
      page.onContentInput(event('', ' 第一段\n\n第二段 <文字> '));
      await saveAll();
      const id = page.data.draftId;
      expect(page.data).toMatchObject({
        content: '第一段\n\n第二段 <文字>', contentDirty: false, contentSaveUnknown: false,
        savingAll: false, message: '全部草稿已保存',
      });
      expect(await page.freeRuntime.getBasicDraft(id)).toMatchObject({
        activityContent: '第一段\n\n第二段 <文字>', version: 2,
      });
      page.onContentInput(event('', '未保存正文'));
      page.onEditorTab({ currentTarget: { dataset: { tab: 'preview' } } });
      page.onEditorTab({ currentTarget: { dataset: { tab: 'edit' } } });
      expect(page.data).toMatchObject({ content: '未保存正文', contentDirty: true });
      page.onHide(); page.onShow(); await flush();
      expect(page.data.content).toBe('未保存正文');
    },
  );
  it('retries the exact content request after the server saved it but its response was lost', async () => {
    fill();
    page.onContentInput(event('', '第一版正文'));
    const original = page.freeRuntime.saveContent.bind(page.freeRuntime);
    const save = jest.spyOn(page.freeRuntime, 'saveContent').mockImplementationOnce(async (...args: unknown[]) => {
      await original(...args);
      throw { statusCode: 0 };
    });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(page.data).toMatchObject({ contentSaveUnknown: true, contentDirty: true, savingAll: false });
    expect(settings).not.toHaveBeenCalled();
    page.onContentInput(event('', '不能替换未知请求'));
    await saveAll();
    expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
    expect(page.data).toMatchObject({ content: '第一版正文', contentDirty: false, contentSaveUnknown: false, version: 3 });
    expect(settings).toHaveBeenCalledTimes(1);
  });
  it('rejects an oversized body before creating a draft and clears it on identity change', async () => {
    page.onContentInput(event('', '字'.repeat(10001)));
    const create = jest.spyOn(page.runtime, 'create');
    await saveAll();
    expect(create).not.toHaveBeenCalled();
    expect(page.data.message).toMatch(/正文/);
    runtime = { ...runtime, accessToken: 'changed-owner' };
    page.onShow();
    expect(page.data).toMatchObject({ viewState: 'forbidden', content: '', contentDirty: false });
  });

  it('saves both partitions once, reads them back, and can then submit the same complete draft', async () => {
    fill();
    const create = jest.spyOn(page.runtime, 'create');
    const basics = jest.spyOn(page.freeRuntime, 'saveBasics');
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    const pending = saveAll();
    expect(saveAll()).toBe(pending);
    page.onInput(event('title', '保存中不得覆盖'));
    page.onFreeTimeChange(event('startsAt', '12:00', 'time'));
    page.onBack();
    expect((host.wx as any).showModal).not.toHaveBeenCalled();
    await pending;
    const id = page.data.draftId;
    expect(create).toHaveBeenCalledTimes(1);
    expect(basics).not.toHaveBeenCalled();
    expect(settings).toHaveBeenCalledWith(id, 1, {
      startsAt: '2099-10-13T00:30:00.000Z', endsAt: '2099-10-14T01:45:00.000Z',
      capacityMode: 'LIMITED', maxRegistrations: 12,
    });
    expect(page.data).toMatchObject({
      viewState: 'ready', version: 2, dirty: false, freeDirty: false, savingAll: false,
      freeReady: true, needsVersionRefresh: false, form: { title: '合成免费活动' },
      message: '全部草稿已保存',
    });
    await saveAll();
    expect(create).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
    const submit = jest.spyOn(page.freeRuntime, 'submit');
    await page.onSubmit();
    expect(submit).toHaveBeenCalledWith(id, 2, expect.any(String));
    expect(page.data).toMatchObject({ hasPendingReview: true, submitUncertain: false, submitRefreshNeeded: false });
    expect(page.data.history).toHaveLength(1);
  });

  it('rejects a partial time before creating anything and retains all input', async () => {
    fill();
    page.onFreeTimeClear(event('startsAt', ''));
    page.onFreeTimeChange(event('startsAt', '2099-10-13', 'date'));
    const create = jest.spyOn(page.runtime, 'create');
    await saveAll();
    expect(create).not.toHaveBeenCalled();
    expect(page.data.freeMessage).toMatch(/完整.*日期.*时间/);
    expect(page.data.freeTimes.startsAt).toEqual({ date: '2099-10-13', time: '' });
    expect(page.data.savingAll).toBe(false);
  });

  it('accepts free settings while changing a saved draft from another type', async () => {
    page.onInput(event('title', '合成原草稿'));
    page.onTypeChange({ detail: { value: 'REGULAR_GROUP' } });
    await page.onSave();
    fill();
    expect(page.data.freeReady).toBe(false);
    expect(page.data.freeTimes.startsAt).toEqual({ date: '2099-10-13', time: '08:30' });
    await saveAll();
    expect(page.data).toMatchObject({
      version: 3, dirty: false, freeDirty: false, freeReady: true, message: '全部草稿已保存',
    });
    expect(page.data.freeTimes.startsAt).toEqual({ date: '2099-10-13', time: '08:30' });
  });

  it.each(['REGULAR_GROUP', 'MULTI_SPEC_GROUP', 'FLASH_SALE', 'MULTI_SPEC_REGISTRATION_FEE', ''])(
    'reports retained free edits separately after saving the current %s draft', async type => {
      fill();
      await saveAll();
      page.onFreeInput(event('maxRegistrations', '18'));
      page.onFreeTimeChange(event('startsAt', '10:15', 'time'));
      const times = structuredClone(page.data.freeTimes);
      const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
      page.onTypeChange({ detail: { value: type } });
      await saveAll();
      expect(page.data).toMatchObject({
        dirty: false, freeDirty: true, savingAll: false, freeTimes: times,
        form: { campaignType: type }, freeForm: { maxRegistrations: '18' },
        message: '当前草稿已保存，免费报名配置尚未保存',
      });
      expect(page.unsaved()).toBe(true);
      expect(settings).not.toHaveBeenCalled();
      expect((await page.freeRuntime.getConfiguration(page.data.draftId)).freeRegistration).toMatchObject({
        startsAt: '2099-10-13T00:30:00.000Z', maxRegistrations: 12,
      });
      const native = host.wx as any;
      page.onBack();
      expect(native.showModal).toHaveBeenCalledTimes(1);
      native.showModal.mock.calls[0][0].success({ confirm: false, cancel: true });
      expect(native.navigateBack).not.toHaveBeenCalled();
      page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
      expect(page.data.freeTimes).toEqual(times);
      expect(page.data.freeForm.maxRegistrations).toBe('18');
      await saveAll();
      expect(settings).toHaveBeenCalledTimes(1);
      expect((await page.freeRuntime.getConfiguration(page.data.draftId)).freeRegistration).toMatchObject({
        startsAt: '2099-10-13T02:15:00.000Z', maxRegistrations: 18,
      });
      expect(page.data).toMatchObject({ dirty: false, freeDirty: false, message: '全部草稿已保存' });
      expect(page.unsaved()).toBe(false);
    },
  );

  it('retains an incomplete free time when saving a new draft under another type', async () => {
    page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
    page.onFreeTimeChange(event('startsAt', '2099-10-13', 'date'));
    page.onTypeChange({ detail: { value: 'FLASH_SALE' } });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(page.data.draftId).toBeTruthy();
    expect(page.data).toMatchObject({
      dirty: false, freeDirty: true, freeTimes: { startsAt: { date: '2099-10-13', time: '' } },
      message: '当前草稿已保存，免费报名配置尚未保存',
    });
    expect(settings).not.toHaveBeenCalled();
    page.onTypeChange({ detail: { value: 'FREE_REGISTRATION' } });
    await saveAll();
    expect(page.data.freeMessage).toMatch(/完整.*日期.*时间/);
    expect(page.data.freeDirty).toBe(true);
    expect(settings).not.toHaveBeenCalled();
  });

  it('reuses an uncertain creation key without saving a free configuration prematurely', async () => {
    fill();
    const create = jest.spyOn(page.runtime, 'create').mockRejectedValueOnce({ statusCode: 0 });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(page.data).toMatchObject({ createUncertain: true, savingAll: false });
    expect(settings).not.toHaveBeenCalled();
    const original = create.mock.calls[0];
    await saveAll();
    expect(create.mock.calls[1]).toEqual(original);
    expect(settings).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ dirty: false, freeDirty: false, createUncertain: false });
  });

  it('retries only the original free save after its response is lost', async () => {
    fill();
    const create = jest.spyOn(page.runtime, 'create');
    const basics = jest.spyOn(page.freeRuntime, 'saveBasics');
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockRejectedValueOnce({ statusCode: 0 });
    await saveAll();
    expect(page.data).toMatchObject({ dirty: false, freeDirty: true, freeSaveUnknown: true, savingAll: false });
    const original = settings.mock.calls[0];
    page.onFreeTimeChange(event('startsAt', '12:00', 'time'));
    await saveAll();
    expect(settings.mock.calls[1]).toEqual(original);
    expect(create).toHaveBeenCalledTimes(1);
    expect(basics).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ freeDirty: false, freeSaveUnknown: false, message: '全部草稿已保存' });
  });

  it('uses the newly read campus zone and preserves input when that time does not exist there', async () => {
    fill();
    page.onFreeTimeChange(event('startsAt', '2026-03-08', 'date'));
    page.onFreeTimeChange(event('startsAt', '02:30', 'time'));
    const read = page.freeRuntime.getConfiguration.bind(page.freeRuntime);
    jest.spyOn(page.freeRuntime, 'getConfiguration').mockImplementation(async (...args: unknown[]) => ({
      ...await read(args[0]), campusTimezone: 'America/New_York',
    }));
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(page.data.draftId).toBeTruthy();
    expect(settings).not.toHaveBeenCalled();
    expect(page.data.freeMessage).toMatch(/不存在/);
    expect(page.data.freeTimes.startsAt).toEqual({ date: '2026-03-08', time: '02:30' });
    expect(page.data.message).not.toBe('全部草稿已保存');
  });

  it('stops at a conflicting basic save and preserves the other partition for an explicit reread', async () => {
    fill(); await saveAll();
    page.onInput(event('title', '合成修改'));
    page.onFreeInput(event('maxRegistrations', '15'));
    jest.spyOn(page.freeRuntime, 'saveBasics').mockRejectedValueOnce({ statusCode: 409 });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(page.data).toMatchObject({ needsVersionRefresh: true, dirty: true, freeDirty: true, savingAll: false });
    expect(settings).not.toHaveBeenCalled();
    await page.onReload();
    await saveAll();
    expect(page.data).toMatchObject({ version: 4, dirty: false, freeDirty: false, form: { title: '合成修改' } });
    expect(settings).toHaveBeenCalledWith(page.data.draftId, 3, expect.objectContaining({ maxRegistrations: 15 }));
  });

  it('requires a read after a confirmed save cannot be reread and never repeats that write on retry', async () => {
    fill();
    const original = page.freeRuntime.saveConfiguration.bind(page.freeRuntime);
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration').mockImplementation(async (...args: unknown[]) => {
      const result = await original(...args);
      jest.spyOn(page.freeRuntime, 'getConfiguration').mockRejectedValueOnce({ statusCode: 500 });
      return result;
    });
    await saveAll();
    expect(page.data).toMatchObject({ needsVersionRefresh: true, freeDirty: false, savingAll: false });
    expect(page.data.message).not.toBe('全部草稿已保存');
    await saveAll();
    expect(settings).toHaveBeenCalledTimes(1);
    await page.onReload();
    await saveAll();
    expect(settings).toHaveBeenCalledTimes(1);
    expect(page.data.message).toBe('全部草稿已保存');
  });

  it('does not resume later writes after an immediate hide/show during creation', async () => {
    fill();
    const create = page.runtime.create.bind(page.runtime);
    let finish!: () => void;
    jest.spyOn(page.runtime, 'create').mockImplementation(async (...args: unknown[]) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return create(...args);
    });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    const pending = saveAll();
    await flush();
    page.onHide(); page.onShow();
    finish(); await pending; await flush();
    expect(settings).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ savingAll: false, dirty: false, freeDirty: true });
    await saveAll();
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('clears the private form and stops the workflow if the session changes between partitions', async () => {
    fill();
    const create = page.runtime.create.bind(page.runtime);
    jest.spyOn(page.runtime, 'create').mockImplementation(async (...args: unknown[]) => {
      const result = await create(...args);
      runtime = { ...runtime, accessToken: 'synthetic-new-owner' };
      return result;
    });
    const settings = jest.spyOn(page.freeRuntime, 'saveConfiguration');
    await saveAll();
    expect(settings).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ viewState: 'forbidden', draftId: '', savingAll: false, form: { title: '' } });
  });
});
