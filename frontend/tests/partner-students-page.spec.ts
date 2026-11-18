import { PARTNER_STUDENTS_FIXTURE, PARTNER_STUDENT_DETAILS_FIXTURE } from '../mock/fixtures/partner.fixture';
import * as fs from 'fs';
import * as path from 'path';

const loadStudents = jest.fn();
const loadStudent = jest.fn();
const loadSubjects = jest.fn();
const logout = jest.fn();
let ownerKey = 'synthetic-students-owner';
jest.mock('../pages/partner/runtime/partner-students-runtime', () => ({
  createPartnerStudentsService: () => ({
    loadStudents: (query: unknown) => loadStudents(query),
    loadStudent: (id: string) => loadStudent(id),
    loadSubjects: (current?: () => boolean) => loadSubjects(current),
  }),
}), { virtual: true });
jest.mock('../pages/partner/runtime/partner-campaign-draft.service', () => ({
  getPartnerCampaignDraftService: () => ({ getSessionKey: () => ownerKey }),
}));
jest.mock('../services/session.service', () => ({
  sessionService: { logout: () => logout() },
  createSessionService: () => ({ logout: () => logout() }),
}));

function success(id = 'new-student', page = 1, totalPages = 1) {
  return {
    status: 'success',
    data: {
      data: [{ ...PARTNER_STUDENTS_FIXTURE[0], id }],
      meta: { page, pageSize: 20, total: totalPages * 20, totalPages },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const subjectRows = [
  { id: '00000000-0000-4000-8000-000000000001', name: '硬笔书法', isActive: true, version: 1 },
  { id: '00000000-0000-4000-8000-000000000002', name: '口才', isActive: false, version: 1 },
];
const subjectSuccess = (rows = subjectRows) => ({ status: rows.length ? 'success' : 'empty', data: rows });

describe('partner student page filters and request lifecycle', () => {
  let page: any;
  let definition: any;
  const instantiate = (config: any) => {
    const instance = { ...config, data: { ...config.data, items: [] } };
    instance.setData = (values: object) => Object.assign(instance.data, values);
    return instance;
  };
  const flush = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    ownerKey = 'synthetic-students-owner';
    logout.mockReset();
    loadStudents.mockReset().mockResolvedValue(success());
    loadStudent.mockReset().mockResolvedValue({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student' },
    });
    loadSubjects.mockReset().mockResolvedValue(subjectSuccess());
    (global as any).wx = {
      stopPullDownRefresh: jest.fn(), navigateTo: jest.fn(), showToast: jest.fn(), reLaunch: jest.fn(),
    };
    (global as any).Page = (config: unknown) => {
      definition = config;
      page = instantiate(config);
    };
    jest.isolateModules(() => require('../pages/partner/students/index'));
  });

  afterEach(() => {
    page.onUnload();
    jest.useRealTimers();
    delete (global as any).wx;
    delete (global as any).Page;
  });

  it('loads once and combines the selected balance band with pending name input', async () => {
    page.onLoad();
    await flush();
    page.onSearchInput({ detail: { value: ' 林 ' } });
    page.onBalanceChange({ detail: { value: '2' } });
    await flush();
    expect(loadStudents).toHaveBeenLastCalledWith({
      page: 1, pageSize: 20, query: '林', balanceBand: 'LTE_FIVE',
    });
    jest.advanceTimersByTime(400);
    expect(loadStudents).toHaveBeenCalledTimes(2);
  });

  const toggle = (id: string) => ({ currentTarget: { dataset: { id } } });
  it('renders enrollment received money, refunds and pending issuance independently', async () => {
    loadStudent.mockResolvedValueOnce({
      status: 'success',
      data: {
        ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student',
        enrollmentSummary: {
          receivedAmountFen: 100000, refundedAmountFen: 20000,
          initialMainUnits: 1000, initialGiftUnits: 0, pendingIssuanceCount: 1,
        },
      },
    });
    page.onLoad();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(page.data.expandedDetail.enrollment).toMatchObject({
      receivedLabel: '¥1000.00', refundedLabel: '¥200.00',
      lessonsLabel: '购买10节 · 赠送0节', pendingLabel: '另有1笔未发放',
    });
  });

  it('keeps absent enrollment history unknown instead of using remaining balances', async () => {
    page.onLoad();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(page.data.expandedDetail.enrollment).toMatchObject({
      receivedLabel: '待核对', refundedLabel: '待核对',
      lessonsLabel: '购买待核对 · 赠送待核对', pendingLabel: '',
    });
  });
  const photo = (url = '/media/student-photo?signature=old', id = 'photo-1') => ({
    id, mimeType: 'image/png', sizeBytes: 12,
    accessUrl: url, accessUrlExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  const photoEvent = (url = '/media/student-photo?signature=old') => ({
    currentTarget: { dataset: { id: 'new-student', photoId: 'photo-1', url } },
  });
  const openPhoto = async () => {
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo() },
    });
    page.onLoad();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
  };

  const startRead = (source: string) => {
    if (source === 'list') {
      page.data.hasMore = true;
      return page.loadStudents(false);
    }
    if (source === 'expanded') {
      page.expansionCache.clear();
      return page.loadExpanded('new-student');
    }
    page.onExpandedPhotoError(photoEvent());
    return page.onRetryExpandedPhoto();
  };

  const expectCleared = () => {
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], total: 0, page: 0, hasMore: false,
      loadingMore: false, paginationError: '', expandedId: '', expandedDetail: null,
      expandedState: 'idle', expandedError: '', expandedPhotoError: '', expandedPhotoRetrying: false,
      subjectId: '', subjectIndex: 0, subjectOptions: [], subjectError: '', subjectsLoading: false,
    });
    expect(page.expansionCache.size).toBe(0);
    expect(page.expansionRequests.size).toBe(0);
    expect(page.pendingResetRequest).toBeUndefined();
    expect(page.pendingResetKey).toBe('');
    expect(page.photoRequest).toBeUndefined();
    expect(page.navigating).toBe(false);
    expect(page.subjectPending).toBeUndefined();
  };

  const chooseSubject = (index: number) => page.onSubjectChange({ detail: { value: String(index) } });

  it('combines stable subject IDs, pending name and balance across first and later pages', async () => {
    page.onLoad();
    page.onShow();
    await flush();
    expect(page.data.subjectOptions).toEqual([
      { value: '', label: '全部科目' }, { value: 'UNCLASSIFIED', label: '未归类' },
      { value: subjectRows[0].id, label: '硬笔书法' },
      { value: subjectRows[1].id, label: '口才（已归档）' },
    ]);
    page.onSearchInput({ detail: { value: ' 林 ' } });
    chooseSubject(3);
    await flush();
    expect(loadStudents).toHaveBeenLastCalledWith({
      page: 1, pageSize: 20, query: '林', balanceBand: 'ALL', subjectId: subjectRows[1].id,
    });
    loadStudents.mockResolvedValueOnce(success('first', 1, 2));
    page.onBalanceChange({ detail: { value: '2' } });
    await flush();
    loadStudents.mockResolvedValueOnce(success('second', 2, 2));
    page.onLoadMore();
    await flush();
    expect(loadStudents).toHaveBeenLastCalledWith({
      page: 2, pageSize: 20, query: '林', balanceBand: 'LTE_FIVE', subjectId: subjectRows[1].id,
    });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['first', 'second']);
    jest.advanceTimersByTime(400);
    expect(loadStudents).toHaveBeenCalledTimes(4);
    page.onPullDownRefresh();
    await flush();
    expect(loadSubjects).toHaveBeenCalledTimes(1);
    chooseSubject(1);
    await flush();
    expect(loadStudents).toHaveBeenLastCalledWith(expect.objectContaining({ subjectId: 'UNCLASSIFIED', page: 1 }));
    chooseSubject(0);
    await flush();
    expect(loadStudents.mock.calls[loadStudents.mock.calls.length - 1][0]).not.toHaveProperty('subjectId');
    expect(loadSubjects).toHaveBeenCalledTimes(1);
  });

  it('includes the subject in the pending reset identity and only applies the latest matching list', async () => {
    await openPhoto();
    const old = deferred<unknown>(), fresh = deferred<unknown>();
    loadStudents.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    chooseSubject(2);
    const first = page.pendingResetRequest;
    expect(page.loadStudents(true, true)).toBe(first);
    chooseSubject(3);
    const latest = page.pendingResetRequest;
    expect(latest).not.toBe(first);
    expect(page.data.expandedDetail).toBeNull();
    expect(page.expansionCache.size).toBe(0);
    fresh.resolve(success());
    await flush();
    expect(page.data).toMatchObject({ expandedId: 'new-student', expandedState: 'ready' });
    expect(loadStudent).toHaveBeenCalledTimes(2);
    old.resolve(success('obsolete'));
    await flush();
    expect(page.data.items[0].id).toBe('new-student');
    expect(page.data.subjectId).toBe(subjectRows[1].id);
    expect(loadStudent).toHaveBeenCalledTimes(2);
  });

  it('drops a filtered-out expansion and ignores its old private detail', async () => {
    page.onLoad();
    await flush();
    const old = deferred<unknown>();
    loadStudent.mockReturnValueOnce(old.promise);
    page.onStudentToggle(toggle('new-student'));
    loadStudents.mockResolvedValueOnce(success('other-student'));
    chooseSubject(2);
    await flush();
    old.resolve({ status: 'success', data: PARTNER_STUDENT_DETAILS_FIXTURE[0] });
    await flush();
    expect(page.data).toMatchObject({ expandedId: '', expandedDetail: null, expandedState: 'idle' });
    expect(page.expansionCache.size).toBe(0);
    expect(loadStudent).toHaveBeenCalledTimes(1);
  });

  it.each(['state', 'reject', 'throw'])('keeps an initial %s catalog failure independent and retries only the catalog', async (kind) => {
    if (kind === 'state') loadSubjects.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: 'private diagnostics' });
    if (kind === 'reject') loadSubjects.mockRejectedValueOnce(new Error('private diagnostics'));
    if (kind === 'throw') loadSubjects.mockImplementationOnce(() => { throw new Error('private diagnostics'); });
    page.onLoad();
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', subjectId: '', subjectsLoading: false, subjectError: '科目加载失败，请重试',
    });
    expect(page.data.items).toHaveLength(1);
    expect(JSON.stringify(page.data)).not.toContain('private diagnostics');
    page.onSubjectsRetry();
    page.onSubjectsRetry();
    await flush();
    expect(loadSubjects).toHaveBeenCalledTimes(2);
    expect(loadStudents).toHaveBeenCalledTimes(1);
    expect(page.data.subjectError).toBe('');
    expect(page.data.subjectOptions).toHaveLength(4);
  });

  it('preserves the selected ID and old catalog on ordinary failure, then resolves its renamed archived option by ID', async () => {
    page.onLoad();
    page.onShow();
    await flush();
    chooseSubject(2);
    await flush();
    const options = page.data.subjectOptions;
    loadSubjects.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '目录暂不可用' });
    page.onHide();
    page.onShow();
    await flush();
    expect(page.data.subjectOptions).toEqual(options);
    expect(page.data).toMatchObject({ subjectId: subjectRows[0].id, subjectIndex: 2, subjectError: '科目加载失败，请重试' });
    expect(loadStudents).toHaveBeenLastCalledWith(expect.objectContaining({ subjectId: subjectRows[0].id }));
    loadSubjects.mockResolvedValueOnce(subjectSuccess([
      subjectRows[1], { ...subjectRows[0], name: '书法新名称', isActive: false },
    ]));
    const count = loadStudents.mock.calls.length;
    page.onSubjectsRetry();
    await flush();
    expect(page.data).toMatchObject({ subjectId: subjectRows[0].id, subjectIndex: 3, subjectError: '' });
    expect(page.data.subjectOptions[3].label).toBe('书法新名称（已归档）');
    expect(loadStudents).toHaveBeenCalledTimes(count);
  });

  it('explicitly marks a missing selected subject and never silently sends an all-subject query', async () => {
    page.onLoad();
    await flush();
    chooseSubject(2);
    await flush();
    loadSubjects.mockResolvedValueOnce(subjectSuccess([]));
    page.onSubjectsRetry();
    await flush();
    expect(page.data.subjectId).toBe(subjectRows[0].id);
    expect(page.data.subjectOptions[page.data.subjectIndex].value).toBe(subjectRows[0].id);
    expect(page.data.subjectError).toBe('所选科目已不在目录中，请重新选择或重试');
    page.onRetry();
    await flush();
    expect(loadStudents).toHaveBeenLastCalledWith(expect.objectContaining({ subjectId: subjectRows[0].id }));
    chooseSubject(1);
    await flush();
    expect(page.data.subjectError).toBe('');
    expect(loadStudents).toHaveBeenLastCalledWith(expect.objectContaining({ subjectId: 'UNCLASSIFIED' }));
  });

  it('keeps a later directory failure visible when changing away from a missing subject', async () => {
    page.onLoad();
    await flush();
    chooseSubject(2);
    await flush();
    loadSubjects.mockResolvedValueOnce(subjectSuccess([]));
    await page.loadSubjects();
    expect(page.data.subjectUnavailable).toBe(true);
    loadSubjects.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '目录读取失败' });
    await page.loadSubjects();
    chooseSubject(1);
    await flush();
    expect(page.data).toMatchObject({
      subjectId: 'UNCLASSIFIED', subjectUnavailable: false, subjectError: '科目加载失败，请重试',
    });
  });

  it.each([401, 403].flatMap((code) => ['state', 'reject', 'throw'].map((kind) => ({ code, kind }))))(
    'clears all private data for catalog $kind HTTP $code and stops other in-flight reads', async ({ code, kind }) => {
      await openPhoto();
      const oldList = deferred<unknown>();
      loadStudents.mockReturnValueOnce(oldList.promise);
      const reading = startRead('list');
      page.onSearchInput({ detail: { value: '旧搜索' } });
      const error = Object.assign(new Error('private catalog error'), { statusCode: code });
      if (kind === 'state') loadSubjects.mockResolvedValueOnce({ status: 'error', statusCode: code, message: 'private catalog error' });
      if (kind === 'reject') loadSubjects.mockRejectedValueOnce(error);
      if (kind === 'throw') loadSubjects.mockImplementationOnce(() => { throw error; });
      page.onSubjectsRetry();
      await flush();
      expectCleared();
      const counts = [loadSubjects.mock.calls.length, loadStudents.mock.calls.length, loadStudent.mock.calls.length];
      oldList.resolve(success('late'));
      await reading;
      page.onRetry(); page.onSubjectsRetry(); page.onShow();
      jest.advanceTimersByTime(400);
      await flush();
      expectCleared();
      expect([loadSubjects.mock.calls.length, loadStudents.mock.calls.length, loadStudent.mock.calls.length]).toEqual(counts);
    },
  );

  it.each(['list', 'expanded', 'photo'])('invalidates the catalog cancellation callback after %s access is lost', async (source) => {
    await openPhoto();
    const catalog = deferred<unknown>();
    loadSubjects.mockReturnValueOnce(catalog.promise);
    page.onSubjectsRetry();
    await flush();
    const current = loadSubjects.mock.calls[loadSubjects.mock.calls.length - 1][0];
    expect(current()).toBe(true);
    const reader = source === 'list' ? loadStudents : loadStudent;
    reader.mockResolvedValueOnce({ status: 'error', statusCode: 403, message: '失权' });
    await startRead(source);
    expectCleared();
    expect(current()).toBe(false);
    catalog.resolve(subjectSuccess());
    await flush();
    expectCleared();
  });

  it.each(['onHide', 'onUnload', 'owner', 'logout'])('cancels a queued catalog read after %s before it starts', async (action) => {
    page.onLoad();
    if (action === 'owner') ownerKey = 'new-owner';
    else if (action === 'logout') page.onLogin();
    else page[action]();
    await flush();
    expect(loadSubjects).not.toHaveBeenCalled();
    if (action === 'owner' || action === 'logout') expectCleared();
  });

  it.each(['success', 'error', 'reject'])('clears the owner when a catalog %s arrives without a lifecycle event', async (delivery) => {
    await openPhoto();
    let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
    loadSubjects.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    page.onSubjectsRetry();
    await flush();
    ownerKey = 'new-owner';
    if (delivery === 'reject') reject(Object.assign(new Error('private'), { statusCode: 403 }));
    else resolve(delivery === 'success' ? subjectSuccess() : { status: 'error', statusCode: 401, message: '旧失权' });
    await flush();
    expectCleared();
    expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
  });

  it.each(['onHide', 'onUnload'])('ignores a late catalog and its commands after %s', async (method) => {
    const old = deferred<unknown>();
    loadSubjects.mockReturnValueOnce(old.promise);
    page.onLoad();
    await flush();
    const current = loadSubjects.mock.calls[0][0];
    page[method]();
    const writes = jest.spyOn(page, 'setData').mockClear();
    expect(current()).toBe(false);
    old.resolve(subjectSuccess());
    chooseSubject(1); page.onSubjectsRetry();
    await flush();
    expect(writes).not.toHaveBeenCalled();
    expect(loadSubjects).toHaveBeenCalledTimes(1);
  });

  it.each([200, 401, 403])('does not overwrite the returned catalog or release its lock with an old HTTP %s', async (code) => {
    const old = deferred<unknown>(), fresh = deferred<unknown>();
    loadSubjects.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    page.onLoad();
    page.onShow();
    await flush();
    const oldCurrent = loadSubjects.mock.calls[0][0];
    page.onHide();
    page.onShow();
    await flush();
    expect(oldCurrent()).toBe(false);
    const active = page.subjectPending;
    old.resolve(code === 200 ? subjectSuccess() : { status: 'error', statusCode: code, message: '旧失权' });
    await flush();
    expect(page.subjectPending).toBe(active);
    expect(page.data.subjectsLoading).toBe(true);
    expect(page.data.viewState).toBe('ready');
    fresh.resolve(subjectSuccess([subjectRows[1]]));
    await flush();
    expect(page.data.subjectOptions).toHaveLength(3);
    expect(page.data.subjectOptions[2].value).toBe(subjectRows[1].id);
    expect(page.data.subjectsLoading).toBe(false);
  });

  it('ignores invalid or unchanged subject selections without searching or reloading the catalog', async () => {
    page.onLoad();
    await flush();
    for (const value of ['99', '-1', 'NaN', '1.5', '0']) page.onSubjectChange({ detail: { value } });
    expect(loadStudents).toHaveBeenCalledTimes(1);
    expect(loadSubjects).toHaveBeenCalledTimes(1);
  });

  it('uses a native subject picker with independent retry and wrapping labels above a full-row name search', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/students/index.wxml'), 'utf8');
    const styles = fs.readFileSync(path.resolve(__dirname, '../pages/partner/students/index.wxss'), 'utf8');
    expect(markup).toMatch(/<picker[^>]*range="{{subjectOptions}}"[^>]*range-key="label"[^>]*value="{{subjectIndex}}"[^>]*bindchange="onSubjectChange"/);
    expect(markup).toContain('bindtap="onSubjectsRetry"');
    expect(markup).toContain('{{subjectError}}');
    expect(markup).toContain('students-page__subject-label');
    expect(styles).toMatch(/\.students-page__subject-label\s*\{[^}]*word-break:\s*break-all/);
    expect(styles).toMatch(/\.students-page__filters\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(styles).toMatch(/\.students-page \.partner-search\s*\{[^}]*flex:\s*0 0 100%/);
  });

  it.each([
    'show', 'search', 'balance', 'retry', 'more', 'retry-more', 'toggle',
    'retry-expanded', 'expanded', 'detail', 'photo-error', 'photo-retry', 'subject', 'subject-retry',
  ])('clears the old owner before the %s entry and starts no replacement read', async (entry) => {
    await openPhoto();
    page.data.hasMore = true;
    page.onExpandedPhotoError(photoEvent());
    const counts = [loadStudents.mock.calls.length, loadStudent.mock.calls.length, loadSubjects.mock.calls.length];
    ownerKey = 'synthetic-other-owner';
    if (entry === 'show') page.onShow();
    if (entry === 'search') page.onSearchInput({ detail: { value: '另一姓名' } });
    if (entry === 'balance') page.onBalanceChange({ detail: { value: '2' } });
    if (entry === 'retry') page.onRetry();
    if (entry === 'more') page.onLoadMore();
    if (entry === 'retry-more') page.onRetryMore();
    if (entry === 'toggle') page.onStudentToggle(toggle('new-student'));
    if (entry === 'retry-expanded') page.onRetryExpanded();
    if (entry === 'expanded') await page.loadExpanded('new-student');
    if (entry === 'detail') page.onStudentMore(toggle('new-student'));
    if (entry === 'photo-error') page.onExpandedPhotoError(photoEvent());
    if (entry === 'photo-retry') await page.onRetryExpandedPhoto();
    if (entry === 'subject') chooseSubject(2);
    if (entry === 'subject-retry') page.onSubjectsRetry();
    jest.advanceTimersByTime(400);
    await flush();
    expectCleared();
    expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
    expect([loadStudents.mock.calls.length, loadStudent.mock.calls.length, loadSubjects.mock.calls.length]).toEqual(counts);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it('checks the owner inside a previously scheduled search before changing input or sending a read', async () => {
    await openPhoto();
    page.onSearchInput({ detail: { value: '旧账号姓名' } });
    ownerKey = 'synthetic-other-owner';
    jest.advanceTimersByTime(400);
    await flush();
    expectCleared();
    expect(loadStudents).toHaveBeenCalledTimes(1);
    expect(page.data.activeQuery).toBe('');
  });

  it.each(['list', 'expanded', 'photo'].flatMap((source) =>
    ['success', 'error', 'reject'].map((delivery) => ({ source, delivery })),
  ))('discards a $source $delivery after owner change without a lifecycle event', async ({ source, delivery }) => {
    await openPhoto();
    let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
    const reader = source === 'list' ? loadStudents : loadStudent;
    reader.mockReturnValueOnce(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const reading = startRead(source);
    await flush();
    ownerKey = 'synthetic-other-owner';
    if (delivery === 'reject') reject(Object.assign(new Error('private'), { statusCode: 403 }));
    else resolve(delivery === 'error' ? { status: 'error', statusCode: 401, message: '旧失权' }
      : source === 'list' ? success('late', 2, 2)
        : { status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('/late') } });
    await reading;
    expectCleared();
    expect(page.data.errorMessage).toBe('登录已更新，请重新登录');
  });

  it('cancels a queued photo renewal before it reads with a replacement token', async () => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    const reading = page.onRetryExpandedPhoto();
    ownerKey = 'synthetic-other-owner';
    await reading;
    expectCleared();
    expect(loadStudent).toHaveBeenCalledTimes(1);
  });

  it('checks identity inside the current native navigation failure callback', async () => {
    await openPhoto();
    page.onStudentMore(toggle('new-student'));
    const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    ownerKey = 'synthetic-other-owner';
    fail();
    expectCleared();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it.each(['list', 'expanded', 'photo'].flatMap((source) =>
    [401, 403].map((code) => ({ source, code })),
  ))('cancels delayed search and navigation after $source HTTP $code', async ({ source, code }) => {
    await openPhoto();
    page.onStudentMore(toggle('new-student'));
    const fail = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page.onSearchInput({ detail: { value: '旧搜索' } });
    const reader = source === 'list' ? loadStudents : loadStudent;
    reader.mockResolvedValueOnce({ status: 'error', statusCode: code, message: '旧失权' });
    await startRead(source);
    const counts = [loadStudents.mock.calls.length, loadStudent.mock.calls.length];
    jest.advanceTimersByTime(400);
    fail();
    await flush();
    expectCleared();
    expect([loadStudents.mock.calls.length, loadStudent.mock.calls.length]).toEqual(counts);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it.each([false, true])('stops the page after explicit logout even when navigation throws=%s', async (throws) => {
    await openPhoto();
    const old = deferred<unknown>();
    loadStudents.mockReturnValueOnce(old.promise);
    const reading = startRead('list');
    if (throws) (global as any).wx.reLaunch.mockImplementationOnce(() => { throw new Error('native failure'); });
    try { page.onLogin(); } catch (error) { expect(throws).toBe(true); }
    expect(logout).toHaveBeenCalledTimes(1);
    expectCleared();
    const counts = [loadStudents.mock.calls.length, loadStudent.mock.calls.length];
    old.resolve(success('late', 2, 2));
    await reading;
    page.onRetry(); page.onShow(); page.onStudentToggle(toggle('new-student'));
    await flush();
    expectCleared();
    expect([loadStudents.mock.calls.length, loadStudent.mock.calls.length]).toEqual(counts);
  });

  it.each(['list', 'expanded', 'photo'].flatMap((source) =>
    ['reject', 'throw'].flatMap((kind) => [401, 403].map((code) => ({ source, kind, code }))),
  ))('clears protected rows and expansion for $source $kind HTTP $code', async ({ source, kind, code }) => {
    await openPhoto();
    const reader = source === 'list' ? loadStudents : loadStudent;
    const error = Object.assign(new Error('internal private details'), { statusCode: code });
    if (kind === 'reject') reader.mockRejectedValueOnce(error);
    else reader.mockImplementationOnce(() => { throw error; });
    await expect(startRead(source)).resolves.toBeUndefined();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], expandedId: '', expandedDetail: null,
      loadingMore: false, paginationError: '', expandedPhotoError: '', expandedPhotoRetrying: false,
    });
    expect(page.expansionCache.size).toBe(0);
    expect(page.expansionRequests.size).toBe(0);
    expect(page.data.errorMessage).toBe(code === 401 ? '登录已失效，请重新登录' : '当前账号无权查看本校区学员档案');
    expect(JSON.stringify(page.data)).not.toContain('internal private details');
  });

  it.each(['list', 'expanded', 'photo'].flatMap((source) =>
    [500, '401'].map((code) => ({ source, code })),
  ))('normalizes a synchronous $source failure with status $code without leaking its message', async ({ source, code }) => {
    await openPhoto();
    const reader = source === 'list' ? loadStudents : loadStudent;
    reader.mockImplementationOnce(() => {
      throw Object.assign(new Error('internal private details'), { statusCode: code });
    });
    await expect(startRead(source)).resolves.toBeUndefined();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.items).toHaveLength(1);
    if (source === 'list') expect(page.data.paginationError).toBe('学员档案加载失败，请稍后重试');
    if (source === 'expanded') expect(page.data).toMatchObject({
      expandedState: 'error', expandedDetail: null, expandedError: '学员信息加载失败，请重试',
    });
    if (source === 'photo') expect(page.data).toMatchObject({
      expandedState: 'ready', expandedPhotoError: '照片加载失败，请重试', expandedPhotoRetrying: false,
    });
    expect(JSON.stringify(page.data)).not.toContain('internal private details');
    expect(page.data.loadingMore).toBe(false);
    expect(page.expansionRequests.size).toBe(0);
    expect(page.photoRequest).toBeUndefined();
    if (source === 'list') {
      loadStudents.mockResolvedValueOnce(success('next-student', 2, 2));
      await page.loadStudents(false);
      expect(page.data.paginationError).toBe('');
      expect(page.data.page).toBe(2);
    } else if (source === 'expanded') {
      await page.loadExpanded('new-student');
      expect(page.data.expandedState).toBe('ready');
      expect(page.expansionRequests.size).toBe(0);
    } else {
      await page.onRetryExpandedPhoto();
      expect(page.data.expandedPhotoError).toBe('');
      expect(page.data.expandedPhotoRetrying).toBe(false);
      expect(page.photoRequest).toBeUndefined();
    }
  });

  it('clears a synchronously failed first-page lock and successfully retries without duplicate reads', async () => {
    loadStudents.mockImplementationOnce(() => { throw new Error('private first-page failure'); });
    page.onLoad();
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'error', items: [], loadingMore: false,
      errorMessage: '学员档案加载失败，请稍后重试',
    });
    expect(page.pendingResetRequest).toBeUndefined();
    expect(page.pendingResetKey).toBe('');
    page.onRetry();
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.items).toHaveLength(1);
    expect(page.pendingResetRequest).toBeUndefined();
    expect(loadStudents).toHaveBeenCalledTimes(2);
  });

  it.each(['list', 'expanded', 'photo'].flatMap((source) =>
    [401, 403].map((code) => ({ source, code })),
  ))('ignores an obsolete rejected $source HTTP $code without clearing a newer filter request', async ({ source, code }) => {
    await openPhoto();
    let reject!: (value: unknown) => void;
    const reader = source === 'list' ? loadStudents : loadStudent;
    reader.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const old = startRead(source);
    await flush();
    const current = deferred<unknown>();
    loadStudents.mockReturnValueOnce(current.promise);
    page.onBalanceChange({ detail: { value: '3' } });
    await flush();
    const active = page.pendingResetRequest;
    reject(Object.assign(new Error('old private response'), { statusCode: code }));
    await old;
    expect(page.pendingResetRequest).toBe(active);
    expect(page.data.viewState).toBe('loading');
    expect(page.data.balanceBand).toBe('GT_FIVE');
    expect(page.data.errorMessage).toBe('');
    const calls = loadStudents.mock.calls.length;
    page.loadStudents(true, true);
    await flush();
    expect(loadStudents).toHaveBeenCalledTimes(calls);
    current.resolve(success());
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.expandedId).toBe('new-student');
    expect(page.data.expandedDetail).not.toBeNull();
  });

  it.each([401, 403])('does not clear a returned-page photo retry lock when a hidden old renewal rejects HTTP %s', async (code) => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    let reject!: (value: unknown) => void;
    loadStudent.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const old = page.onRetryExpandedPhoto();
    await flush();
    page.onHide();
    page.onShow();
    await flush();
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: {
        ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('returned-url'),
      },
    });
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page.onExpandedPhotoError(photoEvent('returned-url'));
    const next = deferred<unknown>();
    loadStudent.mockReturnValueOnce(next.promise);
    const fresh = page.onRetryExpandedPhoto();
    await flush();
    reject(Object.assign(new Error('old private denial'), { statusCode: code }));
    await old;
    expect(page.data.viewState).toBe('ready');
    expect(page.data.expandedPhotoRetrying).toBe(true);
    expect(page.photoRequest).toBe(fresh);
    expect(page.onRetryExpandedPhoto()).toBe(fresh);
    expect(loadStudent).toHaveBeenCalledTimes(4);
    next.resolve({
      status: 'success', data: {
        ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('fresh-url'),
      },
    });
    await fresh;
    expect(page.data.expandedDetail.photo.accessUrl).toBe('fresh-url');
    expect(page.data.expandedPhotoRetrying).toBe(false);
    expect(page.photoRequest).toBeUndefined();
  });

  it('binds photo errors to the current media identity and a separate retry control', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/partner/students/index.wxml'), 'utf8');
    expect(markup).toContain('binderror="onExpandedPhotoError"');
    expect(markup).toContain('data-photo-id="{{expandedDetail.photo.id}}"');
    expect(markup).toContain('data-url="{{expandedDetail.photo.accessUrl}}"');
    expect(markup).toContain('bindtap="onRetryExpandedPhoto"');
  });

  it('retains the expanded student facts and renews only the failed photo', async () => {
    await openPhoto();
    const previous = { ...page.data.expandedDetail };
    page.onExpandedPhotoError(photoEvent());
    expect(page.data.expandedPhotoError).toBe('照片加载失败，请重试');
    expect(page.data.expandedState).toBe('ready');
    const refreshed = photo('/media/student-photo?signature=new');
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: refreshed,
        attendance: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0].attendance, attendanceRateBasisPoints: 0 } },
    });
    await page.onRetryExpandedPhoto();
    expect(page.data.expandedDetail).toEqual({ ...previous, photo: refreshed });
    expect(page.data.expandedPhotoError).toBe('');
    expect(page.data.expandedPhotoRetrying).toBe(false);
    expect(loadStudents).toHaveBeenCalledTimes(1);
    page.onStudentToggle(toggle('new-student'));
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(page.data.expandedDetail.photo).toEqual(refreshed);
    expect(loadStudent).toHaveBeenCalledTimes(2);
  });

  it('deduplicates photo retries and does not automatically retry an image failure', async () => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    page.onExpandedPhotoError(photoEvent());
    expect(loadStudent).toHaveBeenCalledTimes(1);
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    const first = page.onRetryExpandedPhoto();
    const second = page.onRetryExpandedPhoto();
    await flush();
    expect(page.data.expandedPhotoRetrying).toBe(true);
    expect(loadStudent).toHaveBeenCalledTimes(2);
    pending.resolve({ status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('new-url') } });
    await Promise.all([first, second]);
    expect(page.data.expandedPhotoRetrying).toBe(false);
  });

  it.each([500, 'reject'])('preserves summary and failure placeholder when photo renewal fails with %s', async (kind) => {
    await openPhoto();
    const previous = page.data.expandedDetail;
    page.onExpandedPhotoError(photoEvent());
    if (kind === 'reject') loadStudent.mockRejectedValueOnce(new Error('internal signed secret'));
    else loadStudent.mockResolvedValueOnce({ status: 'error', statusCode: kind, message: 'internal signed secret' });
    await page.onRetryExpandedPhoto();
    expect(page.data.expandedDetail).toBe(previous);
    expect(page.data.expandedState).toBe('ready');
    expect(page.data.expandedPhotoError).toBe('照片加载失败，请重试');
    expect(page.data.expandedPhotoRetrying).toBe(false);
  });

  it.each([401, 403])('clears protected student content after photo renewal HTTP %s', async (statusCode) => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode, message: '拒绝访问' });
    await page.onRetryExpandedPhoto();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], expandedDetail: null, expandedId: '',
      expandedPhotoError: '', expandedPhotoRetrying: false,
    });
  });

  it('treats a removed photo as no photo and ignores stale errors from its old URL', async () => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: null },
    });
    await page.onRetryExpandedPhoto();
    expect(page.data.expandedDetail.photo).toBeNull();
    page.onExpandedPhotoError(photoEvent());
    expect(page.data.expandedPhotoError).toBe('');
  });

  it('ignores errors from a previous photo URL after successful renewal', async () => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('new-url') },
    });
    await page.onRetryExpandedPhoto();
    page.onExpandedPhotoError(photoEvent());
    expect(page.data.expandedPhotoError).toBe('');
    expect(page.data.expandedDetail.photo.accessUrl).toBe('new-url');
  });

  it('does not extend the cached student facts when renewing only a photo', async () => {
    await openPhoto();
    jest.advanceTimersByTime(7 * 60_000);
    page.onExpandedPhotoError(photoEvent());
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('new-url') },
    });
    await page.onRetryExpandedPhoto();
    jest.advanceTimersByTime(4 * 60_000);
    page.onStudentToggle(toggle('new-student'));
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(3);
  });

  it('rejects a renewed payload for another student', async () => {
    await openPhoto();
    const previous = page.data.expandedDetail;
    page.onExpandedPhotoError(photoEvent());
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'foreign-student', photo: photo('foreign-url') },
    });
    await page.onRetryExpandedPhoto();
    expect(page.data.expandedDetail).toBe(previous);
    expect(page.data.expandedPhotoError).toBe('照片加载失败，请重试');
  });

  it.each([404, 'empty'])('clears unavailable expanded detail after photo renewal %s', async (kind) => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    loadStudent.mockResolvedValueOnce(kind === 'empty'
      ? { status: 'empty', data: PARTNER_STUDENT_DETAILS_FIXTURE[0] }
      : { status: 'error', statusCode: 404, message: '不存在' });
    await page.onRetryExpandedPhoto();
    expect(page.data).toMatchObject({
      viewState: 'ready', expandedState: 'empty', expandedDetail: null,
      expandedPhotoError: '', expandedPhotoRetrying: false,
    });
    expect(page.expansionCache.has('new-student')).toBe(false);
  });

  it('does not start a queued photo renewal after immediate hide', async () => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    const retry = page.onRetryExpandedPhoto();
    page.onHide();
    await retry;
    expect(loadStudent).toHaveBeenCalledTimes(1);
  });

  it('does not clear the new student retry lock when an old photo request finishes', async () => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    const old = deferred<unknown>();
    loadStudent.mockReturnValueOnce(old.promise);
    const oldRetry = page.onRetryExpandedPhoto();
    await flush();
    page.setData({ items: [...page.data.items, { ...page.data.items[0], id: 'other' }] });
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'other', photo: photo('other-url', 'photo-2') },
    });
    page.onStudentToggle(toggle('other'));
    await flush();
    page.onExpandedPhotoError({ currentTarget: { dataset: { id: 'other', photoId: 'photo-2', url: 'other-url' } } });
    const fresh = deferred<unknown>();
    loadStudent.mockReturnValueOnce(fresh.promise);
    const newRetry = page.onRetryExpandedPhoto();
    await flush();
    old.resolve({ status: 'error', statusCode: 403, message: '旧请求拒绝' });
    await oldRetry;
    expect(page.data.expandedPhotoRetrying).toBe(true);
    expect(page.data.viewState).toBe('ready');
    page.onRetryExpandedPhoto();
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(4);
    fresh.resolve({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'other', photo: photo('fresh-url', 'photo-2') },
    });
    await newRetry;
    expect(page.data.expandedPhotoRetrying).toBe(false);
    expect(page.data.expandedDetail.photo.accessUrl).toBe('fresh-url');
  });

  it.each(['onHide', 'onUnload', 'filter', 'collapse'])('discards a late photo renewal after %s', async (action) => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    const retry = page.onRetryExpandedPhoto();
    await flush();
    if (action === 'filter') page.onBalanceChange({ detail: { value: '3' } });
    else if (action === 'collapse') page.onStudentToggle(toggle('new-student'));
    else page[action]();
    await flush();
    const writes = jest.spyOn(page, 'setData');
    pending.resolve({ status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('late-url') } });
    await retry;
    expect(writes).not.toHaveBeenCalled();
  });

  it('loads only the expanded student, deduplicates requests and reuses the local cache', async () => {
    page.onLoad();
    await flush();
    expect(loadStudent).not.toHaveBeenCalled();
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    page.onStudentToggle(toggle('new-student'));
    expect(page.data.expandedId).toBe('new-student');
    page.onStudentToggle(toggle('new-student'));
    page.onStudentToggle(toggle('new-student'));
    expect(loadStudent).toHaveBeenCalledTimes(1);
    pending.resolve({ status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student' } });
    await flush();
    expect(page.data.expandedDetail.attendanceRateLabel).toBe('100%');
    page.onStudentToggle(toggle('new-student'));
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(1);
    expect(page.data.expandedState).toBe('ready');
  });

  it('renews a retained expansion after filtering and ignores its obsolete detail response', async () => {
    page.onLoad();
    await flush();
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    page.onStudentToggle(toggle('new-student'));
    page.onBalanceChange({ detail: { value: '3' } });
    await flush();
    pending.resolve({ status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student' } });
    await flush();
    expect(page.data.expandedId).toBe('new-student');
    expect(page.data.expandedState).toBe('ready');
    page.onStudentToggle(toggle('new-student'));
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(2);
  });

  it.each(['balance', 'search'])('retains a matching expanded student after %s filtering with fresh facts', async (filter) => {
    await openPhoto();
    const next = deferred<unknown>();
    loadStudents.mockReturnValueOnce(next.promise);
    loadStudent.mockResolvedValueOnce({
      status: 'success',
      data: {
        ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: null,
        attendance: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0].attendance, attendanceRateBasisPoints: 0 },
      },
    });
    if (filter === 'balance') page.onBalanceChange({ detail: { value: '2' } });
    else {
      page.onSearchInput({ detail: { value: ' 林 ' } });
      jest.advanceTimersByTime(300);
    }
    expect(page.data.expandedDetail).toBeNull();
    expect(page.expansionCache.size).toBe(0);
    expect(loadStudent).toHaveBeenCalledTimes(1);
    next.resolve(success());
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', expandedId: 'new-student', expandedState: 'ready',
      expandedDetail: { photo: null, attendanceRateLabel: '0%' },
    });
    expect(loadStudent).toHaveBeenCalledTimes(2);
    expect(loadStudents).toHaveBeenLastCalledWith({
      page: 1, pageSize: 20, balanceBand: filter === 'balance' ? 'LTE_FIVE' : 'ALL',
      ...(filter === 'search' ? { query: '林' } : {}),
    });
  });

  it('retains only the latest matching selection through consecutive pending filters', async () => {
    await openPhoto();
    const old = deferred<unknown>();
    loadStudents.mockReturnValueOnce(old.promise).mockResolvedValueOnce(success());
    page.onBalanceChange({ detail: { value: '2' } });
    page.onBalanceChange({ detail: { value: '3' } });
    await flush();
    expect(page.data.expandedId).toBe('new-student');
    expect(loadStudent).toHaveBeenCalledTimes(2);
    old.resolve(success('obsolete'));
    await flush();
    expect(page.data.items[0].id).toBe('new-student');
    expect(page.data.expandedId).toBe('new-student');
    expect(page.data.balanceBand).toBe('GT_FIVE');
    expect(loadStudent).toHaveBeenCalledTimes(2);
  });

  it.each(['removed', 'empty', 401, 403, 500])('clears a previous selection without requesting its detail when filtered results are %s', async (kind) => {
    await openPhoto();
    const result = kind === 'removed' ? success('other-student')
      : kind === 'empty' ? {
        status: 'empty', data: { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
      } : { status: 'error', statusCode: kind, message: '合成筛选失败' };
    loadStudents.mockResolvedValueOnce(result);
    page.onBalanceChange({ detail: { value: '2' } });
    await flush();
    expect(page.data.expandedId).toBe('');
    expect(page.data.expandedDetail).toBeNull();
    expect(page.expansionCache.size).toBe(0);
    expect(loadStudent).toHaveBeenCalledTimes(1);
  });

  it('does not restore a matching filtered expansion after the page hides', async () => {
    await openPhoto();
    const next = deferred<unknown>();
    loadStudents.mockReturnValueOnce(next.promise);
    page.onBalanceChange({ detail: { value: '2' } });
    page.onHide();
    const writes = jest.spyOn(page, 'setData').mockClear();
    next.resolve(success());
    await flush();
    expect(writes).not.toHaveBeenCalled();
    expect(loadStudent).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary refresh collapsed instead of joining a pending preserve-expansion filter', async () => {
    await openPhoto();
    const filtered = deferred<unknown>();
    const refreshed = deferred<unknown>();
    loadStudents.mockReturnValueOnce(filtered.promise).mockReturnValueOnce(refreshed.promise);
    page.onBalanceChange({ detail: { value: '2' } });
    page.onPullDownRefresh();
    expect(loadStudents).toHaveBeenCalledTimes(3);
    refreshed.resolve(success());
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', expandedId: '', expandedDetail: null, expandedState: 'idle',
    });
    filtered.resolve(success());
    await flush();
    expect(page.data.expandedId).toBe('');
    expect(loadStudent).toHaveBeenCalledTimes(1);
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it.each([200, 401, 403])('ignores an obsolete detail status %s after a matching filter renews the expansion', async (status) => {
    page.onLoad();
    await flush();
    const old = deferred<unknown>();
    loadStudent.mockReturnValueOnce(old.promise).mockResolvedValueOnce({
      status: 'success',
      data: {
        ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: null,
        attendance: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0].attendance, attendanceRateBasisPoints: 0 },
      },
    });
    page.onStudentToggle(toggle('new-student'));
    page.onBalanceChange({ detail: { value: '2' } });
    await flush();
    expect(page.data.expandedDetail.attendanceRateLabel).toBe('0%');
    old.resolve(status === 200 ? {
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student' },
    } : { status: 'error', statusCode: status, message: '旧请求拒绝' });
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', expandedId: 'new-student',
      expandedDetail: { attendanceRateLabel: '0%' },
    });
  });

  it.each([200, 401, 403])('ignores an obsolete photo renewal status %s after filtering', async (status) => {
    await openPhoto();
    page.onExpandedPhotoError(photoEvent());
    const old = deferred<unknown>();
    loadStudent.mockReturnValueOnce(old.promise);
    const retry = page.onRetryExpandedPhoto();
    await flush();
    loadStudent.mockResolvedValueOnce({
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: null },
    });
    page.onBalanceChange({ detail: { value: '2' } });
    await flush();
    old.resolve(status === 200 ? {
      status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student', photo: photo('obsolete-url') },
    } : { status: 'error', statusCode: status, message: '旧请求拒绝' });
    await retry;
    expect(page.data).toMatchObject({
      viewState: 'ready', expandedDetail: { photo: null }, expandedPhotoError: '', expandedPhotoRetrying: false,
    });
  });

  it('does not request the retained expansion again when loading another result page', async () => {
    await openPhoto();
    loadStudents.mockResolvedValueOnce(success('new-student', 1, 2));
    page.onBalanceChange({ detail: { value: '2' } });
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(2);
    loadStudents.mockResolvedValueOnce(success('other-student', 2, 2));
    page.onLoadMore();
    await flush();
    expect(page.data.expandedId).toBe('new-student');
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['new-student', 'other-student']);
    expect(loadStudent).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403])('clears both rows and expanded detail after HTTP %s', async (statusCode) => {
    page.onLoad();
    await flush();
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode, message: '无权访问' });
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.items).toEqual([]);
    expect(page.data.expandedDetail).toBeNull();
  });

  it('retries a failed expansion and only navigates for a currently loaded student', async () => {
    page.onLoad();
    await flush();
    loadStudent.mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '网络失败' });
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(page.data.expandedError).toBe('网络失败');
    expect(page.data.items).toHaveLength(1);
    page.onRetryExpanded();
    await flush();
    expect(page.data.expandedState).toBe('ready');
    page.onStudentMore(toggle('foreign'));
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    page.onStudentMore(toggle('new-student'));
    expect((global as any).wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/partner/student-detail/index?id=new-student',
    }));
  });

  it.each(['onHide', 'onUnload'])('ignores search, balance and detail commands after %s', async (method) => {
    page.onLoad();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page[method]();
    const writes = jest.spyOn(page, 'setData');
    page.onSearchInput({ detail: { value: '隐藏输入' } });
    page.onBalanceChange({ detail: { value: '2' } });
    page.onStudentMore(toggle('new-student'));
    jest.advanceTimersByTime(400);
    await flush();
    expect(writes).not.toHaveBeenCalled();
    expect(loadStudents).toHaveBeenCalledTimes(1);
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it.each(['loading', 'error', 'empty', 'forbidden'])('does not navigate from %s even with stale detail data', async (viewState) => {
    page.onLoad();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page.setData({ viewState });
    page.onStudentMore(toggle('new-student'));
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
  });

  it('requires the current ready expansion and merges repeated detail navigation', async () => {
    page.onLoad();
    await flush();
    page.onStudentMore(toggle('new-student'));
    expect((global as any).wx.navigateTo).not.toHaveBeenCalled();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page.onStudentMore(toggle('new-student'));
    page.onStudentMore(toggle('new-student'));
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(1);
  });

  it('releases a failed navigation and sanitizes synchronous exceptions', async () => {
    page.onLoad();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page.onStudentMore(toggle('new-student'));
    (global as any).wx.navigateTo.mock.calls[0][0].fail({ errMsg: 'internal details' });
    expect((global as any).wx.showToast).toHaveBeenCalledWith({
      title: '页面打开失败，请重试', icon: 'none',
    });
    (global as any).wx.navigateTo.mockImplementationOnce(() => { throw new Error('internal details'); });
    expect(() => page.onStudentMore(toggle('new-student'))).not.toThrow();
    page.onStudentMore(toggle('new-student'));
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(3);
  });

  it('ignores an old navigation failure after returning and opening a new detail', async () => {
    page.onLoad();
    page.onShow();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page.onStudentMore(toggle('new-student'));
    const oldFailure = (global as any).wx.navigateTo.mock.calls[0][0].fail;
    page.onHide();
    page.onShow();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page.onStudentMore(toggle('new-student'));
    oldFailure();
    page.onStudentMore(toggle('new-student'));
    expect((global as any).wx.navigateTo).toHaveBeenCalledTimes(2);
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });

  it('does not cache or render hidden expansion responses', async () => {
    page.onLoad();
    await flush();
    const pending = deferred<unknown>();
    loadStudent.mockReturnValueOnce(pending.promise);
    page.onStudentToggle(toggle('new-student'));
    page.onHide();
    const update = jest.spyOn(page, 'setData').mockClear();
    pending.resolve({ status: 'success', data: { ...PARTNER_STUDENT_DETAILS_FIXTURE[0], id: 'new-student' } });
    await flush();
    expect(update).not.toHaveBeenCalled();
  });

  it('isolates expansion caches between page instances and refreshes expired photo capabilities', async () => {
    page.onLoad();
    await flush();
    page.onStudentToggle(toggle('new-student'));
    await flush();
    page.onStudentToggle(toggle('new-student'));
    jest.advanceTimersByTime(10 * 60_000 + 1);
    page.onStudentToggle(toggle('new-student'));
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(2);
    const other = instantiate(definition);
    other.onLoad();
    await flush();
    other.onStudentToggle(toggle('new-student'));
    await flush();
    expect(loadStudent).toHaveBeenCalledTimes(3);
    other.onUnload();
  });

  it('reuses an in-flight first page for identical foreground and pull refresh requests', async () => {
    const pending = deferred<unknown>();
    loadStudents.mockReturnValueOnce(pending.promise);
    page.onLoad();
    page.onShow();
    page.onPullDownRefresh();
    page.onPullDownRefresh();
    expect(loadStudents).toHaveBeenCalledTimes(1);
    pending.resolve(success());
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });

  it('does not let a hidden old pull request stop the returned page refresh', async () => {
    await openPhoto();
    const old = deferred<unknown>(), fresh = deferred<unknown>();
    loadStudents.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    page.onPullDownRefresh();
    page.onHide();
    page.onShow();
    page.onPullDownRefresh();
    old.resolve(success('old'));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    fresh.resolve(success('fresh'));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data.items[0].id).toBe('fresh');
  });

  it('does not stop another page refresh when its old pull completes after unload', async () => {
    await openPhoto();
    const old = deferred<unknown>();
    loadStudents.mockReturnValueOnce(old.promise);
    page.onPullDownRefresh();
    page.onUnload();
    old.resolve(success('old'));
    await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
  });

  it('invalidates hidden responses and refreshes the preserved input on return', async () => {
    const pending = deferred<unknown>();
    loadStudents.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(success('returned'));
    page.onLoad();
    page.onShow();
    page.onSearchInput({ detail: { value: ' 林 ' } });
    page.onHide();
    const update = jest.spyOn(page, 'setData');
    update.mockClear();
    pending.resolve(success('hidden'));
    jest.advanceTimersByTime(400);
    await flush();
    expect(update).not.toHaveBeenCalled();
    page.onShow();
    await flush();
    expect(loadStudents).toHaveBeenLastCalledWith({
      page: 1, pageSize: 20, query: '林', balanceBand: 'ALL',
    });
    expect(page.data.items[0].id).toBe('returned');
  });

  it('ignores a stale response after changing the balance filter', async () => {
    const old = deferred<unknown>();
    loadStudents.mockReturnValueOnce(old.promise).mockResolvedValueOnce(success('filtered'));
    page.onLoad();
    page.onBalanceChange({ detail: { value: '3' } });
    await flush();
    old.resolve(success('stale'));
    await flush();
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['filtered']);
    expect(page.data.balanceBand).toBe('GT_FIVE');
  });

  it('retains existing rows on a failed next page and retries that page', async () => {
    loadStudents.mockResolvedValueOnce(success('first', 1, 2))
      .mockResolvedValueOnce({ status: 'error', statusCode: 500, message: '网络暂不可用' })
      .mockResolvedValueOnce(success('second', 2, 2));
    page.onLoad();
    await flush();
    page.onLoadMore();
    await flush();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['first']);
    expect(page.data.paginationError).toBe('网络暂不可用');
    page.onRetryMore();
    await flush();
    expect(loadStudents).toHaveBeenLastCalledWith({ page: 2, pageSize: 20, balanceBand: 'ALL' });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['first', 'second']);
  });

  it.each([401, 403])('clears sensitive rows after a %s next-page response', async (statusCode) => {
    loadStudents.mockResolvedValueOnce(success('first', 1, 2))
      .mockResolvedValueOnce({ status: 'error', statusCode, message: '无权访问' });
    page.onLoad();
    await flush();
    page.onLoadMore();
    await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.items).toEqual([]);
    expect(page.data.total).toBe(0);
    expect(page.data.hasMore).toBe(false);
  });

  it('does not write late results or issue delayed searches after unload', async () => {
    const old = deferred<unknown>();
    loadStudents.mockReturnValueOnce(old.promise);
    page.onLoad();
    page.onSearchInput({ detail: { value: '林' } });
    page.onUnload();
    const update = jest.spyOn(page, 'setData');
    update.mockClear();
    old.resolve(success());
    jest.advanceTimersByTime(400);
    await flush();
    expect(update).not.toHaveBeenCalled();
    expect(loadStudents).toHaveBeenCalledTimes(1);
  });

  it('isolates two instances of the same registered page definition', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    loadStudents.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const other = instantiate(definition);
    page.onLoad();
    other.onLoad();
    second.resolve(success('second'));
    await flush();
    first.resolve(success('first'));
    await flush();
    expect(page.data.items[0].id).toBe('first');
    expect(other.data.items[0].id).toBe('second');
    other.onUnload();
  });

  it('merges concurrent load-more requests and rejects invalid picker values', async () => {
    loadStudents.mockResolvedValueOnce(success('first', 1, 2));
    page.onLoad();
    await flush();
    const next = deferred<unknown>();
    loadStudents.mockReturnValueOnce(next.promise);
    page.onLoadMore();
    page.onLoadMore();
    page.onBalanceChange({ detail: { value: '99' } });
    expect(loadStudents).toHaveBeenCalledTimes(2);
    next.resolve(success('second', 2, 2));
    await flush();
  });
});
