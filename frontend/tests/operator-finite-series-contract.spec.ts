import { ApiOperatorDataSource } from '../pages/operator/runtime/data/api-operator-data-source';
import { pattern, preview, created, selected, cancelled, lesson, list, uuid } from './operator-finite-series.fixture';

function source(response: unknown = { data: preview() }) {
  const calls: any[] = [];
  const api: any = new ApiOperatorDataSource({ baseUrl: 'https://series.example.test/base', accessToken: 'synthetic-series',
    request: options => { calls.push(options); options.success({ statusCode: 200, data: response }); } });
  const method = (name: string) => { expect(typeof api[name]).toBe('function'); return api[name].bind(api); };
  return { api, calls, method };
}
it('uses the four relative routes and exact request bodies, keeping preview free of write keys', async () => {
  const a = source(); await a.method('previewLessonSeries')(pattern());
  expect(a.calls[0]).toMatchObject({ url: 'https://series.example.test/base/operators/me/lesson-series/preview',
    method: 'POST', data: pattern() });
  expect(a.calls[0].header['Idempotency-Key']).toBeUndefined();
  const b = source({ data: created() }); await b.method('createLessonSeries')({ ...pattern(), previewHash: preview().previewHash }, 'series-key');
  expect(b.calls[0]).toMatchObject({ url: 'https://series.example.test/base/operators/me/lesson-series',
    data: { ...pattern(), previewHash: preview().previewHash }, header: { 'Idempotency-Key': 'series-key' } });
  const c = source({ data: selected([lesson()]) });
  await c.method('previewLessonCancellation')(uuid(10), 'THIS');
  expect(c.calls[0].data).toEqual({ mode: 'THIS' });
  expect(c.calls[0].url).toContain(`/${uuid(10)}/cancellation-preview`);
  const d = source({ data: cancelled(selected([lesson()])) });
  await d.method('cancelLessonSelection')(uuid(10), { mode: 'THIS', previewHash: preview().previewHash }, selected([lesson()]), 'cancel-key');
  expect(d.calls[0].url).toContain(`/${uuid(10)}/cancel-selection`);
  expect(d.calls[0].data).toEqual({ mode: 'THIS', previewHash: preview().previewHash });
});
it.each([
  ['class uuid', { classGroupId: 'not-uuid' }], ['bad date', { startDate: '2040-02-30' }],
  ['85 days', { endDate: '2040-03-26' }], ['no weekdays', { weekdays: [] }],
  ['duplicate weekday', { weekdays: [1, 1] }], ['wrong weekday', { weekdays: [0] }],
  ['string interval', { intervalWeeks: '1' }], ['boolean interval', { intervalWeeks: true }],
  ['wrong interval', { intervalWeeks: 3 }], ['cross midnight', { endTime: '13:00' }],
  ['equal times', { endTime: '14:00' }], ['bad time', { startTime: '24:00' }],
  ['unknown field', { sessions: [] }], ['invalid kind', { kind: 'FREE' }],
])('rejects invalid pattern before transport: %s', async (_, patch) => {
  const env = source();
  await expect(env.method('previewLessonSeries')(pattern(patch))).rejects.toMatchObject({ statusCode: 400 });
  expect(env.calls).toHaveLength(0);
});
it.each([
  ['timezone', { ...preview(), timezone: 'UTC' }],
  ['hash', { ...preview(), previewHash: 'x' }],
  ['missing row', { ...preview(), sessions: preview().sessions.slice(1) }],
  ['duplicate row', { ...preview(), sessions: [preview().sessions[0], ...preview().sessions.slice(1, -1), preview().sessions[0]] }],
  ['unknown field', { ...preview(), extra: true }],
  ['datetime conflict', { ...preview(), conflictDates: ['2040-01-02T00:00:00Z'] }],
  ['unplanned conflict', { ...preview(), conflictDates: ['2041-01-01'] }],
  ['wrong time', { ...preview(), sessions: preview().sessions.map((row, i) => i ? row : { ...row, endsAt: '2040-01-02T08:30:00Z' }) }],
])('rejects damaged finite preview: %s', async (_, data) => {
  const env = source({ data });
  await expect(env.method('previewLessonSeries')(pattern())).rejects.toMatchObject({ statusCode: 502 });
});
it('rejects a create receipt missing any generated session and retains normal list series compatibility', async () => {
  const env = source({ data: { ...created(), sessions: created().sessions.slice(1) } });
  await expect(env.method('createLessonSeries')({ ...pattern(), previewHash: preview().previewHash }, 'key'))
    .rejects.toMatchObject({ statusCode: 502 });
  const old = lesson(); delete (old as any).seriesId;
  const page = source(list([old, lesson(11, { seriesId: null })]));
  const value = await page.api.listLessonSessions({ page: 1, pageSize: 20 });
  expect(value.data[0]).not.toHaveProperty('seriesId'); expect(value.data[1].seriesId).toBeNull();
});
it.each([
  ['missing cancelled status', { ...cancelled(), sessions: cancelled().sessions.map(({ status, ...row }) => row) }],
  ['partial cancellation', { ...cancelled(), sessions: cancelled().sessions.slice(1) }],
  ['wrong version', { ...cancelled(), sessions: cancelled().sessions.map(row => ({ ...row, version: 1 })) }],
])('rejects damaged cancel receipt: %s', async (_, data) => {
  const env = source({ data });
  await expect(env.method('cancelLessonSelection')(uuid(10), { mode: 'FOLLOWING', previewHash: preview().previewHash }, selected(), 'key'))
    .rejects.toMatchObject({ statusCode: 502 });
});
it('accepts a FOLLOWING set with equal starts sorted before the selected id', async () => {
  const target = lesson(10);
  const rows = [lesson(9, { startsAt: target.startsAt, endsAt: target.endsAt }), target];
  const env = source({ data: selected(rows) });
  const value = await env.method('previewLessonCancellation')(uuid(10), 'FOLLOWING');
  expect(value.sessions.map((row: any) => row.id)).toEqual(rows.map(row => row.id));
});
it('rejects malformed cancellation inputs locally with a typed error', async () => {
  const env = source();
  for (const value of [null, {}, { mode: 'THIS' }, { mode: 'THIS', previewHash: preview().previewHash, extra: true }])
    await expect(env.method('cancelLessonSelection')(uuid(10), value, selected(), 'key')).rejects.toMatchObject({ statusCode: 400 });
  expect(env.calls).toHaveLength(0);
});
it('rejects invalid ISO dates in otherwise well-shaped authority rows', async () => {
  const env = source(list([lesson(10, { startsAt: '2040-02-30T06:00:00Z', endsAt: '2040-03-01T07:00:00Z' })]));
  await expect(env.api.listLessonSessions({ page: 1, pageSize: 20 })).rejects.toMatchObject({ statusCode: 502 });
});
