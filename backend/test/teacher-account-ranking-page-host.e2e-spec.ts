// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Captured Pages need the WeChat ambient declarations.
/// <reference path="../../frontend/node_modules/miniprogram-api-typings/index.d.ts" />
import { captureTeacherPage } from '../../frontend/tests/teacher-page-test-support';

it('requires the integrated account and ranking Page before opening the database', () => {
  const host = captureTeacherPage('earnings');
  try {
    const page = host.instantiate() as Record<string, unknown>;
    for (const method of [
      'onLoad',
      'onOpenRankings',
      'onRankingMetric',
      'onRankingMonth',
      'onRankingMore',
      'onRankingRefresh',
    ]) {
      expect(page[method]).toEqual(expect.any(Function));
    }
  } finally {
    host.close();
  }
});
