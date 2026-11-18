import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';
import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';

const list = (data: unknown[], page = 1, totalPages = 2) => ({
  data, meta: { page, pageSize: 10, total: 11, totalPages },
});
const tab = (value: string) => ({ currentTarget: { dataset: { tab: value } } });
const input = (value: string) => ({ detail: { value } });
const failure = { message: 'Internal Server Error' };
const withdrawal = (status = 'SUBMITTED', version = 1) => ({
  ...fixture.withdrawals[0], id: 'withdraw-1', status, version,
});
function start(env: ReturnType<typeof captureTeacherPage>) {
  const page = env.instantiate(); page.onLoad(); page.onShow?.(); return page;
}
async function prime(env: ReturnType<typeof captureTeacherPage>) {
  const page = start(env);
  env.reply(0, { data: fixture.earningSummary });
  env.reply(1, { data: fixture.earningRule });
  env.reply(2, list(fixture.earnings));
  await flush(); return page;
}
it.each([0, 1, 2])('keeps successful sections when initial section %s fails', async (failed) => {
  const env = captureTeacherPage('earnings');
  try {
    const page = start(env); expect(env.calls).toHaveLength(3);
    const bodies = [{ data: fixture.earningSummary }, { data: fixture.earningRule }, list(fixture.earnings)];
    bodies.forEach((body, i) => env.reply(i, i === failed ? failure : body, i === failed ? 503 : 200));
    await flush();
    expect(page.data.viewState).toBe('ready');
    if (failed !== 0) expect(page.data.summaryItems).toHaveLength(4);
    if (failed !== 1) expect(page.data.rule.configured).toBe(true);
    if (failed !== 2) expect(page.data.earnings).toHaveLength(2);
    expect(page.data[['summaryError', 'ruleError', 'earningsError'][failed]]).toContain('重试');
  } finally { env.close(); }
});
it.each([401, 403])('clears all financial facts immediately on any current %s', async (code) => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await prime(env); page.onOpenWithdrawal(); page.onAmountInput(input('100'));
    page.onPullDownRefresh();
    env.reply(4, failure, code); await flush(); // Other refresh sections deliberately remain pending.
    expect(page.data).toMatchObject({
      viewState: 'forbidden', summaryItems: [], statusItems: [], earnings: [], withdrawals: [],
      showWithdrawalModal: false, amountYuan: '', canWithdraw: false,
    });
    env.reply(3, { data: fixture.earningSummary }); env.reply(5, list(fixture.earnings)); await flush();
    expect(page.data.summaryItems).toEqual([]);
    page.onSubmitWithdrawal(); page.onPullDownRefresh();
    expect(env.calls).toHaveLength(6);
  } finally { env.close(); }
});
it('ignores hidden results, refreshes on return and separates two instances', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const first = start(env), second = start(env);
    env.reply(3, { data: fixture.earningSummary }); await flush();
    expect(second.data.summaryItems).toHaveLength(4);
    first.onHide?.(); env.reply(0, { data: fixture.earningSummary }); await flush();
    expect(first.data.summaryItems).toEqual([]);
    first.onShow?.(); expect(env.calls).toHaveLength(9);
    first.onUnload?.(); env.reply(6, { data: fixture.earningSummary }); await flush();
    expect(first.data.summaryItems).toEqual([]);
  } finally { env.close(); }
});
it('supersedes old append on refresh and keeps tab-specific loading and errors separate', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await prime(env); page.onLoadMore(); // 3 old earnings page2
    page.onPullDownRefresh();
    env.reply(4, { data: fixture.earningSummary }); env.reply(5, { data: fixture.earningRule });
    env.reply(6, list([fixture.earnings[0]], 1, 1)); await flush();
    env.reply(3, list([fixture.earnings[1]], 2)); await flush();
    expect(page.data.earnings).toHaveLength(1); expect(page.data.earningsPage).toBe(1);
    page.onTabTap(tab('withdrawals'));
    env.reply(7, list([withdrawal()])); await flush();
    page.onLoadMore(); page.onTabTap(tab('earnings'));
    env.reply(8, failure, 503); await flush();
    expect(page.data.selectedTab).toBe('earnings');
    expect(page.data.listError).toBe('');
  } finally { env.close(); }
});
it('retains append results on failure and retries page two without duplicates', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await prime(env); page.onLoadMore();
    env.reply(3, failure, 503); await flush();
    expect(page.data.earnings).toHaveLength(2); expect(page.data.earningsPage).toBe(1);
    page.onLoadMore(); expect(env.calls[4].url).toContain('page=2');
    env.reply(4, list(fixture.earnings, 2)); await flush();
    expect(page.data.earnings).toHaveLength(2);
  } finally { env.close(); }
});
