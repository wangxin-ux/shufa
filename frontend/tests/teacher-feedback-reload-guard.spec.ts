import { captureTeacherPage, flushTeacherPage as flush, teacherLesson } from './teacher-page-test-support';
import * as fs from 'node:fs';
import * as path from 'node:path';

const tap = (id: string, field = '') => ({ currentTarget: { dataset: { id, field } } });
const input = (id: string, text: string) => ({ ...tap(id), detail: { value: text } });
const rating = (id: string, value = '8') => ({ ...tap(id, 'overall'), detail: { value } });
const failure = { code: 'INTERNAL_SERVER_ERROR', message: 'Synthetic failure' };

async function start() {
  const env = captureTeacherPage('feedback-detail'), page = env.instantiate(), detail = teacherLesson();
  detail.status = 'COMPLETED';
  const first = { ...detail.students[0], id: 'student-a', canEditFeedback: true, feedback: '原反馈A',
    feedbackVersion: 2, teacherRatings: { classroomPerformance: 1, workCompletion: 2, communication: 3, overall: 4 },
    feedbackImages: [{ id: 'image-a', accessUrl: 'synthetic-image-a', mimeType: 'image/png' as const,
      sizeBytes: 100, accessUrlExpiresAt: '2026-11-01T00:00:00.000Z' }] };
  detail.students = [first, { ...structuredClone(first), id: 'student-b', feedback: '原反馈B',
    feedbackImages: [{ id: 'image-b', accessUrl: 'synthetic-image-b', mimeType: 'image/png' as const,
      sizeBytes: 100, accessUrlExpiresAt: '2026-11-01T00:00:00.000Z' }] }];
  page.onLoad({ id: detail.id }); page.onShow(); env.reply(0, { data: detail }); await flush();
  page.onFeedbackInput(input(first.id, '冲突前草稿A'));
  const save = page.onSaveFeedback(tap(first.id)); await flush();
  env.reply(1, { code: 'FEEDBACK_VERSION_CONFLICT', message: 'Synthetic conflict' }, 409);
  await save;
  expect(page.data.students[0].ratingConflict).toBe(true);
  return { env, page, detail };
}

describe('teacher feedback reload guard', () => {
  it.each(['onFeedbackInput', 'onTeacherRatingChange', 'onRemoveImage'])(
    'disables only the reload target in the actual %s control binding', (handler) => {
      const markup = fs.readFileSync(path.resolve(__dirname, '../pages/teacher/feedback-detail/index.wxml'), 'utf8');
      const control = markup.match(new RegExp(
        '<(?:textarea|picker|button)\\b[^>]*\\bbind(?:input|change|tap)="' + handler + '"[^>]*>',
      ))?.[0];
      const expression = control?.match(/disabled="\{\{([^"]*)\}\}"/)?.[1];
      expect(expression).toBeDefined();
      const disabled = Function('feedbackReloadingId', 'item', 'feedbackSubmittingId', 'feedbackUploadingId',
        'return Boolean(' + expression + ');');
      expect(disabled('student-a', { id: 'student-a', ratingConflict: false }, '', '')).toBe(true);
      expect(disabled('student-a', { id: 'student-b', ratingConflict: false }, '', '')).toBe(false);
    },
  );

  it('locks only the reload target text until its authoritative response arrives', async () => {
    const { env, page, detail } = await start();
    try {
      page.onReloadFeedback(tap('student-a'));
      page.onFeedbackInput(input('student-a', '重载中输入A'));
      page.onFeedbackInput(input('student-b', '重载中输入B'));
      expect(page.data.students[0].feedbackDraft).toBe('冲突前草稿A');
      expect(page.data.students[1].feedbackDraft).toBe('重载中输入B');
      expect(page.data.feedbackReloadingId).toBe('student-a');
      detail.students[0].feedback = '权威新反馈';
      detail.students[0].feedbackVersion = 3;
      env.reply(2, { data: detail }); await flush();
      expect(page.data.students[0]).toMatchObject({ feedbackDraft: '权威新反馈',
        feedbackVersion: 3, ratingConflict: false });
      expect(page.data.students[1].feedbackDraft).toBe('重载中输入B');
      expect(page.data.feedbackReloadingId).toBe('');
      page.onFeedbackInput(input('student-a', '重载完成后输入'));
      expect(page.data.students[0].feedbackDraft).toBe('重载完成后输入');
    } finally { env.close(); }
  });

  it('guards legacy and four-score handlers and image removal for the target only', async () => {
    const { env, page } = await start();
    try {
      page.onReloadFeedback(tap('student-a'));
      const before = structuredClone(page.data.students[0]);
      page.onTeacherRatingChange(rating('student-a'));
      page.onPerformanceChange({ ...tap('student-a'), detail: { value: '2' } });
      page.onRemoveImage({ currentTarget: { dataset: { id: 'student-a', imageId: 'image-a' } } });
      expect(page.data.students[0]).toEqual(before);
      page.onTeacherRatingChange(rating('student-b'));
      page.onRemoveImage({ currentTarget: { dataset: { id: 'student-b', imageId: 'image-b' } } });
      expect(page.data.students[1].teacherRatingsDraft.overall).toBe(7);
      expect(page.data.students[1].feedbackImages).toEqual([]);
      env.reply(2, failure, 503); await flush();
    } finally { env.close(); }
  });

  it('releases after a failed reload while preserving the target draft and conflict', async () => {
    const { env, page } = await start();
    try {
      page.onReloadFeedback(tap('student-a'));
      env.reply(2, failure, 503); await flush();
      expect(page.data).toMatchObject({ feedbackReloadingId: '', refreshError: '反馈刷新失败，请重试' });
      expect(page.data.students[0]).toMatchObject({ feedbackDraft: '冲突前草稿A', ratingConflict: true });
      page.onFeedbackInput(input('student-a', '失败后继续输入'));
      expect(page.data.students[0].feedbackDraft).toBe('失败后继续输入');
    } finally { env.close(); }
  });

  it('cancels the lock across hide and return without letting the old reload replace later edits', async () => {
    const { env, page, detail } = await start();
    try {
      page.onReloadFeedback(tap('student-a')); page.onHide(); page.onShow();
      expect(page.data.feedbackReloadingId).toBe('');
      page.onFeedbackInput(input('student-a', '返回后继续输入'));
      env.reply(2, { data: detail }); await flush();
      env.reply(3, { data: detail }); await flush();
      expect(page.data.students[0].feedbackDraft).toBe('返回后继续输入');
      expect(page.data.feedbackReloadingId).toBe('');
    } finally { env.close(); }
  });

  it.each([401, 403])('clears the target lock and private data on current %s', async (code) => {
    const { env, page } = await start();
    try {
      page.onReloadFeedback(tap('student-a')); env.reply(2, failure, code); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', students: [], detail: null,
        feedbackReloadingId: '' });
    } finally { env.close(); }
  });

  it('does not change an unloaded Page when the reload completes', async () => {
    const { env, page, detail } = await start();
    try {
      page.onReloadFeedback(tap('student-a')); page.onUnload(); page.setData.mockClear();
      env.reply(2, { data: detail }); await flush();
      expect(page.setData).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});
