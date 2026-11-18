import type { OperatorHttpRequestOptions } from '../pages/operator/runtime/data/api-operator-data-source';
import type { OperatorLeaveRequest } from '../pages/operator/runtime/types/operator';
import type { MockOperatorDataSource } from '../pages/operator/runtime/data/mock-operator-data-source';
import { capture, fixture, flush, pendingLeaves, tap } from './operator-page-host';

// Creation and review order deliberately disagree; each terminal status has >20 rows.
export const interleavedHistory: OperatorLeaveRequest[] = Array.from({ length: 45 }, (_, index) => ({
  ...pendingLeaves[0],
  id: `52000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  studentName: `合成学员${index + 1}`,
  status: index % 2 === 0 ? 'APPROVED' : 'REJECTED',
  createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
  reviewedAt: index >= 43 ? null
    : new Date(Date.UTC(2026, 9, 24, 0, 45 - Math.floor(index / 2))).toISOString(),
  reviewerName: '合成审批人',
  reviewReason: index % 2 === 0 ? null : '合成驳回原因',
  version: 2,
}));

export const orderedHistoryIds = [
  ...Array.from({ length: 21 }, (_, pair) => [pair * 2 + 1, pair * 2]).flat(),
  42, 44, 43,
].map((index) => interleavedHistory[index].id);

export function respondHistory(options: OperatorHttpRequestOptions) {
  const url = new URL(options.url);
  const status = url.searchParams.get('status');
  const reviewedOnly = url.searchParams.get('reviewedOnly');
  const page = Number(url.searchParams.get('page'));
  const pageSize = Number(url.searchParams.get('pageSize'));
  if (reviewedOnly !== null && (status !== null || !['true', 'false'].includes(reviewedOnly))) {
    options.success({ statusCode: 400, data: { code: 'BAD_REQUEST' } }); return;
  }
  const records = reviewedOnly === 'true'
    ? orderedHistoryIds.map((id) => interleavedHistory.find((record) => record.id === id)!)
    : interleavedHistory.filter((record) => !status || record.status === status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  options.success({ statusCode: 200, data: {
    data: records.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, total: records.length, totalPages: Math.ceil(records.length / pageSize) },
  } });
}

export async function openHistory() {
  const env = capture(['leave-requests']);
  const page = env.instantiate();
  page.onLoad({}); page.onShow(); await flush();
  env.list(0, []); await flush();
  page.onTabTap(tap('history')); await flush();
  env.calls.slice(1).forEach(respondHistory); await flush();
  return { env, page };
}

export function historyMockSource(): MockOperatorDataSource {
  let source!: MockOperatorDataSource;
  try {
    jest.isolateModules(() => {
      jest.doMock('../pages/operator/runtime/mock/fixtures/operator.fixture', () => ({
        ...jest.requireActual('../pages/operator/runtime/mock/fixtures/operator.fixture'),
        NORMAL_OPERATOR_FIXTURE: { ...fixture, leaveRequests: [...interleavedHistory, ...pendingLeaves] },
      }));
      const { MockOperatorDataSource } = require('../pages/operator/runtime/data/mock-operator-data-source');
      source = new MockOperatorDataSource();
    });
  } finally { jest.dontMock('../pages/operator/runtime/mock/fixtures/operator.fixture'); }
  return source;
}
