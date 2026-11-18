import * as fs from 'node:fs';
import * as path from 'node:path';
import { capture, fixture, flush, tap } from './operator-page-host';
import { rankingPage, RANKING_QUERY, RANKING_REVISION, unavailableRanking } from './operator-ranking.fixture';

const rankingTap = (metric: string) => ({ currentTarget: { dataset: { metric } } });
async function opened() {
  const env = capture(['rankings']);
  const page = env.instantiate();
  page.onLoad(RANKING_QUERY); page.onShow(); await flush();
  env.reply(0, { data: rankingPage() }); await flush();
  return { env, page };
}
const cleared = {
  rows: [], ownCampus: null, revisionId: null, page: 0, total: 0, hasMore: false,
  asOfLabel: '', availability: null, loadingMore: false, refreshing: false,
};

it('provides a private runnable rankings Page', () => {
  expect(fs.existsSync(path.resolve(__dirname, '../pages/operator/rankings/index.ts'))).toBe(true);
});

it('loads once, preserves duplicate campus names and shows off-page own-campus rank independently', async () => {
  const { env, page } = await opened();
  try {
    expect(env.calls).toHaveLength(1);
    expect(env.sessionCalls).toHaveLength(1);
    expect(page.data).toMatchObject({ viewState: 'ready', page: 1, total: 21, hasMore: true, revisionId: RANKING_REVISION });
    expect(page.data.rows).toHaveLength(20);
    expect(page.data.rows[0].campusName).toBe(page.data.rows[1].campusName);
    expect(new Set(page.data.rows.map((row: any) => row.rowKey)).size).toBe(20);
    expect(page.data.ownCampus).toMatchObject({ campusName: '示例校区21', rank: 20 });
    expect(page.data.asOfLabel).toContain('17:30');
    expect(JSON.stringify(page.data)).not.toMatch(/campusId|previousRank|amountFen|studentCount/);
  } finally { env.close(); }
});

it('loads fixed revision page two only once and keeps stable row keys through the last page', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); page.onLoadMore(); page.onReachBottom(); await flush();
    expect(env.calls).toHaveLength(2);
    expect(Object.fromEntries(new URL(env.calls[1].url).searchParams)).toEqual({
      metric: 'STUDENTS', month: '2026-10', page: '2', pageSize: '20', revisionId: RANKING_REVISION,
    });
    env.reply(1, { data: rankingPage({ page: 2 }) }); await flush();
    expect(page.data.rows).toHaveLength(21);
    expect(new Set(page.data.rows.map((row: any) => row.rowKey)).size).toBe(21);
    expect(page.data.hasMore).toBe(false);
    page.onLoadMore(); await flush();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('retains content on page failure and retries the exact same fixed revision page', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush();
    env.reply(1, {}, 503); await flush();
    expect(page.data.rows).toHaveLength(20);
    expect(page.data.pageError).toBeTruthy();
    page.onReachBottom(); await flush();
    expect(env.calls).toHaveLength(2);
    page.onLoadMore(); await flush();
    expect(env.calls[2].url).toBe(env.calls[1].url);
    env.reply(2, { data: rankingPage({ page: 2 }) }); await flush();
    expect(page.data.rows).toHaveLength(21);
    expect(page.data.pageError).toBe('');
  } finally { env.close(); }
});

it('refreshes from page one without revision and retains content on an ordinary refresh failure', async () => {
  const { env, page } = await opened();
  try {
    page.onRefresh(); page.onRefresh(); await flush();
    expect(env.calls).toHaveLength(2);
    expect(new URL(env.calls[1].url).searchParams.has('revisionId')).toBe(false);
    env.reply(1, {}, 503); await flush();
    expect(page.data.rows).toHaveLength(20);
    expect(page.data.refreshError).toBeTruthy();
    page.onLoadMore(); await flush();
    expect(env.calls).toHaveLength(2);
    page.onRetry(); await flush();
    env.reply(2, { data: rankingPage({ revisionId: 'a3000000-0000-4000-8000-000000000002' }, 2) }); await flush();
    expect(page.data.rows).toHaveLength(2);
    expect(page.data.refreshError).toBe('');
  } finally { env.close(); }
});

