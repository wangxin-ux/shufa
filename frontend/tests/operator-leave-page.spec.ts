import { capture, flush, pendingRows, tap } from './operator-page-host';

const pendingLeaves = pendingRows.map(row => ({ ...row, canReview: true }));

async function loaded() {
  const env = capture(['leave-requests']);
  const page = env.instantiate();
  page.onLoad({ selectedLeaveId: pendingLeaves[0].id }); page.onShow?.(); await flush();
  env.list(0, pendingLeaves); await flush();
  return { env, page };
}

it('selects only the pending deep link and preserves independent Page request lists', async () => {
  const { env, page } = await loaded();
  try {
    expect(page.data.selectedItem.id).toBe(pendingLeaves[0].id);
    const other = env.instantiate();
    other.onLoad({}); other.onShow?.(); await flush();
    env.list(1, [{ ...pendingLeaves[1], id: 'other-only' }]); await flush();
    other.onUnload?.();
    page.onApproveTap(tap(pendingLeaves[0].id));
    expect(env.platform.showModal).toHaveBeenCalledTimes(1);
    expect(page.data.items.map((item: any) => item.id)).toContain(pendingLeaves[0].id);
  } finally { env.close(); }
});

it('locks duplicate approval confirmations and releases the lock on modal failure', async () => {
  const { env, page } = await loaded();
  try {
    page.onApproveTap(tap(pendingLeaves[0].id)); page.onApproveTap(tap(pendingLeaves[0].id));
    expect(env.platform.showModal).toHaveBeenCalledTimes(1);
    env.platform.showModal.mock.calls[0][0].fail?.();
    page.onApproveTap(tap(pendingLeaves[0].id));
    expect(env.platform.showModal).toHaveBeenCalledTimes(2);
  } finally { env.close(); }
});

it.each(['hide', 'unload', 'owner', 'selection'])('ignores old approval confirmation after %s', async (action) => {
  const { env, page } = await loaded();
  try {
    page.onApproveTap(tap(pendingLeaves[0].id));
    const modal = env.platform.showModal.mock.calls[0][0];
    if (action === 'owner') env.change({ accessToken: 'synthetic-owner-b' });
    else if (action === 'selection') page.onRequestSelectTap(tap(pendingLeaves[1].id));
    else if (action === 'hide') page.onHide?.();
    else page.onUnload?.();
    modal.success({ confirm: true }); await flush();
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  } finally { env.close(); }
});

it('retains the original rejection command and requires a read before exact key/body recovery', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(pendingLeaves[0].id));
    page.onRejectReasonInput({ detail: { value: '  时间不符  ' } });
    const first = page.onRejectSubmit(); await flush();
    page.onRejectReasonInput({ detail: { value: '提交中不能修改' } });
    page.onRequestSelectTap(tap(pendingLeaves[1].id));
    expect(page.data.rejectReason).toBe('  时间不符  ');
    env.calls[1].fail(new Error('网络中断')); await first;
    expect(page.data).toMatchObject({ rejectVisible: false, rejectReason: '', submitting: false,
      reviewRecoveryAvailable: true, reviewRecoveryReady: false });
    await page.onRejectSubmit(); expect(env.calls).toHaveLength(2);
    page.onRecoverReview(); await flush();
    expect(env.calls[2].method).toBe('GET');
    env.list(2, pendingLeaves); await flush();
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    page.onRecoverReview(); await flush();
    expect(env.calls[3].data).toEqual({ version: 1, reviewReason: '时间不符' });
    expect(env.calls[3].header['Idempotency-Key']).toBe(env.calls[1].header['Idempotency-Key']);
    env.reply(3, { data: { ...pendingLeaves[0], status: 'REJECTED', version: 2 } }); await flush();
    env.list(4, [pendingLeaves[1]]); await flush();
    expect(page.data.rejectReason).toBe('');
  } finally { env.close(); }
});

it('keeps rows on page-two failure but clears the unverified selection and rejection before retry', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(pendingLeaves[0].id));
    page.onRejectReasonInput({ detail: { value: '保留原因' } });
    page.data.hasMore = true;
    page.onLoadMore(); await flush();
    env.reply(1, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', page: 1, hasMore: true,
      rejectReason: '', rejectVisible: false, selectedItem: null, reviewBlocked: true });
    page.onLoadMore(); await flush();
    expect(env.calls[2].url).toContain('page=2');
    env.list(2, [], 2, 2); await flush();
  } finally { env.close(); }
});

