import { captureHeadquarters, flush, tap } from './operator-headquarters-host';
import { directory, headquartersMe, totalSummary, campusSummary, uuid } from './operator-headquarters.fixture';
import { hundredths, presentSummary } from '../pages/operator/headquarters/presenter';
import { HeadquartersContext } from '../pages/operator/headquarters/context';
import { createHeadquartersMock } from '../pages/operator/headquarters/mock';

it('formats the full safe integer range exactly and converts offset server timestamps to UTC', () => {
  expect(hundredths(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
  expect(hundredths(Number.MIN_SAFE_INTEGER, true)).toBe('-90071992547409.91');
  expect(hundredths(0, true)).toBe('0.00'); expect(hundredths(1, true)).toBe('+0.01');
  expect(hundredths(null)).toBe('待核对');
  expect(presentSummary({ ...totalSummary(), serverTime: '2026-10-29T14:00:00+08:00' }).asOf).toBe('2026-10-29 06:00:00 UTC');
});

it('shows empty grants as reliable zero, and distinguishes no search matches from no grants', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    const mock = createHeadquartersMock('empty');
    env.reply(0, directory(1, '', 0));
    env.reply(1, await mock('/operators/me/headquarters/summary')); await flush();
    const fresh = env.calls.length - 1;
    expect(fresh).toBe(2);
    env.reply(fresh, await mock('/operators/me/headquarters/summary')); await flush();
    expect(page.data).toMatchObject({ directoryState: 'empty', directoryTotal: 0, totalState: 'ready' });
    expect(page.data.totalPresentation.enrollment[1].value).toBe('0.00元');
    expect(page.data.totalSummary.campusCount).toBe(0);
  } finally { env.close(); }
  const second = captureHeadquarters();
  try {
    const page = second.instantiate(); await flush();
    second.reply(0, directory()); second.reply(1, { data: totalSummary() }); await flush();
    page.onQueryInput({ detail: { value: '无匹配校区' } }); page.onSearch(); await flush();
    second.reply(2, directory(1, '无匹配校区')); await flush();
    expect(page.data.directoryState).toBe('empty'); expect(page.data.appliedQuery).toBe('无匹配校区');
    expect(page.data.totalSummary.campusCount).toBe(23);
  } finally { second.close(); }
});

it('retries transient /me failures and rejects identity changes with the same token', async () => {
  const env = captureHeadquarters();
  try {
    env.manualMe(); const page = env.instantiate(); await flush();
    env.sessionCalls[0].success({ statusCode: 503, data: { message: 'PRIVATE_ERROR' } }); await flush();
    expect(env.calls).toHaveLength(0); expect(page.data.totalState).toBe('error');
    page.onRetryTotal(); await flush();
    env.sessionCalls[1].success({ statusCode: 200, data: { data: headquartersMe() } }); await flush();
    env.reply(0, { data: totalSummary() }); await flush();
    expect(page.data.totalSummary.campusCount).toBe(23);
    page.onRetryDirectory(); await flush();
    env.sessionCalls[2].success({ statusCode: 200, data: { data: { ...headquartersMe(), userId: uuid(901) } } }); await flush();
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.totalSummary).toBeNull();
    expect(env.calls).toHaveLength(1);
  } finally { env.close(); }
});

it('discards superseded directory and totals after refresh and after an owner change', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    page.onRefresh(); await flush();
    const refreshed = directory(); refreshed.data[0].name = '更新校区';
    env.reply(2, refreshed); env.reply(3, { data: totalSummary() }); await flush();
    env.reply(0, directory()); env.reply(1, { data: { ...totalSummary(), activeStudentCount: 9999 } }); await flush();
    expect(page.data.campuses[0].name).toBe('更新校区'); expect(page.data.totalSummary.activeStudentCount).toBe(851);
    page.onRetryTotal(); await flush(); const old = env.calls.length - 1;
    env.change({ accessToken: 'synthetic-next' });
    env.reply(old, {}, 403); await flush();
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.totalSummary).toBeNull();
    const next = env.instantiate(); await flush(); expect(next.data.viewState).not.toBe('forbidden');
  } finally { env.close(); }
});

it.each(['duplicate', 'changed-count'])('clears stale directory and detail on cross-page %s', async mode => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush(); env.reply(0, directory()); env.reply(1, { data: totalSummary() }); await flush();
    page.onCampusTap(tap(uuid(1))); await flush(); env.reply(2, { data: campusSummary() }); await flush();
    page.onLoadMore(); await flush();
    const response = mode === 'duplicate' ? directory(2) : directory(2, '', 24);
    if (mode === 'duplicate') response.data[0].id = uuid(1);
    env.reply(3, response); await flush();
    expect(page.data).toMatchObject({ campuses: [], selectedCampusId: '', campusSummary: null, directoryState: 'error' });
    expect(page.data.totalSummary).toBeNull();
    page.onRetryDirectory(); await flush(); expect(new URL(env.calls[env.calls.length - 1].url).searchParams.get('page')).toBe('1');
  } finally { env.close(); }
});

