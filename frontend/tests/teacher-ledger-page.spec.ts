import * as fs from 'node:fs';
import * as path from 'node:path';
import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';

const rows = (page = 1, ids = ['consume'], totalPages = 2) => ({
  data: ids.map((id) => ({
    id, lessonSessionId: 'lesson', studentId: 'student', studentName: '合成学员',
    occurredAt: '2026-10-25T02:00:00Z',
    entryType: id === 'reverse' ? 'REVERSAL' : 'CONSUME', bucket: 'GIFT',
    deltaUnits: id === 'reverse' ? 60 : -60,
  })),
  meta: { page, pageSize: 20, total: totalPages === 1 ? ids.length : 21, totalPages },
});
const failure = { code: 'INTERNAL_SERVER_ERROR', message: 'Synthetic failure' };

describe('teacher own lesson ledger Page', () => {
  it('pins the current session, ignores a hidden reply, and refreshes reversals on return', async () => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.();
      expect(env.calls).toHaveLength(1);
      expect(env.calls[0]).toMatchObject({
        url: 'https://initial.synthetic.invalid/teachers/me/lesson-ledger?page=1&pageSize=20',
        header: { Authorization: 'Bearer synthetic-teacher-a' },
      });
      page.onHide?.(); env.reply(0, rows()); await flush();
      expect(page.data.items).toEqual([]);
      page.onShow?.(); expect(env.calls).toHaveLength(2);
      env.reply(1, rows(1, ['reverse', 'consume'], 1)); await flush();
      expect(page.data.items.map((item: { deltaLabel: string }) => item.deltaLabel)).toEqual(['+0.6', '-0.6']);
    } finally { env.close(); }
  });

  it('retains rows on refresh and append failures and retries the original page', async () => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, rows()); await flush();
      page.onPullDownRefresh(); env.reply(1, failure, 503); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', page: 1, refreshError: '刷新失败，请重试' });
      expect(page.data.items).toHaveLength(1);
      page.onLoadMore(); env.reply(2, failure, 503); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', page: 1, loadMoreError: '加载更多失败，请重试' });
      page.onLoadMore();
      expect(env.calls[3].url).toContain('page=2');
      env.reply(3, rows(2, ['consume', 'other'])); await flush();
      expect(page.data.items).toHaveLength(2);
      expect(page.data.loadMoreError).toBe('');
    } finally { env.close(); }
  });

  it('lets a reset supersede a pending append without restoring stale records', async () => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, rows()); await flush();
      page.onLoadMore(); page.onPullDownRefresh();
      expect(env.calls).toHaveLength(3);
      env.reply(2, rows(1, [], 1)); await flush();
      env.reply(1, rows(2, ['stale'])); await flush();
      expect(page.data).toMatchObject({ viewState: 'empty', items: [], page: 1, hasMore: false });
    } finally { env.close(); }
  });

  it.each([401, 403])('clears private rows and stops the pull on current %s', async (statusCode) => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, rows()); await flush();
      page.onPullDownRefresh(); env.reply(1, failure, statusCode); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], page: 0, hasMore: false });
      expect(page.data.errorMessage).toContain('扣课流水');
      expect(env.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
      page.onRetry(); page.onLoadMore();
      expect(env.calls).toHaveLength(2);
      page.onLogin();
      expect(env.values.get('education.session.logged-out')).toBe(true);
      expect(env.wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
    } finally { env.close(); }
  });

  it.each([
    { accessToken: 'synthetic-teacher-b' },
    { apiBaseUrl: 'https://other.synthetic.invalid' },
    { dataDriver: 'mock' },
  ])('rejects an old response after changing session %p', async (patch) => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.();
      env.change(patch); env.reply(0, rows()); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], page: 0 });
      page.onRetry(); expect(env.calls).toHaveLength(1);
    } finally { env.close(); }
  });

  it('clears old rows on logout before a return request can start', async () => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, rows()); await flush();
      page.onHide?.();
      env.values.set('education.session.logged-out', true);
      page.onShow?.();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [] });
      expect(env.calls).toHaveLength(1);
    } finally { env.close(); }
  });

  it('keeps the empty state readable when its refresh fails', async () => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, rows(1, [], 1)); await flush();
      page.onPullDownRefresh(); env.reply(1, failure, 503); await flush();
      expect(page.data).toMatchObject({ viewState: 'empty', items: [], refreshError: '刷新失败，请重试' });
    } finally { env.close(); }
  });

  it('does not let another Page instance cancel the current response', async () => {
    const env = captureTeacherPage('ledger');
    try {
      const first = env.instantiate(), second = env.instantiate();
      first.onLoad(); first.onShow?.(); second.onLoad(); second.onShow?.();
      env.reply(0, rows(1, ['first'])); env.reply(1, rows(1, ['second'])); await flush();
      expect(first.data.items[0].id).toBe('first');
      expect(second.data.items[0].id).toBe('second');
    } finally { env.close(); }
  });

  it('deduplicates pending reads and ignores an unloaded callback', async () => {
    const env = captureTeacherPage('ledger');
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); page.onRetry();
      expect(env.calls).toHaveLength(1);
      page.onUnload?.(); page.setData.mockClear();
      env.reply(0, rows()); await flush();
      expect(page.setData).not.toHaveBeenCalled();
    } finally { env.close(); }
  });

  it('keeps retry and relogin commands and states visible in the actual template', () => {
    const markup = fs.readFileSync(path.resolve(__dirname, '../pages/teacher/ledger/index.wxml'), 'utf8');
    expect(markup).toContain('bindtap="onLogin"');
    expect(markup).toContain('refreshError');
    expect(markup).toContain('loadMoreError');
    expect(markup).toContain('{{item.deltaLabel}} 节');
  });
});
