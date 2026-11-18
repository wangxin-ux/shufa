import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';
import { MockTeacherDataSource } from '../data/mock-teacher-data-source';
import { NORMAL_TEACHER_FIXTURE } from '../mock/fixtures/teacher.fixture';


const image = (id: string) => ({
  id, mimeType: 'image/png', sizeBytes: 120,
  accessUrl: `/files/${id}?signature=synthetic`, accessUrlExpiresAt: '2026-10-25T09:00:00Z',
});
const feedback = (id: string, status = 'COMPLETED') => ({
  id, lessonSessionId: `lesson-${id}`, courseName: '创意绘画', className: '周末班',
  startsAt: '2026-10-24T01:00:00Z', updatedAt: '2026-10-24T03:00:00Z',
  lessonStatus: status, content: `本课反馈${id}`, performanceRating: 7, images: [image(id)],
});
const detail = (page = 1, ids = ['f1'], totalPages = 2) => ({
  id: 'student-1', displayName: '合成学员', classNames: ['周末班'],
  nextLessonAt: null, latestFeedbackAt: null, classes: [], nextLesson: null,
  attendance: { presentCount: 2, leaveCount: 1, absentCount: 0, recordedCount: 3, attendanceRateBasisPoints: 6667 },
  recentAttendance: [], latestFeedback: null,
  archive: {
    age: 8, photo: image('photo'),
    enrollment: { initialMainUnits: 2000, initialGiftUnits: null, receivedAmountFen: 123456, pendingIssuanceCount: 1 },
    balance: { mainAvailableUnits: 425, giftAvailableUnits: 50, availableTotalUnits: 475,
      thresholdUnits: 500, isWarning: true, asOf: '2026-10-25T07:00:00Z' },
  },
  feedbackHistory: { data: ids.map((id) => feedback(id, id === 'f2' ? 'REVERSED' : 'COMPLETED')),
    meta: { page, pageSize: 10, total: 11, totalPages } },
});
const start = (env: ReturnType<typeof captureTeacherPage>) => {
  const page = env.instantiate(); page.onLoad({ id: 'student-1' }); page.onShow(); return page;
};

it('renders authorized archive facts, unknown original values and signed media without reconstructing facts', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    expect(page.data.detail).toMatchObject({
      ageLabel: '8岁', originalMainLabel: '20课时', originalGiftLabel: '待核对',
      receivedLabel: '¥1,234.56', availableMainLabel: '4.25课时',
      availableGiftLabel: '0.5课时', warningLabel: '课时预警', pendingIssuanceLabel: '1笔待发课',
    });
    expect(page.data.detail.photoUrl).toContain('https://initial.synthetic.invalid/files/photo');
    expect(page.data.feedbackHistory[0]).toMatchObject({
      id: 'f1', legacyRatingLabel: '历史单项评分 3.5星', statusLabel: '已完成',
    });
    expect(page.data.feedbackHistory[0].images[0].accessUrl).toContain('https://initial.synthetic.invalid/files/f1');
  } finally { env.close(); }
});

it('loads history serially, deduplicates rows and preserves existing history on failure for retry', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onLoadMoreFeedback(); page.onLoadMoreFeedback();
    expect(env.calls).toHaveLength(2);
    expect(env.calls[1].url).toContain('feedbackPage=2');
    env.reply(1, { message: 'failed' }, 500); await flush();
    expect(page.data.feedbackHistory.map((item: any) => item.id)).toEqual(['f1']);
    expect(page.data.feedbackError).toContain('重试');
    page.onLoadMoreFeedback(); env.reply(2, { data: detail(2, ['f1', 'f2']) }); await flush();
    expect(page.data.feedbackHistory.map((item: any) => item.id)).toEqual(['f1', 'f2']);
    expect(page.data.feedbackHistory[1].statusLabel).toBe('已撤销 · 只读');
    expect(page.data.feedbackHasMore).toBe(false);
    page.onOpenFeedback({ currentTarget: { dataset: { id: 'f2' } } });
    expect(env.wx.navigateTo.mock.calls[0][0].url).toBe('/pages/teacher/feedback-detail/index?id=lesson-f2');
  } finally { env.close(); }
});

it.each([401, 403, 404])('clears archive and all accumulated history after history receives %s', async (code) => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onLoadMoreFeedback(); env.reply(1, { message: 'Denied' }, code); await flush();
    expect(page.data.detail).toBeNull();
    expect(page.data.feedbackHistory).toEqual([]);
    expect(page.data.feedbackHasMore).toBe(false);
  } finally { env.close(); }
});

it('ignores old history after hide and refreshes from page one on return', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onLoadMoreFeedback(); page.onHide(); page.onShow();
    env.reply(2, { data: detail(1, ['new'], 1) }); await flush();
    env.reply(1, { data: detail(2, ['old']) }); await flush();
    expect(page.data.feedbackHistory.map((item: any) => item.id)).toEqual(['new']);
    expect(page.data.feedbackHasMore).toBe(false);
  } finally { env.close(); }
});

it('rejects a changed owner before opening a history record or displaying delayed private facts', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onLoadMoreFeedback();
    env.change({ accessToken: 'synthetic-teacher-b' });
    env.reply(1, { data: detail(2, ['private']) }); await flush();
    page.onOpenFeedback({ currentTarget: { dataset: { id: 'f1' } } });
    expect(page.data.feedbackHistory).toEqual([]);
    expect(page.data.detail).toBeNull();
    expect(env.wx.navigateTo).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it('previews only returned unexpired feedback images and requests refresh for expired media', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    env.wx.previewImage = jest.fn();
    const page = start(env);
    const result = detail();
    result.feedbackHistory.data[0].images[0].accessUrlExpiresAt = '2099-01-01T00:00:00Z';
    env.reply(0, { data: result }); await flush();
    const event = (imageId: string) => ({ currentTarget: { dataset: { id: 'f1', imageId } } });
    page.onPreviewFeedback(event('unknown'));
    expect(env.wx.previewImage).not.toHaveBeenCalled();
    page.onPreviewFeedback(event('f1'));
    expect(env.wx.previewImage.mock.calls[0][0]).toMatchObject({
      current: 'https://initial.synthetic.invalid/files/f1?signature=synthetic',
      urls: ['https://initial.synthetic.invalid/files/f1?signature=synthetic'],
    });
    page.data.feedbackHistory[0].images[0].accessUrlExpiresAt = '2000-01-01T00:00:00Z';
    page.onPreviewFeedback(event('f1'));
    expect(env.wx.previewImage).toHaveBeenCalledTimes(1);
    expect(page.data.feedbackError).toContain('过期');
  } finally { env.close(); }
});

it('uses explicit synthetic archive facts and the same history paging contract in Mock', async () => {
  const source = new MockTeacherDataSource();
  const id = NORMAL_TEACHER_FIXTURE.students[0].id;
  const first = await source.getStudent(id, { feedbackPage: 1, feedbackPageSize: 1 });
  expect(first.archive).toEqual(NORMAL_TEACHER_FIXTURE.studentArchives?.[id]);
  expect(first.feedbackHistory?.data).toHaveLength(1);
  expect(first.feedbackHistory?.meta).toMatchObject({ page: 1, pageSize: 1, total: 1, totalPages: 1 });
  expect((await source.getStudent(id, { feedbackPage: 2, feedbackPageSize: 1 })).feedbackHistory?.data).toEqual([]);
  expect((await source.getStudent(NORMAL_TEACHER_FIXTURE.students[1].id)).archive).toBeUndefined();
});
