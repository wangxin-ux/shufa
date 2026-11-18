import './operator-leave-history.repro';
import { ApiOperatorDataSource, OperatorHttpRequestOptions } from '../pages/operator/runtime/data/api-operator-data-source';
import { OperatorService } from '../pages/operator/runtime/services/operator.service';
import { buildOperatorLeaveItems, mergeOperatorLeaveHistory } from '../pages/operator/runtime/services/operator-leave.presenter';
import type { OperatorLeaveQuery } from '../pages/operator/runtime/types/operator';
import { flush, pendingLeaves, tap } from './operator-page-host';
import {
  historyMockSource,
  interleavedHistory,
  openHistory,
  orderedHistoryIds,
  respondHistory,
} from './operator-leave-history.fixture';

it.each(['APPROVED', 'REJECTED'] as const)('shows an explicit unknown review time for a %s record', (status) => {
  const item = buildOperatorLeaveItems([{ ...interleavedHistory[0], status, reviewedAt: null }])[0];
  expect(item.reviewerLabel).toBe('合成审批人 · 审批时间未知');
  expect(item.canReview).toBe(false);
  expect(item.reviewerLabel).not.toContain('2026');
});

it('does not invent a reviewer when both historical review fields are absent', () => {
  const item = buildOperatorLeaveItems([{
    ...interleavedHistory[0], reviewerName: null, reviewedAt: null,
  }])[0];
  expect(item.reviewerLabel).toBe('审批人未知 · 审批时间未知');
});

it('preserves a known review time when only the reviewer is missing and keeps pending metadata empty', () => {
  const [reviewed, pending] = buildOperatorLeaveItems([
    { ...interleavedHistory[0], reviewerName: null },
    { ...interleavedHistory[0], status: 'PENDING', canReview: undefined },
  ]);
  expect(reviewed.reviewerLabel).toBe('审批人未知 · 2026年10月24日 08:45');
  expect(pending.reviewerLabel).toBe('');
  expect(pending.canReview).toBe(false);
});

it('keeps history read-only and sends one reviewed query while pending remains a single-status read', async () => {
  const { env, page } = await openHistory();
  try {
    expect(env.calls).toHaveLength(2);
    expect(new URL(env.calls[0].url).searchParams.get('status')).toBe('PENDING');
    expect(new URL(env.calls[0].url).searchParams.has('reviewedOnly')).toBe(false);
    expect(new URL(env.calls[1].url).search).toBe('?page=1&pageSize=20&reviewedOnly=true');
    page.onRequestSelectTap(tap(interleavedHistory[0].id));
    page.onApproveTap(tap(interleavedHistory[0].id));
    page.onRejectTap(tap(interleavedHistory[0].id));
    expect(page.data.selectedItem).toBeNull();
    expect(page.data.rejectVisible).toBe(false);
    expect(env.platform.showModal).not.toHaveBeenCalled();
    expect(env.calls.every((call) => call.method === 'GET')).toBe(true);
  } finally { env.close(); }
});

it('retains page one after page-two failure, retries page two, and finishes all 45 globally ordered rows', async () => {
  const { env, page } = await openHistory();
  try {
    const before = structuredClone(page.data.items);
    expect(before.map((item: { id: string }) => item.id)).toEqual(orderedHistoryIds.slice(0, 20));
    page.onLoadMore(); await flush();
    expect(env.calls).toHaveLength(3);
    env.reply(2, {}, 503); await flush();
    expect(page.data).toMatchObject({
      viewState: 'ready', page: 1, total: 45, hasMore: true, loadingMore: false, items: before,
    });
    expect(page.data.loadMoreError).toBeTruthy();
    page.onLoadMore(); await flush();
    expect(new URL(env.calls[3].url).search).toBe('?page=2&pageSize=20&reviewedOnly=true');
    respondHistory(env.calls[3]); await flush();
    expect(page.data).toMatchObject({ page: 2, total: 45, hasMore: true, loadMoreError: '' });
    page.onLoadMore(); await flush();
    expect(new URL(env.calls[4].url).searchParams.get('page')).toBe('3');
    respondHistory(env.calls[4]); await flush();
    expect(page.data).toMatchObject({ page: 3, total: 45, hasMore: false });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(orderedHistoryIds);
    expect(new Set(page.data.items.map((item: { id: string }) => item.id)).size).toBe(45);
  } finally { env.close(); }
});

