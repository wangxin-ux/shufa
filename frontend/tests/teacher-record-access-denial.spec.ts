import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';
import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';

const failure = { code: 'FORBIDDEN', message: 'Synthetic denial' };
const rows = (route: string, page = 1) => ({
  data: route === 'ledger' ? [{
    id: 'entry', lessonSessionId: 'lesson', studentId: 'student', studentName: '合成学员',
    occurredAt: '2026-10-29T02:00:00Z', entryType: 'CONSUME', bucket: 'MAIN', deltaUnits: -100,
  }] : [{ ...fixture.teachingRecords[0], id: 'record' }],
  meta: { page, pageSize: 20, total: 21, totalPages: 2 },
});

describe.each(['records', 'ledger', 'feedback'] as const)('record access denial %s', (route) => {
  it.each([401, 403])('retains a hidden %s denial and clears before a return GET', async (code) => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, rows(route)); await flush();
      page.onPullDownRefresh(); page.onHide?.(); page.setData.mockClear();
      env.reply(1, failure, code); await flush();
      expect(page.setData).not.toHaveBeenCalled();
      page.onShow?.();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], page: 0, hasMore: false });
      expect(env.calls).toHaveLength(2);
      page.onRetry(); page.onLoadMore();
      expect(env.calls).toHaveLength(2);
    } finally { env.close(); }
  });

  it.each([401, 403])('honors stale same-owner %s after a newer read succeeds', async (code) => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, rows(route)); await flush();
      page.onLoadMore(); page.onPullDownRefresh();
      env.reply(2, rows(route)); await flush();
      env.reply(1, failure, code); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], page: 0 });
    } finally { env.close(); }
  });

  it('does not process a denial or a late success after unloading', async () => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); page.onUnload?.(); page.setData.mockClear();
      env.reply(0, failure, 403); await flush();
      expect(page.setData).not.toHaveBeenCalled();
    } finally { env.close(); }
  });

  it('blocks an old owner denial without sending a request with the new token', async () => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.();
      env.change({ accessToken: 'synthetic-teacher-b' });
      env.reply(0, failure, 401); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [] });
      page.onRetry();
      expect(env.calls).toHaveLength(1);
    } finally { env.close(); }
  });
});