it('requires a successful reread before reviewing rows retained after refresh failure', async () => {
  const { env, page } = await loaded();
  try {
    page.onRetry(); await flush();
    env.reply(1, {}, 503); await flush();
    expect(page.data.items).toHaveLength(2);
    page.onApproveTap(tap(pendingLeaves[0].id)); await flush();
    expect(env.platform.showModal).not.toHaveBeenCalled();
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  } finally { env.close(); }
});

it('discards a late pending response after switching to history', async () => {
  const env = capture(['leave-requests']);
  try {
    const page = env.instantiate();
    page.onLoad({}); page.onShow?.(); await flush();
    page.onTabTap(tap('history')); await flush();
    env.list(1, []); await flush();
    env.list(0); await flush();
    expect(page.data).toMatchObject({ activeTab: 'history', viewState: 'empty', items: [], selectedItem: null });
  } finally { env.close(); }
});

it.each([false, true])('keeps the pending selection across history and clears it if the request left pending=%s', async (leftPending) => {
  const { env, page } = await loaded();
  try {
    page.onRequestSelectTap(tap(pendingLeaves[1].id));
    page.onTabTap(tap('history')); await flush();
    env.list(1, []); await flush();
    expect(page.data.selectedItem).toBeNull();
    page.onTabTap(tap('pending')); await flush();
    env.list(2, leftPending ? [pendingLeaves[0]] : pendingLeaves); await flush();
    if (leftPending) {
      expect(page.data.selectedItem).toBeNull();
      expect(page.data.selectionMessage).toBeTruthy();
      page.onRequestSelectTap(tap(pendingLeaves[0].id));
      expect(page.data.selectedItem.id).toBe(pendingLeaves[0].id);
    } else {
      expect(page.data.selectedItem.id).toBe(pendingLeaves[1].id);
      expect(page.data.selectionMessage).toBe('');
    }
  } finally { env.close(); }
});

it.each([401, 403])('clears list, selection and rejection draft on %s', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(pendingLeaves[0].id));
    page.onRejectReasonInput({ detail: { value: '私有原因' } });
    page.onRetry(); await flush();
    env.reply(1, {}, status); await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], selectedItem: null, rejectVisible: false,
      rejectId: '', rejectStudentName: '', rejectReason: '',
    });
  } finally { env.close(); }
});

it('clears a rejection draft when the approval POST returns 401', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(pendingLeaves[0].id));
    page.onRejectReasonInput({ detail: { value: '私有原因' } });
    const saving = page.onRejectSubmit(); await flush();
    env.reply(1, {}, 401); await saving;
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], rejectReason: '', rejectVisible: false,
    });
  } finally { env.close(); }
});

it('releases a review that finishes after returning and rereads without automatically writing again', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(pendingLeaves[0].id));
    page.onRejectReasonInput({ detail: { value: '保留原因' } });
    const saving = page.onRejectSubmit(); await flush();
    page.onHide?.(); page.onShow?.(); await flush();
    env.list(2); await flush();
    env.calls[1].fail(new Error('网络中断')); await flush();
    expect(page.data.submitting).toBe(false);
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(env.calls[3]?.method).toBe('GET');
    env.list(3); await saving;
    expect(page.data.rejectReason).toBe('');
    expect(page.uncertainReview).toMatchObject({ operation: 'reject', reviewReason: '保留原因' });
    expect(page.data.reviewRecoveryReady).toBe(true);
  } finally { env.close(); }
});

it.each([401, 403])('clears a current-owner %s review result after hide/show even if the return read finished', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(pendingLeaves[0].id));
    page.onRejectReasonInput({ detail: { value: '私有草稿' } });
    const saving = page.onRejectSubmit(); await flush();
    page.onHide(); page.onShow(); await flush();
    env.list(2); await flush();
    env.reply(1, {}, status); await flush();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', items: [], selectedItem: null,
      rejectVisible: false, rejectReason: '', submitting: false,
    });
    await saving;
  } finally { env.close(); }
});