it.each([true, false])('serializes reviewedOnly=%s through the actual Service/API without adding status', async (reviewedOnly) => {
  const calls: OperatorHttpRequestOptions[] = [];
  const service = new OperatorService(new ApiOperatorDataSource({
    baseUrl: 'https://operator.example.test', accessToken: 'synthetic-owner-a',
    request: (options) => { calls.push(options); respondHistory(options); },
  }));
  const result = await service.loadLeaveRequests({ page: 1, pageSize: 20, reviewedOnly } as OperatorLeaveQuery);
  expect(calls).toHaveLength(1);
  expect(new URL(calls[0].url).search).toBe(`?page=1&pageSize=20&reviewedOnly=${reviewedOnly}`);
  expect(result).toMatchObject({ status: 'success', data: {
    meta: { page: 1, pageSize: 20, total: 45, totalPages: 3 },
  } });
});

it('uses the history response meta total and page count without inferring from the loaded array', async () => {
  const { env, page } = await openHistory();
  try {
    const start = env.calls.length;
    page.onRetry(); await flush();
    env.calls.slice(start).forEach((call) => call.success({ statusCode: 200, data: {
      data: interleavedHistory.slice(0, 20), meta: { page: 1, pageSize: 20, total: 73, totalPages: 4 },
    } }));
    await flush();
    expect(page.data).toMatchObject({ total: 73, page: 1, hasMore: true });
    expect(page.data.items).toHaveLength(20);
  } finally { env.close(); }
});

it('does not apply a late history page after switching back to pending', async () => {
  const { env, page } = await openHistory();
  try {
    page.onLoadMore(); await flush();
    const old = env.calls[2];
    page.onTabTap(tap('pending')); await flush();
    env.calls[env.calls.length - 1].success({ statusCode: 200, data: {
      // pendingLeaves is the actionable subset (1 of 3 fixture rows), so the page
      // count must agree with the rows actually served or the page rejects it.
      data: pendingLeaves, meta: { page: 1, pageSize: 20, total: pendingLeaves.length, totalPages: 1 },
    } });
    await flush();
    respondHistory(old); await flush();
    expect(page.data.activeTab).toBe('pending');
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(pendingLeaves.map((record) => record.id));
    expect(page.data.selectedItem.id).toBe(pendingLeaves[0].id);
  } finally { env.close(); }
});

it.each([401, 403])('clears history on current %s while a late old-owner response cannot clear the new owner', async (status) => {
  const { env, page } = await openHistory();
  try {
    page.onRetry(); await flush();
    const oldRead = env.calls[env.calls.length - 1];
    env.change({ accessToken: 'synthetic-owner-b' });
    const fresh = env.instantiate();
    fresh.onLoad({}); fresh.onShow(); await flush();
    env.calls[env.calls.length - 1].success({ statusCode: 200, data: {
      // pendingLeaves is the actionable subset (1 of 3 fixture rows), so the page
      // count must agree with the rows actually served or the page rejects it.
      data: pendingLeaves, meta: { page: 1, pageSize: 20, total: pendingLeaves.length, totalPages: 1 },
    } });
    oldRead.success({ statusCode: status, data: {} }); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [] });
    expect(fresh.data.viewState).toBe('ready');
    fresh.onTabTap(tap('history')); await flush();
    env.calls[env.calls.length - 1].success({ statusCode: status, data: {} }); await flush();
    expect(fresh.data).toMatchObject({ viewState: 'forbidden', items: [], selectedItem: null });
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-owner-b');
    expect(env.values.get('education.session.logged-out')).toBe(false);
  } finally { env.close(); }
});

it('matches global filtering, time/id order, nulls last and total in Mock across three pages', async () => {
  const source = historyMockSource();
  const pages = await Promise.all([1, 2, 3].map((page) =>
    source.listLeaveRequests({ page, pageSize: 20, reviewedOnly: true } as OperatorLeaveQuery)));
  expect(pages.map((page) => page.data.length)).toEqual([20, 20, 5]);
  expect(pages.flatMap((page) => page.data.map((record) => record.id))).toEqual(orderedHistoryIds);
  expect(pages.every((page) => page.meta.total === 45 && page.meta.totalPages === 3)).toBe(true);
  expect(pages[2].data.slice(-2).map((record) => record.reviewedAt)).toEqual([null, null]);
});

