import { NORMAL_TEACHER_FIXTURE as fixture } from "../mock/fixtures/teacher.fixture";
import { captureTeacherPage, flushTeacherPage as flush } from "../tests/teacher-page-test-support";

const row = (position = 1) => ({
  position, displayName: `Synthetic teacher ${position}`,
  rank: position, previousRank: null, rankDelta: null, isSelf: position === 1,
});
const board = (patch = {}) => ({
  metric: 'EARNINGS', month: '2026-10', timezone: 'Asia/Shanghai',
  asOf: '2026-10-28T08:00:00Z', revision: 'a'.repeat(64), rows: [row()],
  own: { value: 12345, rank: 1, previousRank: null, rankDelta: null, hasActivity: true },
  meta: { page: 1, pageSize: 10, total: 11, totalPages: 2 }, ...patch,
});
async function open(env: ReturnType<typeof captureTeacherPage>) {
  
  const page = env.instantiate();
  page.onLoad(); page.onShow();
  env.reply(0, { data: fixture.earningSummary });
  env.reply(1, { data: fixture.earningRule });
  env.reply(2, { data: fixture.earnings, meta: { page: 1, pageSize: 10, total: 2, totalPages: 1 } });
  await flush();
  const pending = page.onOpenRankings();
  env.reply(3, { data: board() }); await pending;
  expect(page.data.rankingHasMore).toBe(true);
  return page;
}
const unchangedAccount = (page: any) => ({
  summaryItems: page.data.summaryItems, statusItems: page.data.statusItems,
  rule: page.data.rule, earnings: page.data.earnings,
});
const conflictResponses = [
  { kind: 'HTTP409', status: 409, payload: { code: 'CONFLICT' } },
  { kind: 'revision', status: 200, payload: { data: board({ revision: 'b'.repeat(64) }) } },
  { kind: 'metric', status: 200, payload: { data: board({ metric: 'ATTENDANCE' }) } },
  { kind: 'month', status: 200, payload: { data: board({ month: '2026-09' }) } },
];

describe.each(conflictResponses)('$kind conflict', conflict => {
  it.each(['refresh', 'reopen'])('blocks stale append after the first-page %s fails', async action => {
    const env = captureTeacherPage('earnings');
    try {
      const page = await open(env);
      const account = structuredClone(unchangedAccount(page));
      const rows = structuredClone(page.data.rankingRows);
      const more = page.onRankingMore();
      expect(env.calls[4].url).toContain('page=2');
      expect(env.calls[4].url).toContain(`revision=${'a'.repeat(64)}`);
      env.reply(4, conflict.payload, conflict.status); await more;
      expect(page.data.rankingState).toBe('conflict');
      const count = env.calls.length;
      await page.onRankingMore();
      expect(env.calls).toHaveLength(count);
      if (action === 'reopen') await page.onOpenRankings();
      const refresh = action === 'reopen' ? page.onOpenRankings() : page.onRankingRefresh();
      expect(env.calls[5].url).toContain('page=1');
      expect(env.calls[5].url).not.toContain('revision=');
      env.reply(5, { message: 'Synthetic first-page read failure' }, 503); await refresh;
      expect(page.data.rankingState).toBe('error');
      const beforeMore = env.calls.length;
      const blocked = page.onRankingMore();
      expect(env.calls).toHaveLength(beforeMore);
      await blocked;
      expect(page.data.rankingHasMore).toBe(false);
      expect(page.data.rankingRevision).toBe('');
      expect(page.data.rankingRows).toEqual(rows);
      expect(unchangedAccount(page)).toEqual(account);
      expect(env.calls.every(call => call.method === 'GET')).toBe(true);
    } finally { env.close(); }
  });
});

it('restores append only after a successful first-page read and uses its new revision', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    const more = page.onRankingMore(); env.reply(4, {}, 409); await more;
    const failed = page.onRankingRefresh(); env.reply(5, {}, 503); await failed;
    const refresh = page.onRankingRefresh();
    expect(env.calls[6].url).not.toContain('revision=');
    env.reply(6, { data: board({ revision: 'b'.repeat(64), rows: [row(2)] }) }); await refresh;
    expect(page.data.rankingHasMore).toBe(true);
    expect(page.data.rankingState).toBe('ready');
    const next = page.onRankingMore();
    expect(env.calls[7].url).toContain('page=2');
    expect(env.calls[7].url).toContain(`revision=${'b'.repeat(64)}`);
    env.reply(7, { data: board({
      revision: 'b'.repeat(64), rows: [row(3)],
      meta: { page: 2, pageSize: 10, total: 11, totalPages: 2 },
    }) }); await next;
    expect(page.data.rankingRows.map((value: { position: number }) => value.position)).toEqual([2, 3]);
    expect(page.data.rankingHasMore).toBe(false);
  } finally { env.close(); }
});

it('retains same-page retry for a normal append 503 without a preceding conflict', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    const more = page.onRankingMore(); env.reply(4, {}, 503); await more;
    expect(page.data.rankingHasMore).toBe(true);
    expect(page.data.rankingRevision).toBe('a'.repeat(64));
    const next = page.onRankingMore();
    expect(env.calls[5].url).toBe(env.calls[4].url);
    env.reply(5, { data: board({
      rows: [row(2)], meta: { page: 2, pageSize: 10, total: 11, totalPages: 2 },
    }) }); await next;
    expect(page.data.rankingRows).toHaveLength(2);
  } finally { env.close(); }
});

it('does not let a late superseded first-page success unlock append after a newer failure', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    const more = page.onRankingMore(); env.reply(4, {}, 409); await more;
    const older = page.onRankingRefresh();
    const newer = page.onRankingRefresh();
    env.reply(6, {}, 503); await newer;
    env.reply(5, { data: board({ revision: 'b'.repeat(64) }) }); await older;
    const count = env.calls.length;
    const blocked = page.onRankingMore();
    expect(env.calls).toHaveLength(count);
    await blocked;
    expect(page.data.rankingHasMore).toBe(false);
    expect(page.data.rankingRevision).toBe('');
    expect(page.data.rankingState).toBe('error');
  } finally { env.close(); }
});
