import type { OperatorStudent } from '../pages/operator/runtime/types/operator';
import { capture, flush, tap } from './operator-page-host';

const students: OperatorStudent[] = [
  { id: 'synthetic-student-a', campusId: 'synthetic-campus', displayName: '陈晨',
    ageYears: 8, classNames: ['创意基础班'] },
  { id: 'synthetic-student-b', campusId: 'synthetic-campus', displayName: '陈晨',
    ageYears: null, classNames: ['周末班'] },
];
type Env = ReturnType<typeof capture>;

function list(env: Env, index: number, data = students, page = 1, total = data.length) {
  env.reply(index, { data, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) } });
}

async function loaded(total = 2) {
  const env = capture(['students']);
  const page = env.instantiate();
  page.onLoad({}); page.onShow?.(); await flush();
  list(env, 0, students, 1, total); await flush();
  return { env, page };
}

afterEach(() => jest.useRealTimers());

it('edits a search draft without submitting it on a timer', async () => {
  jest.useFakeTimers();
  const { env, page } = await loaded();
  try {
    page.onSearchInput({ detail: { value: ' 陈 ' } });
    jest.advanceTimersByTime(500); await flush();
    expect(env.calls).toHaveLength(1);
    expect(page.data).toMatchObject({ searchValue: ' 陈 ', activeQuery: '', items: expect.any(Array) });
    page.onSearchSubmit?.(); await flush();
    expect(env.calls).toHaveLength(2);
    expect(new URL(env.calls[1].url).search).toBe('?page=1&pageSize=20&query=%E9%99%88');
    list(env, 1, [students[0]]); await flush();
    expect(page.data.activeQuery).toBe('陈');
  } finally { env.close(); }
});

it('commits and clears search at page one, clears expansion, and does not page the unsubmitted draft', async () => {
  const { env, page } = await loaded(41);
  try {
    page.onLoadMore(); await flush();
    list(env, 1, [{ ...students[1], id: 'synthetic-page-two' }], 2, 41); await flush();
    page.onStudentToggle?.(tap(students[0].id));
    page.onSearchInput({ detail: { value: ' 陈晨 ' } });
    page.onSearchSubmit?.(); await flush();
    expect(env.calls).toHaveLength(3);
    expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('1');
    list(env, 2, students, 1, 41); await flush();
    expect(page.data.items.every((item: { expanded: boolean }) => !item.expanded)).toBe(true);
    page.onSearchInput({ detail: { value: '尚未提交' } });
    page.onLoadMore(); await flush();
    expect(new URL(env.calls[3].url).searchParams.get('query')).toBe('陈晨');
    list(env, 3, [], 2, 41); await flush();
    page.onSearchClear?.(); await flush();
    expect(env.calls).toHaveLength(5);
    expect(new URL(env.calls[4].url).search).toBe('?page=1&pageSize=20');
    list(env, 4, []); await flush();
    expect(page.data).toMatchObject({
      searchValue: '', activeQuery: '', viewState: 'empty', items: [], page: 1, total: 0, hasMore: false,
    });
  } finally { env.close(); }
});

it('does not let an older submitted search replace the newest one', async () => {
  const { env, page } = await loaded();
  try {
    page.onSearchInput({ detail: { value: '陈' } }); page.onSearchSubmit?.(); await flush();
    page.onSearchInput({ detail: { value: '安' } }); page.onSearchSubmit?.(); await flush();
    expect(env.calls).toHaveLength(3);
    list(env, 2, [{ ...students[0], id: 'synthetic-new', displayName: '安然' }]); await flush();
    list(env, 1, students); await flush();
    expect(page.data).toMatchObject({ activeQuery: '安', viewState: 'ready' });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(['synthetic-new']);
  } finally { env.close(); }
});

it('retains loaded rows after a page-two error and retries the same page with the committed query', async () => {
  const { env, page } = await loaded(41);
  try {
    page.onLoadMore(); await flush();
    env.reply(1, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', page: 1, total: 41, hasMore: true, loadingMore: false });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(students.map((item) => item.id));
    expect(page.data.loadMoreError).toBeTruthy();
    page.onLoadMore(); await flush();
    expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('2');
    list(env, 2, [{ ...students[1], id: 'synthetic-page-two' }], 2, 41); await flush();
    expect(page.data).toMatchObject({ page: 2, loadMoreError: '' });
    expect(page.data.items).toHaveLength(3);
  } finally { env.close(); }
});

it('expands same-name students independently and keeps the existing detail route', async () => {
  const { env, page } = await loaded();
  try {
    page.onStudentToggle?.(tap(students[1].id));
    expect(page.data.items.map((item: { expanded: boolean }) => item.expanded)).toEqual([false, true]);
    page.onStudentToggle?.(tap(students[0].id));
    expect(page.data.items.map((item: { expanded: boolean }) => item.expanded)).toEqual([true, true]);
    page.onStudentToggle?.(tap(students[1].id));
    expect(page.data.items.map((item: { expanded: boolean }) => item.expanded)).toEqual([true, false]);
    expect(page.data.items[0]).toMatchObject({ classLabel: '创意基础班' });
    expect(env.calls).toHaveLength(1);
    page.onStudentTap(tap(students[0].id));
    expect(env.platform.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/operator/student-detail/index?id=synthetic-student-a',
    }));
    expect(env.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(JSON.stringify(page.data.items)).not.toMatch(/birthDate|phone|address/i);
  } finally { env.close(); }
});

