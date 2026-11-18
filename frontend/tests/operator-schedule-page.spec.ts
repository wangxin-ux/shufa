import { buildOperatorLessonItems } from '../pages/operator/runtime/services/operator-schedule.presenter';
import { capture, flush, tap } from './operator-page-host';
import { lesson as sourceLesson } from './operator-schedule.fixture';
const uuid = (value: number) => `64000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const lesson = { ...sourceLesson, id: uuid(1), campusId: uuid(100), classGroupId: uuid(200), teacherId: uuid(300) };
const rows = (first: number, count = 20) => Array.from({ length: count }, (_, index) =>
  ({ ...lesson, id: uuid(first + index) }));
type Env = ReturnType<typeof capture>;
function list(env: Env, index: number, data = [lesson], page = 1, total = data.length) {
  env.reply(index, { data, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) } });
}
async function loaded(total = 1) {
  const env = capture(['schedule']);
  const page = env.instantiate(); page.onLoad(); page.onShow?.(); await flush();
  list(env, 0, rows(1, Math.min(total, 20)), 1, total); await flush();
  return { env, page };
}
function edit(page: any) { page.onEditTap(tap(lesson.id)); }
const preview = {
  seriesId: null, previewHash: 'b'.repeat(64),
  sessions: [{ id: lesson.id, version: lesson.version, startsAt: lesson.startsAt, endsAt: lesson.endsAt }],
};
const cancelled = { seriesId: null, sessions: preview.sessions.map(row => ({ ...row, version: row.version + 1, status: 'CANCELLED' })) };
async function prepareCancellation(env: Env, page: any) {
  const index = env.calls.length;
  page.onCancelTap(tap(lesson.id));
  await flush();
  expect(env.calls[index]).toMatchObject({
    url: `https://operator.example.test/operators/me/lesson-sessions/${lesson.id}/cancellation-preview`,
    method: 'POST', data: { mode: 'THIS' },
  });
  expect(env.calls[index].header['Idempotency-Key']).toBeUndefined();
  env.reply(index, { data: preview }); await flush();
  expect(page.data.cancellation.preview).toEqual(preview);
}
async function cancel(env: Env, page: any) {
  await prepareCancellation(env, page);
  page.onConfirmCancellation();
  const calls = env.platform.showModal.mock.calls;
  calls[calls.length - 1][0].success({ confirm: true });
  await flush();
}

afterEach(() => jest.useRealTimers());

it('opens the standalone editor for create and locks repeated navigation', async () => {
  const { env, page } = await loaded();
  try {
    page.onCreateTap(); page.onCreateTap();
    expect(env.platform.navigateTo).toHaveBeenCalledTimes(1);
    expect(env.platform.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/operator/schedule-editor/index',
    }));
  } finally { env.close(); }
});

it('opens the standalone editor with the selected lesson ID', async () => {
  const { env, page } = await loaded();
  try {
    edit(page);
    expect(env.platform.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: `/pages/operator/schedule-editor/index?mode=edit&id=${lesson.id}`,
    }));
  } finally { env.close(); }
});

it('keeps two Page instances and list reads independent without loading form options', async () => {
  const env = capture(['schedule']);
  try {
    const first = env.instantiate(); first.onLoad(); first.onShow?.(); await flush();
    const second = env.instantiate(); second.onLoad(); second.onShow?.(); await flush();
    expect(env.calls).toHaveLength(2);
    list(env, 1, [{ ...lesson, id: uuid(2) }]);
    list(env, 0); await flush();
    expect(first.data.items[0]?.id).toBe(lesson.id);
    expect(second.data.items[0]?.id).toBe(uuid(2));
    expect(env.calls.every((call) => !call.url.includes('scheduling-options'))).toBe(true);
  } finally { env.close(); }
});

it('rejects late date/status reads and uses Shanghai half-open day ranges', async () => {
  const { env, page } = await loaded();
  try {
    page.onFilterDateChange({ detail: { value: '2040-02-29' } }); await flush();
    page.onStatusChange({ detail: { value: '5' } }); await flush();
    const query = new URL(env.calls[2].url).searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      from: '2040-02-29T00:00:00+08:00', to: '2040-03-01T00:00:00+08:00', status: 'CANCELLED',
    });
    list(env, 2, [{ ...lesson, status: 'CANCELLED', version: 2 }]); await flush();
    list(env, 1); await flush();
    expect(page.data.items[0]).toMatchObject({ statusLabel: '已取消', canManage: false });
  } finally { env.close(); }
});

it('retains page one on page-two failure and retries the same page', async () => {
  const { env, page } = await loaded(41);
  try {
    page.onLoadMore(); await flush(); env.reply(1, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', page: 1, total: 41, hasMore: true, loadingMore: false });
    expect(page.data.items[0].id).toBe(lesson.id);
    expect(page.data.loadMoreError).toBeTruthy();
    page.onLoadMore(); await flush();
    expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('2');
    list(env, 2, rows(21), 2, 41); await flush();
    expect(page.data.items).toHaveLength(40);
    expect(page.data.items[20].id).toBe(uuid(21));
  } finally { env.close(); }
});

it('clears private rows on hide and retains the committed filter on a failed return read', async () => {
  const { env, page } = await loaded();
  try {
    page.onStatusChange({ detail: { value: '1' } }); await flush(); list(env, 1); await flush();
    page.onHide?.();
    expect(page.data.items).toEqual([]);
    page.onShow?.(); await flush();
    expect(new URL(env.calls[2].url).searchParams.get('status')).toBe('SCHEDULED');
    env.reply(2, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'error', statusIndex: 1 });
    expect(page.data.errorMessage).toBeTruthy();
    expect(page.data.items).toEqual([]);
  } finally { env.close(); }
});

