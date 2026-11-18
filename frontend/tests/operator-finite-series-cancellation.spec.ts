import { capture, flush, tap } from './operator-page-host';
import { lesson, selected, cancelled, list, change, uuid } from './operator-finite-series.fixture';
import { lesson as memberLesson, lessonId as memberLessonId, studentId, students, roster } from './operator-lesson-members.fixture';

async function schedule(rows = [lesson(), lesson(11), lesson(12, { status: 'COMPLETED' })]) {
  const env = capture(['schedule']); const page = env.instantiate();
  page.onLoad(); page.onShow(); await flush(); env.reply(0, list(rows)); await flush();
  return { env, page };
}
async function cancellation(series: string | null = uuid(2)) {
  const target = lesson(10, { seriesId: series });
  const result = await schedule([target, lesson(11, { seriesId: series })]);
  result.page.onCancelTap(tap(target.id)); await flush();
  expect(result.env.calls).toHaveLength(2);
  result.env.reply(1, { data: selected([target]) }); await flush();
  return { ...result, target };
}
it('requires actual THIS preview before explicit cancellation, then authoritatively refreshes', async () => {
  const { env, page, target } = await cancellation(null);
  try {
    expect(env.calls[1]).toMatchObject({ method: 'POST', data: { mode: 'THIS' }, url: expect.stringContaining('/cancellation-preview') });
    expect(page.data.cancellation.allowFollowing).toBe(false); expect(page.data.cancellation.preview.sessions).toHaveLength(1);
    page.onConfirmCancellation(); env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(env.calls[2].data).toEqual({ mode: 'THIS', previewHash: selected([target]).previewHash });
    env.reply(2, { data: cancelled(selected([target])) }); await flush();
    expect(env.calls[3].method).toBe('GET');
    env.reply(3, list([lesson(10, { seriesId: null, status: 'CANCELLED', version: 2 })])); await flush();
    expect(page.data.cancellation.preview).toBeNull(); expect(page.data.items[0].status).toBe('CANCELLED');
  } finally { env.close(); }
});
it('lists the actual FOLLOWING set and versions while preserving terminal rows', async () => {
  const { env, page } = await cancellation();
  try {
    page.onCancellationModeChange(change('FOLLOWING')); await flush();
    expect(env.calls[2].data).toEqual({ mode: 'FOLLOWING' });
    env.reply(2, { data: selected() }); await flush();
    expect(page.data.cancellation.preview.sessions.map((row: any) => row.version)).toEqual([1, 1]);
    page.onConfirmCancellation(); env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    env.reply(3, { data: cancelled() }); await flush();
    env.reply(4, list([lesson(10, { status: 'CANCELLED', version: 2 }), lesson(11, { status: 'CANCELLED', version: 2 }),
      lesson(12, { status: 'COMPLETED' })])); await flush();
    expect(page.data.items.map((row: any) => row.status)).toEqual(['CANCELLED', 'CANCELLED', 'COMPLETED']);
  } finally { env.close(); }
});
it.each(['omitted', 'version', 'time'])
('main review regression refuses a FOLLOWING preview inconsistent with a known eligible row: %s', async variant => {
  const { env, page } = await cancellation();
  try {
    page.onCancellationModeChange(change('FOLLOWING')); await flush();
    const result = selected();
    if (variant === 'omitted') result.sessions.pop();
    if (variant === 'version') result.sessions[1].version += 1;
    if (variant === 'time') {
      result.sessions[1].startsAt = '2040-01-03T08:00:00Z';
      result.sessions[1].endsAt = '2040-01-03T09:30:00Z';
    }
    env.reply(2, { data: result }); await flush();
    expect(page.data.cancellation.preview).toBeNull();
    expect(page.data.cancellation.error).toContain('刷新课表');
    page.onConfirmCancellation(); await flush();
    expect(env.platform.showModal).not.toHaveBeenCalled();
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(0);
  } finally { env.close(); }
});
it('main review regression accepts additional server rows without treating the loaded list as the full selection', async () => {
  const { env, page } = await cancellation();
  try {
    page.onCancellationModeChange(change('FOLLOWING')); await flush();
    const result = selected([lesson(), lesson(11), lesson(12)]);
    env.reply(2, { data: result }); await flush();
    expect(page.data.cancellation.preview.sessions).toHaveLength(3);
    page.onConfirmCancellation();
    env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(env.calls[3].data).toEqual({ mode: 'FOLLOWING', previewHash: result.previewHash });
  } finally { env.close(); }
});
it('does not allow FOLLOWING for an ordinary lesson and never previews terminal or started rows', async () => {
  const { env, page } = await schedule([lesson(10, { seriesId: null }), lesson(11, { status: 'REVERSED' }),
    lesson(12, { startsAt: '2020-01-01T06:00:00Z', endsAt: '2020-01-01T07:00:00Z' })]);
  try {
    page.onCancelTap(tap(uuid(11))); page.onCancelTap(tap(uuid(12))); await flush(); expect(env.calls).toHaveLength(1);
    page.onCancelTap(tap(uuid(10))); await flush(); expect(env.calls).toHaveLength(2);
    page.onCancellationModeChange(change('FOLLOWING')); await flush(); expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});
it('invalidates THIS confirmation when mode changes and refuses the late modal', async () => {
  const { env, page } = await cancellation();
  try {
    page.onConfirmCancellation(); const modal = env.platform.showModal.mock.calls[0][0];
    page.onCancellationModeChange(change('FOLLOWING')); await flush();
    modal.success({ confirm: true }); await flush();
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(0);
    expect(page.data.cancellation.preview).toBeNull();
  } finally { env.close(); }
});
it('closes range preview on refresh and rejects confirmation from a former display cycle', async () => {
  const { env, page } = await cancellation();
  try {
    page.onConfirmCancellation(); const modal = env.platform.showModal.mock.calls[0][0];
    page.onHide(); expect(page.data.cancellation.preview).toBeNull();
    page.onShow(); await flush(); env.reply(2, list([lesson(10, { version: 2 }), lesson(11)])); await flush();
    modal.success({ confirm: true }); await flush();
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(0);
  } finally { env.close(); }
});
it('reconciles a stale cancellation fingerprint after 409 instead of reusing it', async () => {
  const { env, page } = await cancellation();
  try {
    page.onConfirmCancellation(); env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    env.reply(2, { code: 'CONFLICT' }, 409); await flush();
    env.reply(3, list([lesson(10, { version: 2 }), lesson(11)])); await flush();
    expect(page.data.cancellation.preview).toBeNull();
    page.onConfirmCancellation(); await flush();
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(1);
  } finally { env.close(); }
});
it('reads current authority before same mode/hash/key recovery after unknown cancellation', async () => {
  const { env, page, target } = await cancellation();
  try {
    page.onConfirmCancellation(); env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    const original = env.calls[2]; env.reply(2, {}, 503); await flush();
    page.onRetryWrite(); await flush(); expect(env.calls[3].method).toBe('GET');
    env.reply(3, list([lesson(10, { status: 'CANCELLED', version: 2 })])); await flush();
    expect(page.data.recoveryReady).toBe(true); expect(env.calls).toHaveLength(4);
    expect(page.data.items[0].status).toBe('CANCELLED');
    expect(page.data.cancellation.preview).toBeNull();
    page.onRetryWrite(); await flush();
    expect(env.calls[4]).toMatchObject({ data: original.data, header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
    env.reply(4, { data: cancelled(selected([target])) }); await flush();
    env.reply(5, list([lesson(10, { status: 'CANCELLED', version: 2 })])); await flush();
    expect(page.data.recoveryAvailable).toBe(false);
  } finally { env.close(); }
});
it('keeps the original cancellation locked when authority pagination fails', async () => {
  const { env, page } = await cancellation();
  try {
    page.onConfirmCancellation(); env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    env.reply(2, {}, 503); await flush(); page.onRetryWrite(); await flush(); env.reply(3, {}, 503); await flush();
    expect(page.data.recoveryReady).toBe(false); page.onRetryWrite(); await flush();
    expect(env.calls[4].method).toBe('GET');
    expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(1);
  } finally { env.close(); }
});
it('does not accept a late cancellation preview after filter changes', async () => {
  const { env, page } = await schedule();
  try {
    page.onCancelTap(tap(uuid(10))); await flush();
    page.onFilterDateChange(change('2040-01-02')); await flush();
    env.reply(1, { data: selected([lesson()]) }); await flush();
    expect(page.data.cancellation.preview).toBeNull();
    env.reply(2, list([lesson()])); await flush(); expect(page.data.filterDate).toBe('2040-01-02');
  } finally { env.close(); }
});
it('ignores a hidden successful write until return and never applies one after unload', async () => {
  const { env, page, target } = await cancellation();
  try {
    page.onConfirmCancellation(); env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    page.onHide(); const before = page.setData.mock.calls.length;
    env.reply(2, { data: cancelled(selected([target])) }); await flush();
    expect(page.setData.mock.calls.length).toBe(before); expect(page.data.items).toEqual([]);
    page.onUnload(); expect(page.data.items).toEqual([]);
  } finally { env.close(); }
});
it('keeps existing temporary-member add/readback/remove and editor navigation exclusion', async () => {
  const { env, page } = await schedule([memberLesson as any]);
  try {
    page.onMembersTap(tap(memberLessonId)); await flush();
    env.reply(1, { data: roster() }); await flush();
    page.onMemberSearch(); await flush(); env.reply(2, list(students.slice(0, 20), 1, 26)); await flush();
    page.onMemberStudentTap(tap(studentId(2))); page.onAddMember(); await flush();
    expect(env.calls[3].data).toEqual({ studentId: studentId(2), version: 1 });
    const member = { studentId: studentId(2), displayName: '安然', source: 'TEMPORARY', canRemove: true };
    env.reply(3, { data: roster([...roster().members, member], 2) }); await flush();
    env.reply(4, { data: roster([...roster().members, member], 2) }); await flush();
    page.onRemoveMemberTap(tap(studentId(2))); page.onCreateTap();
    page.onConfirmRemoveMember(); await flush();
    expect(env.platform.navigateTo).toHaveBeenCalledTimes(1);
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    expect(page.data.cancellation.preview).toBeNull();
    env.platform.navigateTo.mock.calls[0][0].fail(); await flush();
    page.onRemoveMemberTap(tap(studentId(2))); page.onConfirmRemoveMember(); await flush();
    expect(env.calls[5].data).toEqual({ version: 2 });
    env.reply(5, { data: roster(undefined, 3) }); await flush();
    env.reply(6, { data: roster(undefined, 3) }); await flush();
    expect(page.data.members.roster.lessonVersion).toBe(3);
    expect(page.data.members.roster.members).toHaveLength(1);
  } finally { env.close(); }
});
it('keeps date/status filters and page-two loading without deriving total from the preview', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => lesson(i + 10));
  const { env, page } = await schedule(rows.slice(0, 20));
  try {
    page.onStatusChange(change('1')); await flush();
    env.reply(1, list(rows.slice(0, 20), 1, 21)); await flush();
    page.onLoadMore(); await flush(); expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('2');
    env.reply(2, list(rows.slice(20), 2, 21)); await flush();
    expect(page.data.items).toHaveLength(21); expect(page.data.total).toBe(21);
    page.onCancelTap(tap(uuid(10))); await flush(); env.reply(3, { data: selected([rows[0]]) }); await flush();
    expect(page.data.items).toHaveLength(21); expect(page.data.statusIndex).toBe(1);
  } finally { env.close(); }
});
it('does not post cancellation after opening an editor or a members panel', async () => {
  const { env, page } = await cancellation();
  try {
    page.onCreateTap();
    if (env.platform.navigateTo.mock.calls.length) {
      page.onConfirmCancellation(); await flush();
      expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(0);
    }
    page.onHide(); page.onShow(); await flush(); env.reply(env.calls.length - 1, list([lesson()])); await flush();
    page.onMembersTap(tap(uuid(10))); await flush();
    expect(page.data.cancellation.preview).toBeNull();
    page.onConfirmCancellation(); await flush(); expect(env.calls.filter(call => call.url.endsWith('/cancel-selection'))).toHaveLength(0);
  } finally { env.close(); }
});
