import { PARTNER_PROFILE_FIXTURE, PARTNER_STUDENT_DETAILS_FIXTURE, PARTNER_STUDENT_GROWTH_FIXTURE } from '../mock/fixtures/partner.fixture';

const loadProfile = jest.fn();
const loadStudent = jest.fn();
const loadStudentGrowth = jest.fn();
const logout = jest.fn();
let owner = 'synthetic-student-owner';
jest.mock('../services/partner-runtime', () => ({
  createPartnerService: () => ({
    loadProfile: () => loadProfile(),
    loadStudent: (id: string) => loadStudent(id),
    loadStudentGrowth: (id: string, query: object) => loadStudentGrowth(id, query),
  }),
  partnerService: {
    loadProfile: () => loadProfile(),
    loadStudent: (id: string) => loadStudent(id),
    loadStudentGrowth: (id: string, query: object) => loadStudentGrowth(id, query),
  },
}));
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => owner }),
}));
jest.mock('../services/session.service', () => ({
  sessionService: { logout: () => logout() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('partner student detail lifecycle', () => {
  let page: any;
  let definition: any;
  const detail = Object.values(PARTNER_STUDENT_DETAILS_FIXTURE)[0];
  const success = { status: 'success', data: detail };
  const instantiate = (config: any) => {
    const instance = { ...config, data: { ...config.data } };
    instance.setData = (values: object) => Object.assign(instance.data, values);
    return instance;
  };
  const flush = async () => {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
  };

  beforeEach(() => {
    owner = 'synthetic-student-owner';
    loadProfile.mockReset().mockResolvedValue({ status: 'success', data: PARTNER_PROFILE_FIXTURE });
    loadStudent.mockReset().mockResolvedValue(success);
    loadStudentGrowth.mockReset().mockResolvedValue({
      status: 'success',
      data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: PARTNER_STUDENT_GROWTH_FIXTURE,
        meta: { page: 1, pageSize: 5, total: 2, totalPages: 1 },
      },
    });
    logout.mockReset();
    (global as any).wx = { stopPullDownRefresh: jest.fn(), reLaunch: jest.fn(), previewImage: jest.fn() };
    (global as any).Page = (config: any) => {
      definition = config;
      page = instantiate(config);
    };
    jest.isolateModules(() => require('../pages/partner/student-detail/index'));
  });

  afterEach(() => {
    page.onUnload?.();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  it('shows the same payment context on recent student ledger rows', async () => {
    loadStudent.mockResolvedValueOnce({ status: 'success', data: {
      ...detail, recentLessonLedger: [{
        ...detail.recentLessonLedger[0], paymentContext: { receivedOn: '2026-09-01' },
      }],
    } });
    page.onLoad({ id: detail.id }); page.onShow();
    await flush();
    expect(page.data.detail.recentLessonLedger[0].paymentLabel).toBe('缴费日期 2026年9月1日');
  });

  it('loads once for initial load/show and deduplicates concurrent pull refreshes', async () => {
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    page.onLoad({ id: detail.id });
    page.onShow();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(1);
    expect(loadProfile).toHaveBeenCalledTimes(1);
    pending.resolve(success);
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(2);
  });

  it('loads growth only after authorized detail and renders read-only ratings', async () => {
    page.onLoad({ id: detail.id });
    page.onShow();
    await flush();
    expect(loadStudentGrowth).toHaveBeenCalledTimes(1);
    expect(loadStudentGrowth).toHaveBeenCalledWith(detail.id, { page: 1, pageSize: 5 });
    expect(page.data.growthItems[0].performanceLabel).toBe('4.5 星');
    expect(page.data.growthItems[1].statusLabel).toBe('已撤销');
    expect(page.data.growthHasMore).toBe(false);
  });

  it('renders enrollment money for an unissued receipt without fabricating lessons', async () => {
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: {
        ...detail,
        enrollmentSummary: {
          receivedAmountFen: 88000, refundedAmountFen: 0,
          initialMainUnits: 0, initialGiftUnits: 0, pendingIssuanceCount: 1,
        },
      },
    });
    page.onLoad({ id: detail.id });
    page.onShow();
    await flush();
    expect(page.data.detail.enrollment).toMatchObject({
      receivedLabel: '¥880.00', refundedLabel: '¥0.00',
      lessonsLabel: '未发放', pendingLabel: '1笔未发放',
    });
  });

  it('deduplicates growth pagination and retries the failed page without dropping old rows', async () => {
    loadStudentGrowth.mockResolvedValueOnce({
      status: 'success',
      data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [PARTNER_STUDENT_GROWTH_FIXTURE[0]],
        meta: { page: 1, pageSize: 5, total: 6, totalPages: 2 },
      },
    });
    page.onLoad({ id: detail.id });
    await flush();
    const pending = deferred<unknown>();
    loadStudentGrowth.mockReturnValueOnce(pending.promise);
    page.onReachBottom();
    page.onReachBottom();
    await flush();
    expect(loadStudentGrowth).toHaveBeenCalledTimes(2);
    pending.resolve({ status: 'error', statusCode: 500, message: '加载失败' });
    await flush();
    expect(page.data.growthItems).toHaveLength(1);
    expect(page.data.growthError).toBe('加载失败');
    page.onRetryGrowth();
    await flush();
    expect(loadStudentGrowth.mock.calls[2][1].page).toBe(2);
    expect(page.data.growthError).toBe('');
  });

  it('ignores a stale more event after the final growth page', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    const items = page.data.growthItems;
    page.onMoreGrowth();
    await flush();
    expect(loadStudentGrowth).toHaveBeenCalledTimes(1);
    expect(page.data.growthItems).toEqual(items);
  });

  it('ignores retry events when growth has not failed', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    page.onRetryGrowth();
    await flush();
    expect(loadStudentGrowth).toHaveBeenCalledTimes(1);
  });

  it('requires explicit retry after a growth page failure instead of stale more events', async () => {
    loadStudentGrowth.mockResolvedValueOnce({
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [PARTNER_STUDENT_GROWTH_FIXTURE[0]],
        meta: { page: 1, pageSize: 5, total: 6, totalPages: 2 },
      },
    });
    page.onLoad({ id: detail.id });
    await flush();
    loadStudentGrowth.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '下一页失败' });
    page.onMoreGrowth();
    await flush();
    page.onMoreGrowth();
    page.onReachBottom();
    await flush();
    expect(loadStudentGrowth).toHaveBeenCalledTimes(2);
    expect(page.data.growthError).toBe('下一页失败');
    page.onRetryGrowth();
    await flush();
    expect(loadStudentGrowth).toHaveBeenCalledTimes(3);
    expect(loadStudentGrowth.mock.calls[2][1].page).toBe(2);
  });

  it.each([0, -1, 1.5, NaN])('rejects invalid growth page %s before reading', async (number) => {
    page.onLoad({ id: detail.id });
    await flush();
    const snapshot = { state: page.data.growthState, items: page.data.growthItems };
    await page.loadGrowth(number);
    expect(loadStudentGrowth).toHaveBeenCalledTimes(1);
    expect(page.data.growthState).toBe(snapshot.state);
    expect(page.data.growthItems).toEqual(snapshot.items);
  });

  it.each([401, 403])('clears all student content when growth returns HTTP %s', async (statusCode) => {
    loadStudentGrowth.mockResolvedValueOnce({ status: 'error', statusCode, message: '权限失效' });
    page.onLoad({ id: detail.id });
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.detail).toBeNull();
    expect(page.data.growthItems).toEqual([]);
  });

  it('retries page one after a failed growth refresh without appending to stale history', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    loadStudentGrowth.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '刷新失败' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.growthItems).toHaveLength(2);
    page.onRetryGrowth();
    await flush();
    expect(loadStudentGrowth.mock.calls[2][1].page).toBe(1);
    expect(page.data.growthItems).toHaveLength(2);
  });

  it.each([1, 2])('makes interrupted growth page %s retryable after a failed detail refresh', async (requestedPage) => {
    const pending = deferred<unknown>();
    if (requestedPage === 1) loadStudentGrowth.mockReturnValueOnce(pending.promise);
    else loadStudentGrowth.mockResolvedValueOnce({
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [PARTNER_STUDENT_GROWTH_FIXTURE[0]],
        meta: { page: 1, pageSize: 5, total: 6, totalPages: 2 },
      },
    }).mockReturnValueOnce(pending.promise);
    page.onLoad({ id: detail.id });
    await flush();
    if (requestedPage === 2) page.onReachBottom();
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '详情刷新失败' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.growthState).toBe('error');
    expect(page.data.growthError).toBeTruthy();
    pending.resolve({ status: 'error', statusCode: 403, message: '过期响应' });
    await flush();
    expect(page.data.viewState).toBe('ready');
    page.onRetryGrowth();
    await flush();
    expect(loadStudentGrowth.mock.calls[loadStudentGrowth.mock.calls.length - 1][1].page).toBe(requestedPage);
  });

  const photo = (expired: boolean, id = 'photo-1') => ({
    id, mimeType: 'image/png', sizeBytes: 12,
    accessUrl: `/media/student-photos/${id}?signature=${expired ? 'old' : 'fresh'}`,
    accessUrlExpiresAt: new Date(Date.now() + (expired ? -60_000 : 600_000)).toISOString(),
  });

  const openMediaDetail = async () => {
    loadStudent.mockResolvedValueOnce({ status: 'success', data: { ...detail, photo: photo(false) } });
    loadStudentGrowth.mockResolvedValueOnce({
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [{ ...PARTNER_STUDENT_GROWTH_FIXTURE[0], feedbackImages: [photo(false)] }],
        meta: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      },
    });
    page.onLoad({ id: detail.id });
    page.onShow();
    await flush();
  };
  const previewMedia = (kind: string) => kind === 'photo'
    ? page.onPreviewPhoto()
    : page.onPreviewFeedback({ currentTarget: { dataset: {
      id: PARTNER_STUDENT_GROWTH_FIXTURE[0].lessonSessionId, index: 0,
    } } });

  it.each(['photo', 'feedback'])('keeps loaded content and sanitizes native %s preview failures', async (kind) => {
    await openMediaDetail();
    const snapshot = { detail: page.data.detail, growthItems: page.data.growthItems };
    (global as any).wx.previewImage.mockImplementationOnce((options: any) => {
      options.fail({ errMsg: 'previewImage:fail private signed URL' });
    });
    await expect(previewMedia(kind)).resolves.toBeUndefined();
    expect(page.data.refreshError).toBe('图片预览失败，请重试');
    expect(page.data.viewState).toBe('ready');
    expect(page.data.detail).toEqual(snapshot.detail);
    expect(page.data.growthItems).toEqual(snapshot.growthItems);
  });

  it.each(['photo', 'feedback'])('handles synchronous native %s preview exceptions', async (kind) => {
    await openMediaDetail();
    (global as any).wx.previewImage.mockImplementationOnce(() => {
      throw new Error('private native exception');
    });
    await expect(previewMedia(kind)).resolves.toBeUndefined();
    expect(page.data.refreshError).toBe('图片预览失败，请重试');
  });

  it.each(['hidden', 'unloaded', 'refresh', 'newer-preview'])('ignores late preview failure after %s', async (outcome) => {
    await openMediaDetail();
    await previewMedia('photo');
    const options = (global as any).wx.previewImage.mock.calls[0][0];
    expect(options.fail).toEqual(expect.any(Function));
    if (outcome === 'hidden') page.onHide();
    else if (outcome === 'unloaded') page.onUnload();
    else if (outcome === 'refresh') await page.loadStudent(true);
    else await previewMedia('feedback');
    const update = jest.spyOn(page, 'setData').mockClear();
    options.fail({ errMsg: 'late native error' });
    expect(update).not.toHaveBeenCalled();
    expect(page.data.refreshError).toBe('');
  });

  it('refreshes an expired photo before previewing the same authorized file', async () => {
    loadStudent.mockResolvedValueOnce({ status: 'success', data: { ...detail, photo: photo(true) } })
      .mockResolvedValueOnce({ status: 'success', data: { ...detail, photo: photo(false) } });
    page.onLoad({ id: detail.id });
    await flush();
    await page.onPreviewPhoto();
    expect((global as any).wx.previewImage).toHaveBeenCalledWith(expect.objectContaining({
      current: photo(false).accessUrl, urls: [photo(false).accessUrl],
    }));
    expect(loadStudent).toHaveBeenCalledTimes(2);
  });

  it.each(['removed', 'replaced', 'failed', 'forbidden', 'hidden'])('does not preview a stale photo after renewal is %s', async (outcome) => {
    loadStudent.mockResolvedValueOnce({ status: 'success', data: { ...detail, photo: photo(true) } });
    page.onLoad({ id: detail.id });
    await flush();
    if (outcome === 'hidden') {
      const pending = deferred<unknown>();
      loadStudent.mockReturnValueOnce(pending.promise);
      const preview = page.onPreviewPhoto();
      page.onHide();
      pending.resolve({ status: 'success', data: { ...detail, photo: photo(false) } });
      await preview;
    } else {
      loadStudent.mockResolvedValueOnce(outcome === 'failed' || outcome === 'forbidden'
        ? { status: 'error', statusCode: outcome === 'failed' ? 500 : 403, message: '刷新失败' }
        : { status: 'success', data: { ...detail, photo: outcome === 'removed' ? null : photo(false, 'photo-2') } });
      await page.onPreviewPhoto();
    }
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
  });

  it('renews an expired feedback image by its source page and preserves file identity', async () => {
    const growth = (expired: boolean) => ({
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [{ ...PARTNER_STUDENT_GROWTH_FIXTURE[0], feedbackImages: [photo(expired)] }],
        meta: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      },
    });
    loadStudentGrowth.mockResolvedValueOnce(growth(true)).mockResolvedValueOnce(growth(false));
    page.onLoad({ id: detail.id });
    await flush();
    await page.onPreviewFeedback({ currentTarget: { dataset: { id: PARTNER_STUDENT_GROWTH_FIXTURE[0].lessonSessionId, index: 0 } } });
    expect(loadStudentGrowth).toHaveBeenCalledTimes(2);
    expect((global as any).wx.previewImage).toHaveBeenCalledWith(expect.objectContaining({
      current: photo(false).accessUrl, urls: [photo(false).accessUrl],
    }));
  });

  it.each(['removed', 'replaced', 'failed', 'forbidden', 'hidden'])('does not preview a stale feedback image after renewal is %s', async (outcome) => {
    const growth = (images: unknown[]) => ({
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [{ ...PARTNER_STUDENT_GROWTH_FIXTURE[0], feedbackImages: images }],
        meta: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      },
    });
    loadStudentGrowth.mockResolvedValueOnce(growth([photo(true)]));
    page.onLoad({ id: detail.id });
    await flush();
    const event = { currentTarget: { dataset: { id: PARTNER_STUDENT_GROWTH_FIXTURE[0].lessonSessionId, index: 0 } } };
    if (outcome === 'hidden') {
      const pending = deferred<unknown>();
      loadStudentGrowth.mockReturnValueOnce(pending.promise);
      const preview = page.onPreviewFeedback(event);
      page.onHide();
      pending.resolve(growth([photo(false)]));
      await preview;
    } else {
      loadStudentGrowth.mockResolvedValueOnce(outcome === 'failed' || outcome === 'forbidden'
        ? { status: 'error', statusCode: outcome === 'failed' ? 500 : 403, message: '刷新失败' }
        : growth(outcome === 'removed' ? [] : [photo(false, 'photo-2')]));
      await page.onPreviewFeedback(event);
    }
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
  });

  it.each([1, 2])('renews images from page %s without dropping loaded pages or moving the next-page cursor', async (sourcePage) => {
    const growth = (number: number, expired: boolean) => ({
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [{
          ...PARTNER_STUDENT_GROWTH_FIXTURE[0],
          lessonSessionId: `lesson-${number}`, feedbackImages: [photo(expired)],
        }],
        meta: { page: number, pageSize: 5, total: 20, totalPages: 4 },
      },
    });
    loadStudentGrowth.mockResolvedValueOnce(growth(1, true))
      .mockResolvedValueOnce(growth(2, true))
      .mockResolvedValueOnce(growth(3, false))
      .mockResolvedValueOnce(growth(sourcePage, false));
    page.onLoad({ id: detail.id });
    await flush();
    page.onReachBottom();
    await flush();
    page.onReachBottom();
    await flush();
    await page.onPreviewFeedback({ currentTarget: { dataset: { id: `lesson-${sourcePage}`, index: 0 } } });
    expect(page.data.growthItems.map((item: { id: string }) => item.id)).toEqual(['lesson-1', 'lesson-2', 'lesson-3']);
    expect(page.data.growthHasMore).toBe(true);
    page.onReachBottom();
    await flush();
    expect(loadStudentGrowth.mock.calls[4][1].page).toBe(4);
  });

  it.each(['photo', 'feedback'])('invalidates an old %s preview after hide, return and a newer successful read', async (kind) => {
    const growth = (expired: boolean) => ({
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [{ ...PARTNER_STUDENT_GROWTH_FIXTURE[0], feedbackImages: [photo(expired)] }],
        meta: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      },
    });
    loadStudent.mockResolvedValueOnce({ status: 'success', data: { ...detail, photo: photo(true) } });
    loadStudentGrowth.mockResolvedValueOnce(growth(true));
    page.onLoad({ id: detail.id });
    page.onShow();
    await flush();
    const pending = deferred<unknown>();
    if (kind === 'photo') loadStudent.mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ status: 'success', data: { ...detail, photo: photo(false) } });
    else loadStudentGrowth.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(growth(false));
    const preview = kind === 'photo' ? page.onPreviewPhoto()
      : page.onPreviewFeedback({ currentTarget: { dataset: { id: PARTNER_STUDENT_GROWTH_FIXTURE[0].lessonSessionId, index: 0 } } });
    page.onHide();
    page.onShow();
    await flush();
    pending.resolve(kind === 'photo'
      ? { status: 'success', data: { ...detail, photo: photo(false) } } : growth(false));
    await preview;
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
  });

  it('does not write late growth responses after hide and refreshes from page one on return', async () => {
    const pending = deferred<unknown>();
    loadStudentGrowth.mockReturnValueOnce(pending.promise);
    page.onLoad({ id: detail.id });
    page.onShow();
    await flush();
    page.onHide();
    const update = jest.spyOn(page, 'setData').mockClear();
    pending.resolve({ status: 'error', statusCode: 403, message: '旧权限结果' });
    await flush();
    expect(update).not.toHaveBeenCalled();
    page.onShow();
    await flush();
    expect(loadStudentGrowth.mock.calls[1][1].page).toBe(1);
    expect(page.data.viewState).toBe('ready');
  });

  it('previews only images from currently visible authorized content', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    page.onPreviewPhoto();
    page.onPreviewFeedback({ currentTarget: { dataset: { id: 'foreign', index: 0 } } });
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
  });

  it.each(['onHide', 'onUnload'])('ignores late responses after %s', async (method) => {
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    page.onLoad({ id: detail.id });
    await flush();
    page[method]();
    const update = jest.spyOn(page, 'setData').mockClear();
    pending.resolve(success);
    await flush();
    expect(update).not.toHaveBeenCalled();
  });

  it('refreshes on return and cannot be overwritten by an older forbidden result', async () => {
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    page.onLoad({ id: detail.id });
    page.onShow();
    await flush();
    page.onHide();
    page.onShow();
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(2);
    pending.resolve({ status: 'error', statusCode: 403, message: '旧请求无权限' });
    await flush();
    expect(page.data.viewState).toBe('ready');
  });

  it('preserves detail during a retryable refresh failure and retries without blanking', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '网络请求失败' });
    page.onPullDownRefresh();
    expect(page.data.detail.displayName).toBe(detail.displayName);
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshError).toBe('网络请求失败');
    page.onRetry();
    await flush();
    expect(page.data.refreshError).toBe('');
    expect(loadStudent).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])('clears sensitive detail for HTTP %s', async (statusCode) => {
    page.onLoad({ id: detail.id });
    await flush();
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode, message: '无权访问' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.detail).toBeNull();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.refreshError).toBe('');
  });

  it('does not accept a successful student response when profile permission has failed', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    loadProfile.mockResolvedValueOnce({ status: 'error', statusCode: 403, message: '校区不可访问' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.detail).toBeNull();
  });

  it('clears cached content even if one read rejects while the other returns forbidden', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    loadProfile.mockRejectedValueOnce(new Error('private profile failure'));
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode: 403, message: '无权访问' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.detail).toBeNull();
  });

  it('clears a removed student rather than retaining an obsolete profile', async () => {
    page.onLoad({ id: detail.id });
    await flush();
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode: 404, message: '学员不存在' });
    page.onPullDownRefresh();
    await flush();
    expect(page.data.viewState).toBe('empty');
    expect(page.data.detail).toBeNull();
  });

  it('rejects a missing ID without requesting identity or student data', async () => {
    page.onLoad({});
    await flush();
    expect(page.data.viewState).toBe('error');
    expect(loadProfile).not.toHaveBeenCalled();
    expect(loadStudent).not.toHaveBeenCalled();
  });

  it('isolates timezones across simultaneous instances', async () => {
    const firstProfile = deferred<unknown>();
    const firstStudent = deferred<unknown>();
    loadProfile.mockReturnValueOnce(firstProfile.promise).mockResolvedValueOnce({
      status: 'success',
      data: { ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, timezone: 'UTC' } },
    });
    loadStudent.mockReturnValueOnce(firstStudent.promise);
    page.onLoad({ id: detail.id });
    const other = instantiate(definition);
    other.onLoad({ id: detail.id });
    await flush();
    const utcLabel = other.data.detail.recentAttendance[0].lessonLabel;
    firstProfile.resolve({ status: 'success', data: PARTNER_PROFILE_FIXTURE });
    firstStudent.resolve(success);
    await flush();
    expect(page.data.detail.recentAttendance[0].lessonLabel).not.toBe(utcLabel);
    other.onUnload();
  });

  it('recovers unexpected service rejection and never fetches after unload', async () => {
    loadStudent.mockRejectedValueOnce(new Error('private diagnostics'));
    page.onLoad({ id: detail.id });
    await flush();
    expect(page.data.viewState).toBe('error');
    expect(page.data.errorMessage).not.toContain('private diagnostics');
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe('ready');
    page.onUnload();
    page.onShow();
    page.onRetry();
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(2);
  });

  it.each(['onShow', 'onRetry', 'onMoreGrowth', 'photo', 'feedback'])('clears private student content before %s after identity changes', async (action) => {
    await openMediaDetail();
    const calls = [loadProfile.mock.calls.length, loadStudent.mock.calls.length, loadStudentGrowth.mock.calls.length];
    owner = 'synthetic-new-owner';
    if (action === 'photo' || action === 'feedback') await previewMedia(action);
    else page[action]();
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', studentId: '', detail: null, growthItems: [],
      growthTotal: 0, growthHasMore: false, refreshError: '',
    });
    expect([loadProfile.mock.calls.length, loadStudent.mock.calls.length, loadStudentGrowth.mock.calls.length]).toEqual(calls);
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
  });

  it.each(['profile', 'student', 'growth'])('rejects a late %s response belonging to the old identity', async (source) => {
    const pending = deferred<unknown>();
    if (source === 'profile') loadProfile.mockReturnValueOnce(pending.promise);
    if (source === 'student') loadStudent.mockReturnValueOnce(pending.promise);
    if (source === 'growth') loadStudentGrowth.mockReturnValueOnce(pending.promise);
    page.onLoad({ id: detail.id }); page.onShow(); await flush();
    owner = 'synthetic-new-owner';
    pending.resolve(source === 'profile' ? { status: 'success', data: PARTNER_PROFILE_FIXTURE }
      : source === 'student' ? success : {
        status: 'success', data: {
          student: { id: detail.id, displayName: detail.displayName, photo: null },
          items: PARTNER_STUDENT_GROWTH_FIXTURE, meta: { page: 1, pageSize: 5, total: 2, totalPages: 1 },
        },
      });
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [], studentId: '' });
    const calls = [loadProfile.mock.calls.length, loadStudent.mock.calls.length, loadStudentGrowth.mock.calls.length];
    page.onRetry(); page.onRetryGrowth(); await flush();
    expect([loadProfile.mock.calls.length, loadStudent.mock.calls.length, loadStudentGrowth.mock.calls.length]).toEqual(calls);
  });

  it.each(['photo', 'feedback'])('does not open old %s media when identity changes during renewal', async (kind) => {
    await openMediaDetail();
    if (kind === 'photo') page.data.detail.photo = photo(true);
    else page.data.growthItems[0].images = [photo(true)];
    const pending = deferred<unknown>();
    if (kind === 'photo') loadStudent.mockReturnValueOnce(pending.promise);
    else loadStudentGrowth.mockReturnValueOnce(pending.promise);
    const preview = previewMedia(kind);
    owner = 'synthetic-new-owner';
    pending.resolve(kind === 'photo' ? { status: 'success', data: { ...detail, photo: photo(false) } } : {
      status: 'success', data: {
        student: { id: detail.id, displayName: detail.displayName, photo: null },
        items: [{ ...PARTNER_STUDENT_GROWTH_FIXTURE[0], feedbackImages: [photo(false)] }],
        meta: { page: 1, pageSize: 5, total: 1, totalPages: 1 },
      },
    });
    await preview; await flush();
    expect((global as any).wx.previewImage).not.toHaveBeenCalled();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [] });
  });

  it('clears private content instead of showing an old native failure after identity changes', async () => {
    await openMediaDetail();
    await previewMedia('photo');
    const native = (global as any).wx.previewImage.mock.calls[0][0];
    owner = 'synthetic-new-owner';
    native.fail({ errMsg: 'private signed media diagnostic' });
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [], refreshError: '' });
  });

  it.each([
    ['profile', 401], ['profile', 403], ['student', 401], ['student', 403],
  ] as const)('revokes media immediately when %s returns %s while its sibling is pending', async (source, statusCode) => {
    await openMediaDetail();
    const pending = deferred<unknown>();
    if (source === 'profile') {
      loadProfile.mockResolvedValueOnce({ status: 'error', statusCode, message: '合成失权' });
      loadStudent.mockReturnValueOnce(pending.promise);
    } else {
      loadStudent.mockResolvedValueOnce({ status: 'error', statusCode, message: '合成失权' });
      loadProfile.mockReturnValueOnce(pending.promise);
    }
    page.onRetry();
    const reading = page.pendingRequest;
    try {
      await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [], refreshError: '' });
      await previewMedia('photo');
      expect((global as any).wx.previewImage).not.toHaveBeenCalled();
    } finally {
      pending.resolve(source === 'profile' ? success : { status: 'success', data: PARTNER_PROFILE_FIXTURE });
      await reading; await flush();
    }
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, growthItems: [] });
  });

  it('logs out only after an explicit re-login command', async () => {
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode: 401, message: '登录过期' });
    page.onLoad({ id: detail.id });
    await flush();
    expect(logout).not.toHaveBeenCalled();
    page.onLogin();
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
});
