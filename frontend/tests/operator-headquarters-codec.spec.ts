import { parseDirectory, parseCampusSummary, parseTotalSummary, HeadquartersError } from '../pages/operator/headquarters/codec';
import { directory, campusSummary, totalSummary, uuid } from './operator-headquarters.fixture';

it('preserves unknown historical fields and negative earnings without rounding safe integers', () => {
  const value = totalSummary();
  value.earnings.estimatedTotalFen = Number.MIN_SAFE_INTEGER;
  expect(parseTotalSummary({ data: value })).toEqual(value);
  expect(parseCampusSummary({ data: campusSummary() }, uuid(1))).toEqual(campusSummary());
  expect(parseDirectory(directory(), { page: 1, pageSize: 20, query: '' }).data).toHaveLength(20);
});
it.each([
  ['short page', (v: any) => v.data.pop()],
  ['duplicate id', (v: any) => { v.data[1].id = v.data[0].id.toUpperCase(); }],
  ['invalid uuid', (v: any) => { v.data[0].id = 'synthetic-id'; }],
  ['timezone', (v: any) => { v.data[0].timezone = 'bad/timezone'; }],
  ['private field', (v: any) => { v.data[0].studentName = '隐私'; }],
  ['meta mismatch', (v: any) => { v.meta.totalPages = 3; }],
  ['wrong page', (v: any) => { v.meta.page = 2; }],
  ['wrong page size', (v: any) => { v.meta.pageSize = 100; }],
])('rejects broken directory %s', (_name, mutate) => {
  const value = directory(); (mutate as (value: unknown) => void)(value);
  expect(() => parseDirectory(value, { page: 1, pageSize: 20, query: '' })).toThrow(HeadquartersError);
});
it.each([
  ['balance total', (v: any) => { v.account.totalBalanceUnits++; }],
  ['negative balance', (v: any) => { v.account.mainBalanceUnits = -1; }],
  ['overflow', (v: any) => { v.activeStudentCount = Number.MAX_SAFE_INTEGER + 1; }],
  ['fractional amount', (v: any) => { v.earnings.estimatedTotalFen = 1.1; }],
  ['currency', (v: any) => { v.earnings.currency = 'USD'; }],
  ['missing type', (v: any) => { v.account.lessonActivityTotals.pop(); }],
  ['duplicate type', (v: any) => { v.account.lessonActivityTotals[1].entryType = 'GRANT'; }],
  ['activity sum', (v: any) => { v.account.lessonActivityTotals[0].totalDeltaUnits++; }],
  ['false known total', (v: any) => { v.account.lessonActivityTotals[0].mainDeltaUnits = null; }],
  ['missing known field', (v: any) => { delete v.account.enrollmentSummary.refundedAmountFen; }],
  ['personal records', (v: any) => { v.students = []; }],
  ['invalid timestamp', (v: any) => { v.serverTime = 'not-a-time'; }],
  ['impossible calendar date', (v: any) => { v.serverTime = '2026-02-31T06:00:00Z'; }],
  ['rolled midnight', (v: any) => { v.serverTime = '2026-10-29T24:00:00Z'; }],
  ['wrong basis', (v: any) => { v.studentCountBasis = 'DISTINCT_PEOPLE'; }],
  ['zero-grant false totals', (v: any) => { v.campusCount = 0; }],
])('rejects broken total %s', (_name, mutate) => {
  const value = totalSummary(); (mutate as (value: unknown) => void)(value);
  expect(() => parseTotalSummary({ data: value })).toThrow(HeadquartersError);
});
it('rejects a summary for another authorized-looking campus and private nested content', () => {
  expect(() => parseCampusSummary({ data: campusSummary(2) }, uuid(1))).toThrow();
  expect(() => parseCampusSummary({ data: { ...campusSummary(), account: { ...campusSummary().account, ledgers: [] } } }, uuid(1))).toThrow();
});
it('propagates null activity components field by field and requires a null total', () => {
  const value: any = totalSummary();
  value.account.lessonActivityTotals[0].mainDeltaUnits = null;
  value.account.lessonActivityTotals[0].totalDeltaUnits = null;
  expect(parseTotalSummary({ data: value }).account.lessonActivityTotals[0].giftDeltaUnits).toBe(690);
});
