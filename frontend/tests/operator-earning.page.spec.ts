import { capture } from './operator-page-host';
import { captureEarnings, flush } from './operator-earning.host';
import { earningEntries, earningSummary } from './operator-earning.fixture';
import { accountPage, accountSubjects } from './operator-account.fixture';

type Env = ReturnType<typeof captureEarnings>;
let env: Env | undefined;
afterEach(() => { env?.close(); env = undefined; });
const pick = (value: string) => ({ detail: { value } });
async function open() {
  env = captureEarnings();
  const page = env.earningPage();
  page.onLoad(); page.onShow(); await flush();
  return page;
}
function replySummary(index = 0, patch = {}) {
  env!.reply(index, { data: { ...earningSummary(), ...patch } });
}
function replyEntries(index = 1, query = {}, total = 21) {
  env!.reply(index, { data: earningEntries(query, total) });
}
async function ready() {
  const page = await open();
  replySummary(); replyEntries(); await flush();
  return page;
}
it('account exposes a guarded earnings navigation command', () => {
  const accountEnv = capture(['lesson-account']);
  try {
    expect(accountEnv.instantiate('lesson-account').onEarnings).toEqual(expect.any(Function));
  } finally { accountEnv.close(); }
});
it('loads summary and journal independently through the private access chain', async () => {
  const page = await open();
  expect(env!.calls.map(call => new URL(call.url).pathname)).toEqual([
    '/operators/me/earnings/summary', '/operators/me/earnings',
  ]);
  replyEntries(); await flush();
  expect(page.data.rows).toHaveLength(20);
  expect(page.data.summaryState).toBe('loading');
  replySummary(0, { estimatedTotalFen: null, pendingReviewFen: 0 }); await flush();
  expect(page.data.summary).toEqual({ estimatedLabel: '待核对', pendingLabel: '¥0.00' });
  expect(page.data.rows[1]).toMatchObject({ amountLabel: '-¥1.00', statusLabel: '已冲正' });
  expect(page.data.rows[0].completedLabel).toContain('11:00');
  expect(page.data.summaryAsOfLabel).toContain('12:00');
});
it('renders signed safe extreme amounts without recalculation', async () => {
  const page = await open();
  replySummary(0, { estimatedTotalFen: Number.MIN_SAFE_INTEGER, pendingReviewFen: Number.MAX_SAFE_INTEGER });
  replyEntries(); await flush();
  expect(page.data.summary).toEqual({
    estimatedLabel: '-¥90071992547409.91', pendingLabel: '¥90071992547409.91',
  });
});
it('uses AND filters for journal only and ignores late replaced queries', async () => {
  const page = await ready();
  const summary = structuredClone(page.data.summary);
  page.onStatusChange(pick('4')); await flush();
  page.onTypeChange(pick('2')); await flush();
  expect(Object.fromEntries(new URL(env!.calls[3].url).searchParams)).toEqual({
    page: '1', pageSize: '20', status: 'REVERSED', entryType: 'REVERSAL',
  });
  replyEntries(3, { status: 'REVERSED', entryType: 'REVERSAL' }, 1); await flush();
  replyEntries(2, { status: 'REVERSED' }); await flush();
  expect(page.data.rows).toHaveLength(1);
  expect(page.data.summary).toEqual(summary);
  expect(env!.calls.filter(call => call.url.endsWith('/summary'))).toHaveLength(1);
});
it.each(['-1', '1.5', '01', '100', 'NaN', '', '1e0'])('ignores forged picker value %s', async value => {
  const page = await ready();
  page.onStatusChange(pick(value)); page.onTypeChange(pick(value)); await flush();
  expect(env!.calls).toHaveLength(2);
});
it('paginates once, preserves rows on failure, and explicitly retries the same page', async () => {
  const page = await ready();
  page.onLoadMore(); page.onReachBottom(); await flush();
  expect(env!.calls).toHaveLength(3);
  env!.reply(2, {}, 503); await flush();
  expect(page.data.rows).toHaveLength(20);
  expect(page.data.detailError).toBeTruthy();
  page.onReachBottom(); await flush(); expect(env!.calls).toHaveLength(3);
  page.onRetryDetail(); await flush();
  expect(new URL(env!.calls[3].url).searchParams.get('page')).toBe('2');
  replyEntries(3, { page: 2 }); await flush();
  expect(page.data.rows).toHaveLength(21);
  expect(page.data.hasMore).toBe(false);
});
it.each(['duplicate', 'order', 'total', 'timezone'])('rejects cross-page %s drift and offers a fresh reload', async kind => {
  const page = await ready();
  page.onLoadMore(); await flush();
  const body = earningEntries({ page: 2 }, kind === 'total' ? 22 : 21);
  if (kind === 'duplicate') body.data[0].id = earningEntries().data[0].id;
  if (kind === 'order') body.data[0].createdAt = '2026-10-30T00:00:00Z';
  if (kind === 'timezone') body.timezone = 'UTC';
  env!.reply(2, { data: body }); await flush();
  expect(page.data.rows).toHaveLength(20);
  expect(page.data.detailError).toContain('刷新');
  page.onRetryDetail(); await flush();
  expect(new URL(env!.calls[3].url).searchParams.get('page')).toBe('1');
});
it.each(['summary', 'entries'])('keeps successful section usable when %s fails', async part => {
  const page = await open();
  if (part === 'summary') { env!.reply(0, {}, 503); replyEntries(); }
  else { replySummary(); env!.reply(1, {}, 503); }
  await flush();
  expect(page.data.summaryState).toBe(part === 'summary' ? 'error' : 'ready');
  expect(page.data.detailState).toBe(part === 'entries' ? 'error' : 'ready');
  if (part === 'summary') {
    page.onRetrySummary(); await flush(); replySummary(2);
  } else {
    page.onRetryDetail(); await flush(); replyEntries(2);
  }
  await flush();
  expect(page.data.summaryState).toBe('ready');
  expect(page.data.detailState).toBe('ready');
});
it('refresh clears prior page two and independently reloads both sections', async () => {
  const page = await ready();
  page.onLoadMore(); await flush(); replyEntries(2, { page: 2 }); await flush();
  page.onPullDownRefresh(); await flush();
  expect(page.data.rows).toEqual([]);
  expect(page.data.summary).toBeNull();
  replySummary(3); env!.reply(4, {}, 503); await flush();
  expect(page.data.summaryState).toBe('ready');
  expect(page.data.detailState).toBe('error');
  expect(page.data.page).toBe(0);
  expect(env!.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
});
it('stops a pull refresh after a toolbar refresh replaces its pending journal request', async () => {
  const page = await ready();
  page.onPullDownRefresh(); await flush(); replySummary(2); await flush();
  page.onRefresh(); await flush();
  replySummary(4); replyEntries(5); await flush();
  expect(env!.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  replyEntries(3); await flush();
  expect(env!.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
});
it.each([401, 403])('clears all sections on summary %s and rejects late journal success', async status => {
  const page = await open();
  env!.reply(0, {}, status); await flush(); replyEntries(); await flush();
  expect(page.data.viewState).toBe('forbidden');
  expect(page.data.summary).toBeNull(); expect(page.data.rows).toEqual([]);
});
it.each([401, 403])('clears previously loaded summary on journal %s', async status => {
  const page = await open();
  replySummary(); await flush(); env!.reply(1, {}, status); await flush();
  expect(page.data.viewState).toBe('forbidden');
  expect(page.data.summary).toBeNull(); expect(page.data.summaryAsOfLabel).toBe('');
});
it.each([
  { accessToken: 'synthetic-b' }, { apiBaseUrl: 'https://changed.example.test' }, { dataDriver: 'mock' },
])('invalidates late replies when runtime changes %j', async patch => {
  const page = await open();
  env!.change(patch); replySummary(); replyEntries(); await flush();
  expect(page.data.viewState).toBe('forbidden');
  expect(page.data.rows).toEqual([]); expect(page.data.summary).toBeNull();
});
it('denies a mixed-role session before any earnings transport', async () => {
  env = captureEarnings();
  env.setSession({ userId: 'synthetic', roles: [{ code: 'OPERATOR', campusId: 'campus' }, { code: 'TEACHER', campusId: 'campus' }] });
  const page = env.earningPage(); page.onLoad(); page.onShow(); await flush();
  expect(env.calls).toHaveLength(0); expect(page.data.viewState).toBe('forbidden');
});
it.each(['education.test-account.current', 'education.session.logged-out'])('clears late results after %s changes', async key => {
  const page = await open();
  env!.values.set(key, key.endsWith('logged-out') ? true : 'OTHER');
  replySummary(); replyEntries(); await flush();
  expect(page.data.viewState).toBe('forbidden');
  expect(page.data.summary).toBeNull(); expect(page.data.rows).toEqual([]);
});
it('ignores old summary after hide and return even when the new summary already succeeded', async () => {
  const page = await open();
  page.onHide(); page.onShow(); await flush();
  replySummary(2, { estimatedTotalFen: 12345 }); replyEntries(3); await flush();
  replySummary(0, { estimatedTotalFen: 99999 }); replyEntries(1); await flush();
  expect(page.data.summary.estimatedLabel).toBe('¥123.45');
  expect(page.data.rows).toHaveLength(20);
});
it('safely reenters account after the earnings page is popped', async () => {
  env = captureEarnings();
  const account = env.accountPage();
  account.onLoad(); account.onShow(); await flush();
  env.reply(0, { data: accountPage() }); env.reply(1, { data: accountSubjects(1, 0) }); await flush();
  account.onEarnings(); account.onHide();
  const earnings = env.earningPage(); earnings.onLoad(); earnings.onShow(); await flush();
  replySummary(2); replyEntries(3); await flush();
  earnings.onBack(); earnings.onUnload(); account.onShow(); await flush();
  env.reply(4, { data: accountPage() }); env.reply(5, { data: accountSubjects(1, 0) }); await flush();
  account.onEarnings(); expect(env.platform.navigateTo).toHaveBeenCalledTimes(2);
});
it('revalidates persisted identity before another read', async () => {
  const page = await ready();
  env!.setSession({ userId: 'changed', roles: [{ code: 'OPERATOR', campusId: 'other' }] });
  page.onLoadMore(); await flush();
  expect(page.data.viewState).toBe('forbidden');
  expect(env!.calls).toHaveLength(2);
});
it('hide clears private values, retains only filters, and return starts at page one', async () => {
  const page = await ready();
  page.onTypeChange(pick('1')); await flush(); replyEntries(2, { entryType: 'ACCRUAL' }); await flush();
  page.onLoadMore(); await flush();
  page.onHide();
  expect(page.data.summary).toBeNull(); expect(page.data.rows).toEqual([]);
  expect(page.data.total).toBe(0); expect(page.data.timezone).toBe('');
  replyEntries(3, { page: 2, entryType: 'ACCRUAL' }); await flush();
  expect(page.data.rows).toEqual([]);
  page.onShow(); await flush();
  expect(page.data.entryType).toBe('ACCRUAL');
  expect(new URL(env!.calls[5].url).searchParams.get('page')).toBe('1');
  replySummary(4); replyEntries(5, { entryType: 'ACCRUAL' }); await flush();
  expect(page.data.rows).toHaveLength(20); expect(page.data.page).toBe(1);
});
it('unload ignores pending callbacks and all later commands', async () => {
  const page = await open();
  page.onUnload(); page.setData.mockClear();
  replySummary(); replyEntries(); await flush();
  page.onRefresh(); page.onStatusChange(pick('1')); page.onLogin(); page.onBack();
  await flush();
  expect(page.setData).not.toHaveBeenCalled();
  expect(env!.calls).toHaveLength(2);
  expect(env!.platform.reLaunch).not.toHaveBeenCalled();
});
it('empty journal does not replace an unknown summary with zero', async () => {
  const page = await open();
  replySummary(0, { estimatedTotalFen: null }); replyEntries(1, {}, 0); await flush();
  expect(page.data.detailState).toBe('empty');
  expect(page.data.summary.estimatedLabel).toBe('待核对');
});
it('account entry prevents duplicate navigation and recovers after failure', async () => {
  env = captureEarnings();
  const page = env.accountPage();
  page.onLoad(); page.onShow(); await flush();
  env.reply(0, { data: accountPage() }); env.reply(1, { data: accountSubjects(1, 0) }); await flush();
  page.onEarnings(); page.onEarnings();
  expect(env.platform.navigateTo).toHaveBeenCalledTimes(1);
  const options = env.platform.navigateTo.mock.calls[0][0] as any;
  expect(options.url).toBe('/pages/operator/earnings/index');
  options.fail(); page.onEarnings();
  expect(env.platform.navigateTo).toHaveBeenCalledTimes(2);
  const pending = env.platform.navigateTo.mock.calls[1][0] as any;
  page.onHide(); page.setData.mockClear(); pending.fail(); page.onEarnings();
  expect(page.setData).not.toHaveBeenCalled();
  expect(env.platform.navigateTo).toHaveBeenCalledTimes(2);
});
it('returns through the existing operator back chain', async () => {
  const page = await ready();
  env!.setPages([{ route: 'lesson-account' }, { route: 'earnings' }]);
  page.onBack(); expect(env!.platform.navigateBack).toHaveBeenCalledTimes(1);
});
