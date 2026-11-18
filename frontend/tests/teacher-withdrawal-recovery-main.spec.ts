import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';
import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';

const STORE = 'education.teacher.withdrawal-recovery.v1';
const identity = (userId = 'teacher-a', campusId = 'campus-a', roles?: unknown[]) => ({
  data: { userId, displayName: '合成教师', roles: roles ?? [{ code: 'TEACHER', campusId }] },
});
const listing = (rows: unknown[], page = 1, totalPages = 1) => ({
  data: rows, meta: { page, pageSize: 10, total: totalPages > 1 ? 21 : rows.length, totalPages },
});
const item = { ...fixture.withdrawals[0], id: 'withdrawal-a', status: 'SUBMITTED', version: 1 };
const failure = { code: 'UNAVAILABLE', message: 'Internal error' };
const input = (value: string) => ({ detail: { value } });
const tap = (dataset: object) => ({ currentTarget: { dataset } });
const board = (patch = {}) => ({
  metric: 'EARNINGS', month: '2026-10', timezone: 'Asia/Shanghai',
  asOf: '2026-10-29T05:00:00Z', revision: 'a'.repeat(64),
  own: { value: 12345, rank: 1, previousRank: 2, rankDelta: 1, hasActivity: true },
  rows: [{ position: 1, rank: 1, previousRank: 2, rankDelta: 1, isSelf: true, displayName: '合成教师' }],
  meta: { page: 1, pageSize: 10, total: 11, totalPages: 2 }, ...patch,
});
type Env = ReturnType<typeof captureTeacherPage>;
let env: Env;
let replied: WeakSet<object>;
const posts = () => env.calls.filter(call => call.method === 'POST');
const unread = (suffix: string) => env.calls.filter(call =>
  !replied.has(call) && new URL(call.url).pathname.endsWith(suffix));
function reply(call: Env['calls'][number], data: unknown, statusCode = 200) {
  replied.add(call); call.success({ data, statusCode });
}
const next = (suffix: string) => {
  const calls = unread(suffix);
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1];
};
async function account() {
  for (const call of [...env.calls]) {
    if (replied.has(call) || call.method !== 'GET') continue;
    const url = new URL(call.url);
    if (url.pathname.endsWith('/earnings/summary')) reply(call, { data: fixture.earningSummary });
    else if (url.pathname.endsWith('/earning-rule')) reply(call, { data: fixture.earningRule });
    else if (url.pathname.endsWith('/earnings')) reply(call, listing(fixture.earnings, Number(url.searchParams.get('page'))));
  }
  await flush();
}
async function start(session: unknown = identity(), verify = true) {
  const page = env.instantiate(); page.onLoad(); page.onShow();
  await account();
  if (verify) for (const call of unread('/me')) reply(call, session);
  await flush();
  return page;
}
async function sendCreate(page: any, amount = '100.01') {
  page.onOpenWithdrawal(); page.onAmountInput(input(amount));
  void page.onSubmitWithdrawal(); await flush();
  expect(posts().length).toBeGreaterThan(0);
  return posts()[posts().length - 1];
}
async function unknownCreate(page: any) {
  const call = await sendCreate(page);
  reply(call, failure, 503); await flush();
  return call;
}
async function showWithdrawals(page: any, rows: unknown[] = [item]) {
  page.onTabTap(tap({ tab: 'withdrawals' })); await flush();
  reply(next('/withdrawals'), listing(rows)); await flush();
}
async function sendCancel(page: any) {
  await showWithdrawals(page);
  page.onCancelWithdrawal(tap({ id: item.id, version: 1 }));
  expect(env.wx.showModal).toHaveBeenCalledTimes(1);
  env.wx.showModal.mock.calls[0][0].success({ confirm: true });
  await flush();
  return posts()[posts().length - 1];
}
async function readBeforeReplay() {
  expect(posts()[posts().length - 1]).toBeDefined();
  reply(next('/withdrawals'), listing([{ ...item, status: 'CANCELLED', version: 2 }]));
  await flush();
}
function savedEntries(): any[] {
  expect(env.values.get(STORE)).toBeDefined();
  return env.values.get(STORE).entries;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  env = captureTeacherPage('earnings', { autoSession: false });
  replied = new WeakSet();
});
afterEach(() => { env.close(); jest.clearAllTimers(); jest.useRealTimers(); });

