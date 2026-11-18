import { captureHeadquarters, flush, tap } from './operator-headquarters-host';
import { uuid, directory, headquartersMe, totalSummary, campusSummary } from './operator-headquarters.fixture';

const index = (env: ReturnType<typeof captureHeadquarters>, suffix: string) =>
  env.calls.findIndex(call => new URL(call.url).pathname.endsWith(suffix));

it('loads the granted campus directory after null-campus OPERATOR identity proof', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    expect(env.sessionCalls.length).toBeGreaterThan(0);
    expect(env.calls.map(call => new URL(call.url).pathname)).toContain('/operators/me/headquarters/campuses');
    env.reply(index(env, '/campuses'), directory()); await flush();
    expect(page.data.campuses).toHaveLength(20);
    expect(page.data.directoryTotal).toBe(23);
    expect(page.data.hasMore).toBe(true);
  } finally { env.close(); }
});

it('reads all-authorized totals independently of the loaded twenty-campus page', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    expect(env.calls.map(call => new URL(call.url).pathname)).toContain('/operators/me/headquarters/summary');
    env.reply(index(env, '/headquarters/summary'), { data: totalSummary() }); await flush();
    expect(page.data.totalSummary.campusCount).toBe(23);
    expect(page.data.totalSummary.activeStudentCount).toBe(851);
    expect(page.data.totalSummary.account.enrollmentSummary.refundedAmountFen).toBeNull();
    expect(page.data.totalPresentation.earnings[0].value).toBe('-283.82元');
  } finally { env.close(); }
});

async function ready() {
  const env = captureHeadquarters(), page = env.instantiate(); await flush();
  env.reply(index(env, '/campuses'), directory());
  env.reply(index(env, '/headquarters/summary'), { data: totalSummary() }); await flush();
  return { env, page };
}

it.each([
  { userId: uuid(900), roles: [{ code: 'OPERATOR', campusId: uuid(1) }] },
  { userId: uuid(900), roles: [{ code: 'OPERATOR' }] },
  { userId: uuid(900), roles: [{ code: 'SUPER_ADMIN', campusId: null }] },
  { userId: uuid(900), roles: [{ code: 'OPERATOR', campusId: null }, { code: 'TEACHER', campusId: uuid(1) }] },
  { userId: '', roles: [{ code: 'OPERATOR', campusId: null }] },
])('rejects a non-headquarters identity before any headquarters request: %j', async me => {
  const env = captureHeadquarters();
  try {
    env.setMe(me); const page = env.instantiate(); await flush();
    expect(page.data.viewState).toBe('forbidden'); expect(env.calls).toHaveLength(0);
  } finally { env.close(); }
});

it('keeps first-page campuses on a second-page error and explicitly retries page two', async () => {
  const { env, page } = await ready();
  try {
    page.onLoadMore(); page.onLoadMore(); await flush();
    const second = env.calls.length - 1;
    expect(new URL(env.calls[second].url).searchParams.get('page')).toBe('2');
    env.reply(second, {}, 503); await flush();
    expect(page.data.campuses).toHaveLength(20);
    expect(page.data.directoryError).toBeTruthy();
    page.onRetryDirectory(); await flush();
    expect(new URL(env.calls[env.calls.length - 1].url).searchParams.get('page')).toBe('2');
    env.reply(env.calls.length - 1, directory(2)); await flush();
    expect(page.data.campuses).toHaveLength(23);
    expect(page.data.campuses[20].id).toBe(uuid(21));
    expect(page.data.hasMore).toBe(false);
    expect(page.data.totalSummary.activeStudentCount).toBe(851);
  } finally { env.close(); }
});

it('clears old campus details and directory on input immediately while keeping independent totals', async () => {
  const { env, page } = await ready();
  try {
    page.onCampusTap(tap(uuid(1))); await flush();
    env.reply(env.calls.length - 1, { data: campusSummary() }); await flush();
    expect(page.data.campusSummary.campus.id).toBe(uuid(1));
    page.onQueryInput({ detail: { value: '合成校区23' } });
    expect(page.data.campusSummary).toBeNull(); expect(page.data.selectedCampusId).toBe('');
    expect(page.data.campuses).toEqual([]);
    expect(page.data.totalSummary.activeStudentCount).toBe(851);
    page.onSearch(); await flush();
    const call = env.calls[env.calls.length - 1];
    expect(new URL(call.url).searchParams.get('query')).toBe('合成校区23');
    env.reply(env.calls.length - 1, directory(1, '合成校区23')); await flush();
    expect(page.data.campuses).toHaveLength(1);
    expect(env.calls.filter(call => new URL(call.url).pathname.endsWith('/headquarters/summary'))).toHaveLength(1);
  } finally { env.close(); }
});

it('ignores a superseded detail and rejects an unlisted forged campus ID', async () => {
  const { env, page } = await ready();
  try {
    const count = env.calls.length;
    page.onCampusTap(tap(uuid(999))); await flush(); expect(env.calls).toHaveLength(count);
    page.onCampusTap(tap(uuid(1))); await flush(); const old = env.calls.length - 1;
    page.onCampusTap(tap(uuid(2))); await flush(); const latest = env.calls.length - 1;
    env.reply(latest, { data: campusSummary(2) }); env.reply(old, { data: campusSummary(1) }); await flush();
    expect(page.data.campusSummary.campus.id).toBe(uuid(2));
    expect(page.data.totalSummary.activeStudentCount).toBe(851);
  } finally { env.close(); }
});

