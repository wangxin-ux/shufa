import { capture, flush, tap } from './operator-page-host';
import { request, id, missing, mixed, list } from './operator-leave-reviewability.fixture';
import { buildOperatorLeaveItems } from '../pages/operator/runtime/services/operator-leave.presenter';
import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';

async function loaded(rows = mixed(), total = rows.length, selectedLeaveId?: string) {
  const env = capture(['leave-requests']);
  const page = env.instantiate();
  page.onLoad(selectedLeaveId ? { selectedLeaveId } : {}); page.onShow(); await flush();
  env.reply(0, list(rows, 1, total)); await flush();
  return { env, page };
}
const approve = async (env: ReturnType<typeof capture>, page: any, target = 3) => {
  page.onApproveTap(tap(id(target)));
  expect(env.platform.showModal).toHaveBeenCalledTimes(1);
  env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
};
const fullFirstPage = () => [request(3),
  ...Array.from({ length: 19 }, (_, index) => request(30 + index, false))];

it('selects the first truly reviewable request while preserving status, order, totals and missing capability', async () => {
  const { env, page } = await loaded();
  try {
    expect(page.data.items.map((row: any) => row.id)).toEqual(mixed().map(row => row.id));
    expect(page.data.items.map((row: any) => row.status)).toEqual(['PENDING', 'PENDING', 'PENDING']);
    expect(page.data.items.map((row: any) => row.canReview)).toEqual([false, false, true]);
    expect(page.data.selectedItem?.id).toBe(id(3)); expect(page.data.total).toBe(3);
    for (const index of [1, 2]) {
      page.onRequestSelectTap(tap(id(index))); page.onApproveTap(tap(id(index))); page.onRejectTap(tap(id(index)));
    }
    expect(page.data.selectedItem?.id).toBe(id(3)); expect(page.data.rejectVisible).toBe(false);
    expect(env.platform.showModal).not.toHaveBeenCalled(); expect(env.calls).toHaveLength(1);
  } finally { env.close(); }
});
it.each([false, undefined, null, 'true', 1])('fails closed on pending capability %j without guessing the reason', (capability) => {
  const row = capability === undefined ? missing(1) : request(1, capability);
  const item = buildOperatorLeaveItems([row])[0];
  expect(item.canReview).toBe(false); expect(item.status).toBe('PENDING');
});
it.each(['APPROVED', 'REJECTED'])('never opens operations for terminal %s even when capability is true', (status) => {
  expect(buildOperatorLeaveItems([request(1, true, status)])[0].canReview).toBe(false);
});
it('paginates an all-unavailable page and selects the first available item on page two', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => i % 2 ? missing(i + 1) : request(i + 1, false));
  const { env, page } = await loaded(rows, 21);
  try {
    expect(page.data.selectedItem).toBeNull(); expect(page.data.viewState).toBe('ready'); expect(page.data.hasMore).toBe(true);
    page.onLoadMore(); await flush();
    expect(new URL(env.calls[1].url).searchParams.get('page')).toBe('2');
    env.reply(1, list([request(21)], 2, 21)); await flush();
    expect(page.data.items).toHaveLength(21); expect(page.data.selectedItem?.id).toBe(id(21)); expect(page.data.total).toBe(21);
  } finally { env.close(); }
});
it.each(['false', 'missing'])('clears selection/reject draft and stale confirmation after return becomes %s', async (mode) => {
  const { env, page } = await loaded([request(3)]);
  try {
    page.onApproveTap(tap(id(3))); const late = env.platform.showModal.mock.calls[0][0];
    page.onHide(); page.onShow(); await flush();
    env.reply(1, list([mode === 'false' ? request(3, false) : missing(3)])); await flush();
    late.success({ confirm: true }); await flush();
    expect(page.data.selectedItem).toBeNull(); expect(page.data.items[0].status).toBe('PENDING');
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
    page.onRequestSelectTap(tap(id(3))); page.onRejectTap(tap(id(3)));
    expect(page.data.rejectVisible).toBe(false);
  } finally { env.close(); }
});
it('clears a saved reject draft when a later page replaces the selected row with unavailable capability', async () => {
  const { env, page } = await loaded(fullFirstPage(), 21);
  try {
    page.onRejectTap(tap(id(3))); page.onRejectReasonInput({ detail: { value: '另行安排' } });
    page.onLoadMore(); await flush();
    env.reply(1, list([request(3, false)], 2, 21)); await flush();
    expect(page.data.selectedItem).toBeNull(); expect(page.data.rejectVisible).toBe(false);
    expect(page.data.rejectReason).toBe(''); expect(page.data.items[0].status).toBe('PENDING');
    await page.onRejectSubmit(); expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
  } finally { env.close(); }
});
it('rejects an old approval confirmation after pagination invalidates the row', async () => {
  const { env, page } = await loaded(fullFirstPage(), 21);
  try {
    page.onApproveTap(tap(id(3))); const late = env.platform.showModal.mock.calls[0][0];
    page.onLoadMore(); await flush(); env.reply(1, list([missing(3)], 2, 21)); await flush();
    late.success({ confirm: true }); await flush();
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
    expect(page.data.selectedItem).toBeNull();
  } finally { env.close(); }
});
it('approves using exact version/key then accepts an old success replay lacking capability without enabling it', async () => {
  const { env, page } = await loaded();
  try {
    await approve(env, page);
    expect(env.calls[1]).toMatchObject({ method: 'POST', data: { version: 1 }, url: expect.stringContaining(`/${id(3)}/approve`) });
    expect(env.calls[1].header['Idempotency-Key']).toBeTruthy();
    const receipt = missing(3); receipt.status = 'APPROVED'; receipt.version = 2;
    env.reply(1, { data: receipt }); await flush();
    expect(env.calls[2].method).toBe('GET'); env.reply(2, list([request(1, false), missing(2)])); await flush();
    expect(page.data.items).toHaveLength(2); expect(page.data.selectedItem).toBeNull();
    expect(page.data.selectionMessage).toBe('');
  } finally { env.close(); }
});
it('requires a rejection reason, sends trimmed original reason, and refreshes after success', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(id(3))); await page.onRejectSubmit(); await flush();
    expect(page.data.rejectError).toMatch(/填写/); expect(env.calls).toHaveLength(1);
    page.onRejectReasonInput({ detail: { value: '  另行安排  ' } }); void page.onRejectSubmit(); await flush();
    expect(env.calls[1].data).toEqual({ version: 1, reviewReason: '另行安排' });
    env.reply(1, { data: { ...request(3, false, 'REJECTED'), version: 2 } }); await flush();
    env.reply(2, list([request(1, false)])); await flush();
    expect(page.data.rejectVisible).toBe(false); expect(page.data.selectedItem).toBeNull();
  } finally { env.close(); }
});
it('clears approval and rejection on conflict then keeps the original pending row read-only', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(id(3))); page.onRejectReasonInput({ detail: { value: '另行安排' } });
    void page.onRejectSubmit(); await flush(); env.reply(1, { code: 'CONFLICT' }, 409); await flush();
    env.reply(2, list([request(3, false)])); await flush();
    expect(page.data.rejectVisible).toBe(false); expect(page.data.rejectReason).toBe('');
    expect(page.data.selectedItem).toBeNull(); expect(page.data.items[0].status).toBe('PENDING');
    page.onApproveTap(tap(id(3))); expect(env.platform.showModal).not.toHaveBeenCalled();
  } finally { env.close(); }
});
it('does not let an old item bypass capability checks through direct submission', async () => {
  const { env, page } = await loaded([request(3)]);
  try {
    const old = page.data.selectedItem;
    page.onRetry(); await flush(); env.reply(1, list([missing(3)])); await flush();
    void page.submitApprove(old); await flush();
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
  } finally { env.close(); }
});
it('retains unknown original command, reads before explicit exact-key replay, then does not infer capability from old receipt', async () => {
  const { env, page } = await loaded();
  try {
    await approve(env, page); const original = env.calls[1];
    env.reply(1, {}, 503); await flush();
    expect(page.data.reviewRecoveryAvailable).toBe(true);
    page.onApproveTap(tap(id(3))); page.onRejectTap(tap(id(3)));
    expect(env.platform.showModal).toHaveBeenCalledTimes(1); expect(page.data.rejectVisible).toBe(false);
    page.onRecoverReview(); await flush(); expect(env.calls[2].method).toBe('GET');
    env.reply(2, list([request(1, false), missing(2)])); await flush();
    expect(env.calls).toHaveLength(3); expect(page.data.reviewRecoveryReady).toBe(true);
    page.onRecoverReview(); await flush();
    expect(env.calls[3]).toMatchObject({ url: original.url, data: original.data,
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
    const receipt = missing(3); receipt.status = 'APPROVED';
    env.reply(3, { data: receipt }); await flush(); env.reply(4, list([request(1, false)])); await flush();
    expect(page.data.selectedItem).toBeNull(); expect(page.data.reviewRecoveryAvailable).toBe(false);
  } finally { env.close(); }
});
it.each([401, 403])('clears private state and pending confirmation on %s and ignores late success', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onApproveTap(tap(id(3))); const late = env.platform.showModal.mock.calls[0][0];
    page.onRetry(); await flush(); page.onHide(); env.reply(1, {}, status); await flush();
    page.onShow(); late.success({ confirm: true }); await flush();
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.items).toEqual([]);
    expect(page.data.selectedItem).toBeNull(); expect(page.data.rejectVisible).toBe(false);
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
  } finally { env.close(); }
});
it.each([{ accessToken: 'synthetic-next' }, { apiBaseUrl: 'https://next.example.test' }, { dataDriver: 'mock' }])(
  'rejects late authority under runtime change %j', async patch => {
    const { env, page } = await loaded();
    try {
      page.onRetry(); await flush(); env.change(patch); env.reply(1, list(mixed())); await flush();
      expect(page.data.viewState).toBe('forbidden'); expect(page.data.items).toEqual([]);
      expect(page.data.selectedItem).toBeNull();
    } finally { env.close(); }
  },
);
it('retains unknown command through hide/show, clears visible rejection and never auto-posts on return', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(id(3))); page.onRejectReasonInput({ detail: { value: '另行安排' } });
    void page.onRejectSubmit(); await flush(); const original = env.calls[1];
    page.onHide(); original.fail(new Error('unknown')); await flush();
    expect(page.data.rejectVisible).toBe(false); expect(page.data.selectedItem).toBeNull();
    page.onShow(); await flush(); env.reply(2, list([request(3, false)])); await flush();
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    page.onRecoverReview(); await flush();
    expect(env.calls[env.calls.length - 1]).toMatchObject({ method: 'POST', data: original.data,
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
  } finally { env.close(); }
});
it('keeps history ordering/paging and uses the existing reviewedOnly query', async () => {
  const { env, page } = await loaded();
  try {
    page.onTabTap({ currentTarget: { dataset: { key: 'history' } } }); await flush();
    const query = new URL(env.calls[1].url).searchParams;
    expect(query.get('reviewedOnly')).toBe('true'); expect(query.has('status')).toBe(false);
    const rows = [request(7, false, 'REJECTED'), request(6, false, 'APPROVED'),
      ...Array.from({ length: 18 }, (_, index) => request(100 + index, false, 'APPROVED'))];
    env.reply(1, list(rows, 1, 21)); await flush(); page.onLoadMore(); await flush();
    env.reply(2, list([request(5, false, 'APPROVED')], 2, 21)); await flush();
    expect(page.data.items.map((row: any) => row.id)).toEqual([...rows.map(row => row.id), id(5)]);
    expect(page.data.total).toBe(21); expect(page.data.selectedItem).toBeNull();
  } finally { env.close(); }
});
it('keeps mock pending history and capability, refuses unavailable writes and marks success non-reviewable', async () => {
  const source = new MockOperatorDataSource();
  const rows = await source.listLeaveRequests({ page: 1, pageSize: 20, status: 'PENDING' });
  expect(rows.data.every(row => typeof row.canReview === 'boolean')).toBe(true);
  expect(rows.data.some(row => row.canReview === false)).toBe(true);
  const blocked = rows.data.find(row => row.canReview === false)!;
  await expect(source.approveLeaveRequest(blocked.id, blocked.version, undefined, 'mock-block')).rejects.toMatchObject({ statusCode: 409 });
  const allowed = rows.data.find(row => row.canReview === true)!;
  const result = await source.approveLeaveRequest(allowed.id, allowed.version, undefined, 'mock-approve');
  expect(result.canReview).toBe(false);
  expect(await source.approveLeaveRequest(allowed.id, allowed.version, undefined, 'mock-approve')).toEqual(result);
  expect((await source.listLeaveRequests({ page: 1, pageSize: 20, status: 'PENDING' })).data).toHaveLength(1);
  expect((await source.getDashboard()).pendingLeaveCount).toBe(0);
});
it('clears private selection and rejection immediately when hidden, then requires fresh authority', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(id(3))); page.onRejectReasonInput({ detail: { value: '另行安排' } });
    page.onHide();
    expect(page.data.items).toEqual([]); expect(page.data.selectedItem).toBeNull();
    expect(page.data.rejectReason).toBe(''); expect(page.data.rejectVisible).toBe(false);
    page.onShow(); await flush();
    page.onApproveTap(tap(id(3))); expect(env.platform.showModal).not.toHaveBeenCalled();
    env.reply(1, list([missing(3)])); await flush(); expect(page.data.selectedItem).toBeNull();
  } finally { env.close(); }
});
it('blocks new operations while pagination is pending and after failure until valid revalidation', async () => {
  const { env, page } = await loaded(fullFirstPage(), 21);
  try {
    page.onLoadMore(); await flush(); page.onApproveTap(tap(id(3)));
    expect(env.platform.showModal).not.toHaveBeenCalled();
    env.reply(1, {}, 503); await flush();
    expect(page.data.items).toHaveLength(20); expect(page.data.selectedItem).toBeNull();
    expect(page.data.reviewBlocked).toBe(true); expect(page.data.loadMoreError).toBeTruthy();
    page.onRejectTap(tap(id(3))); expect(page.data.rejectVisible).toBe(false);
    page.onRetry(); await flush(); env.reply(2, list([request(3, false)])); await flush();
    expect(page.data.items[0].status).toBe('PENDING'); expect(page.data.selectedItem).toBeNull();
  } finally { env.close(); }
});
it.each([
  ['wrong page', { data: [request(3)], meta: { page: 2, pageSize: 20, total: 1, totalPages: 1 } }],
  ['negative total', { data: [request(3)], meta: { page: 1, pageSize: 20, total: -1, totalPages: 1 } }],
  ['inconsistent pages', { data: [request(3)], meta: { page: 1, pageSize: 20, total: 1, totalPages: 2 } }],
  ['invalid version', list([{ ...request(3), version: null }])],
  ['missing rows', { meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } }],
])('does not permit an original command replay after malformed authority: %s', async (_, response) => {
  const { env, page } = await loaded();
  try {
    await approve(env, page); env.reply(1, {}, 503); await flush();
    page.onRecoverReview(); await flush(); env.reply(2, response); await flush();
    expect(page.data.reviewRecoveryAvailable).toBe(true); expect(page.data.reviewRecoveryReady).toBe(false);
    expect(page.data.selectedItem).toBeNull(); expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  } finally { env.close(); }
});
it('requires another authority read after an unknown replay and preserves the original command again', async () => {
  const { env, page } = await loaded();
  try {
    await approve(env, page); const original = env.calls[1];
    env.reply(1, {}, 503); await flush(); page.onRecoverReview(); await flush();
    env.reply(2, list([request(3, false)])); await flush(); page.onRecoverReview(); await flush();
    env.calls[3].fail(new Error('unknown replay')); await flush();
    expect(page.data.reviewRecoveryReady).toBe(false);
    page.onRecoverReview(); await flush(); expect(env.calls[4].method).toBe('GET');
    env.reply(4, list([request(3, false)])); await flush(); page.onRecoverReview(); await flush();
    expect(env.calls[5]).toMatchObject({ method: 'POST', url: original.url, data: original.data,
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
  } finally { env.close(); }
});
it('keeps the original rejected command immutable after the visible form is cleared', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(id(3))); page.onRejectReasonInput({ detail: { value: '  另行安排  ' } });
    void page.onRejectSubmit(); await flush(); const original = env.calls[1];
    env.reply(1, {}, 503); await flush();
    expect(page.data.rejectReason).toBe(''); expect(Object.keys(page.uncertainReview).sort())
      .toEqual(['id', 'operation', 'reviewReason', 'version']);
    page.onRejectReasonInput({ detail: { value: '变更原因' } });
    page.onRecoverReview(); await flush(); env.reply(2, list([missing(3)])); await flush();
    page.onRecoverReview(); await flush();
    expect(env.calls[3].data).toEqual({ version: 1, reviewReason: '另行安排' });
    expect(env.calls[3].header['Idempotency-Key']).toBe(original.header['Idempotency-Key']);
  } finally { env.close(); }
});
it('does not reenable old capability when successful review readback fails', async () => {
  const { env, page } = await loaded([request(3)]);
  try {
    await approve(env, page);
    env.reply(1, { data: { ...missing(3), status: 'APPROVED', version: 2 } }); await flush();
    env.reply(2, {}, 503); await flush();
    expect(page.data.selectedItem).toBeNull(); expect(page.data.reviewBlocked).toBe(true);
    page.onApproveTap(tap(id(3))); page.onRejectTap(tap(id(3)));
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(env.platform.showModal).toHaveBeenCalledTimes(1);
  } finally { env.close(); }
});
it.each(['success', 'unknown'])('ignores %s write replies after unload without retaining commands', async mode => {
  const { env, page } = await loaded();
  try {
    await approve(env, page); page.onUnload(); page.setData.mockClear();
    if (mode === 'success') env.reply(1, { data: { ...request(3, false, 'APPROVED'), version: 2 } });
    else env.calls[1].fail(new Error('unknown'));
    await flush();
    expect(page.setData).not.toHaveBeenCalled(); expect(page.uncertainReview).toBeUndefined();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});
it('ignores an authority reply after unload and clears identity-bound unknown commands', async () => {
  const { env, page } = await loaded();
  try {
    await approve(env, page); env.reply(1, {}, 503); await flush();
    page.onRecoverReview(); await flush(); page.onUnload(); page.setData.mockClear();
    env.reply(2, list([request(3)])); await flush();
    expect(page.setData).not.toHaveBeenCalled(); expect(page.uncertainReview).toBeUndefined();
  } finally { env.close(); }
});
it('clears an unknown command when identity changes before its response', async () => {
  const { env, page } = await loaded();
  try {
    await approve(env, page); env.change({ accessToken: 'synthetic-next' });
    env.calls[1].fail(new Error('unknown')); await flush();
    expect(page.data.viewState).toBe('forbidden'); expect(page.uncertainReview).toBeUndefined();
    expect(page.data.reviewRecoveryAvailable).toBe(false); expect(page.data.items).toEqual([]);
  } finally { env.close(); }
});
it('coalesces repeated approval submission while the first command is in flight', async () => {
  const { env, page } = await loaded();
  try {
    const original = page.data.selectedItem;
    await approve(env, page); void page.submitApprove(original); void page.submitApprove(original); await flush();
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  } finally { env.close(); }
});

it.each([{ rows: [] }, { rows: [request(3)] }])('review regression: rejects an incomplete first page with total 21 (%j)', async ({ rows }) => {
  const { env, page } = await loaded(rows, 21);
  try {
    expect(page.data.viewState).toBe('error');
    expect(page.data.errorMessage).toMatch(/数据异常/);
    expect(page.data.selectedItem).toBeNull();
    expect(page.data.reviewBlocked).toBe(true);
    page.onApproveTap(tap(id(3)));
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
  } finally { env.close(); }
});

it.each([{ rows: [] }, { rows: [request(3, false)] }])('review regression: incomplete authority never enables original command recovery (%j)', async ({ rows }) => {
  const { env, page } = await loaded();
  try {
    await approve(env, page); env.reply(1, {}, 503); await flush();
    page.onRecoverReview(); await flush(); env.reply(2, list(rows, 1, 21)); await flush();
    expect(page.data.reviewRecoveryAvailable).toBe(true);
    expect(page.data.reviewRecoveryReady).toBe(false);
    expect(page.data.refreshError).toMatch(/数据异常/);
    page.onRecoverReview(); await flush();
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(env.calls[env.calls.length - 1]?.method).toBe('GET');
  } finally { env.close(); }
});
