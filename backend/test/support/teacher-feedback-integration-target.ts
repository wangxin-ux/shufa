import { assertCampusArchiveTestTarget } from './campus-archive-test-database';

export function assertTeacherPdfTestTarget(env: NodeJS.ProcessEnv): URL {
  const reject = (): never => {
    throw new Error('Exact coordinator feedback integration target required');
  };
  try {
    const target = assertCampusArchiveTestTarget(env);
    const execution = env.TEACHER_FEEDBACK_INTEGRATION_EXECUTION ?? '';
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        execution,
      ) ||
      target.username !== 'carchive' ||
      env.TEACHER_FEEDBACK_RESOURCE_RUN !== 'archive-4534b1ea9d' ||
      env.TEACHER_PDF_TEST_RUN_ID !==
        `main${execution.replaceAll('-', '').slice(0, 12)}` ||
      env.TEACHER_PDF_NATIVE_ENABLED !== 'false' ||
      env.TEACHER_PDF_NATIVE_HISTORICAL_ONLY !== 'false'
    ) {
      return reject();
    }
    return target;
  } catch {
    return reject();
  }
}
