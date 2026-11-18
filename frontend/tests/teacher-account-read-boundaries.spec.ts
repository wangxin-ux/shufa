import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';
import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';

const list = (data: unknown[]) => ({
  data, meta: { page: 1, pageSize: 10, total: data.length, totalPages: 1 },
});
const board = {
  metric: 'EARNINGS', month: '2026-10', timezone: 'Asia/Shanghai', asOf: '2026-10-28T08:00:00Z',
  revision: 'a'.repeat(64),
  rows: [{ position: 1, displayName: '合成本人', rank: 1, previousRank: null, rankDelta: null, isSelf: true }],
  own: { value: 12345, rank: 1, previousRank: null, rankDelta: null, hasActivity: true },
  meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
};
async function prime(env: ReturnType<typeof captureTeacherPage>, offset = 0) {
  const page = env.instantiate();
  page.onLoad(); page.onShow();
  env.reply(offset, { data: fixture.earningSummary });
  env.reply(offset + 1, { data: fixture.earningRule });
  env.reply(offset + 2, list(fixture.earnings));
  await flush();
  return page;
}

describe.each(['account', 'ranking'])('%s hidden authoritative rejection', (area) => {
  it.each([401, 403])('clears known private data before a failed return can retain it after %s', async (status) => {
    const env = captureTeacherPage('earnings');
    try {
      const page = await prime(env);
      let deniedIndex: number, pending: Promise<void> | undefined;
      if (area === 'ranking') {
        const open = page.onOpenRankings(); env.reply(3, { data: board }); await open;
        pending = page.onRankingRefresh(); deniedIndex = 4;
      } else {
        page.onPullDownRefresh(); deniedIndex = 4;
      }
      page.onHide();
      env.reply(deniedIndex, { message: '合成隐藏期间权限撤销' }, status);
      await pending; await flush();
      const beforeReturn = env.calls.length;
      page.onShow();
      // The original failure path attempts new reads; make every such read fail.
      env.calls.forEach((call, index) => {
        if (index >= beforeReturn && call.method === 'GET') env.reply(index, {}, 503);
      });
      if (area === 'account') {
        env.reply(3, {}, 503); env.reply(5, {}, 503);
      }
      await flush();
      expect(page.data).toMatchObject({
        viewState: 'forbidden', summaryItems: [], statusItems: [], earnings: [], withdrawals: [],
        rankingRows: [], rankingOwnLabel: '', rankingRevision: '', canWithdraw: false,
        showWithdrawalModal: false, amountYuan: '',
      });
      expect(env.calls).toHaveLength(beforeReturn);
    } finally { env.close(); }
  });

  it.each(['owner', 'unload'])('handles a late rejection on a successor Page after %s', async (change) => {
    const env = captureTeacherPage('earnings');
    try {
      const page = await prime(env);
      let deniedIndex: number, pending: Promise<void> | undefined;
      if (area === 'ranking') {
        const open = page.onOpenRankings(); env.reply(3, { data: board }); await open;
        pending = page.onRankingRefresh(); deniedIndex = 4;
      } else {
        page.onPullDownRefresh(); deniedIndex = 4;
      }
      page.onHide();
      if (change === 'owner') {
        env.change({ accessToken: 'synthetic-account-other-owner' });
        page.onShow();
      } else page.onUnload();
      const offset = env.calls.length, next = await prime(env, offset);
      if (change === 'unload') {
        const open = next.onOpenRankings();
        env.reply(env.calls.length - 1, { data: board }); await open;
        next.onOpenWithdrawal(); next.onAmountInput({ detail: { value: '100' } });
        expect(next.data).toMatchObject({
          viewState: 'ready', withdrawalReady: true, showWithdrawalModal: true, amountYuan: '100',
        });
        expect(next.data.rankingRows).toHaveLength(1);
        expect(next.data.summaryItems).toHaveLength(4);
      }
      const nextData = structuredClone(next.data), writes = page.setData.mock.calls.length;
      env.reply(deniedIndex, { message: '合成旧Page迟到拒绝' }, 403);
      if (area === 'account') {
        env.reply(3, { data: fixture.earningSummary });
        env.reply(5, list(fixture.earnings));
      }
      await pending; await flush();
      if (change === 'owner') {
        expect(next.data).toEqual(nextData);
        expect(next.data.viewState).toBe('ready');
      } else {
        // Unloading does not change the Token or verified owner of the successor.
        expect(next.data).toMatchObject({
          viewState: 'forbidden', summaryItems: [], statusItems: [], earnings: [], withdrawals: [],
          rankingRows: [], rankingOwnLabel: '', rankingRevision: '', canWithdraw: false,
          showWithdrawalModal: false, amountYuan: '', withdrawalReady: false, recoveryPending: false,
        });
        const calls = env.calls.length;
        next.onShow(); next.onRecoverCommand(); next.onOpenWithdrawal();
        next.onAmountInput({ detail: { value: '100' } }); void next.onSubmitWithdrawal();
        await flush();
        expect(env.calls).toHaveLength(calls);
        expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
      }
      expect(page.setData).toHaveBeenCalledTimes(writes);
    } finally { env.close(); }
  });
});

it('starts fresh account reads after the preserved cancel succeeds and discards pre-write snapshots', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await prime(env);
    const submitted = { ...fixture.withdrawals[0], id: 'synthetic-cancel', status: 'SUBMITTED', version: 1 };
    const cancelled = { ...submitted, status: 'CANCELLED', version: 2 };
    page.onTabTap({ currentTarget: { dataset: { tab: 'withdrawals' } } });
    env.reply(3, list([submitted])); await flush();
    page.onPullDownRefresh(); // Summary/rule snapshots remain in flight before the write.
    env.reply(6, list([submitted])); await flush();
    const cancel = page.executeCancelWithdrawal(submitted.id, 1);
    expect(env.calls[7]).toMatchObject({ method: 'POST', data: { expectedVersion: 1 } });
    env.reply(7, { data: cancelled }); await flush();
    expect(env.calls).toHaveLength(11);
    expect(env.calls.slice(8).every((call) => call.method === 'GET')).toBe(true);
    env.reply(8, { data: { ...fixture.earningSummary, availableFen: 123456 } });
    env.reply(9, { data: fixture.earningRule });
    env.reply(10, list([cancelled]));
    await cancel; await flush();
    const financialFacts = {
      summaryItems: structuredClone(page.data.summaryItems),
      statusItems: structuredClone(page.data.statusItems),
      withdrawals: structuredClone(page.data.withdrawals),
    };
    expect(page.data.withdrawals[0]).toMatchObject({ version: 2, canCancel: false });
    env.reply(4, { data: fixture.earningSummary });
    env.reply(5, { data: fixture.earningRule }); await flush();
    expect({
      summaryItems: page.data.summaryItems, statusItems: page.data.statusItems,
      withdrawals: page.data.withdrawals,
    }).toEqual(financialFacts);
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  } finally { env.close(); }
});
