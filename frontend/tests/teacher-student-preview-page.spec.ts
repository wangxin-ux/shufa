import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';
import { captureTeacherPage, flushTeacherPage as flush, teacherTap } from './teacher-page-test-support';

async function opened() {
  const env = captureTeacherPage('students');
  const page = env.instantiate(); page.onLoad(); page.onShow();
  env.reply(0, { data: fixture.students, meta: { page: 1, pageSize: 20, total: fixture.students.length, totalPages: 1 } });
  await flush();
  return { env, page, student: fixture.students[0] };
}
function detail(student = fixture.students[0]) {
  return { ...student, classes: [{ id: 'class-1', className: '合成班级', courseName: '美术' }], nextLesson: null,
    attendance: { presentCount: 3, leaveCount: 1, absentCount: 0, recordedCount: 4, attendanceRateBasisPoints: 7500 },
    recentAttendance: [], latestFeedback: null };
}

it('expands only a listed student through the existing read and retains the full detail route', async () => {
  const { env, page, student } = await opened();
  try {
    page.onStudentToggle(teacherTap('not-in-this-list'));
    expect(env.calls).toHaveLength(1);
    page.onStudentToggle(teacherTap(student.id));
    expect(page.data).toMatchObject({ expandedId: student.id, archiveState: 'loading' });
    expect(new URL(env.calls[1].url).pathname).toBe(`/teachers/me/students/${student.id}`);
    env.reply(1, { data: detail(student) }); await flush();
    expect(page.data.archive).toMatchObject({ attendanceRateLabel: '75%', remainingTotalLabel: '待核对', photoUrl: '' });
    page.onStudentTap(teacherTap(student.id));
    expect(env.wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: `/pages/teacher/student-detail/index?id=${student.id}` }));
    expect(env.calls.every(call => call.method === 'GET')).toBe(true);
  } finally { env.close(); }
});

it.each(['collapse', 'hide', 'owner', 'deny'] as const)('does not revive an archive after %s', async reason => {
  const { env, page, student } = await opened();
  try {
    page.onStudentToggle(teacherTap(student.id));
    if (reason === 'collapse') page.onStudentToggle(teacherTap(student.id));
    if (reason === 'hide') page.onHide();
    if (reason === 'owner') env.values.set('education.test-account.current', 'another-teacher');
    env.reply(1, reason === 'deny' ? {} : { data: detail(student) }, reason === 'deny' ? 403 : 200);
    await flush();
    expect(page.data.archive).toBeNull();
    expect(page.data.expandedId).toBe('');
    if (reason === 'owner' || reason === 'deny') expect(page.data).toMatchObject({ viewState: 'forbidden', items: [] });
  } finally { env.close(); }
});
