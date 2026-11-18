import * as fs from 'node:fs';
import * as path from 'node:path';
import { capture, fixture, flush, tap } from './operator-page-host';
import { ACCOUNT_QUERY, accountPage, accountSubjects, SUBJECT_ID } from './operator-account.fixture';
import { earningSummary } from './operator-earning.fixture';
import { rankingPage } from './operator-ranking.fixture';

const pick = (value: string) => ({ detail: { value } });
function start() {
  const env = capture(['lesson-account']);
  const page = env.instantiate(); page.onLoad(); page.onShow();
  return { env, page };
}
async function opened() {
  const result = start(); await flush();
  result.env.reply(0, { data: accountPage() });
  result.env.reply(1, { data: accountSubjects(1, 2) }); await flush();
  return result;
}
const clear = { summary: null, rows: [], subjectOptions: [], page: 0, total: 0, hasMore: false,
  summaryAsOfLabel: '', detailAsOfLabel: '', subjectId: '', subjectLabel: '全部科目' };

it('has a runnable private account Page', () => {
  expect(fs.existsSync(path.resolve(__dirname, '../pages/operator/lesson-account/index.ts'))).toBe(true);
});

it('renders the PDF overview from independent authorized reads without changing the lesson ledger', async () => {
  const { env, page } = await opened();
  try {
    const originalRows = structuredClone(page.data.rows);
    page.onReady(); await flush();
    expect(env.calls.slice(2).map(call => new URL(call.url).pathname)).toEqual([
      '/operators/me/earnings/summary', '/operators/me/rankings',
    ]);
    expect(new URL(env.calls[3].url).searchParams.get('metric')).toBe('PARTNER_EARNINGS');
    env.reply(2, { data: earningSummary() }); await flush();
    expect(page.data.visualSummary).toEqual({ estimatedLabel: '¥208.88', pendingLabel: '¥40.88' });
    expect(page.data.visualRankState).toBe('loading');
    env.reply(3, { data: { ...rankingPage({ metric: 'PARTNER_EARNINGS', month: page.data.visualMonth }, 7),
      asOf: `${page.data.visualMonth}-01T09:30:00Z` } }); await flush();
    expect(page.data.visualRankRows).toHaveLength(6);
    expect(page.data.visualRankState).toBe('ready');
    expect(page.data.rows).toEqual(originalRows);
    page.onOpenTools(); expect(page.data.toolsOpen).toBe(true);
    page.onCloseTools(); expect(page.data.toolsOpen).toBe(false);
    page.onVisualRankings();
    expect(env.platform.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: `/pages/operator/rankings/index?metric=PARTNER_EARNINGS&month=${page.data.visualMonth}`,
    }));
    expect(env.calls.every(call => call.method === 'GET')).toBe(true);
  } finally { env.close(); }
});

