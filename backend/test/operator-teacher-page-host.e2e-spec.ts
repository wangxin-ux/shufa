// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- The captured Page needs WeChat ambient types in the backend test project.
/// <reference path="../../frontend/node_modules/miniprogram-api-typings/index.d.ts" />
import { capture } from '../../frontend/tests/operator-page-host';

it('loads the integrated teacher archive Page rather than its JSON configuration', () => {
  const env = capture(['teacher-archives']);
  try {
    const page = env.instantiate() as { onLoad?: unknown };
    expect(page.onLoad).toEqual(expect.any(Function));
  } finally {
    env.close();
  }
});
