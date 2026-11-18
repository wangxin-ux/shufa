import { captureTeacherPage, flushTeacherPage as flush, teacherLesson } from './teacher-page-test-support';
import { buildTeacherFeedbackStudentModels } from '../services/teacher-feedback.presenter';
import { buildParentUpdatesPageModel } from '../services/parent-updates.presenter';
import { MockTeacherDataSource } from '../data/mock-teacher-data-source';
import { NORMAL_TEACHER_FIXTURE } from '../mock/fixtures/teacher.fixture';

const scores = { classroomPerformance: 0, workCompletion: 7, communication: null, overall: 10 };
const event = (id: string, field: string, value: string) =>
  ({ currentTarget: { dataset: { id, field } }, detail: { value } });
const detail = () => {
  const result = teacherLesson() as any;
  result.status = 'COMPLETED';
  result.students[0] = { ...result.students[0], feedback: '原文', performanceRating: 9,
    canEditFeedback: true, feedbackVersion: 2, teacherRatings: scores, feedbackAuthorName: '合成教师' };
  return result;
};
const start = (env: ReturnType<typeof captureTeacherPage>) => {
  const page = env.instantiate(), input = detail();
  page.onLoad({ id: input.id }); page.onShow();
  env.reply(0, { data: input }); return { page, input };
};

it('separates the four scores, explicit zero, legacy score and immutable family review', () => {
  const model = buildTeacherFeedbackStudentModels(detail())[0] as any;
  expect(model.teacherRatingRows).toEqual([
    expect.objectContaining({ field: 'classroomPerformance', label: '课堂表现', ratingLabel: '0 星', pickerIndex: 1 }),
    expect.objectContaining({ field: 'workCompletion', label: '作品完成', ratingLabel: '3.5 星', pickerIndex: 8 }),
    expect.objectContaining({ field: 'communication', label: '沟通互动', ratingLabel: '未评分', pickerIndex: 0 }),
    expect.objectContaining({ field: 'overall', label: '整体评价', ratingLabel: '5 星', pickerIndex: 11 }),
  ]);
  expect(model.performanceRating).toBe(9);
  expect(model.teacherRatingsDraft).toEqual(scores);
});

it.each([false, undefined])('keeps historical students read-only when canEditFeedback is %s', async (permission) => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const { page, input } = start(env); await flush();
    const id = input.students[0].id;
    page.onTeacherRatingChange(event(id, 'overall', '2'));
    page.onFeedbackInput({ currentTarget: { dataset: { id } }, detail: { value: '未保存草稿' } });
    const historical = structuredClone(input);
    historical.students[0].canEditFeedback = permission;
    page.applyLesson(historical, true);
    expect(page.data.students[0]).toMatchObject({
      readOnly: true, feedbackDraft: '原文', teacherRatingsDraft: scores,
    });
    page.onTeacherRatingChange(event(id, 'overall', '1'));
    page.onFeedbackInput({ currentTarget: { dataset: { id } }, detail: { value: '越权草稿' } });
    await page.onSaveFeedback(event(id, '', ''));
    await page.onChooseImages(event(id, '', ''));
    expect(page.data.viewState).toBe('ready');
    expect(page.data.students[0]).toMatchObject({
      feedbackDraft: '原文', teacherRatingsDraft: scores,
    });
    expect(env.calls).toHaveLength(1);
  } finally { env.close(); }
});

it('saves four independent draft values with the loaded version and advances only from the server response', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const { page, input } = start(env); await flush();
    const id = input.students[0].id;
    page.onTeacherRatingChange(event(id, 'communication', '6'));
    page.onTeacherRatingChange(event(id, 'classroomPerformance', '0'));
    const pending = page.onSaveFeedback(event(id, '', ''));
    await flush();
    expect(env.calls[1].data).toMatchObject({
      expectedVersion: 2, teacherRatings: { ...scores, classroomPerformance: null, communication: 5 },
    });
    env.reply(1, { data: { lessonSessionId: input.id, studentId: id, version: 3,
      teacherRatings: { ...scores, classroomPerformance: null, communication: 5 },
      content: '原文', images: [], performanceRating: 9, updatedAt: '2026-10-25T08:00:00Z' } });
    await pending;
    expect(page.data.students[0].feedbackVersion).toBe(3);
    const again = page.onSaveFeedback(event(id, '', '')); await flush();
    expect(env.calls[2].data).toMatchObject({ expectedVersion: 3 });
    env.reply(2, { message: '稍后重试' }, 500); await again;
  } finally { env.close(); }
});

it('preserves failed drafts and the same retry key, but requires reloading after a version conflict', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const { page, input } = start(env); await flush();
    const id = input.students[0].id;
    page.onTeacherRatingChange(event(id, 'overall', '2'));
    let pending = page.onSaveFeedback(event(id, '', '')); await flush();
    env.reply(1, { message: '暂时失败' }, 503); await pending;
    expect(page.data.students[0].teacherRatingsDraft.overall).toBe(1);
    pending = page.onSaveFeedback(event(id, '', '')); await flush();
    expect(env.calls[2].header['Idempotency-Key']).toBe(env.calls[1].header['Idempotency-Key']);
    env.reply(2, { code: 'FEEDBACK_VERSION_CONFLICT', message: 'changed', details: { currentVersion: 4 } }, 409);
    await pending;
    expect(page.data.students[0].ratingConflict).toBe(true);
    expect(page.data.mutationMessage).toContain('重新加载');
    await page.onSaveFeedback(event(id, '', ''));
    expect(env.calls).toHaveLength(3);
    page.onReloadFeedback();
    env.reply(3, { data: { ...input, students: [{ ...input.students[0], feedbackVersion: 4 }] } });
    await flush();
    expect(page.data.students[0]).toMatchObject({ feedbackVersion: 4, ratingConflict: false });
  } finally { env.close(); }
});

