import { capture, fixture, flush, pendingLeaves, tap } from './operator-page-host';

it('reads home once initially and refreshes its count on return', async () => {
  const env = capture();
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    expect(env.calls).toHaveLength(1);
    env.reply(0, { data: fixture.dashboard }); await flush();
    expect(page.data.pendingCount).toBe('2');
    page.onHide?.(); page.onShow?.(); await flush();
    expect(env.calls).toHaveLength(2);
    env.reply(1, { data: { ...fixture.dashboard, pendingLeaveCount: 0, latestPendingLeave: null } });
    await flush();
    expect(page.data).toMatchObject({ pendingCount: '0', latestLeaveId: null });
  } finally { env.close(); }
});

it.each(['token', 'address', 'driver', 'logout'])('clears home after current %s changes', async (change) => {
  const env = capture();
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    if (change === 'logout') env.values.set('education.session.logged-out', true);
    else env.change(change === 'token' ? { accessToken: 'synthetic-owner-b' }
      : change === 'address' ? { apiBaseUrl: 'https://other.example.test' } : { dataDriver: 'mock' });
    env.reply(0, { data: fixture.dashboard }); await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', managerName: '', campusName: '', stats: [], latestLeaveId: null,
    });
    page.onRetry(); await flush();
    expect(env.calls).toHaveLength(1);
  } finally { env.close(); }
});

it('uses the runtime at Page creation after a module was cached', async () => {
  const env = capture(['home'], 'mock');
  try {
    env.change({ dataDriver: 'api', apiBaseUrl: 'https://current.example.test' });
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    expect(env.calls[0]?.url).toBe('https://current.example.test/operators/me/dashboard');
  } finally { env.close(); }
});

it('retains home content on refresh error and clears it on current 401', async () => {
  const env = capture();
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    env.reply(0, { data: fixture.dashboard }); await flush();
    page.onRetry(); await flush();
    env.reply(1, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', pendingCount: '2' });
    expect(page.data.refreshError).toBeTruthy();
    page.onRetry(); await flush();
    env.reply(2, {}, 401); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', stats: [], campusName: '' });
  } finally { env.close(); }
});

it('does not write unloaded home or let an old pull finish a newer pull', async () => {
  const env = capture();
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    page.onPullDownRefresh(); await flush();
    page.onHide?.(); page.onShow?.(); await flush();
    page.onPullDownRefresh(); await flush();
    env.reply(0, { data: fixture.dashboard }); await flush();
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    page.onUnload?.();
    const count = page.setData.mock.calls.length;
    for (const call of env.calls.slice(1)) call.success({ statusCode: 200, data: { data: fixture.dashboard } });
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(count);
  } finally { env.close(); }
});

it('opens the latest pending ID, toggles only completed menu entries and guards navigation', async () => {
  const env = capture();
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    env.reply(0, { data: fixture.dashboard }); await flush();
    page.onLatestLeaveTap?.(); page.onLatestLeaveTap?.();
    expect(env.platform.navigateTo).toHaveBeenCalledTimes(1);
    expect(env.platform.navigateTo).toHaveBeenLastCalledWith(expect.objectContaining({
      url: `/pages/operator/leave-requests/index?selectedLeaveId=${fixture.dashboard.latestPendingLeave!.id}`,
    }));
    env.platform.navigateTo.mock.calls[0][0].fail();
    page.onMenuToggle?.();
    expect(page.data.menuExpanded).toBe(true);
    expect(page.data.menuActions.map((item: any) => item.key)).toEqual(
      expect.arrayContaining(['students', 'schedule', 'approvals', 'warnings', 'settings', 'profile', 'student-create']),
    );
    expect(page.data.menuActions).toContainEqual({ key: 'rankings', label: '校区月榜' });
    expect(page.data.menuActions).toContainEqual({ key: 'lesson-account', label: '课时账户' });
    expect(JSON.stringify(page.data.menuActions)).not.toMatch(/withdrawal/);
  } finally { env.close(); }
});

it.each([0, 1])('clears both profile reads immediately when request %s loses permission', async (index) => {
  const env = capture(['profile']);
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    expect(env.calls).toHaveLength(2);
    env.reply(index, {}, 403); await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', displayName: '', campusName: '', studentCount: '',
    });
    env.reply(1 - index, { data: index === 0 ? fixture.dashboard : fixture.profile });
    await flush();
    expect(page.data.displayName).toBe('');
  } finally { env.close(); }
});

it('shows profile identity and the dashboard student count without inventing zero on failure', async () => {
  const env = capture(['profile']);
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flush();
    for (let index = 0; index < env.calls.length; index += 1) {
      env.reply(index, { data: env.calls[index].url.endsWith('/profile') ? fixture.profile : fixture.dashboard });
    }
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', identityLabel: '校区运营', studentCount: '106',
    });
  } finally { env.close(); }
});

it('shares Mock approval facts across home and leave Pages in the same runtime', async () => {
  const env = capture(['home', 'leave-requests'], 'mock');
  try {
    const home = env.instantiate('home');
    home.onLoad(); home.onShow?.(); await flush();
    // The fixture holds one PENDING row with canReview:false, which the product
    // deliberately excludes from the pending count, so only reviewable rows
    // appear here.
    expect(pendingLeaves.length).toBe(1);
    expect(home.data.pendingCount).toBe(String(pendingLeaves.length));
    expect(home.data.latestLeaveId).toBe(pendingLeaves[0].id);
    expect(home.data.latestLabel).toContain(pendingLeaves[0].studentName);
    home.onHide?.();
    const leave = env.instantiate('leave-requests');
    leave.onLoad({ selectedLeaveId: pendingLeaves[0].id }); leave.onShow?.(); await flush();
    leave.onApproveTap(tap(pendingLeaves[0].id));
    env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    home.onShow?.(); await flush();
    expect(home.data.pendingCount).toBe(String(pendingLeaves.length - 1));
  } finally { env.close(); }
});

it('does not let an old Mock owner invalidate the newer owners business facts', async () => {
  const env = capture(['home', 'leave-requests'], 'mock');
  try {
    const old = env.instantiate('home');
    old.onLoad(); old.onShow(); await flush();
    env.change({ accessToken: 'synthetic-owner-b' });
    const fresh = env.instantiate('leave-requests');
    fresh.onLoad({ selectedLeaveId: pendingLeaves[0].id }); fresh.onShow(); await flush();
    fresh.onApproveTap(tap(pendingLeaves[0].id));
    env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    old.onShow(); await flush();
    expect(old.data.viewState).toBe('forbidden');
    const current = env.instantiate('home');
    current.onLoad(); current.onShow(); await flush();
    // The only reviewable request was approved under the new owner, so the
    // newer owner sees no pending work left.
    expect(current.data.pendingCount).toBe(String(pendingLeaves.length - 1));
  } finally { env.close(); }
});
