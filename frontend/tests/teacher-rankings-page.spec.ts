import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';
import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';

const event = (key: string, value: string) => ({ currentTarget: { dataset: { [key]: value } } });
const row = (position = 1) => ({
  position, displayName: position === 1 ? '合成教师' : '另一位合成教师',
  rank: position, previousRank: position + 1, rankDelta: 1, isSelf: position === 1,
});
const board = (patch = {}) => ({
  metric: 'EARNINGS', month: '2026-10', timezone: 'Asia/Shanghai', asOf: '2026-10-25T08:00:00Z',
  revision: 'a'.repeat(64), rows: [row()], own: { value: 12345, rank: 1, previousRank: 2, rankDelta: 1, hasActivity: true },
  meta: { page: 1, pageSize: 10, total: 11, totalPages: 2 }, ...patch,
});
async function start(env: ReturnType<typeof captureTeacherPage>) {
  const page = env.instantiate(); page.onLoad(); page.onShow?.();
  env.reply(0, { data: fixture.earningSummary });
  env.reply(1, { data: fixture.earningRule });
  env.reply(2, { data: fixture.earnings, meta: { page: 1, pageSize: 10, total: 2, totalPages: 1 } });
  await flush(); return page;
}
async function open(env: ReturnType<typeof captureTeacherPage>) {
  const page = await start(env);
  const pending = page.onOpenRankings();
  env.reply(3, { data: board() }); await pending;
  return page;
}

it('opens the PDF ranking preview on native readiness without requiring another tap', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await start(env);
    page.onReady();
    expect(page.data.rankingOpen).toBe(true);
    env.reply(3, { data: board() }); await flush();
    expect(page.data.rankingRows).toHaveLength(1);
    expect(page.data.summaryLoaded).toBe(true);
  } finally { env.close(); }
});

it('opens rankings independently, preserves account on a failed ranking and retries', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await start(env);
    expect(env.calls).toHaveLength(3);
    const pending = page.onOpenRankings();
    expect(env.calls[3].url).toContain('/teachers/me/rankings');
    env.reply(3, { message: 'Internal Server Error' }, 503); await pending;
    expect(page.data.rankingState).toBe('error');
    expect(page.data.summaryItems).toHaveLength(4);
    expect(page.data.rankingError).not.toContain('Internal');
    const retry = page.onRankingRefresh();
    env.reply(4, { data: board() }); await retry;
    expect(page.data.rankingState).toBe('ready');
    expect(page.data.rankingOwnLabel).toContain('123.45');
  } finally { env.close(); }
});

it('carries revision on append, preserves first page on 409 and requires explicit refresh', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    const more = page.onRankingMore();
    expect(env.calls[4].url).toContain(`revision=${'a'.repeat(64)}`);
    expect(env.calls[4].url).toContain('page=2');
    env.reply(4, { code: 'CONFLICT' }, 409); await more;
    expect(page.data.rankingRows).toHaveLength(1);
    expect(page.data.rankingState).toBe('conflict');
    page.onRankingMore(); expect(env.calls).toHaveLength(5);
    const refresh = page.onRankingRefresh();
    expect(env.calls[5].url).not.toContain('revision=');
    env.reply(5, { data: board({ revision: 'b'.repeat(64), rows: [row(2)] }) }); await refresh;
    expect(page.data.rankingRows[0].displayName).toBe('另一位合成教师');
  } finally { env.close(); }
});

it('keeps append retry on the same page and never duplicates positions', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    const more = page.onRankingMore();
    env.reply(4, {}, 503); await more;
    expect(page.data.rankingPage).toBe(1);
    const retry = page.onRankingMore();
    expect(env.calls[5].url).toContain('page=2');
    env.reply(5, { data: board({ rows: [row(2)], meta: { page: 2, pageSize: 10, total: 11, totalPages: 2 } }) }); await retry;
    expect(page.data.rankingRows).toHaveLength(2);
  } finally { env.close(); }
});

it('discards late results when switching metric or month', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    page.onRankingMore(); // old EARNINGS page 2
    page.onRankingMetric(event('metric', 'ATTENDANCE'));
    env.reply(5, { data: board({ metric: 'ATTENDANCE', own: { value: 18, rank: 1, hasActivity: true } }) });
    await flush();
    env.reply(4, { data: board({ rows: [row(2)] }) }); await flush();
    expect(page.data.rankingRows).toHaveLength(1);
    expect(page.data.rankingOwnLabel).toContain('18');
    page.onRankingMonth({ detail: { value: '2026-09' } });
    expect(env.calls[6].url).toContain('month=2026-09');
    env.reply(6, { data: board({ month: '2026-09', metric: 'ATTENDANCE', rows: [],
      own: { value: 0, rank: null, hasActivity: false }, meta: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }) });
    await flush();
    expect(page.data.rankingState).toBe('empty');
    expect(page.data.rankingOwnLabel).toContain('暂无');
  } finally { env.close(); }
});

it.each([401, 403])('clears all private data after ranking %s and rejects late account responses', async status => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    const pending = page.onRankingRefresh();
    env.reply(4, {}, status); await pending;
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.rankingRows).toEqual([]);
    expect(page.data.summaryItems).toEqual([]);
    page.onOpenRankings(); expect(env.calls).toHaveLength(5);
  } finally { env.close(); }
});

it('ignores hidden requests and clears ranking facts when the owner changes', async () => {
  const env = captureTeacherPage('earnings');
  try {
    const page = await open(env);
    const pending = page.onRankingRefresh();
    page.onHide?.();
    env.reply(4, { data: board({ rows: [row(2)] }) }); await pending;
    expect(page.data.rankingRows[0].displayName).toBe('合成教师');
    env.change({ accessToken: 'different-synthetic-owner' });
    page.onShow?.();
    expect(page.data.rankingRows).toEqual([]);
    expect(page.data.viewState).toBe('forbidden');
  } finally { env.close(); }
});
