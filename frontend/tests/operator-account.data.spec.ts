import { ApiOperatorDataSource } from '../pages/operator/runtime/data/api-operator-data-source';
import { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { OperatorService } from '../pages/operator/runtime/services/operator.service';
import { ACCOUNT_QUERY, accountPage, accountSubjects, SUBJECT_ID } from './operator-account.fixture';

function api(body: unknown = { data: accountPage() }, statusCode = 200) {
  const request = jest.fn((options) => options.success({ statusCode, data: body }));
  const source: any = new ApiOperatorDataSource({ baseUrl: 'https://operator.example.test', accessToken: 'synthetic-only', request });
  return { source, request };
}
it('provides strict account and subject reads on the operator data source', async () => {
  const { source, request } = api();
  expect(source).toHaveProperty('getLessonAccount', expect.any(Function));
  expect(await source.getLessonAccount(ACCOUNT_QUERY)).toEqual(accountPage());
  expect(new URL(request.mock.calls[0][0].url).pathname).toBe('/operators/me/lesson-account');
  expect(request.mock.calls[0][0]).toMatchObject({ method: 'GET', header: { Authorization: 'Bearer synthetic-only' } });
  const subjects = api({ data: accountSubjects() });
  expect(await subjects.source.listAccountSubjects({ page: 1, pageSize: 100 })).toEqual(accountSubjects());
  expect(new URL(subjects.request.mock.calls[0][0].url).pathname).toBe('/operators/me/subjects');
});
it('sends both filters, exact pagination and no caller scope', async () => {
  const query = { ...ACCOUNT_QUERY, page: 2, entryType: 'CORRECTION', subjectId: SUBJECT_ID };
  const { source, request } = api({ data: accountPage(query) });
  await source.getLessonAccount(query);
  expect(Object.fromEntries(new URL(request.mock.calls[0][0].url).searchParams)).toEqual({
    page: '2', pageSize: '20', entryType: 'CORRECTION', subjectId: SUBJECT_ID,
  });
});
const invalid: Array<[string, (b: any) => void]> = [
  ['extra envelope', b => { b.extra = 1; }],
  ['bad requestId', b => { b.requestId = 1; }],
  ['extra account', b => { b.data.earningsFen = 0; }],
  ['unsafe balance', b => { b.data.mainBalanceUnits = Number.MAX_SAFE_INTEGER + 1; }],
  ['null balance', b => { b.data.mainBalanceUnits = null; }],
  ['negative balance', b => { b.data.mainBalanceUnits = -1; }],
  ['fractional balance', b => { b.data.mainBalanceUnits = 0.5; }],
  ['missing enrollment', b => { delete b.data.enrollmentSummary.initialGiftUnits; }],
  ['negative historical receipt', b => { b.data.enrollmentSummary.receivedAmountFen = -1; }],
  ['null pending', b => { b.data.enrollmentSummary.pendingIssuanceCount = null; }],
  ['duplicate activity', b => { b.data.lessonActivityTotals[5] = b.data.lessonActivityTotals[0]; }],
  ['missing activity', b => { b.data.lessonActivityTotals.pop(); }],
  ['bad enum', b => { b.data.items[0].entryType = 'OTHER'; }],
  ['bad bucket', b => { b.data.items[0].bucket = 'OTHER'; }],
  ['unsafe delta', b => { b.data.items[0].deltaUnits = Number.MIN_SAFE_INTEGER - 1; }],
  ['negative before', b => { b.data.items[0].balanceBeforeUnits = -1; }],
  ['extra ledger field', b => { b.data.items[0].phone = 'private'; }],
  ['bad uuid', b => { b.data.items[0].studentId = 'x'; }],
  ['bad subject', b => { b.data.items[0].subject.name = 1; }],
  ['bad timestamp', b => { b.data.items[0].createdAt = '2026-02-30T08:00:00Z'; }],
  ['bad date', b => { b.data.items[0].paymentContext.receivedOn = '2026-02-29'; }],
  ['ambiguous payment', b => { b.data.items[0].paymentContext.paidAt = '2026-10-28T08:00:00Z'; }],
  ['extra teaching context', b => { b.data.items[0].teachingContext.private = true; }],
  ['wrong page', b => { b.data.meta.page = 2; }],
  ['wrong total pages', b => { b.data.meta.totalPages = 9; }],
  ['wrong row count', b => { b.data.items.pop(); }],
  ['duplicate row', b => { b.data.items[1] = b.data.items[0]; }],
  ['duplicate UUID case', b => { b.data.items[1].id = b.data.items[0].id.toUpperCase(); }],
  ['array bucket', b => { b.data.items[0].bucket = ['MAIN']; }],
  ['empty timezone', b => { b.data.timezone = ''; }],
  ['bad serverTime', b => { b.data.serverTime = 'yesterday'; }],
];
it.each(invalid)('rejects %s without coercion or modifying the input', async (_name, mutate) => {
  const body = { data: accountPage() };
  mutate(body);
  const original = structuredClone(body);
  await expect(api(body).source.getLessonAccount(ACCOUNT_QUERY)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_RESPONSE' });
  expect(body).toEqual(original);
});
it('accepts field nulls, real zero, signed totals and maximum safe hundredth units', async () => {
  const body = accountPage();
  body.enrollmentSummary.receivedAmountFen = Number.MAX_SAFE_INTEGER;
  body.enrollmentSummary.initialGiftUnits = null;
  body.lessonActivityTotals[0].mainDeltaUnits = Number.MIN_SAFE_INTEGER;
  body.items[0].deltaUnits = 0;
  expect(await api({ data: body }).source.getLessonAccount(ACCOUNT_QUERY)).toEqual(body);
});
it.each([
  { subjectId: SUBJECT_ID, entryType: 'CONSUME' }, { subjectId: 'UNCLASSIFIED' },
])('rejects wrong-filter ledger rows for %j', async patch => {
  await expect(api().source.getLessonAccount({ ...ACCOUNT_QUERY, ...patch }))
    .rejects.toMatchObject({ code: 'INVALID_ACCOUNT_RESPONSE' });
});
it.each([
  { page: 0 }, { page: 2147483648 }, { page: 2147483647, pageSize: 2 },
  { pageSize: 101 }, { pageSize: 1.5 }, { subjectId: 'x' }, { subjectId: SUBJECT_ID.replace('-4000-', '-1000-') },
  { entryType: 'OTHER' }, { campusId: SUBJECT_ID },
])('rejects invalid account query %j before transport', async patch => {
  const { source, request } = api();
  await expect(source.getLessonAccount({ ...ACCOUNT_QUERY, ...patch })).rejects.toMatchObject({ statusCode: 400 });
  expect(request).not.toHaveBeenCalled();
});
it.each([
  (b: any) => { b.data.data[0].private = 1; }, (b: any) => { b.data.data[0].version = 0; },
  (b: any) => { b.data.data[0].name = 'a'.repeat(81); }, (b: any) => { b.data.data[0].isActive = 'true'; },
  (b: any) => { b.data.data[1] = b.data.data[0]; }, (b: any) => { b.data.meta.pageSize = 20; },
])('rejects malformed subject projection %#', async mutate => {
  const body = { data: accountSubjects() }; mutate(body);
  await expect(api(body).source.listAccountSubjects({ page: 1, pageSize: 100 }))
    .rejects.toMatchObject({ code: 'INVALID_ACCOUNT_RESPONSE' });
});
it.each([{ query: 'a'.repeat(101) }, { campusId: SUBJECT_ID }, { page: 2147483647 }])('rejects subject query %j before transport', async patch => {
  const { source, request } = api();
  await expect(source.listAccountSubjects({ page: 1, pageSize: 100, ...patch })).rejects.toMatchObject({ statusCode: 400 });
  expect(request).not.toHaveBeenCalled();
});
it.each([401, 403, 404, 503])('preserves HTTP failure %s through the account service', async status => {
  const service: any = new OperatorService(api({ code: 'SYNTHETIC_FAILURE' }, status).source);
  expect(await service.loadLessonAccount(ACCOUNT_QUERY)).toMatchObject({ status: 'error', statusCode: status, code: 'SYNTHETIC_FAILURE' });
  expect(await service.loadAccountSubjects({ page: 1, pageSize: 100 })).toMatchObject({ status: 'error', statusCode: status });
});
it('mock applies subject/category AND only to detail while keeping campus summaries', async () => {
  const source: any = new MockOperatorDataSource();
  expect(source).toHaveProperty('getLessonAccount', expect.any(Function));
  const original = await source.getLessonAccount(ACCOUNT_QUERY);
  const subjects = await source.listAccountSubjects({ page: 1, pageSize: 100 });
  expect(subjects.data.some((item: any) => item.isActive === false)).toBe(true);
  const filtered = await source.getLessonAccount({ ...ACCOUNT_QUERY, subjectId: subjects.data[0].id, entryType: 'GRANT' });
  expect(filtered.items.every((item: any) => item.subject?.id === subjects.data[0].id && item.entryType === 'GRANT')).toBe(true);
  expect(filtered.enrollmentSummary).toEqual(original.enrollmentSummary);
  expect(filtered.lessonActivityTotals).toEqual(original.lessonActivityTotals);
  const second = await source.getLessonAccount({ ...ACCOUNT_QUERY, page: 2 });
  expect(second.meta.page).toBe(2);
});