it('stops concatenation on revision 404 and restarts without revision on explicit refresh', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush();
    env.reply(1, { code: 'RESOURCE_NOT_FOUND' }, 404); await flush();
    expect(page.data).toMatchObject({ rows: expect.any(Array), hasMore: false, revisionId: null, revisionMissing: true });
    expect(page.data.rows).toHaveLength(20);
    page.onLoadMore(); page.onReachBottom(); await flush();
    expect(env.calls).toHaveLength(2);
    page.onRefresh(); await flush();
    expect(Object.fromEntries(new URL(env.calls[2].url).searchParams)).toEqual({
      metric: 'STUDENTS', month: '2026-10', page: '1', pageSize: '20',
    });
    env.reply(2, { data: rankingPage() }); await flush();
    expect(page.data.revisionMissing).toBe(false);
    expect(page.data.hasMore).toBe(true);
  } finally { env.close(); }
});

it('clears old rows and revision immediately on metric and month changes and rejects late replies', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush();
    page.onMetricTap(rankingTap('PARTNER_EARNINGS'));
    expect(page.data).toMatchObject({ ...cleared, viewState: 'loading', refreshing: true });
    await flush();
    page.onMonthChange({ detail: { value: '2026-09' } }); await flush();
    env.reply(3, { data: { ...rankingPage({ metric: 'PARTNER_EARNINGS', month: '2026-09' }, 2), availability: 'SNAPSHOT' } }); await flush();
    env.reply(2, { data: rankingPage({ metric: 'PARTNER_EARNINGS' }) });
    env.reply(1, { data: rankingPage({ page: 2 }) }); await flush();
    expect(page.data).toMatchObject({ metric: 'PARTNER_EARNINGS', month: '2026-09', total: 2, page: 1 });
    expect(page.data.rows).toHaveLength(2);
  } finally { env.close(); }
});

it.each(['HISTORY_UNAVAILABLE', 'SOURCE_DATA_INVALID'])('shows unavailable %s as unknown rather than zero ranks', async (reason) => {
  const { env, page } = await opened();
  try {
    page.onRefresh(); await flush();
    env.reply(1, { data: unavailableRanking(reason) }); await flush();
    expect(page.data).toMatchObject({ viewState: 'unavailable', rows: [], ownCampus: null, revisionId: null, total: 0, hasMore: false });
    expect(page.data.unavailableMessage).toContain(reason === 'HISTORY_UNAVAILABLE' ? '历史数据不足' : '待核对');
  } finally { env.close(); }
});

it('keeps a reliable zero tie as available and also supports an available empty catalog', async () => {
  const { env, page } = await opened();
  try {
    const zero = rankingPage({}, 2);
    zero.data.forEach((row) => { row.rank = 1; row.rankDelta = 0; });
    zero.ownCampus!.rank = 1; zero.ownCampus!.rankDelta = 0;
    page.onRefresh(); await flush(); env.reply(1, { data: zero }); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', availability: 'LIVE', total: 2, hasMore: false });
    expect(page.data.rows.map((row: any) => row.deltaLabel)).toEqual(['持平', '持平']);
    page.onRefresh(); await flush(); env.reply(2, { data: rankingPage({}, 0) }); await flush();
    expect(page.data).toMatchObject({ viewState: 'empty', availability: 'LIVE', rows: [], ownCampus: null });
  } finally { env.close(); }
});

it('rejects inconsistent immutable metadata on page two instead of mixing revisions', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush();
    env.reply(1, { data: { ...rankingPage({ page: 2 }), asOf: '2026-10-28T10:00:00Z' } }); await flush();
    expect(page.data.rows).toHaveLength(20);
    expect(page.data.page).toBe(1);
    expect(page.data.pageError).toBeTruthy();
  } finally { env.close(); }
});

it.each([401, 403])('clears private state on stale or hidden response %s before another response can restore it', async (status) => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush();
    page.onMetricTap(rankingTap('HEADQUARTERS_EARNINGS')); await flush();
    page.onHide();
    env.reply(1, {}, status); await flush();
    expect(page.data).toMatchObject({ ...cleared, viewState: 'forbidden' });
    env.reply(2, { data: rankingPage({ metric: 'HEADQUARTERS_EARNINGS' }) }); await flush();
    expect(page.data).toMatchObject({ ...cleared, viewState: 'forbidden' });
    page.onShow(); await flush();
    expect(env.calls).toHaveLength(3);
  } finally { env.close(); }
});

it.each([
  { accessToken: 'synthetic-owner-b' }, { apiBaseUrl: 'https://changed.example.test' }, { dataDriver: 'mock' },
])('clears on owner/runtime change %j including a late successful response', async (patch) => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush(); env.change(patch);
    env.reply(1, { data: rankingPage({ page: 2 }) }); await flush();
    expect(page.data).toMatchObject({ ...cleared, viewState: 'forbidden' });
  } finally { env.close(); }
});