it('releases only the current navigation lock and reports a saved record omitted by the filter', async () => {
  const { env, page } = await loaded();
  try {
    page.onCreateTap();
    const old = env.platform.navigateTo.mock.calls[0][0];
    old.fail({}); page.onCreateTap();
    expect(env.platform.navigateTo).toHaveBeenCalledTimes(2);
    page.onHide(); old.fail({});
    old.events.scheduleSaved({ id: lesson.id });
    page.onShow(); await flush();
    list(env, 1, []); await flush();
    expect(page.data.savedNotice).toContain('课次已保存');
    expect(page.data.savedNotice).toContain('当前列表未显示');
    page.onCreateTap();
    old.fail({});
    expect(page.data.navigating).toBe(true);
  } finally { env.close(); }
});

it.each([401, 403])('clears all private list state on current read %s', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onRetry(); await flush();
    env.reply(1, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], savedNotice: '', filterDate: '' });
    expect(page.data.items).toEqual([]);
    page.onRetry(); page.onCreateTap(); page.onCancelTap(tap(lesson.id)); await flush();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('captures the new runtime owner and ignores stale reads, modals and logout from the old owner', async () => {
  const { env, page } = await loaded();
  try {
    await prepareCancellation(env, page);
    page.onConfirmCancellation();
    const modal = env.platform.showModal.mock.calls[0][0];
    env.change({ apiBaseUrl: 'https://current.example.test', accessToken: 'synthetic-owner-b' });
    const fresh = env.instantiate(); fresh.onLoad(); fresh.onShow?.(); await flush();
    expect(env.calls[2]).toMatchObject({
      url: 'https://current.example.test/operators/me/lesson-sessions?page=1&pageSize=20',
      header: { Authorization: 'Bearer synthetic-owner-b' },
    });
    list(env, 2); modal.success({ confirm: true }); await flush();
    expect(env.calls).toHaveLength(3);
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(0);
    expect(page.data.viewState).toBe('forbidden');
    page.onLogin?.();
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-owner-b');
  } finally { env.close(); }
});

it('locks cancel confirmation and rejects it after filter changes or hide, then releases after native failure', async () => {
  const { env, page } = await loaded();
  try {
    await prepareCancellation(env, page);
    page.onConfirmCancellation(); page.onConfirmCancellation();
    expect(env.platform.showModal).toHaveBeenCalledTimes(1);
    const old = env.platform.showModal.mock.calls[0][0];
    page.onClearFilterDate(); await flush(); old.success({ confirm: true }); await flush();
    expect(env.calls).toHaveLength(3);
    list(env, 2); await flush();
    await prepareCancellation(env, page);
    page.onConfirmCancellation();
    const hidden = env.platform.showModal.mock.calls[1][0];
    page.onHide?.(); hidden.success({ confirm: true }); await flush();
    expect(env.calls).toHaveLength(4);
    page.onShow?.(); await flush(); list(env, 4); await flush();
    await prepareCancellation(env, page);
    env.platform.showModal.mockImplementationOnce(() => { throw new Error('synthetic modal failure'); });
    expect(() => page.onConfirmCancellation()).not.toThrow();
    page.onConfirmCancellation();
    expect(env.platform.showModal).toHaveBeenCalledTimes(4);
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(0);
  } finally { env.close(); }
});

it('allows only future scheduled records at read time and rechecks the clock before confirmation', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2040-02-01T05:59:00Z'));
  const { env, page } = await loaded();
  try {
    expect(buildOperatorLessonItems([
      { ...lesson, startsAt: '2040-02-01T05:00:00Z' }, { ...lesson, status: 'IN_PROGRESS' },
    ]).every((item) => !item.canManage)).toBe(true);
    jest.setSystemTime(new Date('2040-02-01T06:00:00Z'));
    edit(page); page.onCancelTap(tap(lesson.id));
    expect(env.platform.navigateTo).not.toHaveBeenCalled();
    expect(env.platform.showModal).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it.each([401, 403])('clears state on a cancel %s and does not allow a stale operation to retry', async (status) => {
  const { env, page } = await loaded();
  try {
    await cancel(env, page); env.reply(2, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], recoveryAvailable: false });
    page.onRetryWrite(); page.onCancelTap(tap(lesson.id)); await flush();
    expect(env.calls).toHaveLength(3);
  } finally { env.close(); }
});