it('rejects forged score fields, invalid events and reversed edits, and preserves explicit null drafts on refresh', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const { page, input } = start(env); await flush();
    const id = input.students[0].id;
    for (const value of ['-1', '12', '1.5', 'NaN']) page.onTeacherRatingChange(event(id, 'overall', value));
    page.onTeacherRatingChange(event(id, 'invented', '1'));
    expect(page.data.students[0].teacherRatingsDraft).toEqual(scores);
    page.onTeacherRatingChange(event(id, 'overall', '0'));
    page.applyLesson(input, true);
    expect(page.data.students[0].teacherRatingsDraft.overall).toBeNull();
    page.applyLesson({ ...input, status: 'REVERSED' }, false);
    page.onTeacherRatingChange(event(id, 'overall', '1'));
    await page.onSaveFeedback(event(id, '', ''));
    expect(page.data.students[0].teacherRatingsDraft.overall).toBe(10);
    expect(env.calls).toHaveLength(1);
  } finally { env.close(); }
});

it('shows the same authored four scores as read-only parent rows without changing family review availability', () => {
  const result = buildParentUpdatesPageModel({ student: null, records: [{
    lessonSessionId: 'lesson', courseName: '合成课程', teacherName: '合成教师',
    startsAt: '2026-10-25T01:00:00Z', lessonStatus: 'COMPLETED', attendanceStatus: 'PRESENT',
    feedback: '反馈', feedbackImages: [], teacherRatings: scores, performanceRating: 9,
    feedbackAuthorName: '原作者', feedbackVersion: 2, canReview: true,
  } as any] }).records[0] as any;
  expect(result.teacherRatingRows.map((row: any) => row.ratingLabel)).toEqual(['0 星', '3.5 星', '未评分', '5 星']);
  expect(result.feedbackAuthorName).toBe('原作者');
  expect(result.canReview).toBe(true);
  expect(result.performanceRating).toBe(9);
});

it('uses version checks and independent ratings in Mock while retaining legacy values', async () => {
  const source = new MockTeacherDataSource();
  const original = NORMAL_TEACHER_FIXTURE.lessonSessions.find((lesson) => lesson.status === 'COMPLETED')!;
  const lesson = await source.getLessonSession(original.id);
  const student = lesson.students[0];
  const input = { lessonSessionId: lesson.id, studentId: student.id, content: '合成四维', imageFileIds: [],
    expectedVersion: student.feedback ? 1 : 0, teacherRatings: scores };
  const saved = await source.saveFeedback(input as any, 'four-score-key') as any;
  expect(saved.teacherRatings).toEqual(scores);
  expect(await source.saveFeedback(input as any, 'four-score-key')).toEqual(saved);
  await expect(source.saveFeedback(input as any, 'stale-key')).rejects.toMatchObject({ statusCode: 409 });
  const archive = await source.getStudent(student.id) as any;
  expect(archive.feedbackHistory.data.find((item: any) => item.lessonSessionId === lesson.id).teacherRatings).toEqual(scores);
  await expect(source.saveFeedback({ ...input, content: '不同内容' } as any, 'four-score-key'))
    .rejects.toMatchObject({ statusCode: 409 });
});

it('keeps the draft base version across refresh and reloads only the conflicted student', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const page = env.instantiate(), input = detail(), second = structuredClone(input.students[0]);
    second.id = 'second-student';
    input.students = [input.students[0], second];
    page.onLoad({ id: input.id }); page.onShow();
    env.reply(0, { data: input }); await flush();
    const id = input.students[0].id;
    page.onTeacherRatingChange(event(id, 'overall', '0'));
    page.onTeacherRatingChange(event(second.id, 'communication', '3'));
    page.onPullDownRefresh();
    const newer = structuredClone(input);
    newer.students[0].feedbackVersion = 4;
    newer.students[0].teacherRatings.overall = 5;
    env.reply(1, { data: newer }); await flush();
    expect(page.data.students[0]).toMatchObject({ feedbackVersion: 2, teacherRatingsDraft: { overall: null } });
    const pending = page.onSaveFeedback(event(id, '', '')); await flush();
    expect(env.calls[2].data).toMatchObject({ expectedVersion: 2 });
    env.reply(2, { code: 'FEEDBACK_VERSION_CONFLICT', message: 'changed' }, 409); await pending;
    page.onReloadFeedback(event(id, '', ''));
    env.reply(3, { data: newer }); await flush();
    expect(page.data.students[0]).toMatchObject({ feedbackVersion: 4, ratingConflict: false,
      teacherRatingsDraft: { overall: 5 } });
    expect(page.data.students[1].teacherRatingsDraft.communication).toBe(2);
  } finally { env.close(); }
});

it.each(['hidden', 'owner'])('does not apply late four-score save results after %s changes', async (change) => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const { page, input } = start(env); await flush();
    const id = input.students[0].id;
    page.onTeacherRatingChange(event(id, 'overall', '1'));
    const pending = page.onSaveFeedback(event(id, '', '')); await flush();
    if (change === 'hidden') page.onHide();
    else env.change({ accessToken: 'synthetic-new-owner' });
    env.reply(1, { data: { content: '迟到结果', version: 3, teacherRatings: scores, images: [] } });
    await pending;
    if (change === 'hidden') {
      expect(page.data.students[0].teacherRatingsDraft.overall).toBe(0);
      expect(page.data.students[0].feedbackVersion).toBe(2);
    } else expect(page.data).toMatchObject({ viewState: 'forbidden', students: [], detail: null });
  } finally { env.close(); }
});
