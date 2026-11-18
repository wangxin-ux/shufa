export {};
import * as fs from 'node:fs';
import * as path from 'node:path';
const runtime = jest.fn();
jest.mock('../pages/super-admin/runtime/free-campaign-review-runtime', () => ({
  getFreeCampaignReviewRuntime: () => runtime(),
  logoutFreeCampaignReviewer: jest.fn(),
}), { virtual: true });
const vid = '10000000-0000-4000-8000-000000000001';
const cid = '20000000-0000-4000-8000-000000000001';
const at = '2026-10-13T00:00:00.000Z';
const summary = () => ({
  versionId: vid, campaignId: cid, draftId: '30000000-0000-4000-8000-000000000001',
  campusId: '40000000-0000-4000-8000-000000000001', title: '合成免费活动',
  status: 'SUBMITTED', version: 1, sequence: 1, submittedAt: at, reviewedAt: null, reviewReason: null,
});
const detail = () => ({
  ...summary(), configuration: {
    title: '合成免费活动', campaignType: 'FREE_REGISTRATION', shareDescription: '完整冻结说明',
    contactPhone: '合成机构电话', startsAt: at, endsAt: '2099-10-13T00:00:00.000Z', timezone: 'Asia/Shanghai',
    capacityMode: 'LIMITED', maxRegistrations: 2147483647, feeFen: 0, benefitMode: 'NONE',
    registrationLimit: 'ONCE_PER_STUDENT',
  }, sourceDraftVersion: 4, campaignVersion: 3, lifecycle: 'OPEN', publishedVersionId: null,
});
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve!: (value: any) => void; let reject!: (value: any) => void;
  const promise = new Promise<any>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const event = (value: string) => ({ detail: { value } });