it('re-reads after version conflict and removes terminal record actions', async () => {
  const { env, page } = await loaded();
  try {
    await cancel(env, page);
    expect(env.calls[2]).toMatchObject({ method: 'POST',
      url: `https://operator.example.test/operators/me/lesson-sessions/${lesson.id}/cancel-selection`,
      data: { mode: 'THIS', previewHash: preview.previewHash } });
    expect(preview.sessions[0].version).toBe(1);
    env.reply(2, { error: { code: 'LESSON_VERSION_CONFLICT', message: '课次已变化' } }, 409); await flush();
    expect(env.calls[3].method).toBe('GET');
    list(env, 3, [{ ...lesson, status: 'CANCELLED', version: 2 }]); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready' });
    expect(page.data.items[0].canManage).toBe(false);
  } finally { env.close(); }
});

it('keeps in-flight writes locked while hidden, shows their result on return and never automatically resends', async () => {
  const { env, page } = await loaded();
  try {
    await cancel(env, page); page.onHide?.();
    env.reply(2, { data: cancelled }); await flush();
    expect(env.platform.showToast).not.toHaveBeenCalled();
    expect(env.calls).toHaveLength(3);
    page.onShow?.(); await flush();
    expect(page.data.submitting).toBe(false);
    expect(env.calls.filter((call) => call.url.endsWith('/cancel-selection'))).toHaveLength(1);
    list(env, 3); await flush();
  } finally { env.close(); }
});

it('keeps an uncertain cancellation recoverable after time passes and retains its exact version and key', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2040-02-01T05:59:00Z'));
  const { env, page } = await loaded();
  try {
    await cancel(env, page);
    const original = env.calls[2];
    original.fail(new Error('synthetic unknown cancel')); await flush();
    expect(page.data.recoveryAvailable).toBe(true);
    jest.setSystemTime(new Date('2040-02-01T06:01:00Z'));
    page.onRetry(); await flush(); list(env, 3); await flush();
    expect(page.data.items[0].canManage).toBe(false);
    page.onRetryWrite?.(); await flush();
    expect(env.calls[4]).toMatchObject({ method: 'GET',
      url: 'https://operator.example.test/operators/me/lesson-sessions?page=1&pageSize=20' });
    expect(page.data.recoveryReady).toBe(false);
    list(env, 4, [{ ...lesson, status: 'CANCELLED', version: 2 }]); await flush();
    expect(page.data.recoveryReady).toBe(true);
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(1);
    expect(preview.sessions[0].version).toBe(1);
    page.onRetryWrite?.(); await flush();
    expect(env.calls[5]).toMatchObject({
      url: original.url, method: 'POST', data: { mode: 'THIS', previewHash: preview.previewHash },
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] },
    });
    env.reply(5, { data: cancelled }); await flush();
    list(env, 6, [{ ...lesson, status: 'CANCELLED', version: 2 }]); await flush();
    expect(page.data.recoveryAvailable).toBe(false);
  } finally { env.close(); }
});

it('supersedes paging on pull, rejects hidden reads and leaves the new pull indicator alone', async () => {
  const { env, page } = await loaded(41);
  try {
    page.onLoadMore(); await flush();
    page.onPullDownRefresh(); await flush();
    expect(env.calls).toHaveLength(3);
    list(env, 1, rows(21), 2, 41); await flush();
    page.onHide?.();
    page.onShow?.(); page.onPullDownRefresh(); await flush();
    const count = page.setData.mock.calls.length;
    list(env, 2, []); await flush();
    expect(page.setData).toHaveBeenCalledTimes(count);
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    list(env, 3); await flush();
    expect(env.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual([lesson.id]);
    page.onRetry(); await flush(); page.onUnload?.();
    const disposed = page.setData.mock.calls.length;
    list(env, 4); await flush();
    expect(page.setData).toHaveBeenCalledTimes(disposed);
  } finally { env.close(); }
});

it('forces a fresh list read after a write instead of accepting an already in-flight snapshot', async () => {
  const { env, page } = await loaded();
  try {
    await cancel(env, page);
    page.onRetry(); await flush();
    env.reply(2, { data: cancelled }); await flush();
    expect(env.calls).toHaveLength(5);
    list(env, 3, []); await flush();
    expect(page.data.items).toHaveLength(1);
    list(env, 4, [{ ...lesson, id: uuid(2) }]); await flush();
    expect(page.data.items[0].id).toBe(uuid(2));
  } finally { env.close(); }
});

it.each([401, 403])('clears a hidden cancel %s before return', async (status) => {
  const { env, page } = await loaded();
  try {
    await cancel(env, page); page.onHide();
    env.reply(2, {}, status); await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], recoveryAvailable: false, filterDate: '',
    });
    page.onShow(); await flush();
    expect(env.calls).toHaveLength(3);
  } finally { env.close(); }
});

it.each([401, 403])(
  'clears hidden read %s before a late success can restore data',
  async (status) => {
    const { env, page } = await loaded(41);
    try {
      page.onLoadMore(); await flush();
      page.onRetry(); await flush(); page.onHide();
      env.reply(1, {}, status); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], filterDate: '' });
      list(env, 2); await flush(); page.onShow(); await flush();
      expect(env.calls).toHaveLength(3);
      expect(page.data.viewState).toBe('forbidden');
    } finally { env.close(); }
  },
);

