import type { SessionHttpRequestOptions } from '../services/session.service';

interface Runtime {
  dataDriver: 'api' | 'mock';
  apiBaseUrl: string;
  accessToken: string;
}
interface Editor {
  navigating: boolean;
  data: {
    viewState: string;
    form: { title: string; contactPhone: string };
    draftId: string;
    version: number;
    saving: boolean;
    reading: boolean;
    needsVersionRefresh: boolean;
    publishedPath: string;
    canSharePublished: boolean;
  };
  pendingLoad?: Promise<void>;
  onLoad(options: { id?: string }): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onReload(): Promise<void>;
  onSave(): Promise<void>;
  onBack(): void;
  onInput(event: { currentTarget: { dataset: { field: string } }; detail: { value: string } }): void;
}
const id = '00000000-0000-4000-8000-000000000001';
const receipt = {
  draftId: id, status: 'DRAFT', version: 1,
  createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z',
};
const draft = {
  ...receipt, basicInformation: {
    title: '合成私有草稿', campaignType: null, shareDescription: null, contactPhone: '0000',
  },
};
const configuration = {
  draftId: id, version: 1, campusTimezone: 'Asia/Shanghai',
  freeRegistration: { startsAt: null, endsAt: null, capacityMode: null, maxRegistrations: null },
  campaignId: null, publishedVersionId: null, publishedVersion: null, publishedShareImage: null, campaignVersion: null, lifecycle: null,
};
const changes = ['token', 'address', 'driver'] as const;
type Change = typeof changes[number];

