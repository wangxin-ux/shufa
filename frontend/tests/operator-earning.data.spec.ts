import { ApiOperatorDataSource } from '../pages/operator/runtime/data/api-operator-data-source';
import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { OperatorService } from '../pages/operator/runtime/services/operator.service';
import { earningSummary, earningEntries, EARNING_QUERY } from './operator-earning.fixture';

function api(body: unknown, statusCode = 200) {
  const request = jest.fn(options => options.success({ statusCode, data: body }));
  const source: any = new ApiOperatorDataSource({ baseUrl: 'https://operator.example.test', accessToken: 'synthetic-only', request });
  return { source, request };
}
it('reads the two operator endpoints with no caller scope or extra journal fields', async () => {
  const summary = api({ data: earningSummary() });
  expect(summary.source).toHaveProperty('getEarningSummary', expect.any(Function));
  expect(await summary.source.getEarningSummary()).toEqual(earningSummary());
  expect(summary.request.mock.calls[0][0]).toMatchObject({
    url: 'https://operator.example.test/operators/me/earnings/summary', method: 'GET',
    header: { Authorization: 'Bearer synthetic-only' },
  });
  const query = { ...EARNING_QUERY, page: 2, status: 'REVERSED', entryType: 'REVERSAL' };
  const entries = api({ data: earningEntries(query) });
  expect(await entries.source.listEarningEntries(query)).toEqual(earningEntries(query));
  expect(Object.fromEntries(new URL(entries.request.mock.calls[0][0].url).searchParams)).toEqual({
    page: '2', pageSize: '20', status: 'REVERSED', entryType: 'REVERSAL',
  });
});
it('retains null, zero, signed safe fen and timestamp offsets without repricing', async () => {
  const summary = { ...earningSummary(), estimatedTotalFen: null, pendingReviewFen: 0 };
  expect(await api({ data: summary }).source.getEarningSummary()).toEqual(summary);
  const body = earningEntries({ entryType: 'REVERSAL', status: 'REVERSED' }, 1);
  body.data[0].amountFen = Number.MIN_SAFE_INTEGER;
  expect(await api({ data: body }).source.listEarningEntries(EARNING_QUERY)).toEqual(body);
});
const invalidSummary: Array<[string, (value: any) => void]> = [
  ['extra envelope', value => { value.private = 1; }],
  ['wrong request ID', value => { value.requestId = false; }],
  ['missing amount', value => { delete value.data.estimatedTotalFen; }],
  ['unsafe amount', value => { value.data.pendingReviewFen = Number.MAX_SAFE_INTEGER + 1; }],
  ['string amount', value => { value.data.estimatedTotalFen = '0'; }],
  ['fractional amount', value => { value.data.estimatedTotalFen = 0.1; }],
  ['wrong currency', value => { value.data.currency = 'USD'; }],
  ['private summary field', value => { value.data.shareRate = 100; }],
  ['invalid timezone', value => { value.data.timezone = 'not/a-zone'; }],
  ['calendar overflow', value => { value.data.serverTime = '2026-02-30T00:00:00Z'; }],
  ['missing offset', value => { value.data.serverTime = '2026-10-29T04:00:00'; }],
];
it.each(invalidSummary)('rejects summary %s without modifying or coercing input', async (_name, change) => {
  const body = { data: earningSummary() }; change(body);
  const saved = structuredClone(body);
  await expect(api(body).source.getEarningSummary()).rejects.toMatchObject({ code: 'INVALID_EARNING_RESPONSE' });
  expect(body).toEqual(saved);
});
const invalidEntries: Array<[string, (value: any) => void]> = [
  ['extra entry', value => { value.data.data[0].teacherName = 'private'; }],
  ['missing completion', value => { delete value.data.data[0].completedAt; }],
  ['invalid status', value => { value.data.data[0].status = 'PAID'; }],
  ['invalid type', value => { value.data.data[0].entryType = 'OTHER'; }],
  ['zero accrual', value => { value.data.data[0].amountFen = 0; }],
  ['negative accrual', value => { value.data.data[0].amountFen = -1; }],
  ['positive reversal', value => { value.data.data[1].amountFen = 1; }],
  ['wrong reversal status', value => { value.data.data[1].status = 'AVAILABLE'; }],
  ['unsafe entry', value => { value.data.data[0].amountFen = Number.MAX_SAFE_INTEGER + 1; }],
  ['duplicate case ID', value => { value.data.data[1].id = value.data.data[0].id.toUpperCase(); }],
  ['wrong page', value => { value.data.meta.page = 2; }],
  ['wrong totalPages', value => { value.data.meta.totalPages = 30; }],
  ['wrong count', value => { value.data.data.pop(); }],
  ['wrong order', value => { value.data.data.reverse(); }],
  ['extra page field', value => { value.data.personCount = 30; }],
];
it.each(invalidEntries)('rejects journal %s', async (_name, change) => {
  const body = { data: earningEntries() }; change(body);
  await expect(api(body).source.listEarningEntries(EARNING_QUERY)).rejects.toMatchObject({ code: 'INVALID_EARNING_RESPONSE' });
});
it.each([
  { page: 0 }, { pageSize: 101 }, { page: 2147483647, pageSize: 20 },
  { pageSize: 1.1 }, { status: 'PAID' }, { entryType: 'OTHER' }, { campusId: 'other' },
])('rejects query %j before synthetic transport', async patch => {
  const { source, request } = api({ data: earningEntries() });
  await expect(source.listEarningEntries({ ...EARNING_QUERY, ...patch })).rejects.toMatchObject({ statusCode: 400 });
  expect(request).not.toHaveBeenCalled();
});
it.each([{ status: 'AVAILABLE' }, { entryType: 'REVERSAL' }])('rejects mismatched filtered response %j', async filter => {
  await expect(api({ data: earningEntries() }).source.listEarningEntries({ ...EARNING_QUERY, ...filter }))
    .rejects.toMatchObject({ code: 'INVALID_EARNING_RESPONSE' });
});
it.each([401, 403, 404, 503])('preserves %s independently through the service', async status => {
  const service: any = new OperatorService(api({}, status).source);
  expect(await service.loadEarningSummary()).toMatchObject({ status: 'error', statusCode: status });
  expect(await service.loadEarningEntries(EARNING_QUERY)).toMatchObject({ status: 'error', statusCode: status });
});
it('mock keeps summary independent from AND journal filters and preserves rejected/reversal facts', async () => {
  const source: any = new MockOperatorDataSource();
  expect(source).toHaveProperty('getEarningSummary', expect.any(Function));
  const before = await source.getEarningSummary();
  const result = await source.listEarningEntries({ ...EARNING_QUERY, status: 'REVERSED', entryType: 'REVERSAL' });
  expect(result.data.length).toBeGreaterThan(0);
  expect(result.data.every((row: any) => row.status === 'REVERSED' && row.entryType === 'REVERSAL' && row.amountFen < 0)).toBe(true);
  expect(await source.getEarningSummary()).toEqual(before);
  const rejected = await source.listEarningEntries({ ...EARNING_QUERY, status: 'REJECTED' });
  expect(rejected.data.some((row: any) => row.entryType === 'ACCRUAL')).toBe(true);
  const empty: any = new MockOperatorDataSource({ scenario: 'empty' });
  expect(await empty.getEarningSummary()).toMatchObject({ estimatedTotalFen: 0, pendingReviewFen: 0 });
});
