import { capture, flush } from './operator-page-host';
import { options, pattern, preview, created, lesson, list, change, keyTap } from './operator-finite-series.fixture';

export async function editor() {
  const env = capture(['schedule-editor']); env.setPages([{ route: 'pages/operator/schedule/index' }, { route: 'pages/operator/schedule-editor/index' }]);
  const page = env.instantiate(); page.onLoad({}); page.onShow(); await flush();
  env.reply(0, { data: options() }); await flush(); page.onClassChange(change('0'));
  return { env, page };
}
export function fill(page: any, patch: Record<string, unknown> = {}) {
  const value = pattern(patch);
  page.onScheduleModeTap?.(keyTap('series'));
  page.onFormDateChange(change(value.startDate)); page.onSeriesEndDateChange?.(change(value.endDate));
  page.onIntervalChange?.(change(value.intervalWeeks === 2 ? '1' : '0'));
  page.onWeekdayChange?.(change(value.weekdays.map(String)));
  return value;
}
async function planned() {
  const result = await editor(); const input = fill(result.page);
  expect(result.page.data.scheduleMode).toBe('series');
  result.page.onSeriesPreview(); await flush(); result.env.reply(1, { data: preview(input) }); await flush();
  return { ...result, input };
}
const confirm = async (env: ReturnType<typeof capture>, page: any) => {
  page.onSeriesCreate(); expect(env.platform.showModal).toHaveBeenCalledTimes(1);
  env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
};
it('adds finite mode in the existing editor and renders every authoritative date', async () => {
  const { env, page } = await planned();
  try {
    expect(page.data.seriesPreview.sessions).toHaveLength(preview().sessions.length);
    expect(env.calls[1].data).toEqual(pattern()); expect(env.calls).toHaveLength(2);
    page.onSeriesCreate(); expect(env.platform.showModal).toHaveBeenCalledTimes(1);
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});
it('creates only the same hash and returns after reading every created lesson', async () => {
  const { env, page, input } = await planned();
  try {
    await confirm(env, page);
    expect(env.calls[2].data).toEqual({ ...input, previewHash: preview().previewHash });
    const result = created(); env.reply(2, { data: result }); await flush();
    expect(env.calls[3].method).toBe('GET');
    env.reply(3, list(result.sessions.map((row, i) => lesson(i + 10, row)))); await flush();
    expect(env.platform.navigateBack).toHaveBeenCalledTimes(1); expect(page.data.verified).toBe(true);
  } finally { env.close(); }
});
it('accepts fortnightly multiple weekdays and keeps all conflict dates visible without permitting create', async () => {
  const { env, page } = await editor();
  try {
    const input = fill(page, { intervalWeeks: 2, weekdays: [1, 3, 5], endDate: '2040-02-01' });
    expect(page.data.scheduleMode).toBe('series'); page.onSeriesPreview(); await flush();
    const result = preview(input); result.conflictDates = [result.sessions[0].date, result.sessions[2].date];
    env.reply(1, { data: result }); await flush();
    expect(env.calls[1].data).toEqual(input); expect(page.data.seriesPreview.conflictDates).toEqual(result.conflictDates);
    page.onSeriesCreate(); expect(env.platform.showModal).not.toHaveBeenCalled();
  } finally { env.close(); }
});
it.each(['end', 'weekdays', 'interval', 'date', 'startTime', 'kind', 'mode'])('invalidates old preview/confirmation on %s change', async field => {
  const { env, page } = await planned();
  try {
    page.onSeriesCreate(); const modal = env.platform.showModal.mock.calls[0][0];
    if (field === 'end') page.onSeriesEndDateChange(change('2040-01-16'));
    if (field === 'weekdays') page.onWeekdayChange(change(['2']));
    if (field === 'interval') page.onIntervalChange(change('1'));
    if (field === 'date') page.onFormDateChange(change('2040-01-03'));
    if (field === 'startTime') page.onStartTimeChange(change('14:30'));
    if (field === 'kind') page.onKindChange(change('1'));
    if (field === 'mode') page.onScheduleModeTap(keyTap('single'));
    modal.success({ confirm: true }); await flush();
    expect(page.data.seriesPreview).toBeNull(); expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});
it('rejects more than 12 weeks without sending a preview and shows server 50-session rejection', async () => {
  const { env, page } = await editor();
  try {
    fill(page, { endDate: '2040-03-26' }); expect(page.data.scheduleMode).toBe('series');
    page.onSeriesPreview(); await flush(); expect(env.calls).toHaveLength(1); expect(page.data.formError).toMatch(/12|84/);
    page.onSeriesEndDateChange(change('2040-03-25')); page.onWeekdayChange(change(['1', '2', '3', '4', '5', '6', '7']));
    page.onSeriesPreview(); await flush(); env.reply(1, { message: '最多50节，请缩小范围' }, 400); await flush();
    expect(page.data.formError).toMatch(/50/); expect(page.data.seriesPreview).toBeNull();
  } finally { env.close(); }
});
it('clears visible private fields/preview on hide and rejects a late confirm after return', async () => {
  const { env, page } = await planned();
  try {
    page.onSeriesCreate(); const modal = env.platform.showModal.mock.calls[0][0];
    page.onHide(); expect(page.data.seriesPreview).toBeNull(); expect(page.data.selectedClassLabel).toBe('');
    page.onShow(); await flush(); env.reply(2, { data: options() }); await flush();
    modal.success({ confirm: true }); await flush(); expect(env.calls.filter(call => call.url.endsWith('/lesson-series'))).toHaveLength(0);
    expect(page.data.seriesPreview).toBeNull();
  } finally { env.close(); }
});
it('shows 409 local conflict dates, discards old hash, and requires a fresh finite preview', async () => {
  const { env, page } = await planned();
  try {
    await confirm(env, page); env.reply(2, { code: 'CONFLICT', details: { conflictDates: [preview().sessions[0].date] } }, 409); await flush();
    expect(page.data.seriesPreview).toBeNull(); expect(page.data.formError).toContain(preview().sessions[0].date);
    page.onSeriesCreate(); expect(env.calls.filter(call => call.url.endsWith('/lesson-series'))).toHaveLength(1);
  } finally { env.close(); }
});
it('requires authority GET then explicit original-hash/key retry despite current preview conflicts', async () => {
  const { env, page } = await planned();
  try {
    await confirm(env, page); const original = env.calls[2]; env.reply(2, {}, 503); await flush();
    expect(page.data.recoveryAvailable).toBe(true);
    page.onRetryWrite(); await flush(); expect(env.calls[3].method).toBe('GET');
    env.reply(3, list([])); await flush(); expect(page.data.recoveryReady).toBe(true);
    expect(env.calls).toHaveLength(4); page.onRetryWrite(); await flush();
    expect(env.calls[4]).toMatchObject({ url: original.url, data: original.data,
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
    env.reply(4, {}, 503); await flush(); expect(page.data.recoveryReady).toBe(false);
    page.onRetryWrite(); await flush(); expect(env.calls[5].method).toBe('GET');
  } finally { env.close(); }
});
it('keeps single create and edit linked to the ordinary lesson APIs', async () => {
  const { env, page } = await editor();
  try {
    expect(page.data.scheduleMode).toBe('single'); page.onFormDateChange(change('2040-01-02'));
    page.onSubmit(); env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(env.calls[1].url).toBe('https://operator.example.test/operators/me/lesson-sessions');
    expect(env.calls[1].data).not.toHaveProperty('seriesId');
  } finally { env.close(); }
});
it.each([401, 403])('clears series state on %s and ignores stale confirmation', async status => {
  const { env, page } = await planned();
  try {
    page.onSeriesCreate(); const modal = env.platform.showModal.mock.calls[0][0];
    page.onHide(); page.onShow(); await flush(); env.reply(2, {}, status); await flush();
    modal.success({ confirm: true }); await flush();
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.seriesPreview).toBeNull();
    expect(page.data.selectedClassLabel).toBe(''); expect(env.calls).toHaveLength(3);
  } finally { env.close(); }
});
it.each(['failed', 'malformed'])('does not unlock an original command after a %s recovery GET', async variant => {
  const { env, page } = await planned();
  try {
    await confirm(env, page); env.reply(2, {}, 503); await flush();
    page.onRetryWrite(); await flush();
    env.reply(3, variant === 'failed' ? {} : { data: [], meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } },
      variant === 'failed' ? 503 : 200); await flush();
    expect(page.data.recoveryReady).toBe(false);
    page.onRetryWrite(); await flush(); expect(env.calls[4].method).toBe('GET');
  } finally { env.close(); }
});
it.each([{ accessToken: 'other-synthetic-owner' }, { apiBaseUrl: 'https://changed.example.test' }, { dataDriver: 'mock' }])
('isolates series late write results when runtime changes: %j', async patch => {
  const { env, page } = await planned();
  try {
    await confirm(env, page); env.change(patch); env.reply(2, { data: created() }); await flush();
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.selectedClassLabel).toBe('');
    expect(page.data.seriesPreview).toBeNull(); expect(env.calls).toHaveLength(3);
  } finally { env.close(); }
});
it('ignores late previews and preserves only draft values after hide/show', async () => {
  const { env, page } = await editor();
  try {
    const input = fill(page); page.onSeriesPreview(); await flush();
    page.onHide(); page.onShow(); await flush(); env.reply(2, { data: options() }); await flush();
    env.reply(1, { data: preview(input) }); await flush();
    expect(page.data.seriesPreview).toBeNull(); expect(page.data.formDate).toBe(input.startDate);
    expect(page.data.seriesEndDate).toBe(input.endDate);
  } finally { env.close(); }
});
it('keeps a series ordinary single edit on PATCH, preserves relation and shows local conflict dates', async () => {
  const env = capture(['schedule-editor']); const page = env.instantiate();
  try {
    page.onLoad({ mode: 'edit', id: lesson().id }); page.onShow(); await flush();
    env.reply(0, list([lesson()])); await flush();
    page.onScheduleModeTap(keyTap('series')); expect(page.data.scheduleMode).toBe('single');
    page.onStartTimeChange(change('14:30')); page.onSubmit();
    env.platform.showModal.mock.calls[0][0].success({ confirm: true }); await flush();
    expect(env.calls[1].method).toBe('PATCH'); expect(env.calls[1].data).not.toHaveProperty('seriesId');
    env.reply(1, { code: 'CONFLICT', details: { conflictDates: ['2040-01-02'] } }, 409); await flush();
    expect(page.data.formError).toContain('2040-01-02');
    env.reply(2, list([lesson(10, { version: 2 })])); await flush();
    expect(page.record.seriesId).toBe(lesson().seriesId);
  } finally { env.close(); }
});
it('reads all authoritative pages before permitting same-command recovery', async () => {
  const { env, page } = await planned();
  try {
    await confirm(env, page); env.reply(2, {}, 503); await flush();
    page.onRetryWrite(); await flush();
    env.reply(3, list(Array.from({ length: 20 }, (_, i) => lesson(i + 10)), 1, 21)); await flush();
    expect(page.data.recoveryReady).toBe(false); expect(env.calls[4].method).toBe('GET');
    env.reply(4, list([lesson(30)], 2, 21)); await flush();
    expect(page.data.recoveryReady).toBe(true); expect(env.calls).toHaveLength(5);
  } finally { env.close(); }
});
it('main review regression accepts a later edited series lesson after original successful replay', async () => {
  const { env, page } = await planned();
  try {
    await confirm(env, page);
    const original = env.calls[2], result = created();
    const rows = result.sessions.map((row, i) => lesson(i + 10, {
      ...row, ...(i === 0 ? { version: 2, startsAt: '2040-01-02T08:00:00Z', endsAt: '2040-01-02T09:00:00Z' } : {}),
    }));
    env.reply(2, {}, 503); await flush();
    page.onRetryWrite(); await flush(); env.reply(3, list(rows)); await flush();
    expect(page.data.recoveryReady).toBe(true);
    page.onRetryWrite(); await flush();
    expect(env.calls[4]).toMatchObject({ data: original.data,
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
    env.reply(4, { data: result }); await flush();
    env.reply(5, list(rows)); await flush();
    expect(page.data.verified).toBe(true);
    expect(page.verified.version).toBe(2);
    expect(env.platform.navigateBack).toHaveBeenCalledTimes(1);
    expect(env.calls.filter(call => call.url.endsWith('/lesson-series'))).toHaveLength(2);
  } finally { env.close(); }
});
it.each(['same-version-time', 'different-series', 'older-version'])
('main review regression rejects a mismatched series readback: %s', async variant => {
  const { env, page } = await planned();
  try {
    await confirm(env, page);
    const result = created();
    const patch = variant === 'same-version-time'
      ? { startsAt: '2040-01-02T08:00:00Z', endsAt: '2040-01-02T09:00:00Z' }
      : variant === 'different-series' ? { version: 2, seriesId: lesson(20).id }
        : { version: 1 };
    if (variant === 'older-version') result.sessions[0].version = 2;
    env.reply(2, { data: result }); await flush();
    env.reply(3, list(result.sessions.map((row, i) => lesson(i + 10, {
      ...row, ...(i === 0 ? patch : {}),
    })))); await flush();
    expect(page.data.verified).toBe(false);
    expect(page.data.viewState).toBe('saved');
    expect(env.platform.navigateBack).not.toHaveBeenCalled();
    page.onSeriesCreate(); page.onSubmit(); await flush();
    expect(env.calls.filter(call => call.url.endsWith('/lesson-series'))).toHaveLength(1);
  } finally { env.close(); }
});