it.each([401, 403])('clears every private region on current detail HTTP %s including hidden responses', async status => {
  const { env, page } = await ready();
  try {
    page.onCampusTap(tap(uuid(1))); await flush(); const current = env.calls.length - 1;
    page.onHide(); env.reply(current, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', campuses: [], totalSummary: null, campusSummary: null, selectedCampusId: '', query: '' });
    const count = env.calls.length;
    page.onShow(); page.onSearch(); page.onRetryTotal(); await flush(); expect(env.calls).toHaveLength(count);
  } finally { env.close(); }
});

it('clears sibling Page private data on the same owner revocation without clearing a new owner', async () => {
  const { env, page } = await ready();
  try {
    const other = env.instantiate(); await flush(); const start = env.calls.length - 2;
    for (let i = start; i < env.calls.length; i++) env.reply(i,
      new URL(env.calls[i].url).pathname.endsWith('/campuses') ? directory() : { data: totalSummary() });
    await flush(); expect(other.data.totalSummary).not.toBeNull();
    page.onRetryTotal(); await flush(); env.reply(env.calls.length - 1, {}, 403); await flush();
    expect(other.data).toMatchObject({ viewState: 'forbidden', campuses: [], totalSummary: null });
    env.change({ accessToken: 'synthetic-new-owner' }); env.setMe({ ...headquartersMe(), userId: uuid(901) });
    const fresh = env.instantiate(); await flush();
    expect(fresh.data.viewState).not.toBe('forbidden');
  } finally { env.close(); }
});

it.each([{ accessToken: 'synthetic-new' }, { apiBaseUrl: 'https://new.example.test' }, { dataDriver: 'mock' }])(
  'clears idle private state on runtime ownership change: %j', async change => {
    jest.useFakeTimers();
    const { env, page } = await ready();
    try {
      env.change(change); jest.advanceTimersByTime(1000); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', campuses: [], totalSummary: null, campusSummary: null });
    } finally { env.close(); jest.useRealTimers(); }
  });

it('drops hidden and unloaded responses and re-proves identity on return', async () => {
  const { env, page } = await ready();
  try {
    page.onCampusTap(tap(uuid(1))); await flush(); const old = env.calls.length - 1;
    page.onHide(); expect(page.data.totalSummary).toBeNull();
    env.reply(old, { data: campusSummary() }); await flush(); expect(page.data.campusSummary).toBeNull();
    const proofs = env.sessionCalls.length;
    page.onShow(); await flush(); expect(env.sessionCalls.length).toBeGreaterThan(proofs);
    const count = page.setData.mock.calls.length;
    page.onUnload();
    for (const call of env.calls.slice(old + 1)) call.success({ statusCode: 200, data: { data: totalSummary() } });
    await flush(); expect(page.setData.mock.calls.length).toBe(count + 1);
  } finally { env.close(); }
});

it('does not send a queued business GET after identity proof completes while hidden', async () => {
  const env = captureHeadquarters();
  try {
    env.manualMe(); const page = env.instantiate(); await flush();
    page.onHide();
    env.sessionCalls[0].success({ statusCode: 200, data: { data: headquartersMe() } }); await flush();
    expect(env.calls).toHaveLength(0);
    expect(page.data.totalSummary).toBeNull();
  } finally { env.close(); }
});

it('treats malformed page data as an error and never as empty authorization', async () => {
  const env = captureHeadquarters();
  try {
    const page = env.instantiate(); await flush();
    env.reply(index(env, '/campuses'), { data: [], meta: { page: 1, pageSize: 20, total: 23, totalPages: 2 } }); await flush();
    expect(page.data.directoryState).toBe('error'); expect(page.data.campuses).toEqual([]);
    page.onRetryDirectory(); await flush(); env.reply(env.calls.length - 1, directory()); await flush();
    expect(page.data.directoryState).toBe('ready'); expect(page.data.campuses).toHaveLength(20);
  } finally { env.close(); }
});

it('keeps regional and total errors independently retryable without leaking server messages', async () => {
  const { env, page } = await ready();
  try {
    page.onRetryTotal(); await flush(); env.reply(env.calls.length - 1, { message: 'SECRET_INTERNAL_FAILURE' }, 500); await flush();
    expect(page.data.totalSummary).toBeNull();
    expect(page.data.totalError).toBeTruthy();
    expect(JSON.stringify(page.data)).not.toContain('SECRET_INTERNAL_FAILURE');
    expect(page.data.campuses).toHaveLength(20);
    page.onRetryTotal(); await flush(); env.reply(env.calls.length - 1, { data: totalSummary() }); await flush();
    expect(page.data.totalState).toBe('ready');
  } finally { env.close(); }
});

it('returns to bootstrap from a direct headquarters entry and never opens ordinary operator business routes', async () => {
  const { env, page } = await ready();
  try {
    page.onBack();
    expect(env.platform.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    expect(env.calls.every(call => call.method === 'GET' && new URL(call.url).pathname.startsWith('/operators/me/headquarters/'))).toBe(true);
  } finally { env.close(); }
});