it('does not dispatch an overlong search and encodes punctuation without changing the aggregate request', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush(); env.reply(0, directory()); env.reply(1, { data: totalSummary() }); await flush();
    page.onQueryInput({ detail: { value: '字'.repeat(101) } }); page.onSearch(); await flush();
    expect(env.calls).toHaveLength(2); expect(page.data.directoryError).toContain('100');
    page.onQueryInput({ detail: { value: '甲 &?/# 校区' } }); page.onSearch(); await flush();
    expect(new URL(env.calls[2].url).searchParams.get('query')).toBe('甲 &?/# 校区');
    expect(page.data.totalSummary.campusCount).toBe(23);
  } finally { env.close(); }
});

it('uses only an explicitly enabled headquarters mock alias and never sends mock network traffic', async () => {
  const env = captureHeadquarters();
  try {
    env.change({ dataDriver: 'mock', enableTestAccountSwitcher: true, mockWechatAccount: 'OPERATOR_HEADQUARTERS' });
    const page = env.instantiate(); await flush();
    expect(page.data.campuses).toHaveLength(20); expect(page.data.totalSummary.campusCount).toBe(23);
    expect(env.platform.request).not.toHaveBeenCalled();
  } finally { env.close(); }
  for (const overrides of [
    { dataDriver: 'mock', mockWechatAccount: 'OPERATOR_HEADQUARTERS' },
    { dataDriver: 'mock', enableTestAccountSwitcher: true, mockWechatAccount: 'OPERATOR' },
  ]) {
    const denied = captureHeadquarters();
    try {
      denied.change(overrides); const page = denied.instantiate(); await flush();
      expect(page.data.viewState).toBe('forbidden'); expect(denied.platform.request).not.toHaveBeenCalled();
    } finally { denied.close(); }
  }
});

it('broadcasts mock grant denial to sibling contexts and preserves HTTP status for callers', async () => {
  const env = captureHeadquarters();
  const clears = [jest.fn(), jest.fn()];
  let first: HeadquartersContext | undefined, second: HeadquartersContext | undefined;
  try {
    env.change({ dataDriver: 'mock', enableTestAccountSwitcher: true, mockWechatAccount: 'OPERATOR_HEADQUARTERS' });
    first = new HeadquartersContext(clears[0]); second = new HeadquartersContext(clears[1]);
    await expect(first.service.campusSummary(uuid(999))).rejects.toMatchObject({ statusCode: 403 });
    expect(clears[0]).toHaveBeenCalledTimes(1); expect(clears[1]).toHaveBeenCalledTimes(1);
  } finally { first?.dispose(); second?.dispose(); env.close(); }
});

it('does not run a delayed back fallback after the page owner changes', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush(); env.depth(2); page.onBack();
    const options = env.platform.navigateBack.mock.calls[0][0] as { fail: () => void };
    env.change({ accessToken: 'synthetic-changed' }); options.fail();
    expect(env.platform.reLaunch).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it.each([401, 403])('clears a live sibling on an unloaded owner request status %s without setData on the disposed Page', async status => {
  const env = captureHeadquarters();
  try {
    const old = env.instantiate(); await flush(); old.onUnload();
    const count = old.setData.mock.calls.length;
    const live = env.instantiate(); await flush();
    env.reply(2, directory()); env.reply(3, { data: totalSummary() }); await flush();
    env.reply(0, {}, status); await flush();
    expect(live.data).toMatchObject({ viewState: 'forbidden', campuses: [], totalSummary: null });
    expect(old.setData.mock.calls.length).toBe(count);
  } finally { env.close(); }
});

it('clears a selected summary and stale totals when an unfiltered refreshed directory proves zero grants', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush(); env.reply(0, directory()); env.reply(1, { data: totalSummary() }); await flush();
    page.onCampusTap(tap(uuid(1))); await flush(); env.reply(2, { data: campusSummary() }); await flush();
    page.onSearch(); await flush(); env.reply(3, directory(1, '', 0)); await flush();
    expect(page.data).toMatchObject({ selectedCampusId: '', campusSummary: null, totalSummary: null, campuses: [] });
    if (env.calls.length > 4) { env.reply(4, { data: totalSummary() }); await flush(); }
    expect(page.data.totalSummary).toBeNull();
  } finally { env.close(); }
});

