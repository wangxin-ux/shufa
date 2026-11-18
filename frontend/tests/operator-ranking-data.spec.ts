import { ApiOperatorDataSource } from '../pages/operator/runtime/data/api-operator-data-source';
import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { OperatorService } from '../pages/operator/runtime/services/operator.service';
import { rankingPage, RANKING_MONTH, RANKING_QUERY, RANKING_REVISION, unavailableRanking } from './operator-ranking.fixture';

// The Mock only serves the current Beijing month, so freeze the clock to the
// month this fixture describes. Without this the suite silently starts
// returning empty pages once the real calendar moves past RANKING_MONTH.
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date(`${RANKING_MONTH}-15T04:00:00.000Z`));
});
afterEach(() => {
  jest.useRealTimers();
});

function api(body: unknown = { data: rankingPage() }, statusCode = 200) {
  const request = jest.fn((options) => options.success({ statusCode, data: body }));
  const source = new ApiOperatorDataSource({ baseUrl: 'https://operator.example.test', accessToken: 'synthetic-only', request }) as any;
  return { source, request };
}

it('reads the strict four-field operator page through its existing DataSource', async () => {
  const { source, request } = api();
  expect(source).toHaveProperty('listRankings', expect.any(Function));
  const result = await source.listRankings(RANKING_QUERY);
  expect(result).toEqual(rankingPage());
  expect(Object.keys(result.data[0]).sort()).toEqual(['campusName', 'isOwnCampus', 'rank', 'rankDelta']);
  expect(new URL(request.mock.calls[0][0].url).pathname).toBe('/operators/me/rankings');
  expect(request.mock.calls[0][0].method).toBe('GET');
});

it('preserves all fixed revision pagination fields and bearer authorization', async () => {
  const query = { ...RANKING_QUERY, page: 2, revisionId: RANKING_REVISION };
  const { source, request } = api({ data: rankingPage(query) });
  await source.listRankings(query);
  expect(Object.fromEntries(new URL(request.mock.calls[0][0].url).searchParams)).toEqual({
    metric: 'STUDENTS', month: '2026-10', page: '2', pageSize: '20', revisionId: RANKING_REVISION,
  });
  expect(request.mock.calls[0][0].header.Authorization).toBe('Bearer synthetic-only');
});

const invalidResponses: Array<[string, (body: any) => void]> = [
  ['row campus ID', (b) => { b.data.data[0].campusId = 'private'; }],
  ['row metric value', (b) => { b.data.data[0].studentCount = 0; }],
  ['own previous rank', (b) => { b.data.ownCampus.previousRank = 1; }],
  ['missing rank delta', (b) => { delete b.data.data[0].rankDelta; }],
  ['fractional rank', (b) => { b.data.data[0].rank = 1.5; }],
  ['unsafe rank delta', (b) => { b.data.data[0].rankDelta = Number.MAX_SAFE_INTEGER + 1; }],
  ['wrong own marker', (b) => { b.data.ownCampus.isOwnCampus = false; }],
  ['missing own summary', (b) => { b.data.ownCampus = null; b.data.data[0].isOwnCampus = true; }],
  ['contradictory own row', (b) => { b.data.data[0] = { ...b.data.ownCampus, rank: 1 }; }],
  ['wrong month', (b) => { b.data.month = '2026-09'; }],
  ['wrong metric', (b) => { b.data.metric = 'PARTNER_EARNINGS'; }],
  ['wrong timezone', (b) => { b.data.timezone = 'UTC'; }],
  ['invalid date', (b) => { b.data.asOf = '2026-02-30T00:00:00Z'; }],
  ['missing revision', (b) => { b.data.revisionId = null; }],
  ['non-v4 revision', (b) => { b.data.revisionId = 'a3000000-0000-1000-8000-000000000001'; }],
  ['wrong page', (b) => { b.data.meta.page = 2; }],
  ['wrong size', (b) => { b.data.meta.pageSize = 10; }],
  ['wrong total pages', (b) => { b.data.meta.totalPages = 3; }],
  ['wrong row count', (b) => { b.data.data.pop(); }],
  ['extra metadata', (b) => { b.data.meta.campusId = 'private'; }],
  ['extra page property', (b) => { b.data.amountFen = 0; }],
  ['extra envelope', (b) => { b.meta = {}; }],
  ['invalid optional requestId', (b) => { b.requestId = 1; }],
  ['array availability', (b) => { b.data.availability = ['LIVE']; }],
  ['array unavailable reason', (b) => { b.data = unavailableRanking(); b.data.unavailableReason = ['HISTORY_UNAVAILABLE']; }],
  ['unavailable with fabricated rows', (b) => { b.data.availability = 'UNAVAILABLE'; b.data.unavailableReason = 'SOURCE_DATA_INVALID'; b.data.revisionId = null; }],
];
it.each(invalidResponses)('rejects %s without dropping fields or coercing values', async (_name, mutate) => {
  const body = { data: rankingPage() };
  mutate(body);
  const original = structuredClone(body);
  const { source } = api(body);
  await expect(source.listRankings(RANKING_QUERY)).rejects.toMatchObject({ code: 'INVALID_RANKING_RESPONSE' });
  expect(body).toEqual(original);
});

