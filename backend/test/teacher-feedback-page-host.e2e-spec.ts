// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Captured Pages need the WeChat ambient declarations.
/// <reference path="../../frontend/node_modules/miniprogram-api-typings/index.d.ts" />
import { captureTeacherPage } from '../../frontend/tests/teacher-page-test-support';

it.each(['feedback-detail', 'student-detail'] as const)(
  'registers the integrated %s Page before any database execution',
  (route) => {
    const host = captureTeacherPage(route);
    try {
      const page = host.instantiate() as { onLoad?: unknown };
      expect(page.onLoad).toEqual(expect.any(Function));
    } finally {
      host.close();
    }
  },
);
