import assert from 'node:assert/strict';
import type { TeacherEarningEntry } from '../types/teacher';
import type { TeacherHttpRequestOptions } from '../data/api-teacher-data-source';
import { captureTeacherPage, flushTeacherPage } from './teacher-page-test-support';

// These are explicit read responses for the approved nullable wiring target, not backend projections.
export function historicalRead(patch: Record<string, unknown> = {}): TeacherEarningEntry {
  return {
    id: 'synthetic-earning-1', campusId: 'synthetic-campus', teacherId: 'synthetic-teacher',
    teacherName: '合成教师', teachingRecordId: 'synthetic-record', lessonSessionId: 'synthetic-lesson',
    courseName: '综合创意美术', lessonStartsAt: '2026-09-20T01:30:00.000Z',
    entryType: 'ACCRUAL', amountFen: 375, status: 'PENDING_REVIEW',
    basisType: 'PER_LESSON_UNIT', unitAmountFen: 300, lessonUnits: 125, attendeeCount: 2,
    reviewableAt: '2026-09-21T02:00:00.000Z', reviewedAt: null, rejectionReason: null,
    createdAt: '2026-09-20T02:00:00.000Z', version: 3, ...patch,
  } as unknown as TeacherEarningEntry;
}
export const zeroSummary = {
  todayEstimatedFen: 0, weekEstimatedFen: 0, monthEstimatedFen: 0, estimatedTotalFen: 0,
  pendingReviewFen: 0, availableFen: 0, withdrawingFen: 0, currency: 'CNY',
};
export interface RequestRead {
  path: string; method: string; settled: boolean; input: TeacherHttpRequestOptions;
  statusCode?: number; response?: unknown;
}
export async function openPage() {
  const env = captureTeacherPage('earnings', { preload: false, autoClock: false, autoSession: false });
  const requests: RequestRead[] = [];
  env.change({ apiBaseUrl: 'https://earning-ui.synthetic.invalid', accessToken: 'synthetic-local-read', dataDriver: 'api' });
  const respond = (request: RequestRead, data: unknown, statusCode = 200) => {
    assert(!request.settled, 'Controlled read can only settle once');
    request.settled = true; request.statusCode = statusCode;
    const wire: unknown = JSON.parse(JSON.stringify(data));
    request.response = wire;
    request.input.success({ statusCode, data: wire });
  };
  env.wx.request = (input: TeacherHttpRequestOptions) => {
    const url = new URL(input.url);
    assert.equal(url.origin, 'https://earning-ui.synthetic.invalid');
    assert.equal(input.method, 'GET', 'Unknown-field display must not write');
    const request: RequestRead = { path: url.pathname + url.search, method: input.method, input, settled: false };
    requests.push(request);
    let body: unknown;
    if (url.pathname === '/me') body = { data: {
      userId: 'synthetic-ui-user', displayName: '合成教师',
      roles: [{ code: 'TEACHER', campusId: 'synthetic-campus' }],
    } };
    else if (url.pathname === '/teachers/me/earnings/summary') body = { data: zeroSummary };
    else if (url.pathname === '/teachers/me/earning-rule') body = { data: null };
    else { assert.equal(url.pathname, '/teachers/me/earnings'); return; }
    queueMicrotask(() => respond(request, body));
  };
  env.register('earnings');
  const page = env.instantiate();
  page.onLoad(); page.onShow();
  await flushTeacherPage();
  const pending = (pageNumber: number) => {
    const found = requests.find(request => !request.settled &&
      request.path === `/teachers/me/earnings?page=${pageNumber}&pageSize=10`);
    assert(found, `Expected actual Page read of page ${pageNumber}`);
    return found;
  };
  const reply = async (rows: TeacherEarningEntry[], pageNumber = 1, total = rows.length, statusCode = 200) => {
    respond(pending(pageNumber), statusCode === 200 ? {
      data: rows, meta: { page: pageNumber, pageSize: 10, total, totalPages: Math.ceil(total / 10) },
    } : { code: 'SYNTHETIC_READ_FAILURE', message: '合成读取失败' }, statusCode);
    await flushTeacherPage();
  };
  const record = () => ({
    data: structuredClone(page.data),
    requests: requests.map(({ input: _input, ...request }) => request),
    pendingReads: requests.filter(request => !request.settled).length,
  });
  return { env, page, requests, respond, pending, reply, record, close: env.close };
}
