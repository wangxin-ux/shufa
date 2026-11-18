export {};
const performanceLoad = jest.fn();
const performanceSave = jest.fn();
jest.mock('../pages/teacher/runtime/teacher-read-context', () => ({
  readTeacherReadContext: () => ({}),
  isCurrentTeacherReadContext: () => true,
  createTeacherPageService: () => ({
    loadLessonSession: (...args: unknown[]) => performanceLoad(...args),
    saveFeedback: (...args: unknown[]) => performanceSave(...args),
  }),
}));

describe('teacher performance editor', () => {
  let page: any;
  const detail = {
    id: 'lesson', status: 'COMPLETED', courseName: '专业美术', className: '基础班',
    startsAt: '2026-10-06T01:00:00Z', endsAt: '2026-10-06T02:00:00Z',
    students: [{ id: 'student', displayName: '陈晨', attendanceStatus: 'PRESENT',
      canEditFeedback: true, feedback: '课堂认真', feedbackImages: [], performanceRating: 9 }],
  };
  const event = (value: string) => ({ currentTarget: { dataset: { id: 'student' } }, detail: { value } });
  beforeEach(async () => {
    performanceLoad.mockReset().mockResolvedValue({ status: 'success', data: detail });
    performanceSave.mockReset().mockResolvedValue({ status: 'success', data: {
      lessonSessionId: 'lesson', studentId: 'student', content: '课堂认真', images: [],
      performanceRating: 10, updatedAt: '2026-10-06T03:00:00Z',
    } });
    (global as any).wx = { showToast: jest.fn(), stopPullDownRefresh: jest.fn() };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (patch: unknown) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/teacher/feedback-detail/index'));
    page.onLoad({ id: 'lesson' });
    page.onShow();
    await page.pendingRequest;
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
  });
  it('selects half-star units and saves them alongside the teacher feedback', async () => {
    page.applyLesson(detail, false);
    page.onPerformanceChange(event('10'));
    await page.onSaveFeedback(event('10'));
    expect(performanceSave).toHaveBeenCalledWith(expect.objectContaining({ performanceRating: 10 }), expect.any(String));
    expect(page.data.students[0]).toMatchObject({
      performanceRating: 10, performanceRatingDraft: 10, performanceRatingLabel: '5 星',
    });
  });
  it('preserves an explicitly cleared rating draft across refresh', () => {
    page.applyLesson(detail, false);
    page.onPerformanceChange(event('0'));
    page.applyLesson(detail, true);
    expect(page.data.students[0].performanceRatingDraft).toBeNull();
    expect(page.data.students[0].performanceRating).toBe(9);
    page.applyLesson(detail, false);
    expect(page.data.students[0].performanceRatingDraft).toBe(9);
  });
  it('does not allow rating changes or writes on reversed lessons', async () => {
    page.applyLesson({ ...detail, status: 'REVERSED' }, false);
    page.onPerformanceChange(event('1'));
    await page.onSaveFeedback(event('1'));
    expect(page.data.students[0].performanceRatingDraft).toBe(9);
    expect(performanceSave).not.toHaveBeenCalled();
  });
  it('rejects invalid picker events and protects ratings while saving', async () => {
    page.applyLesson(detail, false);
    for (const value of ['-1', '11', '1.5', 'not-a-rating']) page.onPerformanceChange(event(value));
    expect(page.data.students[0].performanceRatingDraft).toBe(9);
    let finish!: (value: unknown) => void;
    performanceSave.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = page.onSaveFeedback(event('9'));
    page.onPerformanceChange(event('1'));
    expect(page.data.students[0].performanceRatingDraft).toBe(9);
    finish({ status: 'error', statusCode: 503, message: '稍后重试' });
    await pending;
  });
  it('retains failed rating drafts and prevents duplicate submissions', async () => {
    let resolve!: (value: unknown) => void;
    performanceSave.mockImplementation(() => new Promise((done) => { resolve = done; }));
    page.applyLesson(detail, false);
    page.onPerformanceChange(event('1'));
    const pending = page.onSaveFeedback(event('1'));
    await page.onSaveFeedback(event('1'));
    expect(performanceSave).toHaveBeenCalledTimes(1);
    resolve({ status: 'error', statusCode: 503, code: 'INTERNAL_SERVER_ERROR', message: '稍后重试' });
    await pending;
    expect(page.data.students[0].performanceRatingDraft).toBe(1);
    expect(page.data.feedbackSubmittingId).toBe('');
    expect(page.data.mutationMessage).toBe('稍后重试');
  });
});