it.each([undefined, false])('keeps legacy Mock creation ordering when reviewedOnly=%s', async (reviewedOnly) => {
  const source = historyMockSource();
  const input = { page: 1, pageSize: 100, ...(reviewedOnly === undefined ? {} : { reviewedOnly }) };
  const result = await source.listLeaveRequests(input);
  const records = [...interleavedHistory, ...pendingLeaves].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  expect(result.data.map((record) => record.id)).toEqual(records.map((record) => record.id));
  expect(result.meta.total).toBe(records.length);
});

it.each([true, false])('rejects even reviewedOnly=%s combined with status in Mock', async (reviewedOnly) => {
  const source = historyMockSource();
  await expect(source.listLeaveRequests({
    page: 1, pageSize: 20, status: 'PENDING', reviewedOnly,
  } as unknown as OperatorLeaveQuery)).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
});

it.each(['true', 'false'])('rejects a raw nonboolean reviewedOnly=%s in Mock', async (reviewedOnly) => {
  const source = historyMockSource();
  await expect(source.listLeaveRequests({
    page: 1, pageSize: 20, reviewedOnly,
  } as unknown as OperatorLeaveQuery)).rejects.toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
});

it('deduplicates an overlapping history response without losing its updated version or original server position', () => {
  const first = interleavedHistory[1];
  const second = interleavedHistory[0];
  const updated = { ...first, version: 3, reviewReason: '补全历史说明' };
  expect(mergeOperatorLeaveHistory([first, second], [updated, interleavedHistory[3]]))
    .toEqual([updated, second, interleavedHistory[3]]);
});

it('keeps a failed history refresh visible, then recovers to an authoritative empty result', async () => {
  const { env, page } = await openHistory();
  try {
    const before = structuredClone(page.data.items);
    page.onRetry(); await flush();
    env.reply(2, {}, 503); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', items: before, page: 1, total: 45 });
    expect(page.data.refreshError).toBeTruthy();
    page.onRetry(); await flush();
    env.list(3, [], 1, 0); await flush();
    expect(page.data).toMatchObject({
      viewState: 'empty', items: [], selectedItem: null, total: 0, page: 1, hasMore: false, refreshError: '',
    });
  } finally { env.close(); }
});

it.each([
  ['pull', 200], ['pull', 503], ['retry', 200], ['retry', 503],
] as const)('restarts history at page one on %s refresh and ignores the old page-two %s', async (trigger, status) => {
  const { env, page } = await openHistory();
  try {
    page.onLoadMore(); await flush();
    if (trigger === 'pull') page.onPullDownRefresh();
    else page.onRetry();
    await flush();
    expect(env.calls).toHaveLength(4);
    expect(new URL(env.calls[3].url).search).toBe('?page=1&pageSize=20&reviewedOnly=true');
    expect(page.data).toMatchObject({ page: 1, refreshing: true, loadingMore: false });
    expect(env.platform.stopPullDownRefresh).not.toHaveBeenCalled();
    if (status === 200) respondHistory(env.calls[2]);
    else env.reply(2, {}, status);
    await flush();
    expect(page.data).toMatchObject({
      page: 1, refreshing: true, loadingMore: false, refreshError: '', loadMoreError: '',
    });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual(orderedHistoryIds.slice(0, 20));
    page.onRetry(); await flush();
    expect(env.calls).toHaveLength(4);
    const latest = { ...interleavedHistory[44], reviewedAt: '2026-10-24T02:00:00.000Z' };
    env.list(3, [latest], 1, 1); await flush();
    expect(page.data).toMatchObject({ page: 1, total: 1, hasMore: false, refreshing: false, loadingMore: false });
    expect(page.data.items.map((item: { id: string }) => item.id)).toEqual([latest.id]);
    expect(env.platform.stopPullDownRefresh).toHaveBeenCalledTimes(trigger === 'pull' ? 1 : 0);
  } finally { env.close(); }
});
