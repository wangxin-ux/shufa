import {
  buildTeacherEarningEntryModel, buildTeacherEarningRuleModel, buildTeacherEarningSummaryModel,
} from '../services/teacher-earnings.presenter';
import { flushTeacherPage } from './teacher-page-test-support';
import { historicalRead, openPage, zeroSummary } from './teacher-earning-unknown-ui-support';

const present = (name: string, patch: Record<string, unknown>) => {
  const entry = historicalRead(patch), original = JSON.stringify(entry);
  const model = buildTeacherEarningEntryModel(entry);
  expect(JSON.stringify(entry)).toBe(original);
  expect(JSON.stringify(model)).not.toMatch(/null|undefined|NaN|Infinity/);
  return model;
};

test.each([
  ['PER_COMPLETED_SESSION', '每完成一课次', '单价 ¥3.00'],
  ['PER_LESSON_UNIT', '按课时', '1.25 课时 · 单价 ¥3.00'],
  ['PER_PRESENT_ATTENDEE', '按实际到课人数', '2 人到课 · 单价 ¥3.00'],
])('[control] complete %s retains the configured explanation', (basisType, basisLabel, basisDetail) => {
  expect(present(basisType, { basisType })).toMatchObject({
    basisLabel, basisDetail, amount: '¥3.75', statusLabel: '待审核', timeLabel: '2026-09-20 09:30',
  });
});
test('[control] known zero count and stored monetary zero stay visible', () => {
  expect(present('known-zero', { basisType: 'PER_PRESENT_ATTENDEE', attendeeCount: 0, amountFen: 0 }))
    .toMatchObject({ amount: '¥0.00', basisDetail: '0 人到课 · 单价 ¥3.00' });
});
test('[control] empty summary zero and absent current rule preserve their existing meaning', () => {
  expect(buildTeacherEarningSummaryModel(zeroSummary as Parameters<typeof buildTeacherEarningSummaryModel>[0])
    .map(item => item.value)).toEqual(Array(4).fill('¥0.00'));
  expect(buildTeacherEarningRuleModel(null)).toMatchObject({ configured: false, basisLabel: '待配置' });
});

test.each([null, undefined, '', 'PER_LEGACY', 0, '__proto__'])(
  '[display] unknown basis %p preserves a known price', basisType => {
    expect(present('basis-' + String(basisType), { basisType })).toMatchObject({
      basisLabel: '待核对', basisDetail: '单价 ¥3.00', amount: '¥3.75',
    });
  },
);
test.each([null, undefined, 0, -1, 1.5, '300', Number.MAX_SAFE_INTEGER + 1])(
  '[display] unavailable price %p retains known units', unitAmountFen => {
    expect(present('price-' + String(unitAmountFen), { unitAmountFen })).toMatchObject({
      basisLabel: '按课时', basisDetail: '1.25 课时 · 单价 待核对',
    });
  },
);
test.each([null, undefined, 0, -1, 1.5, '125', Number.MAX_SAFE_INTEGER + 1])(
  '[display] unavailable units %p retain a known price', lessonUnits => {
    expect(present('units-' + String(lessonUnits), { lessonUnits })).toMatchObject({
      basisLabel: '按课时', basisDetail: '课时待核对 · 单价 ¥3.00',
    });
  },
);
test.each([null, undefined, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1])(
  '[display] unavailable count %p is not inferred from amount', attendeeCount => {
    expect(present('count-' + String(attendeeCount), { basisType: 'PER_PRESENT_ATTENDEE', attendeeCount }))
      .toMatchObject({ basisLabel: '按实际到课人数', basisDetail: '人数待核对 · 单价 ¥3.00' });
  },
);
test('[display] zero counted people survive a missing price and irrelevant units', () => {
  expect(present('zero-unknown-price', {
    basisType: 'PER_PRESENT_ATTENDEE', attendeeCount: 0, unitAmountFen: null, lessonUnits: null,
  })).toMatchObject({ basisDetail: '0 人到课 · 单价 待核对' });
});
test('[display] mixed unknowns affect their own labels without adding irrelevant fields', () => {
  expect(present('mixed', {
    basisType: 'PER_PRESENT_ATTENDEE', attendeeCount: null, unitAmountFen: null, lessonUnits: null,
  })).toMatchObject({ basisDetail: '人数待核对 · 单价 待核对' });
  expect(present('session-irrelevant', {
    basisType: 'PER_COMPLETED_SESSION', attendeeCount: null, lessonUnits: null,
  })).toMatchObject({ basisDetail: '单价 ¥3.00' });
  expect(present('all-unknown', {
    basisType: null, attendeeCount: null, unitAmountFen: null, lessonUnits: null,
  })).toMatchObject({ basisLabel: '待核对', basisDetail: '单价 待核对' });
});
test.each([
  ['PENDING_REVIEW', '待审核'], ['AVAILABLE', '可提现'], ['REJECTED', '已驳回'], ['REVERSED', '已撤销'],
] as const)('[display] %s keeps authoritative amount, time, status and reason', (status, statusLabel) => {
  expect(present(status, {
    status, unitAmountFen: null, amountFen: status === 'REVERSED' ? -375 : 375,
    entryType: status === 'REVERSED' ? 'REVERSAL' : 'ACCRUAL',
    rejectionReason: status === 'REJECTED' ? '合成历史审核原因' : null,
  })).toMatchObject({
    amount: status === 'REVERSED' ? '-¥3.75' : '¥3.75',
    entryTypeLabel: status === 'REVERSED' ? '撤销冲正' : '课次收益',
    statusLabel, reason: status === 'REJECTED' ? '合成历史审核原因' : '',
    timeLabel: '2026-09-20 09:30', basisDetail: '1.25 课时 · 单价 待核对',
  });
});