it('keeps two Page instances and their reads independent', async () => {
  const env = capture(['students']);
  try {
    const first = env.instantiate(); first.onLoad({}); first.onShow?.(); await flush();
    const second = env.instantiate(); second.onLoad({}); second.onShow?.(); await flush();
    list(env, 1, [students[1]]); list(env, 0, [students[0]]); await flush();
    expect(first.data.items.map((item: { id: string }) => item.id)).toEqual([students[0].id]);
    expect(second.data.items.map((item: { id: string }) => item.id)).toEqual([students[1].id]);
    first.onUnload();
    second.onRetry(); await flush();
    list(env, 2, [students[1]]); await flush();
    expect(second.data.viewState).toBe('ready');
  } finally { env.close(); }
});

it.each([401, 403])('clears list, search, expansion and private form data on current %s', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onStudentToggle?.(tap(students[0].id));
    page.setData({ quickOpen: true, quickStudentName: '合成姓名', quickParentPhone: 'synthetic-phone' });
    page.onRetry(); await flush();
    env.reply(1, {}, status); await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], total: 0, hasMore: false, activeQuery: '',
      searchValue: '', quickOpen: false, quickStudentName: '', quickParentPhone: '',
    });
    expect(page.expandedIds).toEqual([]);
    page.onRetry(); await flush();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('uses the runtime owner at Page creation and refuses an old owners late reply', async () => {
  const env = capture(['students']);
  try {
    const old = env.instantiate(); old.onLoad({}); old.onShow?.(); await flush();
    env.change({ apiBaseUrl: 'https://current.example.test', accessToken: 'synthetic-owner-b' });
    const fresh = env.instantiate(); fresh.onLoad({}); fresh.onShow?.(); await flush();
    expect(env.calls[1].url).toBe('https://current.example.test/operators/me/students?page=1&pageSize=20');
    expect(env.calls[1].header.Authorization).toBe('Bearer synthetic-owner-b');
    list(env, 1); await flush();
    list(env, 0); await flush();
    expect(old.data).toMatchObject({ viewState: 'forbidden', items: [] });
    expect(fresh.data.viewState).toBe('ready');
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-owner-b');
  } finally { env.close(); }
});

it('preserves query, unsubmitted draft and expansion on return, and retains them on refresh failure', async () => {
  const { env, page } = await loaded();
  try {
    page.onSearchInput({ detail: { value: '陈' } }); page.onSearchSubmit?.(); await flush();
    expect(env.calls).toHaveLength(2);
    list(env, 1); await flush();
    page.onStudentToggle?.(tap(students[1].id));
    page.onSearchInput({ detail: { value: '安' } });
    page.onHide?.(); page.onShow?.(); await flush();
    expect(new URL(env.calls[2].url).searchParams.get('query')).toBe('陈');
    env.reply(2, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', activeQuery: '陈', searchValue: '安' });
    expect(page.data.refreshError).toBeTruthy();
    expect(page.data.items[1].expanded).toBe(true);
    page.onRetry(); await flush();
    list(env, 3, [{ ...students[1], classNames: ['更新后的班级'] }]); await flush();
    expect(page.data.items[0]).toMatchObject({ id: students[1].id, expanded: true, classLabel: '更新后的班级' });
  } finally { env.close(); }
});

it('supersedes pagination on pull refresh and never updates a hidden or unloaded Page', async () => {
  const { env, page } = await loaded(41);
  try {
    page.onLoadMore(); await flush();
    page.onPullDownRefresh(); await flush();
    expect(env.calls).toHaveLength(3);
    expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('1');
    list(env, 1, [{ ...students[0], id: 'synthetic-stale-page' }], 2, 41); await flush();
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    list(env, 2, [students[1]]); await flush();
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual([students[1].id]);
    expect(env.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    page.onRetry(); await flush();
    page.onHide?.();
    const count = page.setData.mock.calls.length;
    list(env, 3); await flush();
    expect(page.setData).toHaveBeenCalledTimes(count);
    page.onShow?.(); await flush();
    page.onUnload();
    const disposed = page.setData.mock.calls.length;
    list(env, 4); await flush();
    expect(page.setData).toHaveBeenCalledTimes(disposed);
  } finally { env.close(); }
});