describe('partner campaign editor with actual current-session services', () => {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  let runtime: Runtime;
  let page: Editor;
  let request: jest.Mock<void, [SessionHttpRequestOptions]>;
  let navigateBack: jest.Mock;
  let reLaunch: jest.Mock;
  let showModal: jest.Mock;
  const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
  const replace = (change: Change) => {
    if (change === 'token') runtime = { ...runtime, accessToken: 'synthetic-owner-b' };
    if (change === 'address') runtime = { ...runtime, apiBaseUrl: 'http://other.synthetic.invalid' };
    if (change === 'driver') runtime = { ...runtime, dataDriver: 'mock' };
  };
  const edit = (title: string) => page.onInput({
    currentTarget: { dataset: { field: 'title' } }, detail: { value: title },
  });
  const expectCleared = () => {
    expect(page.navigating).toBe(false);
    expect(page.data).toMatchObject({
      viewState: 'forbidden', draftId: '', version: 0, saving: false, reading: false,
      publishedPath: '', canSharePublished: false,
    });
    expect(page.data.form).toMatchObject({ title: '', contactPhone: '' });
  };
  beforeEach(() => {
    runtime = { dataDriver: 'api', apiBaseUrl: 'http://editor.synthetic.invalid', accessToken: 'synthetic-owner-a' };
    for (const key of ['wx', 'Page', 'getCurrentPages']) previous.set(key, Object.getOwnPropertyDescriptor(host, key));
    request = jest.fn((options: SessionHttpRequestOptions) => options.success({
      statusCode: 200,
      data: {
        data: options.method === 'GET'
          ? options.url.endsWith('/free-registration') ? configuration
            : options.url.endsWith('/images') ? { draftId: id, version: 1, images: { cover: null, share: null } } : draft
          : { ...receipt, version: options.method === 'PUT' ? 2 : 1 },
        requestId: 'synthetic-editor-runtime',
      },
    }));
    navigateBack = jest.fn();
    reLaunch = jest.fn();
    showModal = jest.fn();
    host.wx = {
      getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined,
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 290, height: 32 }),
      request, navigateBack, reLaunch, showModal,
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      showShareMenu: jest.fn(), hideShareMenu: jest.fn(),
    };
    host.getCurrentPages = () => [{}, page];
    host.Page = (definition: Editor) => {
      const instance = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(instance.data, patch),
      };
      page = instance;
    };
    jest.isolateModules(() => require('../pages/partner/campaign-editor/index'));
  });
  afterEach(() => {
    page?.onUnload();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(host, key, descriptor);
      else Reflect.deleteProperty(host, key);
    }
    previous.clear();
  });
  const open = async (draftId?: string) => {
    page.onLoad(draftId ? { id: draftId } : {});
    page.onShow();
    await page.pendingLoad;
  };
  it.each(changes)('does not dispatch an initial queued read after a %s change', async (change) => {
    page.onLoad({ id });
    page.onShow();
    const pending = page.pendingLoad;
    replace(change);
    await pending;
    expect(request).not.toHaveBeenCalled();
    expectCleared();
  });
  it.each(changes)('clears loaded private fields before dispatching a queued reread after a %s change', async (change) => {
    await open(id);
    expect(page.data.form.contactPhone).toBe('0000');
    request.mockClear();
    const pending = page.onReload();
    replace(change);
    await pending;
    expect(request).not.toHaveBeenCalled();
    expectCleared();
  });
  it.each(['create', 'save'])('cancels an unsent basic %s across an immediate hide/show cycle', async (operation) => {
    await open(operation === 'save' ? id : undefined);
    edit('离页前的输入');
    request.mockClear();
    const pending = page.onSave();
    page.onHide();
    page.onShow();
    await pending;
    await flush();
    const reads = operation === 'save' ? 3 : 0;
    expect(request).toHaveBeenCalledTimes(reads);
    expect(request.mock.calls.every(([options]) => options.method === 'GET')).toBe(true);
    expect(page.data).toMatchObject({ viewState: 'ready', saving: false });
    expect(page.data.form.title).toBe('离页前的输入');
    edit('返回后的输入');
    await page.onSave();
    expect(request).toHaveBeenCalledTimes(reads + 1);
    expect(request.mock.calls[request.mock.calls.length - 1][0]).toMatchObject({
      method: operation === 'save' ? 'PUT' : 'POST',
      data: operation === 'save'
        ? { expectedVersion: 1, basicInformation: expect.objectContaining({ title: '返回后的输入' }) }
        : expect.objectContaining({ title: '返回后的输入' }),
      header: { Authorization: 'Bearer synthetic-owner-a' },
    });
  });
  it.each(changes)('blocks a queued basic save after a %s change', async (change) => {
    await open(id);
    edit('旧身份的修改');
    request.mockClear();
    const pending = page.onSave();
    replace(change);
    await pending;
    expect(request).not.toHaveBeenCalled();
    expectCleared();
  });
  it.each(['callback', 'throw'])('locks a cancelled loaded reread after both native return paths fail by %s', async (failure) => {
    await open(id);
    request.mockClear();
    request.mockImplementationOnce(() => {});
    const reading = page.onReload(); await flush();
    const old = request.mock.calls[0][0];
    if (failure === 'throw') {
      navigateBack.mockImplementationOnce(() => { throw new Error('synthetic return failure'); });
      reLaunch.mockImplementationOnce(() => { throw new Error('synthetic fallback failure'); });
    }
    page.onBack();
    if (failure === 'callback') {
      navigateBack.mock.calls[0][0].fail({});
      reLaunch.mock.calls[0][0].fail({});
    }
    expect(page.data).toMatchObject({ viewState: 'ready', reading: false, needsVersionRefresh: true });
    await page.onSave();
    expect(request).toHaveBeenCalledTimes(1);
    edit('返回失败保留输入');
    request.mockImplementation((options) => options.success({
      statusCode: 200, data: {
        data: options.url.endsWith('/free-registration')
          ? { ...configuration, version: 3 }
          : options.url.endsWith('/images') ? { draftId: id, version: 3, images: { cover: null, share: null } }
          : { ...draft, version: 3, basicInformation: { ...draft.basicInformation, title: '服务端最新草稿' } },
        requestId: 'synthetic-current-reread',
      },
    }));
    await page.onReload();
    expect(page.data).toMatchObject({
      version: 3, needsVersionRefresh: false, form: { title: '返回失败保留输入' },
    });
    old.success({ statusCode: 200, data: { data: { ...draft, version: 9 }, requestId: 'synthetic-old-reread' } });
    await reading; await flush();
    expect(page.data).toMatchObject({
      version: 3, needsVersionRefresh: false, form: { title: '返回失败保留输入' },
    });
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.every(([options]) => options.method === 'GET')).toBe(true);
  });
  it.each(['back', 'fallback'])('ignores a duplicate %s failure after fresh reading has recovered the editor', async (source) => {
    await open(id);
    request.mockImplementationOnce(() => {});
    const reading = page.onReload(); await flush();
    const old = request.mock.calls[request.mock.calls.length - 1][0];
    page.onBack();
    const back = navigateBack.mock.calls[0][0];
    back.fail({});
    const fallback = reLaunch.mock.calls[0][0];
    fallback.fail({});
    old.success({ statusCode: 200, data: { data: draft, requestId: 'synthetic-cancelled-read' } });
    await reading;
    await page.onReload();
    expect(page.data).toMatchObject({ needsVersionRefresh: false, reading: false });
    const before = structuredClone(page.data);
    (source === 'back' ? back : fallback).fail({});
    expect(reLaunch).toHaveBeenCalledTimes(1);
    expect(page.data).toEqual(before);
    expect(page.navigating).toBe(false);
  });
  it.each(changes)('rejects a late return failure after a %s change', async (change) => {
    await open(id);
    page.onBack();
    expect(navigateBack).toHaveBeenCalledTimes(1);
    replace(change);
    navigateBack.mock.calls[0][0].fail({});
    expect(reLaunch).not.toHaveBeenCalled();
    expectCleared();
  });
  it.each(['cancel', 'fail'])('clears private edits when an old return dialog reports %s after an identity change', async (callback) => {
    await open(id);
    edit('旧身份未保存输入');
    page.onBack();
    runtime = { ...runtime, accessToken: 'synthetic-owner-b' };
    const dialog = showModal.mock.calls[0][0];
    if (callback === 'cancel') dialog.success({ confirm: false });
    else dialog.fail({});
    expect(navigateBack).not.toHaveBeenCalled();
    expectCleared();
  });
  it('checks identity before opening a return dialog for private edits', async () => {
    await open(id);
    edit('旧身份未保存输入');
    runtime = { ...runtime, accessToken: 'synthetic-owner-b' };
    page.onBack();
    expect(showModal).not.toHaveBeenCalled();
    expectCleared();
  });
});
