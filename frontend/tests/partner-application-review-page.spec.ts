export {};
const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({ getPartnerApplicationRuntime: () => getRuntime() }));
const id = '55883f08-c9f5-4f26-927c-82ea07cb8a02';
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
const history = () => ({ applicationId: id, status: 'REJECTED', version: 10, editSourceSubmissionId: null,
  data: [{ submissionId: id, submissionVersion: 9, submittedAt: '2026-10-13T00:00:00.000Z', institutionName: '合成机构',
    review: { reviewId: id, decision: 'REJECTED', reason: '门头不清晰，请补交', reviewedAt: '2026-10-13T01:00:00.000Z' } }],
  meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } });
describe('applicant review history and reopening page', () => {
  let page: any; let runtime: any; let key: string;
  beforeEach(() => {
    key = '1:synthetic';
    runtime = { formalArchive: false, sessions: { getSessionKey: () => key, invalidateReads: jest.fn(),
      loadMe: jest.fn().mockResolvedValue({ displayName: '申请人', formalAccountReady: false }) },
      applications: { load: jest.fn().mockResolvedValue({ applicationId: id, status: 'REJECTED', version: 10,
        basicInformation: { institutionName: '合成机构' } }), saveBasics: jest.fn() },
      reviews: { history: jest.fn().mockResolvedValue(history()), reopen: jest.fn().mockResolvedValue({
        applicationId: id, sourceSubmissionId: id, status: 'DRAFT', version: 11,
      }) },
    };
    getRuntime.mockReset().mockReturnValue(runtime);
    let entropy = 0;
    (global as any).wx = { getWindowInfo: () => ({ windowWidth: 390 }), getMenuButtonBoundingClientRect: () => ({ top: 32, height: 32 }),
      showModal: jest.fn(), stopPullDownRefresh: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn(),
      navigateTo: jest.fn(),
      getRandomValues: jest.fn((input: any) => input.success({ randomValues: new Uint8Array(16).fill(++entropy).buffer })) };
    (global as any).Page = (config: any) => { page = { ...config, data: JSON.parse(JSON.stringify(config.data)) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch)); };
    (global as any).getCurrentPages = () => [page];
    jest.isolateModules(() => require('../pages/partner/application/index'));
  });
  afterEach(() => { page.onUnload(); delete (global as any).wx; delete (global as any).Page; delete (global as any).getCurrentPages; });
  const open = async () => { page.onLoad(); page.onShow(); await flush(); };
  const confirm = async () => { page.onReopen?.(); await flush();
    expect((global as any).wx.showModal).toHaveBeenCalled();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush(); };
  it('shows rejection reason and durable submission/review times after reentry', async () => {
    await open(); expect(runtime.reviews.history).toHaveBeenCalledWith(1);
    expect(page.data.reviewHistory[0].review.reason).toBe('门头不清晰，请补交');
    expect(page.data.canReopen).toBe(true); expect(page.data.readonly).toBe(true);
  });
  it('confirms once and reloads the newly derived draft', async () => {
    await open(); runtime.applications.load.mockResolvedValueOnce({ applicationId: id, version: 11, status: 'DRAFT', basicInformation: { institutionName: '合成机构' } });
    await confirm(); expect(runtime.reviews.reopen).toHaveBeenCalledWith(id, 10, expect.any(String));
    expect(page.data.readonly).toBe(false); expect(page.data.version).toBe(11);
  });
  it('retains the original key/version for an unknown reopening outcome', async () => {
    await open(); runtime.reviews.reopen.mockRejectedValueOnce(Object.assign(new Error('连接失败'), { statusCode: 503 }));
    await confirm(); expect(page.data.reopenUncertain).toBe(true);
    const first = runtime.reviews.reopen.mock.calls[0];
    await confirm(); expect(runtime.reviews.reopen.mock.calls[1]).toEqual(first);
    expect((global as any).wx.getRandomValues).toHaveBeenCalledTimes(1);
  });
  it('retains the original reopening request across a failed return and recovered history', async () => {
    await open();
    runtime.reviews.reopen.mockRejectedValueOnce(Object.assign(new Error('合成未知结果'), { statusCode: 503 }));
    await confirm();
    const original = runtime.reviews.reopen.mock.calls[0];
    page.onBack();
    (global as any).wx.reLaunch.mock.calls[0][0].fail(); await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', historyLoading: false, canReopen: true, reopenUncertain: true,
    });
    expect(runtime.reviews.history).toHaveBeenCalledTimes(2);
    expect(runtime.reviews.reopen).toHaveBeenCalledTimes(1);
    await confirm();
    expect(runtime.reviews.reopen.mock.calls[1]).toEqual(original);
    expect((global as any).wx.getRandomValues).toHaveBeenCalledTimes(1);
  });
  it.each(['onHide', 'onUnload', 'replacement'])('cancels an unsent unknown-outcome reopening retry after %s', async (boundary) => {
    await open();
    runtime.reviews.reopen.mockRejectedValueOnce(Object.assign(new Error('合成未知结果'), { statusCode: 503 }));
    await confirm();
    const original = runtime.reviews.reopen.mock.calls[0];
    page.onReopen();
    (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true });
    if (boundary === 'replacement') key = '2:synthetic-replacement';
    else page[boundary]();
    await flush();
    expect(runtime.reviews.reopen).toHaveBeenCalledTimes(1);
    if (boundary === 'onHide') {
      page.onShow(); await flush();
      expect(page.data).toMatchObject({ reopening: false, reopenUncertain: true });
      await confirm();
      expect(runtime.reviews.reopen).toHaveBeenCalledTimes(2);
      expect(runtime.reviews.reopen.mock.calls[1]).toEqual(original);
    } else if (boundary === 'replacement') {
      expect(page.data.viewState).toBe('login');
      expect(page.data.reviewHistory).toEqual([]);
    }
    expect((global as any).wx.getRandomValues).toHaveBeenCalledTimes(1);
  });
  it.each(['onHide', 'onUnload', 'replacement'])('cancels an unsent history read after %s', async (boundary) => {
    await open();
    const reads = runtime.reviews.history.mock.calls.length;
    const pending = page.onHistoryRetry();
    if (boundary === 'replacement') key = '2:synthetic-replacement';
    else page[boundary]();
    await pending; await flush();
    expect(runtime.reviews.history).toHaveBeenCalledTimes(reads);
    if (boundary === 'onHide') {
      page.onShow(); await flush();
      expect(runtime.reviews.history).toHaveBeenCalledTimes(reads + 1);
      expect(page.data.reviewHistory[0].review.reason).toBe('门头不清晰，请补交');
    }
  });
  it.each([401, 403])('clears all private history and basics after current %s', async (statusCode) => {
    runtime.reviews.history.mockRejectedValue(Object.assign(new Error('拒绝'), { statusCode }));
    await open(); expect(page.data.reviewHistory).toEqual([]); expect(page.data.form.institutionName).toBe('');
    expect(page.data.viewState).toBe('login');
  });
  it('ignores late history after hide and replaced applicant', async () => {
    let resolve!: (value: unknown) => void;
    runtime.reviews.history.mockImplementationOnce(() => new Promise((yes) => { resolve = yes; }));
    await open(); page.onHide(); key = '2:new-owner'; runtime.reviews.history.mockResolvedValue({ ...history(), data: [] });
    page.onShow(); await flush(); resolve(history()); await flush();
    expect(page.data.reviewHistory).toEqual([]);
  });
  it('disallows reopen without current matching history or in formal archive', async () => {
    runtime.formalArchive = true; runtime.reviews = undefined; await open();
    expect(page.data.canReopen).toBe(false); page.onReopen?.(); await flush();
    expect((global as any).wx.showModal).not.toHaveBeenCalled();
  });
  it('loads older history without replacing the latest rejection reason', async () => {
    runtime.reviews.history.mockResolvedValueOnce({ ...history(), meta: { page: 1, pageSize: 20, total: 21, totalPages: 2 } });
    await open(); runtime.reviews.history.mockResolvedValueOnce({ ...history(), data: [{ ...history().data[0], submissionId: '9d22fa42-3869-4e7a-8ea2-e72589430f7b' }],
      meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } });
    await page.onHistoryMore?.(); await flush();
    expect(page.data.reviewHistory).toHaveLength(2); expect(page.data.canReopen).toBe(true);
  });
  it('consumes a reopening confirmation once and ignores a confirmation after hide', async () => {
    await open(); page.onReopen(); await flush();
    const dialog = (global as any).wx.showModal.mock.calls.at(-1)[0];
    dialog.success({ confirm: true }); dialog.success({ confirm: true }); await flush();
    expect(runtime.reviews.reopen).toHaveBeenCalledTimes(1);
    runtime.applications.load.mockResolvedValue({ applicationId: id, version: 10, status: 'REJECTED', basicInformation: { institutionName: '合成机构' } });
    await page.loadDraft(); await flush(); page.onReopen(); await flush();
    const late = (global as any).wx.showModal.mock.calls.at(-1)[0]; page.onHide(); late.success({ confirm: true });
    await flush(); expect(runtime.reviews.reopen).toHaveBeenCalledTimes(1);
  });
  it('releases the reopening display lock after a hidden unknown response and retries the original key', async () => {
    await open(); let reject!: (v: unknown) => void;
    runtime.reviews.reopen.mockImplementationOnce(() => new Promise((_yes, no) => { reject = no; }));
    await confirm(); page.onHide(); page.onShow();
    reject(Object.assign(new Error('未知'), { statusCode: 503 })); await flush();
    expect(page.data.reopening).toBe(false); expect(page.data.reopenUncertain).toBe(true);
    const first = runtime.reviews.reopen.mock.calls[0]; await confirm();
    expect(runtime.reviews.reopen.mock.calls[1]).toEqual(first);
    expect((global as any).wx.getRandomValues).toHaveBeenCalledTimes(1);
  });
  it('reloads the basic version when history discovers a concurrent status change', async () => {
    runtime.reviews.history.mockResolvedValue({ ...history(), status: 'DRAFT', version: 11 });
    await open(); expect(page.data.canReopen).toBe(false);
    runtime.applications.load.mockResolvedValue({ applicationId: id, version: 11, status: 'DRAFT', basicInformation: { institutionName: '新草稿' } });
    await page.onHistoryRetry(); await flush();
    expect(page.data.version).toBe(11); expect(page.data.readonly).toBe(false);
  });
  it('refreshes durable submission history immediately after a successful resubmission', async () => {
    runtime.applications.load.mockResolvedValue({ applicationId: id, version: 10, status: 'DRAFT', basicInformation: { institutionName: '合成机构' } });
    runtime.reviews.history.mockResolvedValue({ ...history(), status: 'DRAFT', data: [] });
    runtime.submissions = { submit: jest.fn().mockResolvedValue({ applicationId: id, submissionId: id, version: 11, status: 'SUBMITTED', submittedAt: '2026-10-13T00:00:00.000Z' }) };
    await open();
    runtime.reviews.history.mockResolvedValue({ ...history(), status: 'SUBMITTED', version: 11,
      data: [{ ...history().data[0], submissionVersion: 11, review: null }] });
    page.onSubmit(); (global as any).wx.showModal.mock.calls.at(-1)[0].success({ confirm: true }); await flush();
    expect(runtime.reviews.history).toHaveBeenCalledTimes(2);
    expect(page.data.reviewHistory[0].submissionVersion).toBe(11);
  });
  it('offers active formal login only after current approved state and same identity readiness', async () => {
    runtime.sessions.loadMe.mockResolvedValue({ displayName: '申请人', formalAccountReady: true });
    runtime.applications.load.mockResolvedValue({ applicationId: id, status: 'APPROVED', version: 10, basicInformation: {} });
    runtime.reviews.history.mockResolvedValue({ ...history(), status: 'APPROVED' });
    await open(); expect(page.data.approvalReady).toBe(true); page.onFormalLogin?.();
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/partner/login/index' }));
    page.onHide(); page.onFormalLogin?.(); expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });
  const openApproved = async () => {
    runtime.sessions.loadMe.mockResolvedValue({ displayName: '申请人', formalAccountReady: true });
    runtime.applications.load.mockResolvedValue({
      applicationId: id, status: 'APPROVED', version: 10,
      basicInformation: { institutionName: '合成已批准机构' },
    });
    runtime.reviews.history.mockResolvedValue({ ...history(), status: 'APPROVED' });
    await open();
    expect(page.data.approvalReady).toBe(true);
  };
  it.each(['throw', 'fail'])('recovers the approved login entry after native %s and permits retry', async (failure) => {
    await openApproved();
    const navigate = (global as any).wx.navigateTo;
    navigate.mockImplementationOnce((options: WechatMiniprogram.NavigateToOption) => {
      if (failure === 'throw') throw new Error('synthetic navigation failure');
      options.fail?.({ errMsg: 'synthetic navigation failure' });
    });
    expect(() => page.onFormalLogin()).not.toThrow();
    expect(page.navigating).toBe(false);
    expect(page.data).toMatchObject({
      viewState: 'ready', approvalReady: true, readonly: true,
      message: '打开登录失败，请重试', form: { institutionName: '合成已批准机构' },
    });
    page.onRetry(); await flush();
    expect(runtime.applications.load).toHaveBeenCalledTimes(2);
    page.onFormalLogin();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate.mock.calls[1][0].url).toBe('/pages/partner/login/index');
    expect(page.navigating).toBe(true);
  });
  it('deduplicates the approved login entry while navigation is pending', async () => {
    await openApproved();
    page.onFormalLogin(); page.onFormalLogin(); page.onRetry();
    await flush();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
    expect(runtime.applications.load).toHaveBeenCalledTimes(1);
  });
  it.each(['onHide', 'onUnload'])('ignores an approved login failure after %s', async (lifecycle) => {
    await openApproved(); page.onFormalLogin();
    const callback = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page[lifecycle]();
    const writes = page.setData.mock.calls.length;
    callback({ errMsg: 'synthetic late failure' });
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data.approvalReady).toBe(false);
  });
  it('does not let a repeated failure release the next approved login navigation', async () => {
    await openApproved(); page.onFormalLogin();
    const first = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    first({ errMsg: 'synthetic failure' });
    page.onFormalLogin();
    const writes = page.setData.mock.calls.length;
    first({ errMsg: 'synthetic duplicate failure' });
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.navigating).toBe(true);
    page.onFormalLogin();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });
  it('keeps the restored approved navigation locked when a prior navigation failure arrives', async () => {
    await openApproved(); page.onFormalLogin();
    const first = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page.onHide(); page.onShow(); await flush();
    expect(page.data.approvalReady).toBe(true);
    page.onFormalLogin();
    const writes = page.setData.mock.calls.length;
    first({ errMsg: 'synthetic old navigation failure' });
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.navigating).toBe(true);
    page.onFormalLogin();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
  });
  it('clears the old approved application when ownership changes before navigation fails', async () => {
    await openApproved(); page.onFormalLogin();
    key = '2:synthetic-replacement';
    (global as any).wx.navigateTo.mock.calls[0][0].fail({ errMsg: 'synthetic failure' });
    expect(page.data).toMatchObject({
      viewState: 'login', approvalReady: false, applicationId: '', version: 0,
      form: { institutionName: '' }, reviewHistory: [],
      errorMessage: '申请登录已更新，请重新登录',
    });
    page.onFormalLogin();
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });
  it.each(['2:synthetic-replacement', ''])('clears the old approved application before login after owner changes to %s', async (nextKey) => {
    await openApproved();
    key = nextKey;
    page.onFormalLogin();
    expect(page.data).toMatchObject({
      viewState: 'login', approvalReady: false, applicationId: '', version: 0,
      form: { institutionName: '' }, reviewHistory: [],
      errorMessage: '申请登录已更新，请重新登录',
    });
    expect(page.navigating).toBe(false);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    expect(runtime.applications.load).toHaveBeenCalledTimes(1);
  });
  it('keeps the existing return action usable after an approved login navigation throws', async () => {
    await openApproved();
    (global as any).wx.navigateTo.mockImplementationOnce(() => { throw new Error('synthetic failure'); });
    expect(() => page.onFormalLogin()).not.toThrow();
    page.onBack();
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/pages/bootstrap/index' }),
    );
  });
  it('never offers approval login for unapproved, unready, or formal archive views', async () => {
    await open(); expect(page.data.approvalReady).toBe(false); page.onFormalLogin?.();
    runtime.sessions.loadMe.mockResolvedValue({ displayName: '申请人', formalAccountReady: true });
    await page.loadDraft(); expect(page.data.approvalReady).toBe(false);
    runtime.formalArchive = true; runtime.applications.load.mockResolvedValue({ applicationId: id, status: 'APPROVED', version: 10, basicInformation: {} });
    await page.loadDraft(); expect(page.data.approvalReady).toBe(false);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });
});
