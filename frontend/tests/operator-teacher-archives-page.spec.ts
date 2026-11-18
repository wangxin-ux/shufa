import { capture, flush, tap } from './operator-page-host';
import { archivePage, teacherArchives, teacherPerformance, teacherRevisions } from './operator-teacher-archives.fixture';

async function opened() {
  const env = capture(['teacher-archives']);
  const page = env.instantiate();
  page.onLoad(); page.onShow(); await flush();
  env.reply(0, archivePage(teacherArchives.slice(0, 20), 1, 21)); await flush();
  return { env, page };
}

async function expanded(total = 21) {
  const { env, page } = await opened();
  page.onTeacherToggle(tap(teacherArchives[0].id)); await flush();
  env.reply(1, { data: teacherPerformance() }); await flush();
  env.reply(2, archivePage(teacherRevisions().slice(0, 20), 1, total)); await flush();
  return { env, page };
}

it('paginates 21 same-name teachers and expands by ID with only the three read routes', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); page.onLoadMore(); await flush();
    expect(new URL(env.calls[1].url).searchParams.get('page')).toBe('2');
    env.reply(1, archivePage(teacherArchives.slice(20), 2, 21)); await flush();
    expect(page.data.items).toHaveLength(21);
    expect(page.data.hasMore).toBe(false);
    page.onTeacherToggle(tap(teacherArchives[20].id)); await flush();
    expect(new URL(env.calls[2].url).pathname).toBe(`/operators/me/teacher-archives/${teacherArchives[20].id}/performance`);
    env.reply(2, { data: teacherPerformance(teacherArchives[20].id) }); await flush();
    expect(new URL(env.calls[3].url).searchParams.get('month')).toBe('2026-10');
    env.reply(3, archivePage([])); await flush();
    expect(page.data).toMatchObject({ expandedId: teacherArchives[20].id, historyState: 'empty' });
    expect(page.data.performance).toMatchObject({ completionLabel: '80%', periodMonth: '2026-10' });
    expect(env.calls.every((call) => call.method === 'GET')).toBe(true);
  } finally { env.close(); }
});

it('retains 20 revisions when page two fails and retries the same page without renumbering', async () => {
  const { env, page } = await expanded();
  try {
    page.onHistoryMore(); page.onHistoryMore(); await flush();
    expect(env.calls).toHaveLength(4);
    env.reply(3, {}, 503); await flush();
    expect(page.data.historyItems).toHaveLength(20);
    expect(page.data.historyError).toBeTruthy();
    page.onHistoryRetry(); await flush();
    expect(new URL(env.calls[4].url).searchParams.get('page')).toBe('2');
    env.reply(4, archivePage(teacherRevisions().slice(20), 2, 21)); await flush();
    expect(page.data.historyItems.map((row: any) => row.version)).toEqual(Array.from({ length: 21 }, (_, index) => 21 - index));
    expect(page.data).toMatchObject({ historyHasMore: false, historyError: '' });
  } finally { env.close(); }
});

