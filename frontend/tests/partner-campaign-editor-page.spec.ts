export {};
import * as fs from 'fs';
import * as path from 'path';
const get = jest.fn();
const create = jest.fn();
const save = jest.fn();
let owner = 'synthetic-owner';
const logout = jest.fn();
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  ...jest.requireActual('../pages/partner/runtime/partner-campaign-draft.service'),
  getPartnerCampaignDraftService: () => ({ get, create, save, getSessionKey: () => owner, setMockFreeSummary: jest.fn() }),
}));
jest.mock('../services/session.service', () => ({
  ...jest.requireActual('../services/session.service'), sessionService: { logout: () => logout() },
}));
const id = '00000000-0000-4000-8000-000000000001';
const receipt = { draftId: id, status: 'DRAFT', version: 1, createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' };
const draft = { ...receipt, basicInformation: { title: '已存草稿', campaignType: null, shareDescription: null, contactPhone: null } };
const deferred = () => {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
describe('partner campaign basic editor actual Page', () => {
  let page: any;
  const flush = async () => { for (let i = 0; i < 25; i += 1) await Promise.resolve(); };
  const input = (field: string, value: string) => page.onInput({ currentTarget: { dataset: { field } }, detail: { value } });
  beforeEach(() => {
    owner = 'synthetic-owner';
    get.mockReset().mockResolvedValue(draft);
    create.mockReset().mockResolvedValue(receipt);
    save.mockReset().mockResolvedValue({ ...receipt, version: 2 });
    logout.mockReset();
    (global as any).wx = {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 290, height: 32 }),
      showModal: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    (global as any).getCurrentPages = () => [page, page];
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
      page.setData = jest.fn((values: object) => Object.assign(page.data, values));
    };
    jest.isolateModules(() => require('../pages/partner/campaign-editor/index'));
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).Page;
    delete (global as any).wx;
    delete (global as any).getCurrentPages;
  });
  const open = async (draftId?: string) => {
    page.onLoad(draftId ? { id: draftId } : {});
    // All three partitions use the same synthetic draft version.
    jest.spyOn(page.freeRuntime, 'getImages').mockImplementation(async () => {
      const loaded = await get.mock.results[get.mock.results.length - 1]?.value;
      return { draftId: loaded.draftId, version: loaded.version, images: { cover: null, share: null } };
    });
    jest.spyOn(page.freeRuntime, 'getConfiguration').mockImplementation(async () => {
      const loaded = await get.mock.results[get.mock.results.length - 1]?.value;
      return { draftId: loaded.draftId, version: loaded.version, campusTimezone: 'Asia/Shanghai',
        freeRegistration: { startsAt: null, endsAt: null, capacityMode: null, maxRegistrations: null },
        campaignId: null, publishedVersionId: null, publishedVersion: null, publishedShareImage: null, campaignVersion: null, lifecycle: null };
    });
    page.onShow();
    await flush();
  };
  it('opens a new unsaved form without making a server draft', async () => {
    await open();
    expect(page.data).toMatchObject({ viewState: 'ready', draftId: '', version: 0, dirty: false });
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it.each([
    'REGULAR_GROUP', 'MULTI_SPEC_GROUP', 'FLASH_SALE', 'MULTI_SPEC_REGISTRATION_FEE', 'FREE_REGISTRATION',
  ])('opens and saves the selected %s in the unified editor', async (type) => {
    page.onLoad({ type });
    page.onShow();
    expect(page.data).toMatchObject({
      viewState: 'ready', draftId: '', dirty: true, form: { campaignType: type },
    });
    expect(create).not.toHaveBeenCalled();
    input('title', '统一活动草稿');
    await page.onSave();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      title: '统一活动草稿', campaignType: type,
    }), expect.any(String));
  });
  it.each(['UNKNOWN', '__proto__', 'free_registration', ''])('ignores unsupported entry type %s', (type) => {
    page.onLoad({ type });
    page.onShow();
    expect(page.data.form.campaignType).toBe('');
    expect(page.data.dirty).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
  it('uses saved data when an existing draft URL also contains a different type', async () => {
    page.onLoad({ id, type: 'FLASH_SALE' });
    jest.spyOn(page.freeRuntime, 'getImages').mockResolvedValue({
      draftId: id, version: 1, images: { cover: null, share: null },
    });
    jest.spyOn(page.freeRuntime, 'getConfiguration').mockResolvedValue({
      draftId: id, version: 1, campusTimezone: 'Asia/Shanghai',
      freeRegistration: { startsAt: null, endsAt: null, capacityMode: null, maxRegistrations: null },
      campaignId: null, publishedVersionId: null, publishedVersion: null, publishedShareImage: null, campaignVersion: null, lifecycle: null,
    });
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({ form: { campaignType: '' }, dirty: false, version: 1 });
  });
  const editorTab = (tab: string) => page.onEditorTab({ currentTarget: { dataset: { tab } } });
  it.each([
    'REGULAR_GROUP', 'MULTI_SPEC_GROUP', 'FLASH_SALE', 'MULTI_SPEC_REGISTRATION_FEE', 'FREE_REGISTRATION',
  ])('previews unsaved %s and returns to the same input without any write', async (type) => {
    page.onLoad({ type });
    page.onShow();
    input('title', '合成预览活动');
    input('shareDescription', '第一行\n第二行 <不作为HTML>');
    input('contactPhone', '0000');
    const form = structuredClone(page.data.form);
    expect(page.data.editorTab).toBe('edit');
    editorTab('preview');
    expect(page.data.editorTab).toBe('preview');
    expect(page.data.form).toEqual(form);
    expect(page.data.dirty).toBe(true);
    editorTab('edit');
    expect(page.data.editorTab).toBe('edit');
    expect(page.data.form).toEqual(form);
    expect(create).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
  it('preserves partial free time and capacity across preview without filling defaults', async () => {
    page.onLoad({ type: 'FREE_REGISTRATION' });
    page.onShow();
    page.onFreeTimeChange({
      currentTarget: { dataset: { field: 'startsAt', part: 'date' } }, detail: { value: '2099-10-17' },
    });
    page.onCapacityChange({ detail: { value: 'LIMITED' } });
    page.onFreeInput({ currentTarget: { dataset: { field: 'maxRegistrations' } }, detail: { value: '12' } });
    editorTab('preview');
    editorTab('edit');
    expect(page.data.freeTimes.startsAt).toEqual({ date: '2099-10-17', time: '' });
    expect(page.data.freeTimes.endsAt).toEqual({ date: '', time: '' });
    expect(page.data.freeForm).toMatchObject({ capacityMode: 'LIMITED', maxRegistrations: '12' });
    expect(page.data.freeDirty).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
  it.each(['saving', 'savingAll', 'freeSaving', 'submitting', 'reading'])('does not switch views during %s', async (flag) => {
    await open();
    page.setData({ [flag]: true });
    editorTab('preview');
    expect(page.data.editorTab).toBe('edit');
  });
  it('discards the preview when identity changes and ignores hidden or invalid switches', async () => {
    await open();
    input('title', '私有草稿');
    editorTab('unknown');
    expect(page.data.editorTab).toBe('edit');
    editorTab('preview');
    page.onHide();
    editorTab('edit');
    expect(page.data.editorTab).toBe('preview');
    owner = 'new-owner';
    page.onShow();
    expect(page.data).toMatchObject({ viewState: 'forbidden', editorTab: 'edit', form: { title: '' } });
    editorTab('preview');
    expect(page.data.editorTab).toBe('edit');
  });
  it('restores an existing draft on load/show once', async () => {
    await open(id);
    expect(get).toHaveBeenCalledTimes(1);
    expect(page.data.form.title).toBe('已存草稿');
    expect(page.data.version).toBe(1);
  });
  it('saves partial basics once and continues editing the same draft', async () => {
    await open();
    input('title', ' 新草稿 ');
    page.onSave();
    page.onSave();
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ draftId: id, version: 1, dirty: false, saving: false });
    input('title', '修改');
    await page.onSave();
    expect(save).toHaveBeenCalledWith(id, 1, expect.objectContaining({ title: '修改' }));
    expect(page.data.version).toBe(2);
  });
  it('retries an unknown creation result using the same key and exact normalized fields', async () => {
    await open();
    input('contactPhone', ' 0000 ');
    create.mockRejectedValueOnce({ statusCode: 0 });
    await page.onSave();
    expect(page.data.createUncertain).toBe(true);
    const previous = create.mock.calls[0];
    input('title', '不应加入');
    await page.onSave();
    expect(create.mock.calls[1]).toEqual(previous);
    expect(page.data.createUncertain).toBe(false);
  });
  it('preserves local values over a hide/show while refreshing the server baseline', async () => {
    await open(id);
    input('title', '未保存');
    page.onHide();
    page.onShow();
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(page.data.form.title).toBe('未保存');
  });
  it('keeps edits on conflict and explicitly refreshes only the server baseline/version', async () => {
    await open(id);
    input('title', '我的修改');
    save.mockRejectedValueOnce({ statusCode: 409 });
    await page.onSave();
    expect(page.data.needsVersionRefresh).toBe(true);
    get.mockResolvedValueOnce({ ...draft, version: 3, basicInformation: { ...draft.basicInformation, title: '他人修改' } });
    await page.onReload();
    expect(page.data).toMatchObject({ version: 3, needsVersionRefresh: false, dirty: true });
    expect(page.data.form.title).toBe('我的修改');
    expect(save).toHaveBeenCalledTimes(1);
  });
  it.each(['onHide', 'onUnload'])('ignores a late read after %s', async (method) => {
    const pending = deferred();
    get.mockReturnValueOnce(pending.promise);
    await open(id);
    page[method]();
    const writes = page.setData.mock.calls.length;
    pending.resolve(draft);
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
  });
  it('resumes a save completed while hidden without submitting a second write', async () => {
    await open();
    input('title', '保存');
    const pending = deferred();
    create.mockReturnValueOnce(pending.promise);
    page.onSave();
    await flush();
    page.onHide();
    const writes = page.setData.mock.calls.length;
    pending.resolve(receipt);
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({ draftId: id, version: 1, saving: false, dirty: false });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('clears all private fields and pending creation when the owner changes', async () => {
    await open(id);
    input('contactPhone', '0000');
    page.onHide();
    owner = 'other-owner';
    page.onShow();
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', draftId: '', version: 0, dirty: false });
    expect(page.data.form.contactPhone).toBe('');
  });
  it.each([401, 403, 404])('clears private content after HTTP %s', async (statusCode) => {
    await open(id);
    input('title', '修改');
    save.mockRejectedValueOnce({ statusCode });
    await page.onSave();
    expect(page.data.form.title).toBe('');
    expect(page.data.draftId).toBe('');
  });
  it('validates Unicode length without writing and keeps the invalid form editable', async () => {
    await open();
    input('title', '😀'.repeat(41));
    await page.onSave();
    expect(create).not.toHaveBeenCalled();
    expect(page.data.form.title).toBe('😀'.repeat(41));
    expect(page.data.message).toMatch(/格式|长度/);
  });
  it('asks before discarding edits and gives direct-entry back a role-home fallback', async () => {
    await open();
    input('title', '未保存');
    page.onBack();
    const modal = (global as any).wx.showModal.mock.calls[0][0];
    expect((global as any).wx.navigateBack).not.toHaveBeenCalled();
    modal.success({ confirm: true });
    expect((global as any).wx.navigateBack).toHaveBeenCalled();
    (global as any).wx.navigateBack.mock.calls[0][0].fail({});
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/partner/group-campaigns/index' }));
  });
  it('shows a recoverable read failure, suppresses raw diagnostics and supports retry', async () => {
    get.mockRejectedValueOnce(new Error('raw SQL'));
    await open(id);
    expect(page.data).toMatchObject({ viewState: 'error' });
    expect(page.data.message).not.toContain('raw SQL');
    await page.onRetry();
    expect(page.data.viewState).toBe('ready');
  });
  it('keeps a loaded basic draft read-only after refresh failure until the explicit reread succeeds', async () => {
    await open(id);
    get.mockRejectedValueOnce({ statusCode: 500 });
    page.onHide(); page.onShow(); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', reading: false, needsVersionRefresh: true });
    expect(page.data.form.title).toBe('已存草稿');
    await page.onSave();
    expect(save).not.toHaveBeenCalled();
    input('title', '失败后继续编辑');
    const reads = get.mock.calls.length;
    page.onHide(); page.onShow(); await flush();
    expect(get).toHaveBeenCalledTimes(reads);
    get.mockResolvedValue({ ...draft, version: 3, basicInformation: { ...draft.basicInformation, title: '服务端名称' } });
    await page.onRetry();
    expect(page.data).toMatchObject({ version: 3, needsVersionRefresh: false, dirty: true });
    expect(page.data.form.title).toBe('失败后继续编辑');
    save.mockResolvedValueOnce({ ...receipt, version: 4 });
    await page.onSave();
    expect(save).toHaveBeenCalledWith(id, 3, expect.objectContaining({ title: '失败后继续编辑' }));
  });
  it('uses new input after a queued creation was skipped by immediately hiding', async () => {
    await open();
    input('title', '旧输入');
    page.onSave();
    page.onHide();
    await flush();
    expect(create).not.toHaveBeenCalled();
    page.onShow();
    input('title', '新输入');
    await page.onSave();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: '新输入' }), expect.any(String));
    expect(page.data.form.title).toBe('新输入');
  });
  it('releases a read invalidated by two navigation failures and retries with a fresh GET', async () => {
    const pending = deferred();
    get.mockReturnValueOnce(pending.promise);
    await open(id);
    page.onBack();
    (global as any).wx.navigateBack.mock.calls[0][0].fail({});
    (global as any).wx.reLaunch.mock.calls[0][0].fail({});
    pending.resolve(draft);
    await flush();
    await page.onRetry();
    expect(get).toHaveBeenCalledTimes(2);
    expect(page.data).toMatchObject({ viewState: 'ready', reading: false });
  });
  it('does not navigate on a stale confirmation after the credential changes', async () => {
    await open();
    input('contactPhone', '0000');
    page.onBack();
    owner = 'other-owner';
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    expect((global as any).wx.navigateBack).not.toHaveBeenCalled();
    expect(page.data.form.contactPhone).toBe('');
  });
  it('uses existing back tokens and native controls in the source field order', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../pages/partner/campaign-editor/index.wxss'), 'utf8');
    const tokens = fs.readFileSync(path.resolve(__dirname, '../styles/tokens.wxss'), 'utf8');
    for (const match of css.matchAll(/var\((--role-back-[^)]+)\)/g)) expect(tokens).toContain(`${match[1]}:`);
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/campaign-editor/index.wxml'), 'utf8');
    expect(markup.indexOf('id="campaign-title"')).toBeLessThan(markup.indexOf('id="campaign-description"'));
    expect(markup.indexOf('id="campaign-description"')).toBeLessThan(markup.indexOf('id="campaign-type"'));
    expect(markup).toContain('maxlength="-1"');
    expect(markup).toContain('auto-height="{{true}}"');
    expect(markup).not.toMatch(/bindtap="(?:onPublish|onApprove)"|shareAppMessage/);
    expect(markup).toContain('wx:if="{{form.campaignType === \'FREE_REGISTRATION\'}}"');
  });
  it('retains the original uncertain creation key if a queued retry is hidden before dispatch', async () => {
    await open();
    input('title', '未知结果');
    create.mockRejectedValueOnce({ statusCode: 0 });
    await page.onSave();
    const previous = create.mock.calls[0];
    page.onSave();
    page.onHide();
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    page.onShow();
    await page.onSave();
    expect(create.mock.calls[1]).toEqual(previous);
  });
  it.each(['cancel', 'fail'])('consumes the old %s confirmation before opening another dialog', async (action) => {
    await open();
    input('title', '未保存');
    page.onBack();
    const previous = (global as any).wx.showModal.mock.calls[0][0];
    if (action === 'cancel') previous.success({ confirm: false }); else previous.fail({});
    page.onBack();
    const current = (global as any).wx.showModal.mock.calls[1][0];
    previous.success({ confirm: true });
    previous.fail({});
    expect((global as any).wx.navigateBack).not.toHaveBeenCalled();
    expect(page.dialogPending).toBe(true);
    current.success({ confirm: false });
    expect(page.dialogPending).toBe(false);
  });
});