it('clears on hide, rejects late success, then rechecks current role and campus on return', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush(); page.onHide();
    expect(page.data).toMatchObject(cleared);
    env.reply(1, { data: rankingPage({ page: 2 }) }); await flush();
    expect(page.data).toMatchObject(cleared);
    env.setSession({ userId: 'synthetic-operator', roles: [{ code: 'OPERATOR', campusId: 'changed-campus' }] });
    page.onShow(); await flush();
    expect(env.sessionCalls).toHaveLength(3);
    expect(page.data).toMatchObject({ ...cleared, viewState: 'forbidden' });
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it.each([
  { userId: 'x', roles: [{ code: 'OPERATOR', campusId: null }] },
  { userId: 'x', roles: [{ code: 'PARTNER', campusId: 'x' }] },
  { userId: 'x', roles: [{ code: 'OPERATOR', campusId: 'x' }, { code: 'TEACHER', campusId: 'x' }] },
])('rejects invalid operator identity before ranking requests: %j', async (session) => {
  const env = capture(['rankings']);
  try {
    env.setSession(session);
    const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
    expect(page.data).toMatchObject({ ...cleared, viewState: 'forbidden' });
    expect(env.calls).toHaveLength(0);
  } finally { env.close(); }
});

it('ignores unload replies and a previous pull-down completion', async () => {
  const { env, page } = await opened();
  try {
    page.onPullDownRefresh(); await flush(); page.onHide(); page.onShow(); await flush();
    env.reply(1, { data: rankingPage() }); await flush();
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    page.onUnload();
    const count = page.setData.mock.calls.length;
    env.reply(2, { data: rankingPage() }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(count);
    expect(page.data).toMatchObject(cleared);
  } finally { env.close(); }
});

it('retries an initial ordinary failure without fake zero content and ignores invalid filter events', async () => {
  const env = capture(['rankings']);
  try {
    const page = env.instantiate(); page.onLoad({ metric: 'invalid', month: '9999-12' }); page.onShow(); await flush();
    env.reply(0, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'error', rows: [], total: 0, ownCampus: null });
    page.onMonthChange({ detail: { value: '9999-12' } }); page.onMetricTap(rankingTap('WEIGHTED'));
    await flush(); expect(env.calls).toHaveLength(1);
    page.onRetry(); await flush(); expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('exposes home-menu and profile entries that navigate to the actual rankings route', async () => {
  for (const route of ['home', 'profile'] as const) {
    const env = capture([route]);
    try {
      const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
      for (let index = 0; index < env.calls.length; index++) {
        env.reply(index, { data: env.calls[index].url.endsWith('/profile') ? fixture.profile : fixture.dashboard });
      }
      await flush();
      const actions = route === 'home' ? page.data.menuActions : [...page.data.actions, ...page.data.moreActions];
      expect(actions).toContainEqual({ key: 'rankings', label: '校区月榜' });
      page.onActionTap(tap('rankings'));
      expect(env.platform.navigateTo).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/pages/operator/rankings/index' }));
    } finally { env.close(); }
  }
});

it('returns using existing role navigation and has a working login recovery', async () => {
  const { env, page } = await opened();
  try {
    env.setPages([{ route: 'pages/operator/home/index' }, { route: 'pages/operator/rankings/index' }]);
    page.onBack();
    expect(env.platform.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }));
    env.setPages([]); page.onBack();
    expect(env.platform.reLaunch).toHaveBeenCalledWith({ url: '/pages/operator/home/index' });
    page.onLogin();
    expect(page.data).toMatchObject({ ...cleared, viewState: 'forbidden' });
    expect(env.platform.reLaunch).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
  } finally { env.close(); }
});

it('ignores hidden or unloaded navigation and login handlers', async () => {
  const { env, page } = await opened();
  try {
    page.onHide(); page.onLogin(); page.onBack();
    expect(env.platform.reLaunch).not.toHaveBeenCalled();
    expect(env.platform.navigateBack).not.toHaveBeenCalled();
    page.onUnload(); page.onLogin(); page.onBack(); page.onShow();
    expect(env.platform.reLaunch).not.toHaveBeenCalled();
    expect(env.calls).toHaveLength(1);
  } finally { env.close(); }
});

it('shows login navigation failure only during its own visible display cycle', async () => {
  const { env, page } = await opened();
  try {
    page.onLogin();
    const options = env.platform.reLaunch.mock.calls[0][0];
    expect(options.fail).toEqual(expect.any(Function));
    options.fail();
    expect(page.data.errorMessage).toBe('登录页打开失败，请重试');
    page.onHide();
    const count = page.setData.mock.calls.length;
    options.fail();
    expect(page.setData).toHaveBeenCalledTimes(count);
  } finally { env.close(); }
});
