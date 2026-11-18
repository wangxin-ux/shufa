import { capture, flush } from './operator-page-host';
import { archive } from './operator-student-archive.fixture';

const student = archive;
type Env = ReturnType<typeof capture>;
function reply(env: Env, index: number, data = student) {
  env.reply(index * 2, { data });
  env.reply(index * 2 + 1, { data: { items: [] }, meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 } });
}

async function loaded() {
  const env = capture(['student-detail']);
  const page = env.instantiate();
  page.onLoad({ id: student.id }); page.onShow?.(); await flush();
  reply(env, 0); await flush();
  return { env, page };
}

it('loads once on first show and keeps same-name IDs and separate Page instances independent', async () => {
  const env = capture(['student-detail']);
  try {
    const first = env.instantiate(); first.onLoad({ id: student.id }); first.onShow?.(); await flush();
    const second = env.instantiate(); second.onLoad({ id: 'synthetic-student-b' }); second.onShow?.(); await flush();
    expect(env.calls).toHaveLength(4);
    expect(env.calls[2].url).toMatch(/\/students\/synthetic-student-b\/archive$/);
    reply(env, 1, { ...student, id: 'synthetic-student-b', classes: [{ ...student.classes[0], className: '周末班' }] });
    reply(env, 0); await flush();
    expect(first.data.detail).toMatchObject({ id: student.id, classLabel: '创意班', mainBalanceLabel: '11' });
    expect(second.data.detail).toMatchObject({ id: 'synthetic-student-b', classLabel: '周末班' });
    first.onUnload?.();
    second.onRetry(); await flush(); reply(env, 2, { ...student, id: 'synthetic-student-b' }); await flush();
    expect(second.data.viewState).toBe('ready');
  } finally { env.close(); }
});

it('refreshes on return, retains usable detail on ordinary failure, and retries without duplicate reads', async () => {
  const { env, page } = await loaded();
  try {
    page.onHide?.(); page.onShow?.(); await flush();
    expect(env.calls).toHaveLength(4);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshing).toBe(true);
    env.reply(2, {}, 503); await flush();
    env.reply(3, { data: { items: [] }, meta: { page: 1, pageSize: 5, total: 0, totalPages: 0 } }); await flush();
    expect(page.data.detail.id).toBe(student.id);
    expect(page.data).toMatchObject({ viewState: 'ready', refreshing: false });
    expect(page.data.refreshError).toBeTruthy();
    page.onRetry(); page.onRetry(); await flush();
    expect(env.calls).toHaveLength(6);
    reply(env, 2, { ...student, mainAvailableUnits: 800 }); await flush();
    expect(page.data).toMatchObject({ refreshError: '', detail: { mainBalanceLabel: '8' } });
  } finally { env.close(); }
});

it.each([401, 403])('clears current private detail on %s and stops further reads', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onRetry(); await flush(); env.reply(2, {}, status); await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', detail: null, studentId: '', refreshing: false, refreshError: '',
    });
    page.onRetry(); await flush();
    expect(env.calls).toHaveLength(4);
    page.onLogin?.();
    expect(env.platform.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  } finally { env.close(); }
});

it('captures address and token at Page creation and never logs out a newer owner', async () => {
  const env = capture(['student-detail']);
  try {
    const old = env.instantiate(); old.onLoad({ id: student.id }); old.onShow?.(); await flush();
    env.change({ apiBaseUrl: 'https://current.example.test', accessToken: 'synthetic-owner-b' });
    const fresh = env.instantiate(); fresh.onLoad({ id: student.id }); fresh.onShow?.(); await flush();
    expect(env.calls[2]).toMatchObject({
      url: `https://current.example.test/operators/me/students/${student.id}/archive`,
      header: { Authorization: 'Bearer synthetic-owner-b' },
    });
    reply(env, 1); reply(env, 0); await flush();
    expect(old.data).toMatchObject({ viewState: 'forbidden', detail: null, studentId: '' });
    expect(fresh.data.viewState).toBe('ready');
    old.onLogin?.();
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-owner-b');
  } finally { env.close(); }
});

it('rejects hidden and unloaded replies and does not stop a newer Pages pull refresh', async () => {
  const { env, page } = await loaded();
  try {
    page.onPullDownRefresh(); await flush();
    page.onHide?.();
    const hiddenUpdates = page.setData.mock.calls.length;
    page.onShow?.(); page.onPullDownRefresh(); await flush();
    reply(env, 1, { ...student, displayName: '旧回复' }); await flush();
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    expect(page.setData.mock.calls.length).toBeGreaterThanOrEqual(hiddenUpdates);
    expect(page.data.detail.displayName).toBe(student.displayName);
    reply(env, 2); await flush();
    expect(env.platform.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    page.onRetry(); await flush();
    page.onUnload?.();
    const count = page.setData.mock.calls.length;
    reply(env, 3); await flush();
    expect(page.setData).toHaveBeenCalledTimes(count);
  } finally { env.close(); }
});

it('does not request without an ID and removes previously loaded detail after a 404', async () => {
  const { env, page } = await loaded();
  try {
    const missing = env.instantiate(); missing.onLoad({}); missing.onShow?.(); await flush();
    expect(env.calls).toHaveLength(2);
    expect(missing.data).toMatchObject({ viewState: 'error', detail: null });
    page.onRetry(); await flush(); env.reply(2, {}, 404); await flush();
    expect(page.data).toMatchObject({ viewState: 'error', detail: null, refreshing: false });
  } finally { env.close(); }
});

it.each([401, 403])('clears detail immediately on hidden %s even if a later return read would fail', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onRetry(); await flush(); page.onHide();
    env.reply(2, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, studentId: '' });
    page.onShow(); await flush();
    expect(env.calls).toHaveLength(4);
  } finally { env.close(); }
});
