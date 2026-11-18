import { captureTeacherPage, flushTeacherPage as flush } from './teacher-page-test-support';

const detail = (id = 'student-1') => ({
  id, displayName: `合成学员${id}`, classNames: ['创意班'], nextLessonAt: null, latestFeedbackAt: null,
  classes: [{ id: 'class-1', className: '创意班', courseName: '创意' }], nextLesson: null,
  attendance: { presentCount: 3, leaveCount: 1, absentCount: 0, recordedCount: 4, attendanceRateBasisPoints: 7500 },
  recentAttendance: [], latestFeedback: null,
});
const start = (env: ReturnType<typeof captureTeacherPage>, id = 'student-1') => {
  const page = env.instantiate(); page.onLoad({ id }); page.onShow?.(); return page;
};
it('does not request a missing ID and clears a 404 without exposing stale teaching facts', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const missing = start(env, ' '); expect(env.calls).toHaveLength(0);
    expect(missing.data.errorMessage).toContain('缺少学员');
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onPullDownRefresh(); env.reply(1, { message: 'Not Found' }, 404); await flush();
    expect(page.data.detail).toBeNull(); expect(page.data.errorMessage).toContain('不存在');
  } finally { env.close(); }
});
it('refreshes on return and retains the teaching detail on ordinary failure', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); expect(env.calls).toHaveLength(1);
    env.reply(0, { data: detail() }); await flush();
    page.onHide?.(); page.onShow?.(); expect(env.calls).toHaveLength(2);
    env.reply(1, { message: 'Internal Server Error' }, 500); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', refreshError: '档案刷新失败，请重试' });
    expect(page.data.detail.attendanceRateLabel).toBe('75%');
  } finally { env.close(); }
});
it('keeps separate student pages independent and ignores hidden or unloaded replies', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const first = start(env, 'one'), second = start(env, 'two');
    env.reply(1, { data: detail('two') }); await flush();
    first.onHide?.(); env.reply(0, { data: detail('hidden') }); await flush();
    expect(second.data.detail.displayName).toBe('合成学员two');
    first.onShow?.(); env.reply(2, { data: detail('one') }); await flush();
    expect(first.data.detail.displayName).toBe('合成学员one');
    first.onPullDownRefresh(); first.onUnload?.();
    env.reply(3, { data: detail('old') }); await flush();
    expect(first.data.detail.displayName).toBe('合成学员one');
    expect(env.wx.stopPullDownRefresh).not.toHaveBeenCalled();
  } finally { env.close(); }
});
it.each([401, 403])('clears a denial received while hidden before showing the detail again (%s)', async (status) => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onPullDownRefresh(); page.onHide();
    env.reply(1, { message: 'Denied' }, status); await flush();
    expect(page.data.detail.displayName).toBe('合成学员student-1');
    page.onShow();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, studentId: '' });
    page.onRetry(); page.onPullDownRefresh();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});
it.each([401, 403])('clears the current detail on %s and stops further reads', async (status) => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onPullDownRefresh(); env.reply(1, { message: 'Denied' }, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, studentId: '' });
    page.onRetry(); page.onPullDownRefresh(); expect(env.calls).toHaveLength(2);
    expect(env.wx.stopPullDownRefresh).toHaveBeenCalledTimes(2);
  } finally { env.close(); }
});
it('rejects an old identity and protects the existing feedback entry', async () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env); env.reply(0, { data: detail() }); await flush();
    page.onFeedback?.();
    expect(env.wx.navigateTo.mock.calls[0]?.[0].url).toBe('/pages/teacher/feedback/index');
    env.values.set('education.test-account.current', 'other-teacher');
    page.onFeedback?.();
    expect(page.data.detail).toBeNull(); expect(env.wx.navigateTo).toHaveBeenCalledTimes(1);
  } finally { env.close(); }
});
it('returns to the existing student list without accumulating navigation pages', () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env);
    env.stack.push(
      { route: 'pages/teacher/home/index' },
      { route: 'pages/teacher/students/index' },
      { route: 'pages/teacher/feedback/index' },
      { route: 'pages/teacher/student-detail/index' },
    );
    page.onStudents(); page.onStudents();
    expect(env.wx.navigateBack).toHaveBeenCalledTimes(1);
    expect(env.wx.navigateBack.mock.calls[0][0].delta).toBe(2);
    expect(env.wx.navigateTo).not.toHaveBeenCalled();
    expect(env.wx.redirectTo).not.toHaveBeenCalled();
  } finally { env.close(); }
});
it('replaces a directly opened detail with the student list and allows retry after navigation failure', () => {
  const env = captureTeacherPage('student-detail');
  try {
    const page = start(env);
    env.stack.push({ route: 'pages/teacher/student-detail/index' });
    page.onStudents();
    expect(env.wx.redirectTo.mock.calls[0][0].url).toBe('/pages/teacher/students/index');
    env.wx.redirectTo.mock.calls[0][0].fail();
    page.onStudents();
    expect(env.wx.redirectTo).toHaveBeenCalledTimes(2);
    expect(env.wx.navigateTo).not.toHaveBeenCalled();
    page.onHide(); page.onStudents();
    expect(env.wx.redirectTo).toHaveBeenCalledTimes(2);
  } finally { env.close(); }
});