it.each(['hide', 'deny', 'owner'] as const)('clears the combined account and discards late overview replies after %s', async reason => {
  const { env, page } = await opened();
  try {
    page.onReady(); await flush();
    const month = page.data.visualMonth;
    if (reason === 'hide') page.onHide();
    else if (reason === 'owner') env.values.set('education.test-account.current', 'another-account');
    env.reply(2, { data: earningSummary() });
    env.reply(3, reason === 'deny' ? {} : { data: { ...rankingPage({ metric: 'PARTNER_EARNINGS', month }), asOf: `${month}-01T09:30:00Z` } }, reason === 'deny' ? 403 : 200);
    await flush();
    expect(page.data.visualSummary).toBeNull();
    expect(page.data.visualRankRows).toEqual([]);
    if (reason === 'deny') expect(page.data).toMatchObject({ viewState: 'forbidden', rows: [], toolsOpen: false });
  } finally { env.close(); }
});
it('loads account once, keeps null distinct from zero and paginates the whole archived subject directory', async () => {
  const { env, page } = start();
  try {
    await flush();
    expect(env.calls).toHaveLength(2);
    env.reply(0, { data: accountPage() }); env.reply(1, { data: accountSubjects() }); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', subjectsState: 'loading', subjectOptions: [] });
    expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('2');
    env.reply(2, { data: accountSubjects(2) }); await flush();
    expect(page.data.subjectOptions).toHaveLength(103);
    expect(page.data.subjectOptions[3].label).toContain('已归档');
    expect(page.data.summary.enrollment.find((row: any) => row.label === '原始赠送课时').value).toBe('待核对');
    expect(page.data.summary.activities).toHaveLength(6);
    expect(page.data.summary.activities[0].label).toBe('历史累计发放');
    expect(page.data.rows[0]).toMatchObject({ deltaLabel: '-1.00', paymentLabel: '缴费日期 2026-10-27' });
    expect(page.data.rows[1].paymentLabel).toContain('缴费时间 2026-10-27 20:00');
    expect(page.data.rows[0].teachingLabel).toContain('2026-10-27 16:00');
  } finally { env.close(); }
});
it('changes subject/category using AND while preserving every campus summary through filtering and pagination', async () => {
  const { env, page } = await opened();
  try {
    const summary = structuredClone(page.data.summary);
    const summaryTime = page.data.summaryAsOfLabel;
    page.onSubjectChange(pick('2')); await flush();
    expect(page.data.rows).toEqual([]);
    expect(page.data.summary).toEqual(summary);
    expect(Object.fromEntries(new URL(env.calls[2].url).searchParams)).toEqual({ page: '1', pageSize: '20', subjectId: SUBJECT_ID });
    env.reply(2, { data: { ...accountPage({ subjectId: SUBJECT_ID }), enrollmentSummary: { ...accountPage().enrollmentSummary, receivedAmountFen: 1 } } }); await flush();
    page.onCategoryChange(pick('6')); await flush();
    const query = { ...ACCOUNT_QUERY, subjectId: SUBJECT_ID, entryType: 'CORRECTION' };
    expect(Object.fromEntries(new URL(env.calls[3].url).searchParams)).toEqual({
      page: '1', pageSize: '20', subjectId: SUBJECT_ID, entryType: 'CORRECTION',
    });
    env.reply(3, { data: accountPage(query) }); await flush();
    page.onLoadMore(); page.onLoadMore(); await flush();
    expect(env.calls).toHaveLength(5);
    env.reply(4, { data: accountPage({ ...query, page: 2 }) }); await flush();
    expect(page.data.rows).toHaveLength(21);
    expect(page.data).toMatchObject({ summary, summaryAsOfLabel: summaryTime, page: 2, hasMore: false });
    page.onLoadMore(); await flush(); expect(env.calls).toHaveLength(5);
  } finally { env.close(); }
});
it('rejects stale filter success and ignores forged picker events', async () => {
  const { env, page } = await opened();
  try {
    page.onCategoryChange(pick('1')); await flush(); page.onCategoryChange(pick('2')); await flush();
    env.reply(3, { data: accountPage({ entryType: 'CONSUME' }, 1) }); await flush();
    env.reply(2, { data: accountPage({ entryType: 'GRANT' }) }); await flush();
    expect(page.data.rows).toHaveLength(1);
    expect(page.data.rows[0].entryLabel).toBe('消费');
    for (const value of ['-1', '2.1', '999', 'NaN', '']) page.onSubjectChange(pick(value));
    expect(env.calls).toHaveLength(4);
  } finally { env.close(); }
});
it('retains detail on page failure and retries the same page, without automatic retry loops', async () => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush(); env.reply(2, {}, 503); await flush();
    expect(page.data.rows).toHaveLength(20); expect(page.data.detailError).toBeTruthy();
    page.onReachBottom(); await flush(); expect(env.calls).toHaveLength(3);
    page.onRetryDetail(); await flush(); expect(env.calls[3].url).toBe(env.calls[2].url);
    env.reply(3, { data: accountPage({ page: 2 }) }); await flush();
    expect(page.data).toMatchObject({ page: 2, detailError: '', hasMore: false });
  } finally { env.close(); }
});
it('retries a filter failure from page one and never repaints old-filter rows', async () => {
  const { env, page } = await opened();
  try {
    page.onSubjectChange(pick('1')); await flush(); env.reply(2, {}, 503); await flush();
    expect(page.data).toMatchObject({ rows: [], detailState: 'error', page: 0 });
    expect(page.data.summary).not.toBeNull();
    page.onRetryDetail(); await flush();
    env.reply(3, { data: accountPage({ subjectId: 'UNCLASSIFIED' }, 0) }); await flush();
    expect(page.data).toMatchObject({ detailState: 'empty', rows: [], total: 0 });
  } finally { env.close(); }
});
it('handles directory failure independently and retries from page one without exposing a partial catalog', async () => {
  const { env, page } = start();
  try {
    await flush(); env.reply(0, { data: accountPage() }); env.reply(1, { data: accountSubjects() }); await flush();
    env.reply(2, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', subjectsState: 'error', subjectOptions: [] });
    page.onRetrySubjects(); page.onRetrySubjects(); await flush(); expect(env.calls).toHaveLength(4);
    expect(new URL(env.calls[3].url).searchParams.get('page')).toBe('1');
    env.reply(3, { data: accountSubjects(1, 2) }); await flush();
    expect(page.data.subjectOptions).toHaveLength(4);
    expect(env.calls.filter(call => call.url.includes('/lesson-account'))).toHaveLength(1);
  } finally { env.close(); }
});
it('rejects directory ID duplication across pages', async () => {
  const { env, page } = start();
  try {
    await flush(); env.reply(0, { data: accountPage() }); env.reply(1, { data: accountSubjects() }); await flush();
    const second = accountSubjects(2); second.data[0].id = SUBJECT_ID;
    env.reply(2, { data: second }); await flush();
    expect(page.data).toMatchObject({ subjectsState: 'error', subjectOptions: [], viewState: 'ready' });
  } finally { env.close(); }
});
it('formats maximum safe amounts and negative hundredths exactly, preserving real zero and null', async () => {
  const { env, page } = start();
  try {
    await flush();
    const body = accountPage({}, 1);
    body.mainBalanceUnits = Number.MAX_SAFE_INTEGER;
    body.enrollmentSummary.receivedAmountFen = Number.MAX_SAFE_INTEGER;
    body.enrollmentSummary.refundedAmountFen = 0;
    body.lessonActivityTotals[0].mainDeltaUnits = Number.MIN_SAFE_INTEGER;
    body.items[0].deltaUnits = Number.MIN_SAFE_INTEGER;
    env.reply(0, { data: body }); env.reply(1, { data: accountSubjects(1, 0) }); await flush();
    expect(page.data.summary.balances[0].main).toBe('90071992547409.91');
    expect(page.data.summary.enrollment[0].value).toBe('¥90071992547409.91');
    expect(page.data.summary.enrollment[1].value).toBe('¥0.00');
    expect(page.data.summary.enrollment[3].value).toBe('待核对');
    expect(page.data.summary.activities[0].main).toBe('-90071992547409.91');
    expect(page.data.rows[0].deltaLabel).toBe('-90071992547409.91');
  } finally { env.close(); }
});
it('detects changed directory pagination and overlapping ledger pages without mixing content', async () => {
  const { env, page } = start();
  try {
    await flush(); env.reply(0, { data: accountPage() }); env.reply(1, { data: accountSubjects() }); await flush();
    env.reply(2, { data: accountSubjects(2, 102) }); await flush();
    expect(page.data.subjectsState).toBe('error');
    page.onLoadMore(); await flush();
    const next = accountPage({ page: 2 }); next.items[0].id = accountPage().items[0].id;
    env.reply(3, { data: next }); await flush();
    expect(page.data.rows).toHaveLength(20); expect(page.data.detailError).toContain('刷新');
  } finally { env.close(); }
});
it('rechecks changed campus identity on reentry before sending either account request', async () => {
  const { env, page } = await opened();
  try {
    page.onHide();
    env.setSession({ userId: 'synthetic-operator', roles: [{ code: 'OPERATOR', campusId: 'changed-campus' }] });
    page.onShow(); await flush();
    expect(page.data).toMatchObject({ ...clear, viewState: 'forbidden' });
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});
it('account initial error and refresh failure preserve independent directory and trusted summary appropriately', async () => {
  const { env, page } = start();
  try {
    await flush(); env.reply(0, {}, 503); env.reply(1, { data: accountSubjects(1, 0) }); await flush();
    expect(page.data).toMatchObject({ summary: null, viewState: 'error', subjectsState: 'ready' });
    page.onRetry(); await flush(); env.reply(2, { data: accountPage({}, 0) }); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', detailState: 'empty' });
    const summary = structuredClone(page.data.summary);
    page.onRefresh(); page.onRefresh(); await flush(); env.reply(3, {}, 503); await flush();
    expect(page.data.summary).toEqual(summary); expect(page.data.refreshError).toBeTruthy();
  } finally { env.close(); }
});
it.each([401, 403])('either read returning %s clears all private content even when stale or hidden', async status => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush(); page.onCategoryChange(pick('1')); await flush();
    page.onHide(); env.reply(2, {}, status); await flush();
    expect(page.data).toMatchObject({ ...clear, viewState: 'forbidden' });
    env.reply(3, { data: accountPage({ entryType: 'GRANT' }) }); await flush();
    page.onShow(); await flush(); expect(page.data).toMatchObject({ ...clear, viewState: 'forbidden' });
    expect(env.calls).toHaveLength(4);
  } finally { env.close(); }
});
it('directory denial clears an already loaded account and prevents later callbacks restoring it', async () => {
  const { env, page } = start();
  try {
    await flush(); env.reply(0, { data: accountPage() }); env.reply(1, {}, 403); await flush();
    expect(page.data).toMatchObject({ ...clear, viewState: 'forbidden' });
  } finally { env.close(); }
});
it.each([{ accessToken: 'synthetic-b' }, { apiBaseUrl: 'https://changed.example.test' }, { dataDriver: 'mock' }])('clears both sections on runtime change %j', async patch => {
  const { env, page } = await opened();
  try {
    page.onLoadMore(); await flush(); env.change(patch); env.reply(2, { data: accountPage({ page: 2 }) }); await flush();
    expect(page.data).toMatchObject({ ...clear, viewState: 'forbidden' });
  } finally { env.close(); }
});
it('clears on hide, ignores old pull completion, reloads both reads on reentry and ignores unload callbacks', async () => {
  const { env, page } = await opened();
  try {
    page.onPullDownRefresh(); await flush(); page.onHide();
    expect(page.data).toMatchObject(clear);
    page.onShow(); await flush();
    env.reply(2, { data: accountPage() }); await flush();
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    env.reply(3, { data: accountSubjects(1, 2) }); await flush();
    page.onUnload();
    const count = page.setData.mock.calls.length;
    for (let index = 4; index < env.calls.length; index++) env.reply(index, { data: accountPage() });
    await flush(); expect(page.setData).toHaveBeenCalledTimes(count);
  } finally { env.close(); }
});
it.each([
  { userId: 'x', roles: [{ code: 'OPERATOR', campusId: null }] },
  { userId: 'x', roles: [{ code: 'PARTNER', campusId: 'x' }] },
  { userId: 'x', roles: [{ code: 'OPERATOR', campusId: 'x' }, { code: 'TEACHER', campusId: 'x' }] },
])('rejects unsuitable identity before account transport %j', async session => {
  const env = capture(['lesson-account']);
  try {
    env.setSession(session); const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
    expect(env.calls).toHaveLength(0); expect(page.data).toMatchObject({ ...clear, viewState: 'forbidden' });
  } finally { env.close(); }
});
it('provides back, direct-entry fallback, login failure recovery and hidden event guards', async () => {
  const { env, page } = await opened();
  try {
    page.onBack(); expect(env.platform.reLaunch).toHaveBeenCalledWith({ url: '/pages/operator/home/index' });
    env.setPages([{ route: 'operator/home' }, { route: 'operator/lesson-account' }]);
    page.onBack(); expect(env.platform.navigateBack).toHaveBeenCalledWith({ delta: 1, fail: expect.any(Function) });
    page.onLogin(); env.platform.reLaunch.mock.calls[env.platform.reLaunch.mock.calls.length - 1][0].fail();
    expect(page.data.errorMessage).toContain('登录页打开失败');
    page.onHide(); const calls = env.platform.reLaunch.mock.calls.length; page.onBack(); page.onLogin();
    expect(env.platform.reLaunch).toHaveBeenCalledTimes(calls);
  } finally { env.close(); }
});
it('makes home and profile account entries usable while preserving rankings', async () => {
  for (const route of ['home', 'profile'] as const) {
    const env = capture([route]);
    try {
      const page = env.instantiate(); page.onLoad(); page.onShow(); await flush();
      env.reply(0, { data: route === 'home' ? fixture.dashboard : fixture.profile });
      if (route === 'profile') env.reply(1, { data: fixture.dashboard });
      await flush(); if (route === 'home') page.onMenuToggle();
      expect([...(page.data.menuActions ?? page.data.actions), ...(page.data.moreActions ?? [])].map((item: any) => item.key)).toEqual(expect.arrayContaining(['lesson-account', 'rankings']));
      page.onActionTap(tap('lesson-account'));
      expect(env.platform.navigateTo).toHaveBeenCalledWith({ url: '/pages/operator/lesson-account/index', fail: expect.any(Function) });
    } finally { env.close(); }
  }
});