it.each(['HISTORY_UNAVAILABLE', 'SOURCE_DATA_INVALID'])('accepts explicit unavailable %s separately from a reliable zero tie', async (reason) => {
  const { source } = api({ data: unavailableRanking(reason) });
  expect(await source.listRankings(RANKING_QUERY)).toMatchObject({ availability: 'UNAVAILABLE', data: [], ownCampus: null });
  const zero = rankingPage({}, 3);
  zero.data.forEach((row) => { row.rank = 1; row.rankDelta = 0; });
  zero.ownCampus!.rank = 1;
  zero.ownCampus!.rankDelta = 0;
  expect(await api({ data: zero }).source.listRankings(RANKING_QUERY)).toEqual(zero);
});

it('accepts contract strings, offset timestamps and duplicate display names without inventing identity', async () => {
  const body = rankingPage();
  body.data[0].campusName = '';
  body.calculationVersion = '';
  body.asOf = '2026-10-28T17:30:00+08:00';
  expect(await api({ data: body, requestId: 'synthetic' }).source.listRankings(RANKING_QUERY)).toEqual(body);
});

it.each([
  { campusId: 'foreign' }, { metric: 'WEIGHTED' }, { month: '9999-12' }, { month: '2026-13' },
  { page: 0 }, { pageSize: 101 }, { revisionId: 'not-a-uuid' },
])('rejects invalid or expanded query %j before transport', async (patch) => {
  const { source, request } = api();
  await expect(source.listRankings({ ...RANKING_QUERY, ...patch })).rejects.toMatchObject({ statusCode: 400 });
  expect(request).not.toHaveBeenCalled();
});

it.each([401, 403, 404, 503])('retains actual error code and HTTP status %s through Service', async (status) => {
  const { source } = api({ code: 'RESOURCE_NOT_FOUND', message: '合成错误' }, status);
  const service = new OperatorService(source) as any;
  expect(await service.loadRankings(RANKING_QUERY)).toMatchObject({ status: 'error', statusCode: status, code: 'RESOURCE_NOT_FOUND' });
});

it('rejects a different revision on a continuation response', async () => {
  const { source } = api({ data: rankingPage({ page: 2, revisionId: 'a3000000-0000-4000-8000-000000000002' }) });
  await expect(source.listRankings({ ...RANKING_QUERY, page: 2, revisionId: RANKING_REVISION }))
    .rejects.toMatchObject({ code: 'INVALID_RANKING_RESPONSE' });
});

it('mock exposes the same strict projection and immutable fixed-size pages for all metrics', async () => {
  const source = new MockOperatorDataSource() as any;
  for (const metric of ['STUDENTS', 'PARTNER_EARNINGS', 'HEADQUARTERS_EARNINGS']) {
    const first = await source.listRankings({ ...RANKING_QUERY, metric });
    expect(first.data).toHaveLength(20);
    expect(first.meta.total).toBe(21);
    const second = await source.listRankings({ ...RANKING_QUERY, metric, page: 2, revisionId: first.revisionId });
    expect(second.data).toHaveLength(1);
    expect(second.asOf).toBe(first.asOf);
    expect(second.ownCampus).toEqual(first.ownCampus);
    expect(Object.keys(second.data[0]).sort()).toEqual(['campusName', 'isOwnCampus', 'rank', 'rankDelta']);
  }
  await expect(source.listRankings({ ...RANKING_QUERY, revisionId: 'a3000000-0000-4000-8000-000000000099' }))
    .rejects.toMatchObject({ statusCode: 404, code: 'RESOURCE_NOT_FOUND' });
});