it.each(['back', 'login'])('provides usable %s recovery after ownership changes without logging out the new owner', async handler => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush(); env.change({ accessToken: 'synthetic-new-owner' });
    page.context.isCurrent();
    if (handler === 'back') page.onBack(); else page.onLogin();
    expect(env.platform.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    expect(env.platform.setStorageSync).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it.each(['while-search', 'after-search'])('preserves zero-grant evidence independently of search during a late total: %s', async order => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    env.reply(0, directory(1, '', 0)); await flush();
    page.onQueryInput({ detail: { value: '搜索校区' } }); page.onSearch(); await flush();
    if (order === 'after-search') { env.reply(3, directory(1, '搜索校区', 0)); await flush(); }
    env.reply(1, { data: totalSummary() }); await flush();
    expect(page.data.totalSummary).toBeNull(); expect(page.data.totalState).toBe('loading');
    env.reply(2, { data: totalSummary() }); await flush();
    expect(page.data.totalSummary).toBeNull(); expect(page.data.totalState).toBe('error');
    expect(page.data.campuses).toEqual([]);
  } finally { env.close(); }
});

it('allows newly granted campuses only after a fresh unfiltered directory proves a nonempty authorization', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    env.reply(0, directory(1, '', 0)); await flush();
    page.onRefresh(); await flush();
    const refreshDirectory = env.calls.length - 2, refreshTotal = env.calls.length - 1;
    env.reply(refreshDirectory, directory()); await flush();
    const fresh = env.calls.length - 1;
    expect(fresh).toBeGreaterThan(refreshTotal);
    env.reply(fresh, { data: totalSummary() }); await flush();
    expect(page.data.directoryTotal).toBe(23); expect(page.data.totalSummary.campusCount).toBe(23);
    for (const stale of [1, 2, refreshTotal]) env.reply(stale, { data: { ...totalSummary(), activeStudentCount: 9999 } });
    await flush();
    expect(page.data.totalSummary.activeStudentCount).toBe(851);
  } finally { env.close(); }
});

it('never restores pre-zero or pre-regrant totals when clearing a search restores authorization', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush(); const initialTotal = 1;
    env.reply(0, directory(1, '', 0)); await flush();
    const totalsAfterZero = env.calls.map((call, index) => ({ call, index }))
      .filter(({ call, index }) => index > initialTotal && new URL(call.url).pathname.endsWith('/headquarters/summary'))
      .map(({ index }) => index);
    page.onQueryInput({ detail: { value: '搜索' } }); page.onSearch(); await flush();
    env.reply(env.calls.length - 1, directory(1, '搜索', 0)); await flush();
    page.onQueryInput({ detail: { value: '' } }); page.onSearch(); await flush();
    env.reply(env.calls.length - 1, directory(1, '', 1)); await flush();
    const freshTotal = env.calls.length - 1;
    env.reply(initialTotal, { data: { ...totalSummary(), activeStudentCount: 9999 } });
    for (const old of totalsAfterZero) env.reply(old, { data: totalSummary() });
    await flush();
    expect(page.data.totalSummary).toBeNull();
    expect(totalsAfterZero).toHaveLength(1);
    expect(new URL(env.calls[freshTotal].url).pathname).toBe('/operators/me/headquarters/summary');
    env.reply(freshTotal, { data: { ...totalSummary(), campusCount: 1, activeStudentCount: 37,
      todayLessonCount: 5, account: campusSummary().account, earnings: campusSummary().earnings } }); await flush();
    expect(page.data.totalSummary).toMatchObject({ campusCount: 1, activeStudentCount: 37 });
  } finally { env.close(); }
});

it('discards a pending total when an unfiltered directory proves a reduced nonzero grant count', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    env.reply(0, directory()); await flush();
    page.onSearch(); await flush(); env.reply(2, directory(1, '', 1)); await flush();
    const fresh = env.calls.length - 1;
    env.reply(1, { data: totalSummary() }); await flush();
    expect(page.data.totalSummary).toBeNull();
    expect(new URL(env.calls[fresh].url).pathname).toBe('/operators/me/headquarters/summary');
    env.reply(fresh, { data: { ...totalSummary(), campusCount: 1, activeStudentCount: 37,
      todayLessonCount: 5, account: campusSummary().account, earnings: campusSummary().earnings } }); await flush();
    expect(page.data.totalSummary.campusCount).toBe(1);
  } finally { env.close(); }
});

it.each([0, 1])('discards an old pending total when page two proves the current grant count is %s', async count => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush(); env.reply(0, directory()); await flush();
    page.onLoadMore(); await flush(); env.reply(2, directory(2, '', count)); await flush();
    const fresh = env.calls.length - 1;
    env.reply(1, { data: { ...totalSummary(), activeStudentCount: 9999 } }); await flush();
    expect(page.data).toMatchObject({ campuses: [], totalSummary: null, directoryState: 'error' });
    expect(new URL(env.calls[fresh].url).pathname).toBe('/operators/me/headquarters/summary');
    const zero = await createHeadquartersMock('empty')('/operators/me/headquarters/summary');
    env.reply(fresh, count === 0 ? zero : { data: { ...totalSummary(), campusCount: 1, activeStudentCount: 37,
      todayLessonCount: 5, account: campusSummary().account, earnings: campusSummary().earnings } }); await flush();
    expect(page.data.totalSummary.campusCount).toBe(count);
  } finally { env.close(); }
});