it.each([401, 403])('clears a hidden current-owner %s review result before the next show', async (status) => {
  const { env, page } = await loaded();
  try {
    const saving = page.submitApprove(page.data.selectedItem); await flush();
    page.onHide();
    env.reply(1, {}, status); await saving;
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], selectedItem: null });
    page.onShow(); await flush();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it.each([200, 409])('blocks review during pagination and ignores its old response after review %s', async (status) => {
  const { env, page } = await loaded();
  try {
    page.data.hasMore = true;
    page.onLoadMore(); await flush();
    const selected = page.data.selectedItem;
    await page.submitApprove(selected); await flush();
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(0);
    env.list(1, [], 2, 2); await flush();
    const saving = page.submitApprove(page.data.selectedItem); await flush();
    expect(env.calls[2].method).toBe('POST');
    env.reply(2, status === 200
      ? { data: { ...pendingLeaves[0], status: 'APPROVED', version: 2 } } : {}, status);
    await flush();
    expect(env.calls[3]?.url).toContain('page=1&');
    expect(page.data.reviewBlocked).toBe(true);
    env.list(1, [{ ...pendingLeaves[0], id: 'stale-page-two' }], 2); await flush();
    expect(page.data.items.some((item: any) => item.id === 'stale-page-two')).toBe(false);
    env.list(3, [pendingLeaves[1]]); await saving;
    expect(page.data).toMatchObject({ page: 1, reviewBlocked: false });
    expect(page.data.selectedItem?.id ?? null).toBe(status === 200 ? pendingLeaves[1].id : null);
    expect(page.data.items.map((item: any) => item.id)).toEqual([pendingLeaves[1].id]);
  } finally { env.close(); }
});

it('retains an unknown rejection key through hide, reread and explicit retry', async () => {
  const { env, page } = await loaded();
  try {
    page.onRejectTap(tap(pendingLeaves[0].id));
    page.onRejectReasonInput({ detail: { value: '保留原因' } });
    const saving = page.onRejectSubmit(); await flush();
    page.onHide?.();
    const writes = page.setData.mock.calls.length;
    env.calls[1].fail(new Error('网络中断')); await saving;
    expect(page.setData).toHaveBeenCalledTimes(writes);
    page.onShow?.(); await flush();
    env.list(2); await flush();
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    page.onRecoverReview(); await flush();
    expect(env.calls[3].header['Idempotency-Key']).toBe(env.calls[1].header['Idempotency-Key']);
    env.reply(3, {}, 409); await flush();
    env.list(4, [pendingLeaves[1]]); await flush();
    expect(page.data.rejectReason).toBe('');
    expect(page.data.selectedItem).toBeNull();
  } finally { env.close(); }
});

it('does not select another student when the requested deep link has left pending', async () => {
  const env = capture(['leave-requests']);
  try {
    const page = env.instantiate();
    page.onLoad({ selectedLeaveId: 'already-reviewed' }); page.onShow?.(); await flush();
    env.list(0); await flush();
    expect(page.data.selectedItem).toBeNull();
    expect(page.data.selectionMessage).toBeTruthy();
    page.onApproveTap(tap('already-reviewed'));
    expect(env.platform.showModal).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it.each([401, 403])('clears history immediately when the single reviewed query returns %s', async (status) => {
  const { env, page } = await loaded();
  try {
    page.onTabTap(tap('history')); await flush();
    expect(env.calls).toHaveLength(2);
    expect(env.calls[1].url).toContain('reviewedOnly=true');
    env.reply(1, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], rejectReason: '' });
  } finally { env.close(); }
});

it('never acts on a stale response or logs out newly changed credentials', async () => {
  const env = capture(['leave-requests']);
  try {
    const old = env.instantiate();
    old.onLoad({}); old.onShow?.(); await flush();
    env.change({ accessToken: 'synthetic-owner-b' });
    const fresh = env.instantiate();
    fresh.onLoad({}); fresh.onShow?.(); await flush();
    env.list(1); await flush();
    env.reply(0, {}, 401); await flush();
    expect(old.data.viewState).toBe('forbidden');
    expect(fresh.data.viewState).toBe('ready');
    expect(env.values.get('education.session.logged-out')).toBe(false);
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-owner-b');
    old.onLogin?.();
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-owner-b');
  } finally { env.close(); }
});