describe('current main withdrawal recovery', () => {
  it('verifies exact-session identity before enabling writes, while account reads work', async () => {
    const page = await start(undefined, false);
    expect(page.data.summaryItems).toHaveLength(4);
    page.onOpenWithdrawal(); page.onAmountInput(input('100'));
    void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(0);
    const me = next('/me');
    expect(me.header.Authorization).toBe('Bearer synthetic-teacher-a');
    reply(me, identity()); await flush();
    expect(page.data.withdrawalReady).toBe(true);
    page.onOpenWithdrawal(); expect(page.data.showWithdrawalModal).toBe(true);
  });

  it('saves a minimal original command synchronously before POST and never persists tokens or account facts', async () => {
    const page = await start(), call = await sendCreate(page);
    const saved = savedEntries()[0];
    expect(saved.owner).toEqual({ apiBaseUrl: 'https://initial.synthetic.invalid', userId: 'teacher-a', campusId: 'campus-a' });
    expect(saved.command).toMatchObject({ kind: 'create', amountFen: 10001, amountYuan: '100.01', uncertain: true });
    expect(saved.command.key).toBe(call.header['Idempotency-Key']);
    expect(JSON.stringify(env.values.get(STORE))).not.toMatch(/synthetic-teacher-a|displayName|earning|Authorization/);
    reply(call, { data: item }); await flush();
    expect(savedEntries()[0].command).toBeNull();
    expect(page.data.showWithdrawalModal).toBe(false);
  });

  it('keeps the original amount/key through failed reply, attempted edits and close/reopen', async () => {
    const page = await start(), original = await unknownCreate(page);
    page.onAmountInput(input('200')); expect(page.data.amountYuan).toBe('100.01');
    page.onCloseWithdrawal(); page.onOpenWithdrawal();
    expect(page.data.amountYuan).toBe('100.01');
    void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(1);
    await readBeforeReplay();
    expect(posts()).toHaveLength(2);
    expect(posts()[1]).toMatchObject({ data: original.data, header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
    reply(posts()[1], { data: item }); await flush();
    expect(page.data.recoveryMessage).toBe('');
  });

  it.each(['cold-start', 'token-rotation', 'relogin'])('restores only after fresh identity across %s and uses the original command', async mode => {
    const page = await start(), original = await unknownCreate(page);
    page.onUnload();
    if (mode !== 'cold-start') env.change({ accessToken: `synthetic-${mode}` });
    if (mode === 'relogin') env.values.set('education.session.logged-out', false);
    env.register();
    const reopened = await start(undefined, false);
    expect(reopened.data.amountYuan).toBe('');
    expect(reopened.data.withdrawalReady).toBe(false);
    reply(next('/me'), identity()); await flush();
    reopened.onOpenWithdrawal();
    expect(reopened.data.amountYuan).toBe('100.01');
    expect(posts()).toHaveLength(1);
    void reopened.onSubmitWithdrawal(); await flush(); await readBeforeReplay();
    expect(posts()[1].data).toEqual(original.data);
    expect(posts()[1].header['Idempotency-Key']).toBe(original.header['Idempotency-Key']);
    expect(posts()[1].header.Authorization).toBe(`Bearer ${env.values.get('education.runtime').accessToken}`);
    reply(posts()[1], { data: item }); await flush();
  });

  it('bounds a missing POST callback and allows explicit read-then-original-key recovery', async () => {
    const page = await start(), original = await sendCreate(page);
    expect(page.data.submitting).toBe(true);
    jest.advanceTimersByTime(30000); await flush();
    expect(page.data.submitting).toBe(false);
    expect(page.data.recoveryMessage).toContain('核对');
    void page.onSubmitWithdrawal(); await flush();
    await readBeforeReplay();
    expect(posts()[1].header['Idempotency-Key']).toBe(original.header['Idempotency-Key']);
    reply(posts()[1], { data: item }); await flush();
  });

  it('keeps an uncertain cancellation original ID/version/key even when the current row is terminal', async () => {
    const page = await start(), original = await sendCancel(page);
    expect(original.url).toContain(`/${item.id}/cancel`);
    reply(original, failure, 503); await flush();
    page.onUnload(); env.register();
    const reopened = await start();
    expect(typeof reopened.onRecoverCommand).toBe('function');
    reopened.onRecoverCommand(); await flush();
    expect(posts()).toHaveLength(1);
    await readBeforeReplay();
    expect(posts()[1]).toMatchObject({
      url: original.url, data: { expectedVersion: 1 },
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] },
    });
    reply(posts()[1], { data: { ...item, status: 'CANCELLED', version: 2 } }); await flush();
    expect(savedEntries()[0].command).toBeNull();
  });

  it.each([401, 403, 503])('identity %i blocks writes without exposing stored command amounts', async code => {
    const page = await start(undefined, false);
    reply(next('/me'), failure, code); await flush();
    page.onOpenWithdrawal(); page.onAmountInput(input('100'));
    void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(0); expect(page.data.amountYuan).toBe('');
    if (code < 500) expect(page.data.viewState).toBe('forbidden');
    else {
      expect(page.data.summaryItems).toHaveLength(4);
      expect(typeof page.onRecoverCommand).toBe('function');
      page.onRecoverCommand(); await flush();
      reply(next('/me'), identity()); await flush();
      page.onOpenWithdrawal(); expect(page.data.showWithdrawalModal).toBe(true);
    }
  });

  it.each([
    identity('', 'campus-a'), identity('teacher-a', ''),
    identity('teacher-a', 'campus-a', [{ code: 'PARENT', campusId: 'campus-a' }]),
    identity('teacher-a', 'campus-a', [{ code: 'TEACHER', campusId: 'campus-a' }, { code: 'TEACHER', campusId: 'campus-b' }]),
  ])('rejects malformed, nonteacher or ambiguous identity %#', async session => {
    const page = await start(session);
    page.onOpenWithdrawal(); page.onAmountInput(input('100'));
    void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(0); expect(page.data.viewState).toBe('forbidden');
  });

  it.each(['user', 'campus', 'origin', 'driver'])('never exposes or overwrites another %s recovery', async dimension => {
    const first = await start(); await unknownCreate(first);
    const saved = structuredClone(env.values.get(STORE));
    expect(saved).toBeDefined();
    first.onUnload(); env.register();
    env.change({ accessToken: 'synthetic-other',
      ...(dimension === 'origin' ? { apiBaseUrl: 'https://other.synthetic.invalid' } : {}),
      ...(dimension === 'driver' ? { dataDriver: 'mock' } : {}) });
    const page = await start(identity(dimension === 'user' ? 'teacher-b' : 'teacher-a',
      dimension === 'campus' ? 'campus-b' : 'campus-a'));
    expect(page.data.amountYuan).toBe('');
    expect(page.data.recoveryMessage).not.toContain('上次');
    expect(env.values.get(STORE)).toEqual(saved);
    expect(posts()).toHaveLength(1);
  });

  it.each(['user', 'campus'])('rechecks same-token backend %s before showing a remembered command', async dimension => {
    const first = await start(); await unknownCreate(first); first.onUnload();
    const saved = structuredClone(env.values.get(STORE));
    const page = await start(undefined, false);
    expect(page.data.amountYuan).toBe('');
    reply(next('/me'), identity(dimension === 'user' ? 'teacher-b' : 'teacher-a',
      dimension === 'campus' ? 'campus-b' : 'campus-a')); await flush();
    expect(page.data.amountYuan).toBe('');
    expect(env.values.get(STORE)).toEqual(saved);
    expect(posts()).toHaveLength(1);
  });

  it.each(['read', 'corrupt', 'write'])('storage %s failure blocks POST and preserves readable accounts', async mode => {
    const get = env.wx.getStorageSync, set = env.wx.setStorageSync;
    if (mode === 'read') env.wx.getStorageSync = (key: string) => {
      if (key === STORE) throw new Error('synthetic read failure'); return get(key);
    };
    if (mode === 'corrupt') env.values.set(STORE, { version: 1, entries: [{ command: 'broken' }] });
    const page = await start();
    if (mode === 'write') env.wx.setStorageSync = (key: string, value: unknown) => {
      if (key === STORE) throw new Error('synthetic write failure'); return set(key, value);
    };
    page.onOpenWithdrawal(); page.onAmountInput(input('100'));
    void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(0);
    expect(page.data.summaryItems).toHaveLength(4);
    expect(page.data.recoveryMessage).toBeTruthy();
    env.wx.getStorageSync = get; env.wx.setStorageSync = set;
  });

  it('can retry the same prepared command after storage recovers without sending before the save', async () => {
    const page = await start(), set = env.wx.setStorageSync;
    env.wx.setStorageSync = (key: string, value: unknown) => {
      if (key === STORE) throw new Error('synthetic full'); return set(key, value);
    };
    page.onOpenWithdrawal(); page.onAmountInput(input('100'));
    void page.onSubmitWithdrawal(); await flush(); expect(posts()).toHaveLength(0);
    env.wx.setStorageSync = set;
    void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(1);
    expect(savedEntries()[0].command.key).toBe(posts()[0].header['Idempotency-Key']);
    reply(posts()[0], { data: item }); await flush();
  });

  it('keeps the original pending command when local cleanup fails after server success', async () => {
    const page = await start(), original = await sendCreate(page), set = env.wx.setStorageSync;
    env.wx.setStorageSync = () => { throw new Error('synthetic cleanup failure'); };
    reply(original, { data: item }); await flush();
    expect(page.data.submitting).toBe(false);
    expect(page.data.recoveryMessage).toContain('核对');
    env.wx.setStorageSync = set;
    page.onUnload(); env.register();
    const reopened = await start();
    reopened.onOpenWithdrawal(); expect(reopened.data.amountYuan).toBe('100.01');
    void reopened.onSubmitWithdrawal(); await flush(); await readBeforeReplay();
    expect(posts()[1].header['Idempotency-Key']).toBe(original.header['Idempotency-Key']);
    reply(posts()[1], { data: item }); await flush();
  });

  it('preserves other owners when completing this owner command', async () => {
    const other = { owner: { apiBaseUrl: 'https://else.synthetic.invalid', userId: 'teacher-z', campusId: 'campus-z' },
      command: { kind: 'cancel', key: 'other-command', id: 'other-id', version: 7, uncertain: true } };
    env.values.set(STORE, { version: 1, entries: [other] });
    const page = await start(), call = await sendCreate(page);
    reply(call, { data: item }); await flush();
    expect(savedEntries().find(entry => entry.owner.userId === 'teacher-z')).toEqual(other);
    expect(savedEntries().find(entry => entry.owner.userId === 'teacher-a').command).toBeNull();
  });

  it('failed recovery GET never POSTs and repeated unknown replies always reread before the same command', async () => {
    const page = await start(), original = await unknownCreate(page);
    void page.onSubmitWithdrawal(); await flush();
    reply(next('/withdrawals'), failure, 503); await flush();
    expect(posts()).toHaveLength(1); expect(page.data.submitting).toBe(false);
    void page.onSubmitWithdrawal(); await flush(); await readBeforeReplay();
    reply(posts()[1], failure, 503); await flush();
    void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(2); await readBeforeReplay();
    expect(posts()[2].header['Idempotency-Key']).toBe(original.header['Idempotency-Key']);
    reply(posts()[2], { data: item }); await flush();
  });

  it('replays a completed create after balance becomes zero without treating it as a new write', async () => {
    const page = await start(), original = await unknownCreate(page);
    void page.readSection('summary');
    reply(next('/earnings/summary'), { data: { ...fixture.earningSummary, availableFen: 0 } }); await flush();
    expect(page.data.canWithdraw).toBe(false);
    page.onCloseWithdrawal(); page.onOpenWithdrawal(); expect(page.data.showWithdrawalModal).toBe(true);
    void page.onSubmitWithdrawal(); await flush(); await readBeforeReplay();
    expect(posts()[1].header['Idempotency-Key']).toBe(original.header['Idempotency-Key']);
    reply(posts()[1], { data: item }); await flush();
  });

  it.each([401, 403])('hidden command %i is authoritative on return without another private GET', async code => {
    const page = await start(), call = await sendCreate(page);
    page.onHide(); reply(call, failure, code); await flush();
    const count = env.calls.length;
    page.onShow(); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.summaryItems).toEqual([]);
    expect(page.data.amountYuan).toBe('');
    expect(env.calls).toHaveLength(count);
  });

  it('keeps hidden success in its original owner and refreshes authoritative account on return', async () => {
    const page = await start(), call = await sendCreate(page);
    page.onHide(); reply(call, { data: item }); await flush();
    expect(savedEntries()[0].command).toBeNull();
    const count = env.calls.length;
    page.onShow(); await account();
    expect(env.calls.length).toBeGreaterThan(count);
    expect(page.data.showWithdrawalModal).toBe(false);
    expect(page.data.submitting).toBe(false);
  });

  it.each([{ accessToken: 'synthetic-new' }, { apiBaseUrl: 'https://new.synthetic.invalid' }, { dataDriver: 'mock' }])(
    'rejects old confirmation after current context changes %#', async change => {
      const page = await start(); await showWithdrawals(page);
      page.onCancelWithdrawal(tap({ id: item.id, version: 1 }));
      expect(env.wx.showModal).toHaveBeenCalledTimes(1);
      env.change(change);
      env.wx.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
      expect(posts()).toHaveLength(0);
      expect(page.data.viewState).toBe('forbidden');
    });

  it.each(['hide', 'unload', 'version'])('rejects old confirmation after %s', async mode => {
    const page = await start(); await showWithdrawals(page);
    page.onCancelWithdrawal(tap({ id: item.id, version: 1 }));
    if (mode === 'hide') page.onHide();
    else if (mode === 'unload') page.onUnload();
    else {
      void page.loadWithdrawals(true);
      reply(next('/withdrawals'), listing([{ ...item, version: 2 }])); await flush();
    }
    env.wx.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(posts()).toHaveLength(0);
  });

  it('shares only an in-flight original command across two verified Pages and prevents duplicate POSTs', async () => {
    const first = await start(), call = await sendCreate(first);
    const second = await start();
    second.onOpenWithdrawal(); void second.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(1);
    reply(call, { data: item }); await flush(); await account();
    expect(savedEntries()[0].command).toBeNull();
    expect(first.data.submitting).toBe(false);
    expect(second.data.submitting).toBe(false);
    expect(second.data.showWithdrawalModal).toBe(false);
  });

  it('an old-session late reply cannot clear a newer owner command or populate its Page', async () => {
    const first = await start(), old = await sendCreate(first);
    first.onUnload(); env.change({ accessToken: 'synthetic-new-teacher' });
    const second = await start(identity('teacher-b', 'campus-b')), recent = await sendCreate(second, '200');
    reply(old, { data: item }); await flush();
    expect(savedEntries().find(entry => entry.owner.userId === 'teacher-b').command.key).toBe(recent.header['Idempotency-Key']);
    expect(second.data.amountYuan).toBe('200');
    expect(second.data.submitting).toBe(true);
    reply(recent, { data: item }); await flush();
  });

  it('protects account pagination and ranking revision conflict while recovery is pending', async () => {
    const page = await start(); await unknownCreate(page);
    void page.loadEarnings(true);
    reply(next('/earnings'), listing([fixture.earnings[0]], 1, 3)); await flush();
    page.onLoadMore(); reply(next('/earnings'), failure, 503); await flush();
    page.onLoadMore();
    expect(new URL(next('/earnings').url).searchParams.get('page')).toBe('2');
    reply(next('/earnings'), listing([{ ...fixture.earnings[0], id: 'earning-page-2' }], 2, 3)); await flush();
    expect(page.data.earnings).toHaveLength(2);
    void page.onOpenRankings(); reply(next('/rankings'), { data: board() }); await flush();
    void page.onRankingMore(); reply(next('/rankings'), failure, 409); await flush();
    expect(page.data.rankingHasMore).toBe(false);
    void page.onRankingRefresh(); reply(next('/rankings'), failure, 503); await flush();
    const count = env.calls.length; void page.onRankingMore(); await flush();
    expect(env.calls).toHaveLength(count);
    expect(page.data.rankingRows).toHaveLength(1);
    expect(page.data.summaryItems).toHaveLength(4);
  });

  it('bounds missing identity callbacks and permits a fresh explicit identity check', async () => {
    const page = await start(undefined, false);
    jest.advanceTimersByTime(30000); await flush();
    expect(page.data.withdrawalReady).toBe(false);
    expect(page.data.recoveryMessage).toContain('核对');
    page.onRecoverCommand(); await flush();
    reply(next('/me'), identity()); await flush();
    expect(page.data.withdrawalReady).toBe(true);
  });

  it('bounds an unknown-operation GET without posting and preserves the original command', async () => {
    const page = await start(), original = await unknownCreate(page);
    void page.onSubmitWithdrawal(); await flush();
    expect(unread('/withdrawals')).toHaveLength(1);
    jest.advanceTimersByTime(30000); await flush();
    expect(page.data.submitting).toBe(false);
    expect(posts()).toHaveLength(1);
    expect(savedEntries()[0].command.key).toBe(original.header['Idempotency-Key']);
  });

  it.each(['x', 'invalid command key', 'secret-field'])('blocks invalid persisted command %s without changing the store', async key => {
    const command: any = { kind: 'create', key, amountFen: 10000, amountYuan: '100', uncertain: true };
    if (key === 'secret-field') command.accessToken = 'synthetic-not-to-persist';
    env.values.set(STORE, { version: 1, entries: [{
      owner: { apiBaseUrl: 'https://initial.synthetic.invalid', userId: 'teacher-a', campusId: 'campus-a' }, command,
    }] });
    const saved = structuredClone(env.values.get(STORE)), page = await start();
    expect(page.data.withdrawalReady).toBe(false);
    expect(page.data.amountYuan).toBe('');
    page.onOpenWithdrawal(); void page.onSubmitWithdrawal(); await flush();
    expect(posts()).toHaveLength(0);
    expect(env.values.get(STORE)).toEqual(saved);
  });

  it.each([401, 403])('uncertain cancellation replay %i keeps original command even if local writes now fail', async code => {
    const page = await start(), original = await sendCancel(page);
    reply(original, failure, 503); await flush();
    const saved = structuredClone(env.values.get(STORE));
    page.onRecoverCommand(); await flush(); await readBeforeReplay();
    env.wx.setStorageSync = () => { throw new Error('synthetic failure'); };
    reply(posts()[1], failure, code); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.amountYuan).toBe('');
    expect(env.values.get(STORE)).toEqual(saved);
  });

  it('late timeout success cannot clear or unlock a subsequent new command', async () => {
    const page = await start(), old = await sendCreate(page);
    jest.advanceTimersByTime(30000); await flush();
    void page.onSubmitWithdrawal(); await flush(); await readBeforeReplay();
    reply(posts()[1], { data: item }); await flush(); await account();
    const newer = await sendCreate(page, '200');
    reply(old, { data: item }); await flush();
    expect(savedEntries()[0].command.key).toBe(newer.header['Idempotency-Key']);
    expect(page.data.submitting).toBe(true);
    expect(page.data.amountYuan).toBe('200');
    reply(newer, { data: item }); await flush();
  });

  it('late identity denial remains authoritative after timeout and a newer successful identity response', async () => {
    const page = await start(undefined, false), old = next('/me');
    jest.advanceTimersByTime(30000); await flush();
    page.onRecoverCommand(); await flush();
    reply(next('/me'), identity()); await flush();
    expect(page.data.withdrawalReady).toBe(true);
    reply(old, failure, 403); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.summaryItems).toEqual([]);
  });

  it('attaching to a completed same-owner command invalidates account reads started before identity verification', async () => {
    const first = await start(), original = await sendCreate(first);
    env.change({ accessToken: 'synthetic-rotated' });
    const second = env.instantiate(); second.onLoad(); second.onShow(); await flush();
    const oldSummary = next('/earnings/summary');
    reply(original, { data: item }); await flush();
    reply(next('/me'), identity()); await flush();
    reply(oldSummary, { data: { ...fixture.earningSummary, availableFen: 999999 } }); await flush();
    expect(second.data.canWithdraw).toBe(false);
    expect(unread('/earnings/summary').some(call => call !== oldSummary)).toBe(true);
    const fresh = next('/earnings/summary');
    reply(fresh, { data: { ...fixture.earningSummary, availableFen: 0 } }); await flush();
    expect(second.data.canWithdraw).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it.each(['user', 'campus'])('clears all private facts when the same Page verifies a changed backend %s', async dimension => {
    const page = await start(); await showWithdrawals(page);
    void page.onOpenRankings(); reply(next('/rankings'), { data: board() }); await flush();
    expect(page.data.rankingRows).toHaveLength(1);
    page.onHide(); page.onShow(); await flush();
    const oldSummary = next('/earnings/summary');
    reply(next('/me'), identity(dimension === 'user' ? 'teacher-b' : 'teacher-a',
      dimension === 'campus' ? 'campus-b' : 'campus-a')); await flush();
    for (const call of [...env.calls]) {
      if (!replied.has(call) && call !== oldSummary) reply(call, failure, 503);
    }
    await flush();
    expect(page.data.summaryItems).toEqual([]);
    expect(page.data.earnings).toEqual([]);
    expect(page.data.withdrawals).toEqual([]);
    expect(page.data.rankingRows).toEqual([]);
    reply(oldSummary, failure, 403); await flush();
    expect(page.data).toMatchObject({
      summaryItems: [], statusItems: [], earnings: [], withdrawals: [],
      rankingRows: [], rankingOwnLabel: '', rankingRevision: '',
      canWithdraw: false, amountYuan: '', withdrawalReady: true,
    });
    expect(page.data.viewState).not.toBe('forbidden');
  });

  it('a previous owner POST denial cannot invalidate the changed owner on the same Page and Token', async () => {
    const page = await start(), old = await sendCreate(page);
    page.onHide(); page.onShow(); await flush();
    reply(next('/me'), identity('teacher-b', 'campus-b')); await flush(); await account();
    expect(page.data.withdrawalReady).toBe(true);
    reply(old, failure, 403); await flush();
    expect(page.data.viewState).not.toBe('forbidden');
    expect(page.data.withdrawalReady).toBe(true);
    expect(page.data.summaryItems).toHaveLength(4);
    expect(savedEntries().find(entry => entry.owner.userId === 'teacher-a').command).toBeTruthy();
  });

  it.each([401, 403])('a timed-out POST late %i immediately clears every verified Page of its exact session', async code => {
    const first = await start(), old = await sendCreate(first);
    jest.advanceTimersByTime(30000); await flush(); first.onUnload();
    const second = await start();
    expect(second.data.summaryItems).toHaveLength(4);
    reply(old, failure, code); await flush();
    expect(second.data).toMatchObject({
      viewState: 'forbidden', summaryItems: [], withdrawals: [], amountYuan: '', withdrawalReady: false,
    });
    const count = env.calls.length;
    second.onRecoverCommand(); second.onOpenWithdrawal(); void second.onSubmitWithdrawal(); await flush();
    expect(env.calls).toHaveLength(count);
    expect(posts()).toHaveLength(1);
  });

  it('a late denied previous Token does not clear a verified same-owner Page using a new Token', async () => {
    const first = await start(), old = await sendCreate(first);
    jest.advanceTimersByTime(30000); await flush(); first.onUnload();
    env.change({ accessToken: 'synthetic-renewed' });
    const second = await start();
    reply(old, failure, 403); await flush();
    expect(second.data.viewState).not.toBe('forbidden');
    expect(second.data.withdrawalReady).toBe(true);
    second.onRecoverCommand(); void second.onSubmitWithdrawal(); await flush(); await readBeforeReplay();
    expect(posts()[1].header.Authorization).toBe('Bearer synthetic-renewed');
    reply(posts()[1], { data: item }); await flush();
  });

  it('cancels a current verified row while older summary and rule reads cannot overwrite the post-write facts', async () => {
    const page = await start(); await showWithdrawals(page);
    void page.readSection('summary'); void page.readSection('rule'); await flush();
    const oldSummary = next('/earnings/summary'), oldRule = next('/earning-rule');
    page.onCancelWithdrawal(tap({ id: item.id, version: 1 }));
    env.wx.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].data).toEqual({ expectedVersion: 1 });
    const cancelled = { ...item, status: 'CANCELLED', version: 2 };
    reply(posts()[0], { data: cancelled }); await flush();
    reply(next('/earnings/summary'), { data: { ...fixture.earningSummary, availableFen: 123456 } });
    reply(next('/earning-rule'), { data: fixture.earningRule });
    reply(next('/withdrawals'), listing([cancelled])); await flush();
    const facts = structuredClone({ summary: page.data.summaryItems, status: page.data.statusItems,
      withdrawals: page.data.withdrawals });
    reply(oldSummary, { data: fixture.earningSummary });
    reply(oldRule, { data: null }); await flush();
    expect({ summary: page.data.summaryItems, status: page.data.statusItems,
      withdrawals: page.data.withdrawals }).toEqual(facts);
    expect(page.data.withdrawals[0]).toMatchObject({ version: 2, canCancel: false });
  });

  it('does not start a new cancel while the current withdrawals refresh is pending', async () => {
    const page = await start(); await showWithdrawals(page);
    page.onPullDownRefresh(); await flush();
    void page.executeCancelWithdrawal(item.id, 1); await flush();
    expect(posts()).toHaveLength(0);
    reply(next('/withdrawals'), listing([item])); await flush();
    page.onCancelWithdrawal(tap({ id: item.id, version: 1 }));
    env.wx.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(posts()).toHaveLength(1);
    reply(posts()[0], { data: { ...item, status: 'CANCELLED', version: 2 } }); await flush();
  });

  it('a rotated Token late identity denial follows its newly verified same-owner recovery', async () => {
    const first = await start(); await unknownCreate(first); first.onUnload();
    env.change({ accessToken: 'synthetic-rotated-identity' });
    const second = await start(undefined, false), old = next('/me');
    jest.advanceTimersByTime(30000); await flush();
    second.onRecoverCommand(); await flush();
    reply(next('/me'), identity()); await flush(); await account();
    expect(second.data.withdrawalReady).toBe(true);
    reply(old, failure, 403); await flush();
    expect(second.data).toMatchObject({
      viewState: 'forbidden', withdrawalReady: false, summaryItems: [], amountYuan: '',
    });
    expect(posts()).toHaveLength(1);
  });

  it('clears a rotated Page when identity attached while hidden and its return identity is denied', async () => {
    const first = await start(); await unknownCreate(first); first.onUnload();
    env.change({ accessToken: 'synthetic-hidden-identity' });
    const second = await start(undefined, false);
    second.onHide(); reply(next('/me'), identity()); await flush();
    second.onShow(); await flush();
    reply(next('/me'), failure, 403); await flush();
    expect(second.data).toMatchObject({
      viewState: 'forbidden', summaryItems: [], statusItems: [], withdrawals: [],
      rankingRows: [], withdrawalReady: false, amountYuan: '',
    });
    const count = env.calls.length;
    second.onRecoverCommand(); await flush();
    expect(env.calls).toHaveLength(count);
    expect(posts()).toHaveLength(1);
  });

  it.each([401, 403])('main review regression: an unloaded Page GET late %i clears its exact-session successor', async code => {
    const first = await start();
    first.onTabTap(tap({ tab: 'withdrawals' })); await flush();
    const old = next('/withdrawals');
    first.onUnload();
    const unloadedWrites = first.setData.mock.calls.length;
    const second = await start();
    expect(second.data.summaryItems).toHaveLength(4);
    second.onOpenWithdrawal(); second.onAmountInput(input('100'));
    expect(second.data).toMatchObject({ showWithdrawalModal: true, amountYuan: '100' });
    reply(old, failure, code); await flush();
    expect(second.data).toMatchObject({
      viewState: 'forbidden', summaryItems: [], statusItems: [], earnings: [], withdrawals: [],
      rankingRows: [], rankingOwnLabel: '', rankingRevision: '', canWithdraw: false,
      showWithdrawalModal: false, amountYuan: '', withdrawalReady: false,
    });
    const count = env.calls.length;
    second.onRecoverCommand(); second.onOpenWithdrawal(); second.onAmountInput(input('100'));
    void second.onSubmitWithdrawal(); await flush();
    first.onShow(); first.onRetry(); first.onRecoverCommand(); first.onOpenWithdrawal();
    first.onAmountInput(input('100')); void first.onSubmitWithdrawal(); await flush();
    const reopened = await start();
    expect(reopened.data).toMatchObject({ viewState: 'forbidden', withdrawalReady: false, summaryItems: [] });
    expect(env.calls).toHaveLength(count);
    expect(posts()).toHaveLength(0);
    expect(first.setData).toHaveBeenCalledTimes(unloadedWrites);
  });

  it.each(['token', 'owner'])('main review regression: an unloaded Page GET denial isolates a different %s', async dimension => {
    const first = await start();
    first.onTabTap(tap({ tab: 'withdrawals' })); await flush();
    const old = next('/withdrawals');
    first.onUnload();
    if (dimension === 'token') env.change({ accessToken: 'synthetic-next-session' });
    const second = await start(dimension === 'owner' ? identity('teacher-b', 'campus-b') : identity());
    await account();
    reply(old, failure, 403); await flush();
    expect(second.data.viewState).not.toBe('forbidden');
    expect(second.data.withdrawalReady).toBe(true);
    expect(second.data.summaryItems).toHaveLength(4);
    const current = await sendCreate(second);
    expect(posts()).toHaveLength(1);
    reply(current, { data: item }); await flush();
  });

  it.each(['same-session', 'renewed-token'])('an unloaded Page GET late success cannot overwrite its %s successor', async mode => {
    const first = await start();
    first.onTabTap(tap({ tab: 'withdrawals' })); await flush();
    const old = next('/withdrawals');
    first.onUnload();
    const unloadedWrites = first.setData.mock.calls.length;
    if (mode === 'renewed-token') env.change({ accessToken: 'synthetic-success-next-session' });
    const second = await start();
    await account();
    await showWithdrawals(second, [{ ...item, status: 'CANCELLED', version: 2 }]);
    second.onOpenWithdrawal(); second.onAmountInput(input('100.01'));
    expect(second.data).toMatchObject({ showWithdrawalModal: true, amountYuan: '100.01' });
    const data = structuredClone(second.data), writes = second.setData.mock.calls.length;
    const count = env.calls.length;
    reply(old, listing([{ ...item, id: 'synthetic-old-only' }])); await flush();
    expect(second.data).toEqual(data);
    expect(second.data).toMatchObject({ viewState: 'ready', withdrawalReady: true, amountYuan: '100.01' });
    expect(second.data.withdrawals[0]).toMatchObject({ id: item.id, version: 2, canCancel: false });
    expect(second.setData).toHaveBeenCalledTimes(writes);
    expect(first.setData).toHaveBeenCalledTimes(unloadedWrites);
    expect(env.calls).toHaveLength(count);
    expect(posts()).toHaveLength(0);
  });
});