it('retries the failed teacher page while preserving forty teachers and the expanded second-page detail', async () => {
  const env = capture(['teacher-archives']);
  try {
    const all = Array.from({ length: 41 }, (_, index) => ({
      ...teacherArchives[index % 21],
      id: `e5000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    }));
    const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
    env.reply(0, archivePage(all.slice(0, 20), 1, 41)); await flush();
    page.onLoadMore(); await flush();
    env.reply(1, archivePage(all.slice(20, 40), 2, 41)); await flush();
    page.onTeacherToggle(tap(all[20].id)); await flush();
    env.reply(2, { data: teacherPerformance(all[20].id) }); await flush();
    env.reply(3, archivePage([])); await flush();
    page.onLoadMore(); await flush();
    env.reply(4, {}, 503); await flush();
    page.onRetry(); await flush();
    expect(new URL(env.calls[5].url).searchParams.get('page')).toBe('3');
    expect(page.data.items).toHaveLength(40);
    expect(page.data.expandedId).toBe(all[20].id);
    env.reply(5, archivePage(all.slice(40), 3, 41)); await flush();
    expect(page.data.items).toHaveLength(41);
    expect(page.data.expandedId).toBe(all[20].id);
    expect(page.data.performance).not.toBeNull();
  } finally { env.close(); }
});

it('ignores a late previous-month performance and history after switching month', async () => {
  const { env, page } = await expanded();
  try {
    page.onHistoryMore(); await flush();
    page.onMonthChange({ detail: { value: '2026-09' } }); await flush();
    env.reply(4, { data: teacherPerformance(teacherArchives[0].id, '2026-09') }); await flush();
    env.reply(5, archivePage(teacherRevisions('2026-09').slice(0, 20), 1, 21)); await flush();
    env.reply(3, archivePage(teacherRevisions().slice(20), 2, 21)); await flush();
    expect(page.data.month).toBe('2026-09');
    expect(page.data.performance.periodMonth).toBe('2026-09');
    expect(page.data.historyItems.every((row: any) => row.periodMonth === '2026-09')).toBe(true);
    page.onMonthChange({ detail: { value: '2026-08' } }); await flush();
    page.onMonthChange({ detail: { value: '2026-07' } }); await flush();
    env.reply(7, { data: teacherPerformance(teacherArchives[0].id, '2026-07') }); await flush();
    env.reply(6, { data: teacherPerformance(teacherArchives[0].id, '2026-08') }); await flush();
    expect(page.data.performance.periodMonth).toBe('2026-07');
  } finally { env.close(); }
});

it.each([401, 403])('clears every view and in-memory record on any read %s, including a hidden stale lane', async (status) => {
  for (const lane of ['list', 'performance', 'history']) {
    const { env, page } = await expanded();
    try {
      if (lane === 'list') page.onLoadMore();
      if (lane === 'performance') page.onPerformanceRetry();
      if (lane === 'history') page.onHistoryMore();
      await flush();
      page.onHide();
      env.reply(3, {}, status); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], expandedId: '', month: '',
        performance: null, historyItems: [], query: '', activeQuery: '' });
      expect(page.teacherRecords).toEqual([]);
      expect(page.historyRecords).toEqual([]);
    } finally { env.close(); }
  }
});

it('keeps current history on refresh failure and retries page one even when no more pages remain', async () => {
  const { env, page } = await expanded(20);
  try {
    page.onPerformanceRetry(); await flush();
    env.reply(3, { data: teacherPerformance() }); await flush();
    env.reply(4, {}, 503); await flush();
    expect(page.data.historyItems).toHaveLength(20);
    page.onHistoryRetry(); await flush();
    expect(new URL(env.calls[5].url).searchParams.get('page')).toBe('1');
    env.reply(5, archivePage([])); await flush();
    expect(page.data).toMatchObject({ historyItems: [], historyState: 'empty', historyError: '' });
  } finally { env.close(); }
});

it('blocks old teacher and search results, preserves stable IDs and refreshes on return', async () => {
  const { env, page } = await opened();
  try {
    page.onTeacherToggle(tap(teacherArchives[0].id)); await flush();
    page.onTeacherToggle(tap(teacherArchives[1].id)); await flush();
    env.reply(2, { data: teacherPerformance(teacherArchives[1].id) }); await flush();
    env.reply(1, { data: teacherPerformance() }); await flush();
    expect(page.data.expandedId).toBe(teacherArchives[1].id);
    expect(page.data.performance.periodMonth).toBe('2026-10');
    page.onSearchInput({ detail: { value: ' 李 ' } }); page.onSearchSubmit(); await flush();
    expect(new URL(env.calls[4].url).searchParams.get('query')).toBe('李');
    page.onSearchClear(); await flush();
    env.reply(5, archivePage(teacherArchives.slice(0, 20), 1, 21)); await flush();
    env.reply(4, archivePage([])); await flush();
    expect(page.data.items).toHaveLength(20);
    page.onHide(); page.onShow(); await flush();
    expect(new URL(env.calls[6].url).searchParams.get('page')).toBe('1');
    page.onUnload();
    env.reply(6, archivePage([])); await flush();
    expect(page.data.items).toHaveLength(20);
  } finally { env.close(); }
});

it('clears data after runtime replacement and supports direct-open back fallback', async () => {
  const { env, page } = await expanded();
  try {
    page.onBack(); expect(env.platform.reLaunch).toHaveBeenCalledWith({ url: '/pages/operator/home/index' });
    env.setPages([{ route: 'pages/operator/home/index' }, { route: 'pages/operator/teacher-archives/index' }]);
    page.onBack(); expect(env.platform.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
    env.change({ accessToken: 'synthetic-replaced' }); page.onShow();
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], performance: null, historyItems: [] });
  } finally { env.close(); }
});

it.each(['refresh', 'pagination'] as const)('clears all uncertain caches on a list %s 404 and retries page one', async (operation) => {
  const { env, page } = await expanded();
  try {
    page.onHistoryMore(); await flush();
    if (operation === 'refresh') page.onPullDownRefresh();
    else page.onLoadMore();
    await flush();
    env.reply(4, {}, 404); await flush();
    expect(page.data).toMatchObject({
      viewState: 'error', items: [], total: 0, page: 0, hasMore: false, listLoading: false,
      expandedId: '', month: '', performance: null, historyItems: [], historyPage: 0,
      historyHasMore: false, historyLoading: false,
    });
    expect(page.data.errorMessage).toBeTruthy();
    expect(page.teacherRecords).toEqual([]);
    expect(page.historyRecords).toEqual([]);
    env.reply(3, archivePage(teacherRevisions().slice(20), 2, 21)); await flush();
    expect(page.data.historyItems).toEqual([]);
    expect(page.historyRecords).toEqual([]);
    page.onRetry(); await flush();
    expect(new URL(env.calls[5].url).searchParams.get('page')).toBe('1');
    env.reply(5, archivePage(teacherArchives.slice(0, 20), 1, 21)); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', page: 1, expandedId: '', errorMessage: '' });
    expect(page.data.items).toHaveLength(20);
  } finally { env.close(); }
});

const lateScopeCases = (['performance', 'history'] as const).flatMap((lane) =>
  (['hidden', 'superseded-month', 'another-teacher'] as const).map((change) => ({ lane, change })));

it.each(lateScopeCases)('handles a late $lane 404 after $change by the requested teacher ID', async ({ lane, change }) => {
  const { env, page } = await expanded();
  const originalId = teacherArchives[0].id;
  const otherId = teacherArchives[1].id;
  try {
    if (lane === 'performance') page.onPerformanceRetry();
    else page.onHistoryMore();
    await flush();
    if (change === 'hidden') page.onHide();
    else {
      if (change === 'superseded-month') page.onMonthChange({ detail: { value: '2026-09' } });
      else page.onTeacherToggle(tap(otherId));
      await flush();
      const currentId = change === 'superseded-month' ? originalId : otherId;
      const currentMonth = change === 'superseded-month' ? '2026-09' : '2026-10';
      env.reply(4, { data: {
        ...teacherPerformance(currentId, currentMonth), completedLessonCount: 6, completionRateBasisPoints: 6000,
      } }); await flush();
      env.reply(5, archivePage(teacherRevisions(currentMonth).slice(0, 20), 1, 21)); await flush();
    }
    const retained = structuredClone({
      performance: page.data.performance, historyItems: page.data.historyItems, historyRecords: page.historyRecords,
      month: page.data.month,
    });
    if (change === 'another-teacher') { page.onLoadMore(); await flush(); }
    env.reply(3, {}, 404); await flush();
    expect(page.teacherRecords.some((item: any) => item.id === originalId)).toBe(false);
    expect(page.data.items.some((item: any) => item.id === originalId)).toBe(false);
    expect(page.data.listError).toBeTruthy();
    if (change === 'another-teacher') {
      expect(page.data).toMatchObject({ expandedId: otherId, performance: retained.performance,
        historyItems: retained.historyItems, month: retained.month });
      expect(page.historyRecords).toEqual(retained.historyRecords);
      env.reply(6, archivePage([teacherArchives[0]], 2, 21)); await flush();
      expect(page.data.items.some((item: any) => item.id === originalId)).toBe(false);
      expect(page.data).toMatchObject({ expandedId: otherId, performance: retained.performance,
        historyItems: retained.historyItems, listLoading: false });
    } else {
      expect(page.data).toMatchObject({ expandedId: '', performance: null, historyItems: [] });
      expect(page.historyRecords).toEqual([]);
    }
  } finally { env.close(); }
});

it.each(['performance', 'history'] as const)('keeps another teacher request live when the previous %s returns 404', async (lane) => {
  const { env, page } = await expanded();
  const originalId = teacherArchives[0].id;
  const otherId = teacherArchives[1].id;
  try {
    if (lane === 'performance') page.onPerformanceRetry();
    else page.onHistoryMore();
    await flush();
    page.onTeacherToggle(tap(otherId)); await flush();
    env.reply(3, {}, 404); await flush();
    expect(page.data.expandedId).toBe(otherId);
    expect(page.teacherRecords.some((item: any) => item.id === originalId)).toBe(false);
    env.reply(4, { data: teacherPerformance(otherId) }); await flush();
    env.reply(5, archivePage([])); await flush();
    expect(page.data).toMatchObject({ expandedId: otherId, performanceState: 'ready',
      performance: { completionLabel: '80%' }, historyState: 'empty' });
  } finally { env.close(); }
});

it.each(['before', 'after'] as const)('replaces pagination with a page-one refresh and rejects its old success %s the refresh', async (order) => {
  const { env, page } = await expanded();
  try {
    page.onLoadMore(); await flush();
    expect(new URL(env.calls[3].url).searchParams.get('page')).toBe('2');
    page.onPullDownRefresh(); await flush();
    expect(env.calls).toHaveLength(5);
    expect(new URL(env.calls[4].url).searchParams.get('page')).toBe('1');
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    if (order === 'before') {
      env.reply(3, archivePage(teacherArchives.slice(20), 2, 21)); await flush();
      expect(page.data.page).toBe(1);
      page.onLoadMore(); await flush();
      expect(env.calls).toHaveLength(5);
    }
    env.reply(4, archivePage(teacherArchives.slice(0, 20), 1, 21)); await flush();
    expect(new URL(env.calls[5].url).pathname)
      .toBe(`/operators/me/teacher-archives/${teacherArchives[0].id}/performance`);
    env.reply(5, { data: {
      ...teacherPerformance(), completedLessonCount: 6, completionRateBasisPoints: 6000,
    } }); await flush();
    expect(new URL(env.calls[6].url).searchParams.get('page')).toBe('1');
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    env.reply(6, archivePage([])); await flush();
    if (order === 'after') {
      env.reply(3, archivePage(teacherArchives.slice(20), 2, 21)); await flush();
    }
    expect(page.data).toMatchObject({ page: 1, expandedId: teacherArchives[0].id,
      performance: { completedLabel: '6', completionLabel: '60%' }, historyItems: [], listLoading: false });
    expect(page.data.items).toHaveLength(20);
    expect(env.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  } finally { env.close(); }
});

it('rereads the expanded teacher after refresh rather than reusing an earlier performance promise', async () => {
  const { env, page } = await expanded();
  try {
    page.onPerformanceRetry(); await flush();
    page.onLoadMore(); await flush();
    page.onPullDownRefresh(); await flush();
    expect(env.calls).toHaveLength(6);
    expect(new URL(env.calls[5].url).searchParams.get('page')).toBe('1');
    env.reply(5, archivePage(teacherArchives.slice(0, 20), 1, 21)); await flush();
    expect(env.calls).toHaveLength(7);
    expect(new URL(env.calls[6].url).pathname)
      .toBe(`/operators/me/teacher-archives/${teacherArchives[0].id}/performance`);
    env.reply(6, { data: {
      ...teacherPerformance(), completedLessonCount: 6, completionRateBasisPoints: 6000,
    } }); await flush();
    env.reply(7, archivePage([])); await flush();
    env.reply(3, { data: teacherPerformance() }); await flush();
    env.reply(4, archivePage(teacherArchives.slice(20), 2, 21)); await flush();
    expect(env.calls).toHaveLength(8);
    expect(page.data).toMatchObject({ page: 1, performance: { completedLabel: '6' }, historyItems: [] });
    expect(page.data.items).toHaveLength(20);
    expect(env.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  } finally { env.close(); }
});