const read = (name: string) => {
  const file = path.resolve(__dirname, '..', name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

describe('super admin free campaign actual Page lifecycle', () => {
  let page: any; let service: any; let owner: string; let currentDetail: any;
  beforeEach(() => {
    owner = 'synthetic-owner-a'; currentDetail = detail();
    service = {
      isMock: false, getSessionKey: () => owner, invalidateReads: jest.fn(),
      list: jest.fn().mockResolvedValue({ data: [summary()], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }),
      detail: jest.fn(() => Promise.resolve(currentDetail)),
      approve: jest.fn().mockImplementation(async () => {
        currentDetail = { ...detail(), status: 'APPROVED', version: 2, reviewedAt: at, publishedVersionId: vid, campaignVersion: 4 };
        return { ...summary(), status: 'APPROVED', version: 2, reviewedAt: at };
      }),
      reject: jest.fn().mockRejectedValue({ statusCode: 503 }),
      close: jest.fn().mockImplementation(async () => {
        currentDetail = { ...currentDetail, lifecycle: 'CLOSED', campaignVersion: 4 };
        return { campaignId: cid, lifecycle: 'CLOSED', version: 4 };
      }),
    };
    runtime.mockReset().mockReturnValue(service);
    (global as any).wx = { showModal: jest.fn(), navigateTo: jest.fn(), showToast: jest.fn(),
      stopPullDownRefresh: jest.fn(), reLaunch: jest.fn() };
    (global as any).getCurrentPages = () => [{}, {}];
    page = { data: {} };
    (global as any).Page = (config: any) => {
      page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
  });
  afterEach(() => {
    page.onUnload?.();
    delete (global as any).wx; delete (global as any).Page; delete (global as any).getCurrentPages;
  });
  const open = async (name = 'campaign-review-detail') => {
    jest.isolateModules(() => {
      const file = `../pages/super-admin/${name}/index`;
      if (fs.existsSync(path.resolve(__dirname, `${file}.ts`))) require(file);
    });
    expect(typeof page.onLoad).toBe('function');
    page.onLoad({ id: vid }); page.onShow(); await flush();
  };
  const confirm = async () => {
    const options = (global as any).wx.showModal.mock.calls.at(-1)[0];
    options.success({ confirm: true }); await flush(); return options;
  };
  it.each(['campaign-reviews', 'campaign-review-detail'])('preserves measured navigation space on %s after access is cleared', async (name) => {
    Object.assign((global as any).wx, {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 47 }),
      getMenuButtonBoundingClientRect: () => ({ top: 55, height: 32 }),
    });
    await open(name);
    expect(page.data.headerTopPx).toBe(55);
    page.clear('合成失权');
    expect(page.data.headerTopPx).toBe(55);
  });
  it('loads once across first load/show and displays every frozen field', async () => {
    await open(); expect(service.detail).toHaveBeenCalledTimes(1);
    expect(page.data.detail).toEqual(detail());
    expect(page.data.canApprove).toBe(true);
    expect(page.data.capacityLabel).toContain('2147483647');
    expect(page.data.startsLabel).toContain('2026');
  });
  it('uses the candidate version for approval and reads current state after the receipt', async () => {
    await open(); page.onApprove(); await confirm();
    expect(service.approve).toHaveBeenCalledWith(vid, 1, expect.any(String));
    expect(service.detail).toHaveBeenCalledTimes(2);
    expect(page.data.detail.status).toBe('APPROVED');
    expect(page.data.canApprove).toBe(false); expect(page.data.submitting).toBe(false);
  });
  it('closes with lifecycle version rather than candidate review version', async () => {
    await open(); page.onReasonInput(event('  活动下架  ')); page.onCloseCampaign(); await confirm();
    expect(service.close).toHaveBeenCalledWith(cid, 3, '活动下架', expect.any(String));
    expect(page.data.detail.lifecycle).toBe('CLOSED'); expect(page.data.canClose).toBe(false);
  });
  it('blocks opposing actions and preserves original rejection reason/key after an unknown result', async () => {
    await open(); page.onReasonInput(event('原原因')); page.onReject(); await confirm();
    const args = service.reject.mock.calls[0]; expect(page.data.uncertain).toBe(true);
    page.onReasonInput(event('新原因')); page.onApprove(); page.onCloseCampaign(); await flush();
    expect(service.approve).not.toHaveBeenCalled(); expect(service.close).not.toHaveBeenCalled();
    service.reject.mockResolvedValueOnce({ ...summary(), status: 'REJECTED', version: 2, reviewedAt: at, reviewReason: '原原因' });
    page.onReject(); await confirm(); expect(service.reject.mock.calls[1]).toEqual(args);
  });
  it('keeps a sent unknown attempt when its queued retry is hidden before dispatch', async () => {
    await open(); page.onReasonInput(event('原原因')); page.onReject(); await confirm();
    const args = service.reject.mock.calls[0];
    page.onReject();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true });
    page.onHide(); await flush(); expect(service.reject).toHaveBeenCalledTimes(1);
    page.onShow(); await flush(); page.onReject(); await confirm();
    expect(service.reject.mock.calls[1]).toEqual(args);
  });
  it('prevents duplicate confirmations and concurrent approval/rejection', async () => {
    await open(); const pending = deferred(); service.approve.mockReturnValueOnce(pending.promise);
    page.onApprove(); const options = (global as any).wx.showModal.mock.calls.at(-1)[0];
    page.onReject(); options.success({ confirm: true }); options.success({ confirm: true }); options.fail({});
    await flush(); page.onApprove(); expect(service.approve).toHaveBeenCalledTimes(1);
    pending.resolve({ ...summary(), status: 'APPROVED', version: 2, reviewedAt: at }); await flush();
    expect(page.data.submitting).toBe(false);
  });
  it.each(['cancel', 'fail'])('consumes an old %s callback before opening the next modal', async (action) => {
    await open(); page.onApprove(); const previous = (global as any).wx.showModal.mock.calls.at(-1)[0];
    if (action === 'cancel') previous.success({ confirm: false }); else previous.fail({});
    page.onApprove(); const current = (global as any).wx.showModal.mock.calls.at(-1)[0];
    previous.success({ confirm: true }); previous.fail({}); await flush();
    expect(service.approve).not.toHaveBeenCalled();
    current.success({ confirm: true }); await flush(); expect(service.approve).toHaveBeenCalledTimes(1);
  });
  it('handles synchronous modal failure and permits retry without a stuck lock', async () => {
    await open(); (global as any).wx.showModal.mockImplementationOnce(() => { throw new Error('native'); });
    page.onApprove(); page.onApprove(); await confirm();
    expect(service.approve).toHaveBeenCalledTimes(1);
  });
  it.each(['onHide', 'onUnload'])('never dispatches a late confirmation after %s', async (method) => {
    await open(); page.onApprove(); const options = (global as any).wx.showModal.mock.calls.at(-1)[0];
    page[method](); options.success({ confirm: true }); await flush();
    expect(service.approve).not.toHaveBeenCalled(); expect(page.data.detail).toBeNull();
  });
  it('rejects owner replacement before confirmation and clears cached fields', async () => {
    await open(); page.onReasonInput(event('旧原因')); page.onApprove();
    owner = 'synthetic-owner-b'; await confirm();
    expect(service.approve).not.toHaveBeenCalled(); expect(page.data.detail).toBeNull();
    expect(page.data.reason).toBe('');
  });
  it('ignores a hidden success and retains the original attempt for explicit resolution', async () => {
    await open(); const pending = deferred(); service.approve.mockReturnValueOnce(pending.promise);
    page.onApprove(); const options = (global as any).wx.showModal.mock.calls.at(-1)[0];
    options.success({ confirm: true }); await flush(); const args = service.approve.mock.calls[0];
    page.onHide(); pending.resolve({ ...summary(), status: 'APPROVED', version: 2, reviewedAt: at }); await flush();
    expect(service.detail).toHaveBeenCalledTimes(1); expect(page.data.detail).toBeNull();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
    page.onShow(); await flush(); page.onApprove(); await confirm();
    expect(service.approve.mock.calls[1]).toEqual(args);
  });
  it('clears an old-owner pending mutation without letting its late finally release the new lock', async () => {
    await open(); const old = deferred(); const fresh = deferred(); service.approve.mockReturnValueOnce(old.promise);
    page.onApprove(); await confirm(); page.onHide(); owner = 'synthetic-owner-b';
    page.onShow(); await flush(); service.approve.mockReturnValueOnce(fresh.promise);
    page.onApprove(); await confirm(); expect(page.data.submitting).toBe(true);
    old.reject({ statusCode: 401 }); await flush();
    expect(page.data.submitting).toBe(true); expect(page.data.viewState).toBe('ready');
    fresh.reject({ statusCode: 503 }); await flush(); expect(page.data.submitting).toBe(false);
  });
  it.each([401, 403])('clears private detail and reason after read status %s', async (statusCode) => {
    await open(); page.onReasonInput(event('私有原因')); service.detail.mockRejectedValueOnce({ statusCode });
    await page.onReload(); expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe('');
    expect(page.data.viewState).toBe('forbidden');
  });
  it.each([401, 403])('clears private mutation state on status %s', async (statusCode) => {
    await open(); service.approve.mockRejectedValueOnce({ statusCode });
    page.onApprove(); await confirm();
    expect(page.data.detail).toBeNull(); expect(page.data.uncertain).toBe(false);
    expect(page.data.viewState).toBe('forbidden');
  });
  it('keeps the rejection reason on 409 and requires explicit version reread', async () => {
    await open(); service.reject.mockRejectedValueOnce({ statusCode: 409 });
    page.onReasonInput(event('请补全说明')); page.onReject(); await confirm();
    expect(page.data.reason).toBe('请补全说明'); expect(service.detail).toHaveBeenCalledTimes(1);
    page.onApprove(); await flush(); expect(service.approve).not.toHaveBeenCalled();
    currentDetail = { ...detail(), version: 2 };
    await page.onReload(); expect(page.data.reason).toBe('请补全说明');
    page.onReject(); await confirm(); expect(service.reject.mock.calls[1][1]).toBe(2);
  });
  it.each(['approve', 'reject', 'close'])('keeps the %s 409 lock and reason across implicit hide/show rereads', async (action) => {
    await open(); service[action].mockRejectedValueOnce({ statusCode: 409 });
    page.onReasonInput(event('保留冲突原因'));
    const handler = action === 'approve' ? 'onApprove' : action === 'reject' ? 'onReject' : 'onCloseCampaign';
    page[handler](); await confirm(); expect(page.data.needsRefresh).toBe(true);
    currentDetail = { ...detail(), version: 2, campaignVersion: 4 };
    page.onHide(); expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe('');
    page.onShow(); await flush();
    expect(page.data.detail.version).toBe(2);
    expect(page.data.needsRefresh).toBe(true); expect(page.data.reason).toBe('保留冲突原因');
    expect(page.data.message).toContain('重读');
    expect([page.data.canApprove, page.data.canReject, page.data.canClose]).toEqual([false, false, false]);
    const modalCount = (global as any).wx.showModal.mock.calls.length;
    page.onApprove(); page.onReject(); page.onCloseCampaign(); await flush();
    expect((global as any).wx.showModal).toHaveBeenCalledTimes(modalCount);
    const pending = deferred(); service.detail.mockReturnValueOnce(pending.promise);
    const reload = page.onReload(); await flush();
    expect(page.data.needsRefresh).toBe(true); expect(page.data.canApprove).toBe(false);
    pending.resolve(currentDetail); await reload;
    expect(page.data.needsRefresh).toBe(false); expect(page.data.reason).toBe('保留冲突原因');
    expect(page.data.message).toBe('');
    expect([page.data.canApprove, page.data.canReject, page.data.canClose]).toEqual([true, true, true]);
  });
  it('retains the 409 lock after failed explicit reread and another show until successful pull refresh', async () => {
    await open(); service.reject.mockRejectedValueOnce({ statusCode: 409 });
    page.onReasonInput(event('保留原因')); page.onReject(); await confirm();
    service.detail.mockRejectedValueOnce({ statusCode: 503 });
    await page.onReload(); expect(page.data.needsRefresh).toBe(true); expect(page.data.reason).toBe('保留原因');
    page.onHide(); page.onShow(); await flush();
    expect(page.data.needsRefresh).toBe(true); expect(page.data.canReject).toBe(false);
    page.onPullDownRefresh(); await flush();
    expect(page.data.needsRefresh).toBe(false); expect(page.data.canReject).toBe(true);
    expect(page.data.reason).toBe('保留原因');
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });
  it('clears the previous owner conflict and private reason before reading the new owner', async () => {
    await open(); service.reject.mockRejectedValueOnce({ statusCode: 409 });
    page.onReasonInput(event('旧身份原因')); page.onReject(); await confirm();
    page.onHide(); owner = 'synthetic-owner-b';
    const pending = deferred(); service.detail.mockReturnValueOnce(pending.promise);
    page.onShow();
    expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe('');
    expect(page.reasonDraft).toBe(''); expect(page.data.needsRefresh).toBe(false);
    await flush(); pending.resolve(detail()); await flush();
    expect(page.data.canApprove).toBe(true); expect(page.data.reason).toBe('');
  });
  it('treats synchronous service throws as unknown without trapping submitting', async () => {
    await open(); service.approve.mockImplementationOnce(() => { throw new Error('sync'); });
    page.onApprove(); await confirm();
    expect(page.data.submitting).toBe(false); expect(page.data.uncertain).toBe(true);
  });
  it('preserves uncertainty across explicit reread instead of enabling an opposing action', async () => {
    await open(); service.approve.mockRejectedValueOnce({ statusCode: 0 }); page.onApprove(); await confirm();
    await page.onReload(); page.onReasonInput(event('不能改成驳回')); page.onReject(); await flush();
    expect(service.reject).not.toHaveBeenCalled(); expect(page.data.uncertain).toBe(true);
  });
  it('disables publishing a closed candidate and rejects blank reasons without opening a modal', async () => {
    currentDetail = { ...detail(), lifecycle: 'CLOSED' }; await open();
    page.onApprove(); page.onReject(); page.onCloseCampaign(); await flush();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
  });
  it('deduplicates list load/show and navigates only a row returned by the current owner', async () => {
    await open('campaign-reviews'); expect(service.list).toHaveBeenCalledTimes(1);
    page.onOpen({ currentTarget: { dataset: { id: cid } } }); expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    page.onOpen({ currentTarget: { dataset: { id: vid } } });
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: `/pages/super-admin/campaign-review-detail/index?id=${vid}`,
    }));
  });
  it('filters status and retries the same failed next page while retaining content', async () => {
    service.list.mockResolvedValueOnce({ data: [summary()], meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 } });
    await open('campaign-reviews'); service.list.mockRejectedValueOnce({ statusCode: 0 });
    await page.onMore(); expect(page.data.rows).toHaveLength(1); expect(page.data.page).toBe(1);
    service.list.mockResolvedValueOnce({ data: [], meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } });
    await page.onMore(); expect(service.list.mock.calls.slice(-2).map((args: any[]) => args[0])).toEqual([2, 2]);
    page.onStatus(event('2')); await flush(); expect(service.list.mock.calls.at(-1)[1]).toBe('REJECTED');
  });
  it('drops a stale filtered response rather than mixing it into the new list', async () => {
    await open('campaign-reviews'); const pending = deferred(); service.list.mockReturnValueOnce(pending.promise);
    const old = page.load(true); await flush(); page.onStatus(event('2')); await flush();
    pending.resolve({ data: [{ ...summary(), title: '旧私有行' }], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    await old; expect(page.data.rows.some((row: any) => row.title === '旧私有行')).toBe(false);
  });
  it('clears previous owner rows before direct load and ignores the late old response', async () => {
    await open('campaign-reviews'); const pending = deferred(); service.list.mockReturnValueOnce(pending.promise);
    const old = page.load(true); await flush(); owner = 'synthetic-owner-b';
    service.list.mockRejectedValueOnce({ statusCode: 0 }); const fresh = page.load(true);
    expect(page.data.rows).toEqual([]); await fresh;
    pending.resolve({ data: [summary()], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    await old; expect(page.data.rows).toEqual([]);
  });
  it('releases navigation on synchronous failure and isolates old failures after hide/return', async () => {
    await open('campaign-reviews'); (global as any).wx.navigateTo.mockImplementationOnce(() => { throw new Error('native'); });
    const tap = () => page.onOpen({ currentTarget: { dataset: { id: vid } } });
    tap(); tap(); expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
    const previous = (global as any).wx.navigateTo.mock.calls.at(-1)[0];
    page.onHide(); page.onShow(); await flush(); tap(); previous.fail({}); tap();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(3);
  });
  it.each([401, 403])('clears list content on status %s', async (statusCode) => {
    await open('campaign-reviews'); service.list.mockRejectedValueOnce({ statusCode });
    await page.load(true); expect(page.data.rows).toEqual([]); expect(page.data.viewState).toBe('forbidden');
  });
  it('ignores a late hidden list read and clears cached private rows immediately', async () => {
    await open('campaign-reviews'); const pending = deferred(); service.list.mockReturnValueOnce(pending.promise);
    const old = page.load(true); await flush(); page.onHide();
    expect(page.data.rows).toEqual([]);
    pending.resolve({ data: [summary()], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }); await old;
    expect(page.data.rows).toEqual([]);
  });
  it('uses the approved workspace shell, original icon and complete native controls', () => {
    const markup = read('pages/super-admin/campaign-review-detail/index.wxml');
    expect(markup).toContain('super-admin-page-shell');
    for (const name of ['shareDescription', 'contactPhone', 'startsLabel', 'endsLabel', 'timezone',
      'capacityLabel', 'reviewReason', 'sourceDraftVersion', 'campaignVersion', 'feeFen']) expect(markup).toContain(name);
    expect(markup).toContain('<textarea'); expect(markup).toContain('maxlength="-1"');
    expect(markup).toContain('/pages/super-admin/assets/profile-mark-glyph.png');
    expect(read('pages/super-admin/campaign-reviews/index.wxml')).toContain('<picker');
    expect(read('pages/super-admin/campaign-review-detail/index.wxss')).toContain('super-admin-workspace.wxss');
    expect(read('pages/super-admin/group-campaigns/index.wxml')).toContain('bindtap="onFreeCampaignReviews"');
  });
});

describe('super admin free campaign Page through real runtime and defaultRequest', () => {
  let page: any; let stored: Map<string, unknown>; let requests: any[]; let currentDetail: any;
  const respond = (options: any, data: unknown, statusCode = 200) =>
    options.success({ statusCode, data: { data, requestId: 'synthetic-page-flow' } });
  beforeEach(() => {
    stored = new Map([['education.runtime', {
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3000', accessToken: 'synthetic-a',
    }]]);
    requests = []; currentDetail = detail();
    (global as any).wx = {
      getStorageSync: (key: string) => stored.get(key),
      request: jest.fn((options: any) => {
        requests.push(options);
        if (options.method === 'GET') respond(options, currentDetail);
      }),
      showModal: jest.fn(), showToast: jest.fn(), stopPullDownRefresh: jest.fn(),
    };
    page = { data: {} };
    (global as any).Page = (config: any) => {
      page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = (patch: object) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => {
      const actual = jest.requireActual('../pages/super-admin/runtime/free-campaign-review-runtime');
      runtime.mockReset().mockImplementation(actual.getFreeCampaignReviewRuntime);
      require('../pages/super-admin/campaign-review-detail/index');
    });
  });
  afterEach(() => {
    page.onUnload?.(); delete (global as any).wx; delete (global as any).Page;
  });
  const open = async () => { page.onLoad({ id: vid }); page.onShow(); await flush(); };
  const confirm = async () => {
    const calls = (global as any).wx.showModal.mock.calls;
    calls[calls.length - 1][0].success({ confirm: true }); await flush();
  };
  const writes = () => requests.filter((request) => request.method === 'POST');
  it('keeps a real service 409 blocked after return until an explicit current-version reread', async () => {
    await open(); page.onReasonInput(event('原冲突原因')); page.onReject(); await confirm();
    const original = writes()[0]; respond(original, {}, 409); await flush();
    expect(page.data.needsRefresh).toBe(true);
    currentDetail = { ...currentDetail, version: 2, campaignVersion: 4 };
    page.onHide(); page.onShow(); await flush();
    expect(page.data.detail.version).toBe(2); expect(page.data.needsRefresh).toBe(true);
    expect(page.data.reason).toBe('原冲突原因');
    page.onApprove(); page.onReject(); page.onCloseCampaign(); await flush();
    expect(writes()).toHaveLength(1);
    await page.onReload(); expect(page.data.needsRefresh).toBe(false);
    page.onReject(); await confirm();
    expect(writes()[1].data).toEqual({ expectedVersion: 2, reason: '原冲突原因' });
    expect(writes()[1].header['Idempotency-Key']).not.toBe(original.header['Idempotency-Key']);
    currentDetail = { ...currentDetail, status: 'REJECTED', version: 3, reviewedAt: at, reviewReason: '原冲突原因' };
    respond(writes()[1], { ...summary(), status: 'REJECTED', version: 3, reviewedAt: at, reviewReason: '原冲突原因' });
    await flush(); expect(page.data.detail.status).toBe('REJECTED');
  });
  it('keeps malformed successful receipts unknown and retries exactly the same request', async () => {
    await open(); page.onApprove(); await confirm();
    const write = writes()[0];
    respond(write, { ...summary(), status: 'REJECTED', version: 2, reviewedAt: at, reviewReason: '异动作回执' });
    await flush(); expect(page.data.uncertain).toBe(true);
    expect(requests.filter((request) => request.method === 'GET')).toHaveLength(1);
    page.onReasonInput(event('不能改动作')); page.onReject(); await flush();
    expect(writes()).toHaveLength(1);
    page.onRetryAction(); await confirm();
    expect(writes()[1]).toMatchObject({ url: write.url, data: write.data, header: write.header });
    currentDetail = { ...currentDetail, status: 'APPROVED', version: 2, reviewedAt: at, campaignVersion: 4, publishedVersionId: vid };
    respond(writes()[1], { ...summary(), status: 'APPROVED', version: 2, reviewedAt: at });
    await flush();
    expect(page.data.detail.status).toBe('APPROVED'); expect(page.data.uncertain).toBe(false);
    write.fail({}); await flush(); expect(page.data.uncertain).toBe(false);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });
  it('does not dispatch a first confirmed action hidden before its microtask and accepts a fresh reason after return', async () => {
    await open(); page.onReasonInput(event('未发原因')); page.onReject();
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true });
    page.onHide(); await flush(); expect(writes()).toHaveLength(0);
    page.onShow(); await flush(); page.onReasonInput(event('新原因')); page.onReject(); await confirm();
    expect(writes()[0].data).toEqual({ expectedVersion: 1, reason: '新原因' });
    respond(writes()[0], {}, 409); await flush();
  });
  it('blocks mutation after a valid receipt whose current detail reread failed until explicit reread', async () => {
    await open(); page.onApprove(); await confirm();
    (global as any).wx.request.mockImplementation((options: any) => {
      requests.push(options); if (options.method === 'GET') options.fail({});
    });
    respond(writes()[0], { ...summary(), status: 'APPROVED', version: 2, reviewedAt: at });
    await flush();
    expect(page.data.needsRefresh).toBe(true); expect(page.data.uncertain).toBe(false);
    page.onApprove(); page.onReasonInput(event('关闭')); page.onCloseCampaign(); await flush();
    expect(writes()).toHaveLength(1);
    currentDetail = { ...currentDetail, status: 'APPROVED', version: 2, reviewedAt: at, campaignVersion: 4, publishedVersionId: vid };
    (global as any).wx.request.mockImplementation((options: any) => {
      requests.push(options); if (options.method === 'GET') respond(options, currentDetail);
    });
    await page.onReload(); expect(page.data.needsRefresh).toBe(false); expect(page.data.canClose).toBe(true);
  });
  it('consumes a synchronous native confirmation once even if fail and throw follow success', async () => {
    await open();
    (global as any).wx.showModal.mockImplementationOnce((options: any) => {
      options.success({ confirm: true }); options.fail({}); throw new Error('native after callback');
    });
    page.onApprove(); await flush();
    expect(writes()).toHaveLength(1); expect(page.data.submitting).toBe(true);
    respond(writes()[0], {}, 409); await flush(); expect(page.data.submitting).toBe(false);
  });
  it('clears private fields before a direct owner reload and rejects the old native confirmation', async () => {
    await open(); page.onReasonInput(event('旧私有原因')); page.onApprove();
    const oldModal = (global as any).wx.showModal.mock.calls[0][0];
    stored.set('education.runtime', {
      dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001', accessToken: 'synthetic-b',
    });
    (global as any).wx.request.mockImplementation((options: any) => {
      requests.push(options); options.success({ statusCode: 403, data: { message: 'private' } });
    });
    const load = page.load(); expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe('');
    oldModal.success({ confirm: true }); await load;
    expect(writes()).toHaveLength(0); expect(page.data.viewState).toBe('forbidden');
    expect(requests[requests.length - 1].header.Authorization).toBe('Bearer synthetic-b');
  });
});
