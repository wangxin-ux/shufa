import { LOCAL_RUNTIME_STORAGE_KEY } from '../config/local-runtime';
import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import { PartnerApplicationBankService } from '../pages/partner/runtime/partner-application-bank.service';
import { PartnerApplicationMaterialService } from '../pages/partner/runtime/partner-application-material.service';
import { PartnerApplicationReviewService } from '../pages/partner/runtime/partner-application-review.service';
import { PartnerApplicationService } from '../pages/partner/runtime/partner-application.service';
import type { SessionHttpRequestOptions } from '../services/session.service';
import { partnerApplicationAcceptanceFixture } from './fixtures/partner-application-acceptance.fixture';

const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({
  getPartnerApplicationRuntime: () => getRuntime(),
}));
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const event = (dataset: object) => ({ currentTarget: { dataset } });

describe('complete application Page with real read services and synthetic memory transport', () => {
  let page: any;
  let fixture: ReturnType<typeof partnerApplicationAcceptanceFixture>;
  let stored: Record<string, any>;
  let calls: SessionHttpRequestOptions[];
  let downloads: WechatMiniprogram.DownloadFileOption[];
  let responses: Map<string, unknown>;
  let held: Set<string>;
  let failures: Map<string, number>;
  let sessions: PartnerApplicantSessionService;
  const base = '/partner-applicants';
  const bankPath = `${base}/me/application/bank-information`;
  const materialsPath = `${base}/me/application/materials`;
  const historyPath = `${base}/me/application/history`;
  const respond = (input: SessionHttpRequestOptions, value: unknown, statusCode = 200) => input.success({
    statusCode, data: statusCode === 200 ? { data: value, requestId: 'synthetic-full-page' }
      : { code: statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: '合成访问拒绝' },
  });
  beforeEach(() => {
    fixture = partnerApplicationAcceptanceFixture();
    calls = []; downloads = []; held = new Set(); failures = new Map();
    responses = new Map<string, unknown>([
      [`${base}/me`, fixture.identity], [`${base}/me/application`, fixture.application],
      [bankPath, fixture.bank], [materialsPath, fixture.materials],
    ]);
    stored = {
      accessToken: 'synthetic-existing-formal-session',
      partnerApplicantSession: {
        token: 'synthetic-restricted-session', expiresAt: '2026-10-13T01:00:00.000Z', me: fixture.identity,
      },
    };
    sessions = new PartnerApplicantSessionService({
      apiBaseUrl: 'http://127.0.0.1:3000',
      now: () => Date.parse('2026-10-13T00:00:00.000Z'),
      storage: {
        get: (key) => key === LOCAL_RUNTIME_STORAGE_KEY ? stored : undefined,
        set: (_key, value) => { stored = value as Record<string, any>; },
      },
      request: (input) => {
        calls.push(input);
        const url = new URL(input.url);
        if (held.has(url.pathname)) return;
        if (failures.has(url.pathname)) { respond(input, null, failures.get(url.pathname)); return; }
        if (url.pathname === `${base}/auth/logout`) { respond(input, {}); return; }
        if (input.method !== 'GET') throw new Error('Fixture forbids business writes');
        const value = url.pathname === historyPath
          ? fixture.history(Number(url.searchParams.get('page'))) : responses.get(url.pathname);
        if (value === undefined) throw new Error(`Unknown fixture path: ${url.pathname}`);
        respond(input, value);
      },
      loginCodeProvider: () => { throw new Error('Fixture forbids wx.login'); },
      upload: () => { throw new Error('Fixture forbids uploads'); },
      download: (input) => { downloads.push(input); },
    });
    getRuntime.mockReset().mockReturnValue({
      formalArchive: false, sessions, applications: new PartnerApplicationService(sessions),
      banks: new PartnerApplicationBankService(sessions), materials: new PartnerApplicationMaterialService(sessions),
      reviews: new PartnerApplicationReviewService(sessions),
    });
    (global as any).wx = {
      getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: 390 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 295, height: 32 }),
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      previewImage: jest.fn(), showModal: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(), navigateTo: jest.fn(),
    };
    (global as any).getCurrentPages = () => [{}, page];
    (global as any).Page = (config: any) => {
      page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
    jest.isolateModules(() => require('../pages/partner/application/index'));
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).wx; delete (global as any).Page; delete (global as any).getCurrentPages;
  });
  const open = async () => {
    page.onLoad(); page.onShow(); await flush();
    page.onBankToggle(); page.onMaterialsToggle(); await flush();
  };
  const edit = (partition: string) => {
    if (partition === 'basics' || partition === 'all') page.onFieldInput({
      ...event({ field: 'institutionName' }), detail: { value: '未保存机构修改' },
    });
    if (partition === 'bank' || partition === 'all') page.onBankFieldInput({
      ...event({ field: 'accountHolder' }), detail: { value: '未保存银行修改' },
    });
    if (partition === 'materials' || partition === 'all') page.onMaterialRemove(
      event({ id: fixture.materials.materials[13].storedFileId }),
    );
  };
  const expectPrivateCleared = () => {
    expect(page.data.viewState).toBe('login');
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.bankForm.accountNumber).toBe('');
    expect(page.data.materialsDraft).toEqual([]);
    expect(page.data.materialsRows.every((row: any) => row.files.length === 0)).toBe(true);
    expect(page.data.reviewHistory).toEqual([]);
  };
  it('loads all long partitions on demand without writes, downloads, or prefetching private bank data', async () => {
    page.onLoad(); page.onShow(); await flush();
    expect(calls.map((call) => new URL(call.url).pathname)).not.toContain(bankPath);
    expect(calls.map((call) => new URL(call.url).pathname)).not.toContain(materialsPath);
    page.onBankToggle(); page.onMaterialsToggle(); await flush();
    expect(page.data.form).toEqual(fixture.application.basicInformation);
    expect(page.data.bankForm).toEqual(fixture.bank.bankInformation);
    expect(page.data.materialsDraft).toHaveLength(14);
    expect(page.data.materialsRows.find((row: any) => row.kind === 'ENVIRONMENT')).toMatchObject({
      full: true, files: expect.arrayContaining([expect.objectContaining({ saved: true, localPath: '' })]),
    });
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(page.data.reviewHistory[0]).toMatchObject({
      submittedLabel: '2026-10-13 02:00', reviewedLabel: '2026-10-13 03:00',
      review: { reason: fixture.reason },
    });
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(downloads).toHaveLength(0);
  });
  it.each(['basics', 'bank', 'materials', 'all'])('restores history and retains unsaved %s after saved image preview returns', async (partition) => {
    await open(); edit(partition);
    const before = JSON.parse(JSON.stringify({
      form: page.data.form, bank: page.data.bankForm, materials: page.data.materialsDraft,
    }));
    (global as any).wx.previewImage.mockImplementationOnce((input: WechatMiniprogram.PreviewImageOption) => {
      page.onHide(); input.success?.({ errMsg: 'previewImage:ok' });
    });
    const preview = page.onMaterialPreview(event({ id: fixture.materials.materials[0].storedFileId }));
    await flush();
    expect(downloads).toHaveLength(1);
    downloads[0].success!({ statusCode: 200, tempFilePath: 'wxfile://synthetic-private.png' } as WechatMiniprogram.DownloadFileSuccessCallbackResult);
    await preview; await flush();
    expect(page.data.reviewHistory).toEqual([]);
    page.onShow(); await flush();
    expect(page.data.form).toEqual(before.form);
    expect(page.data.bankForm).toEqual(before.bank);
    expect(page.data.materialsDraft).toEqual(before.materials);
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(page.data.historyMore).toBe(true);
    await page.onHistoryMore(); await flush();
    expect(page.data.reviewHistory).toHaveLength(21);
    expect(new Set(page.data.reviewHistory.map((row: any) => row.submissionId)).size).toBe(21);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it.each([bankPath, materialsPath, historyPath].flatMap((path) =>
    [401, 403].map((status) => ({ path, status })),
  ))('clears every open partition on current $status read of $path', async ({ path, status }) => {
    await open(); failures.set(path, status);
    if (path === bankPath) await page.onBankRetry();
    if (path === materialsPath) await page.onMaterialsRetry();
    if (path === historyPath) await page.onHistoryRetry();
    await flush(); expectPrivateCleared();
    expect(stored.accessToken).toBe('synthetic-existing-formal-session');
  });
  it('retains every dirty partition when resumed history fails and retries without replacing basics', async () => {
    await open(); edit('all');
    const before = JSON.parse(JSON.stringify({
      form: page.data.form, bank: page.data.bankForm, materials: page.data.materialsDraft,
    }));
    const basicReads = calls.filter((call) => new URL(call.url).pathname === `${base}/me/application`).length;
    page.onHide(); failures.set(historyPath, 503);
    page.onShow(); await flush();
    expect(page.data.historyMessage).toContain('读取失败');
    expect(page.data.form).toEqual(before.form);
    expect(page.data.bankForm).toEqual(before.bank);
    expect(page.data.materialsDraft).toEqual(before.materials);
    failures.delete(historyPath); await page.onHistoryRetry(); await flush();
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(calls.filter((call) => new URL(call.url).pathname === `${base}/me/application`)).toHaveLength(basicReads);
  });
  it('ignores resumed history from a replaced applicant session and clears all previous edits', async () => {
    await open(); edit('all');
    const initialRequests = calls.length;
    page.onHide(); held.add(historyPath);
    page.onShow(); await flush();
    const delayed = calls.slice(initialRequests).find((call) => new URL(call.url).pathname === historyPath);
    expect(delayed).toBeDefined();
    page.onHide();
    stored.partnerApplicantSession = { ...stored.partnerApplicantSession, token: 'synthetic-replacement-session' };
    held.delete(historyPath); page.onShow();
    expect(page.data.form.institutionName).toBe('');
    expect(page.data.bankForm.accountNumber).toBe('');
    expect(page.data.materialsDraft).toEqual([]);
    await flush();
    const before = JSON.parse(JSON.stringify(page.data));
    respond(delayed!, { ...fixture.history(), data: [] }); await flush();
    expect(page.data).toEqual(before);
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(sessions.getToken()).toBe('synthetic-replacement-session');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it('keeps a second hidden page clear when the resumed history arrives late', async () => {
    await open(); edit('all'); page.onHide(); held.add(historyPath);
    page.onShow(); await flush();
    const delayed = calls[calls.length - 1];
    expect(new URL(delayed.url).pathname).toBe(historyPath);
    page.onHide(); respond(delayed, fixture.history()); await flush();
    expect(page.data.reviewHistory).toEqual([]);
    held.delete(historyPath); page.onShow(); await flush();
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(page.data.form.institutionName).toBe('未保存机构修改');
    expect(page.data.bankForm.accountHolder).toBe('未保存银行修改');
    expect(page.data.materialsDraft).toHaveLength(13);
  });
  it('requires current basics on a resumed history version conflict while retaining all unsaved partitions', async () => {
    await open(); edit('all');
    const before = JSON.parse(JSON.stringify({
      form: page.data.form, bank: page.data.bankForm, materials: page.data.materialsDraft,
    }));
    const originalHistory = fixture.history;
    fixture.application.version++; fixture.bank.version++; fixture.materials.version++;
    fixture.history = (number = 1) => ({ ...originalHistory(number), version: fixture.application.version });
    page.onHide(); page.onShow(); await flush();
    expect(page.data.historyNeedsRefresh).toBe(true);
    expect(page.data.canReopen).toBe(false);
    await page.onHistoryRetry(); await flush();
    expect(page.data.version).toBe(fixture.application.version);
    expect(page.data.historyNeedsRefresh).toBe(false);
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(page.data.form).toEqual(before.form);
    expect(page.data.bankForm).toEqual(before.bank);
    expect(page.data.materialsDraft).toEqual(before.materials);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it.each(['SUBMITTED', 'REJECTED', 'APPROVED'] as const)('keeps the complete %s application read-only across all editors', async (status) => {
    fixture = partnerApplicationAcceptanceFixture(status);
    responses.set(`${base}/me`, fixture.identity); responses.set(`${base}/me/application`, fixture.application);
    responses.set(bankPath, fixture.bank); responses.set(materialsPath, fixture.materials);
    await open(); edit('all');
    await page.onSave(); await page.onBankSave(); await page.onMaterialsSave();
    expect(page.data.readonly).toBe(true);
    expect(page.data.approvalReady).toBe(status === 'APPROVED');
    expect(page.data.form).toEqual(fixture.application.basicInformation);
    expect(page.data.bankForm).toEqual(fixture.bank.bankInformation);
    expect(page.data.materialsDraft).toHaveLength(14);
    expect(page.data.canReopen).toBe(status === 'REJECTED');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it.each([bankPath, materialsPath, historyPath].flatMap((partition) =>
    ['before', 'after'].map((timing) => ({ partition, timing })),
  ))('recovers the interrupted $partition read when its reply arrives $timing approved navigation fails',
    async ({ partition, timing }) => {
      fixture = partnerApplicationAcceptanceFixture('APPROVED');
      responses.set(`${base}/me`, fixture.identity); responses.set(`${base}/me/application`, fixture.application);
      responses.set(bankPath, fixture.bank); responses.set(materialsPath, fixture.materials);
      held.add(partition);
      await open();
      expect(page.data.approvalReady).toBe(true);
      const interrupted = calls.find((call) => new URL(call.url).pathname === partition)!;
      expect(interrupted).toBeDefined();
      const value = partition === historyPath ? fixture.history(1) : responses.get(partition);
      page.onFormalLogin();
      const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
      if (timing === 'before') { respond(interrupted, value); await flush(); }
      held.delete(partition);
      fail({ errMsg: 'synthetic navigation failure' }); await flush();
      if (timing === 'after') { respond(interrupted, value); await flush(); }
      expect(page.data).toMatchObject({
        viewState: 'ready', approvalReady: true, readonly: true, bankLoading: false,
        materialsLoading: false, historyLoading: false, message: '打开登录失败，请重试',
      });
      expect(page.data.bankForm).toEqual(fixture.bank.bankInformation);
      expect(page.data.materialsDraft).toHaveLength(14);
      expect(page.data.reviewHistory).toHaveLength(20);
      const partitionReads = calls.filter((call) => new URL(call.url).pathname === partition);
      expect(partitionReads.length).toBeLessThanOrEqual(2);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      expect(downloads).toHaveLength(0);
    });
  it('recovers all three interrupted approved reads together without repeating business writes', async () => {
    fixture = partnerApplicationAcceptanceFixture('APPROVED');
    responses.set(`${base}/me`, fixture.identity); responses.set(`${base}/me/application`, fixture.application);
    responses.set(bankPath, fixture.bank); responses.set(materialsPath, fixture.materials);
    for (const partition of [bankPath, materialsPath, historyPath]) held.add(partition);
    await open(); page.onFormalLogin();
    const interrupted = calls.filter((call) => held.has(new URL(call.url).pathname));
    expect(interrupted).toHaveLength(3);
    for (const call of interrupted) {
      const partition = new URL(call.url).pathname;
      respond(call, partition === historyPath ? fixture.history(1) : responses.get(partition));
    }
    await flush(); held.clear();
    (global as any).wx.navigateTo.mock.calls[0][0].fail({ errMsg: 'synthetic failure' }); await flush();
    expect(page.data).toMatchObject({
      bankLoading: false, materialsLoading: false, historyLoading: false, readonly: true, approvalReady: true,
    });
    expect(page.data.bankForm).toEqual(fixture.bank.bankInformation);
    expect(page.data.materialsDraft).toHaveLength(14);
    expect(page.data.reviewHistory).toHaveLength(20);
    for (const partition of [bankPath, materialsPath, historyPath]) {
      expect(calls.filter((call) => new URL(call.url).pathname === partition)).toHaveLength(2);
    }
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(downloads).toHaveLength(0);
  });
  it.each([
    { partition: bankPath, statusCode: 401 },
    { partition: materialsPath, statusCode: 403 },
    { partition: historyPath, statusCode: 403 },
  ])('clears private data on current $statusCode while recovering $partition after navigation failure',
    async ({ partition, statusCode }) => {
      fixture = partnerApplicationAcceptanceFixture('APPROVED');
      responses.set(`${base}/me`, fixture.identity); responses.set(`${base}/me/application`, fixture.application);
      responses.set(bankPath, fixture.bank); responses.set(materialsPath, fixture.materials);
      held.add(partition);
      await open(); page.onFormalLogin();
      const interrupted = calls.find((call) => new URL(call.url).pathname === partition)!;
      respond(interrupted, partition === historyPath ? fixture.history(1) : responses.get(partition));
      await flush(); held.delete(partition); failures.set(partition, statusCode);
      (global as any).wx.navigateTo.mock.calls[0][0].fail({ errMsg: 'synthetic failure' }); await flush();
      expectPrivateCleared();
      expect(page.data.approvalReady).toBe(false);
      page.onFormalLogin();
      expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
    });
  it.each(['replacement', 'expiry'])('clears every approved partition before login after applicant credential %s', async (change) => {
    fixture = partnerApplicationAcceptanceFixture('APPROVED');
    responses.set(`${base}/me`, fixture.identity); responses.set(`${base}/me/application`, fixture.application);
    responses.set(bankPath, fixture.bank); responses.set(materialsPath, fixture.materials);
    await open();
    expect(page.data.approvalReady).toBe(true);
    const reads = calls.length;
    stored.partnerApplicantSession = {
      ...stored.partnerApplicantSession,
      ...(change === 'replacement' ? { token: 'synthetic-replacement-applicant' }
        : { expiresAt: '2026-10-13T00:00:00.000Z' }),
    };
    page.onFormalLogin(); await flush();
    expectPrivateCleared();
    expect(page.data.approvalReady).toBe(false);
    expect(calls).toHaveLength(reads);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    expect(stored.accessToken).toBe('synthetic-existing-formal-session');
    if (change === 'replacement') expect(sessions.getToken()).toBe('synthetic-replacement-applicant');
    else expect(sessions.getToken()).toBe('');
  });
  const startReturn = () => {
    page.onBack();
    const modal = (global as any).wx.showModal.mock.calls.at(-1)?.[0];
    if (modal) modal.success({ confirm: true });
  };
  const failReturn = () => {
    const native = (global as any).wx;
    native.navigateBack.mock.calls.at(-1)[0].fail();
    native.reLaunch.mock.calls.at(-1)[0].fail();
  };
  it.each(['before', 'after'].flatMap((timing) =>
    [200, 401, 403].map((statusCode) => ({ timing, statusCode })),
  ))('restores history after failed return with old $statusCode arriving $timing failure', async ({ timing, statusCode }) => {
    await open(); edit('all');
    const before = JSON.parse(JSON.stringify({
      form: page.data.form, bank: page.data.bankForm, materials: page.data.materialsDraft,
    }));
    held.add(historyPath);
    const reading = page.onHistoryRetry(); await flush();
    const delayed = calls[calls.length - 1];
    expect(new URL(delayed.url).pathname).toBe(historyPath);
    startReturn();
    const stale = JSON.parse(JSON.stringify(fixture.history()));
    stale.data[0].review!.reason = '合成旧审核意见';
    if (timing === 'before') { respond(delayed, stale, statusCode); await reading; }
    held.delete(historyPath);
    failReturn(); await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', historyLoading: false, historyMore: true, message: '返回失败，请重试',
      dirty: true, bankDirty: true, materialsDirty: true,
    });
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(page.data.reviewHistory[0].review.reason).toBe(fixture.reason);
    expect(page.data.form).toEqual(before.form);
    expect(page.data.bankForm).toEqual(before.bank);
    expect(page.data.materialsDraft).toEqual(before.materials);
    expect(calls.filter((call) => new URL(call.url).pathname === historyPath)).toHaveLength(3);
    const writes = page.setData.mock.calls.length;
    const credentials = JSON.stringify(stored);
    if (timing === 'after') { respond(delayed, stale, statusCode); await reading; await flush(); }
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(JSON.stringify(stored)).toBe(credentials);
    expect(sessions.getToken()).toBe('synthetic-restricted-session');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    await page.onHistoryMore(); await flush();
    expect(page.data.reviewHistory).toHaveLength(21);
    expect(downloads).toHaveLength(0);
  });
  it('restores rejected history and reopening without waiting for the interrupted response', async () => {
    fixture = partnerApplicationAcceptanceFixture('REJECTED');
    responses.set(`${base}/me`, fixture.identity); responses.set(`${base}/me/application`, fixture.application);
    responses.set(bankPath, fixture.bank); responses.set(materialsPath, fixture.materials);
    await open();
    held.add(historyPath);
    void page.onHistoryRetry(); await flush();
    const delayed = calls[calls.length - 1];
    startReturn(); held.delete(historyPath); failReturn(); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', readonly: true, historyLoading: false, canReopen: true });
    expect(page.data.reviewHistory).toHaveLength(20);
    const writes = page.setData.mock.calls.length;
    respond(delayed, null, 403); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data.canReopen).toBe(true);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it.each([401, 403])('clears all partitions when recovered history returns current %s after failed return', async (statusCode) => {
    await open(); edit('all');
    held.add(historyPath); void page.onHistoryRetry(); await flush();
    const delayed = calls[calls.length - 1];
    startReturn(); held.delete(historyPath); failures.set(historyPath, statusCode);
    failReturn(); await flush();
    expectPrivateCleared();
    expect(page.data.historyLoading).toBe(false);
    respond(delayed, fixture.history()); await flush();
    expectPrivateCleared();
    expect(stored.accessToken).toBe('synthetic-existing-formal-session');
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it.each(['replacement', 'expiry'].flatMap((change) =>
    ['back', 'fallback', 'direct'].map((stage) => ({ change, stage })),
  ))('clears every partition after credential $change before $stage return failure', async ({ change, stage }) => {
    await open(); edit('all');
    const native = (global as any).wx;
    if (stage === 'direct') (global as any).getCurrentPages = () => [page];
    startReturn();
    if (stage === 'fallback') native.navigateBack.mock.calls[0][0].fail();
    const reads = calls.length;
    stored.partnerApplicantSession = {
      ...stored.partnerApplicantSession,
      ...(change === 'replacement' ? { token: 'synthetic-replacement-session' }
        : { expiresAt: '2026-10-13T00:00:00.000Z' }),
    };
    if (stage === 'back') native.navigateBack.mock.calls[0][0].fail();
    else native.reLaunch.mock.calls[0][0].fail();
    await flush();
    expectPrivateCleared();
    expect(page.navigating).toBe(false);
    expect(calls).toHaveLength(reads);
    expect(native.reLaunch).toHaveBeenCalledTimes(stage === 'back' ? 0 : 1);
    expect(stored.accessToken).toBe('synthetic-existing-formal-session');
    expect(sessions.getToken()).toBe(change === 'replacement' ? 'synthetic-replacement-session' : '');
  });
  it('consumes the first back failure once even if it repeats before or after fallback failure', async () => {
    await open(); startReturn();
    const native = (global as any).wx;
    const backFailed = native.navigateBack.mock.calls[0][0].fail;
    backFailed(); backFailed();
    expect(native.reLaunch).toHaveBeenCalledTimes(1);
    native.reLaunch.mock.calls[0][0].fail(); await flush();
    const writes = page.setData.mock.calls.length;
    const reads = calls.length;
    backFailed(); native.reLaunch.mock.calls[0][0].fail(); await flush();
    expect(native.reLaunch).toHaveBeenCalledTimes(1);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(calls).toHaveLength(reads);
    expect(page.navigating).toBe(false);
  });
  it.each(['failure', 'hide'])('isolates old return callbacks from another return after %s', async (boundary) => {
    await open(); startReturn();
    const native = (global as any).wx;
    const oldBack = native.navigateBack.mock.calls[0][0].fail;
    oldBack();
    const oldFallback = native.reLaunch.mock.calls[0][0].fail;
    if (boundary === 'failure') oldFallback();
    else { page.onHide(); page.onShow(); }
    await flush();
    startReturn();
    const reads = calls.length;
    const writes = page.setData.mock.calls.length;
    oldBack(); oldFallback(); await flush();
    expect(native.navigateBack).toHaveBeenCalledTimes(2);
    expect(native.reLaunch).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(reads);
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.navigating).toBe(true);
    failReturn(); await flush();
    expect(page.navigating).toBe(false);
    expect(page.data.historyLoading).toBe(false);
  });
  it.each(['onHide', 'onUnload'])('does not recover history or navigate through old return callbacks after %s', async (boundary) => {
    await open(); startReturn();
    const native = (global as any).wx;
    const backFailed = native.navigateBack.mock.calls[0][0].fail;
    backFailed();
    const fallbackFailed = native.reLaunch.mock.calls[0][0].fail;
    page[boundary]();
    const writes = page.setData.mock.calls.length;
    const reads = calls.length;
    backFailed(); fallbackFailed(); await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(calls).toHaveLength(reads);
    expect(native.reLaunch).toHaveBeenCalledTimes(1);
  });
  it.each(['throw', 'fail'])('recovers history once when both return operations %s synchronously', async (mode) => {
    await open(); held.add(historyPath); void page.onHistoryRetry(); await flush();
    const native = (global as any).wx;
    const rejectNavigation = (input: { fail(): void }) => {
      if (mode === 'throw') throw new Error('synthetic return failure');
      input.fail();
    };
    native.navigateBack.mockImplementationOnce(rejectNavigation);
    native.reLaunch.mockImplementationOnce(rejectNavigation);
    held.delete(historyPath);
    expect(() => startReturn()).not.toThrow(); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', historyLoading: false });
    expect(page.data.reviewHistory).toHaveLength(20);
    expect(calls.filter((call) => new URL(call.url).pathname === historyPath)).toHaveLength(3);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
  it('rejects a late bank response after materials access revokes the fully loaded page', async () => {
    await open(); held.add(bankPath);
    const reading = page.onBankRetry(); await flush();
    const delayed = calls[calls.length - 1];
    failures.set(materialsPath, 403); await page.onMaterialsRetry(); await flush();
    expectPrivateCleared();
    respond(delayed, fixture.bank); await reading; await flush();
    expectPrivateCleared();
  });
  it('clears every partition on confirmed logout and preserves the independent formal session', async () => {
    await open(); edit('all');
    void page.onApplicantLogout();
    expect((global as any).wx.showModal).toHaveBeenCalledTimes(1);
    (global as any).wx.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expectPrivateCleared();
    expect(stored.partnerApplicantSession).toBeUndefined();
    expect(stored.accessToken).toBe('synthetic-existing-formal-session');
    expect(calls.filter((call) => call.method !== 'GET').map((call) => new URL(call.url).pathname))
      .toEqual([`${base}/auth/logout`]);
  });
});