test('[page] actual Page uses nullable read rows on first and next pages without data injection', async () => {
  const host = await openPage();
  try {
    const first = Array.from({ length: 10 }, (_, index) => historicalRead({
      id: `first-${index}`, basisType: 'PER_PRESENT_ATTENDEE',
      attendeeCount: index === 0 ? 0 : null, unitAmountFen: null,
    }));
    await host.reply(first, 1, 11);
    expect(host.page.data.earnings).toHaveLength(10);
    expect(host.page.data.earnings[0]).toMatchObject({ basisDetail: '0 人到课 · 单价 待核对', amount: '¥3.75' });
    host.page.onLoadMore();
    await host.reply([historicalRead({
      id: 'last-11', lessonUnits: null, entryType: 'REVERSAL', amountFen: -375, status: 'REVERSED',
    })], 2, 11);
    expect(host.page.data.earnings).toHaveLength(11);
    expect(host.page.data.earnings[10]).toMatchObject({
      basisDetail: '课时待核对 · 单价 ¥3.00', amount: '-¥3.75', statusLabel: '已撤销',
    });
    expect(host.page.data.earningsHasMore).toBe(false);
    expect(host.record().pendingReads).toBe(0);
  } finally { host.close(); }
});
test('[page] original page retry replaces failure with readable unknown fields', async () => {
  const host = await openPage();
  try {
    await host.reply([], 1, 0, 503);
    expect(host.page.data.listError).toBe('记录加载失败，请重试');
    host.page.onRetrySection({ currentTarget: { dataset: { section: 'earnings' } } });
    await host.reply([historicalRead({ basisType: null, unitAmountFen: null })]);
    expect(host.page.data).toMatchObject({
      listError: '', earningsError: '', earningsLoaded: true,
      earnings: [{ basisLabel: '待核对', basisDetail: '单价 待核对', amount: '¥3.75' }],
    });
    expect(host.record().pendingReads).toBe(0);
  } finally { host.close(); }
});
test('[page] next-page failure retains earlier rows and retries the same next-page source', async () => {
  const host = await openPage();
  try {
    await host.reply([historicalRead({ unitAmountFen: null })], 1, 11);
    const before = structuredClone(host.page.data.earnings);
    host.page.onLoadMore(); await host.reply([], 2, 11, 503);
    expect(host.page.data.earnings).toEqual(before);
    host.page.onLoadMore();
    await host.reply([historicalRead({ id: 'second-row', lessonUnits: null })], 2, 11);
    expect(host.page.data.earnings).toHaveLength(2);
    expect(host.page.data.earnings[1].basisDetail).toBe('课时待核对 · 单价 ¥3.00');
    expect(host.page.data.listError).toBe('');
  } finally { host.close(); }
});
test.each([401, 403])('[page] %i denial clears private rows and rejects a late earlier reply', async code => {
  const host = await openPage();
  try {
    await host.reply([historicalRead({ unitAmountFen: null })], 1, 11);
    host.page.onLoadMore();
    const late = host.pending(2);
    host.page.onRetrySection({ currentTarget: { dataset: { section: 'earnings' } } });
    await host.reply([], 1, 0, code);
    expect(host.page.data.viewState).toBe('forbidden');
    host.respond(late, { data: [historicalRead({ id: 'late', unitAmountFen: null })],
      meta: { page: 2, pageSize: 10, total: 11, totalPages: 2 } });
    await flushTeacherPage();
    expect(host.page.data).toMatchObject({ viewState: 'forbidden', earnings: [], summaryItems: [] });
    expect(host.record().pendingReads).toBe(0);
  } finally { host.close(); }
});
test('[page] token change prevents a late next page from repopulating private data', async () => {
  const host = await openPage();
  try {
    await host.reply([historicalRead({ unitAmountFen: null })], 1, 11);
    host.page.onLoadMore();
    const late = host.pending(2);
    host.env.change({ accessToken: 'synthetic-new-session' });
    host.page.onShow();
    host.respond(late, { data: [historicalRead({ id: 'late' })],
      meta: { page: 2, pageSize: 10, total: 11, totalPages: 2 } });
    await flushTeacherPage();
    expect(host.page.data).toMatchObject({ viewState: 'forbidden', earnings: [] });
  } finally { host.close(); }
});
