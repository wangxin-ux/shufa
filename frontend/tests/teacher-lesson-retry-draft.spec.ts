import {
  captureTeacherPage, flushTeacherPage as flush, teacherLesson, teacherTap,
} from './teacher-page-test-support';
import type { AttendanceItem, TeacherLessonDetail } from '../types/teacher';

const failure = (code: string) => ({ code, message: '合成明确失败' });
const balanceFailure = {
  ...failure('INSUFFICIENT_LESSON_BALANCE'),
  details: { insufficientStudents: [{ studentId: 'synthetic-student', displayName: '合成学员' }] },
};
function authority(detail: TeacherLessonDetail, patch: Partial<TeacherLessonDetail> = {}): TeacherLessonDetail {
  const current: TeacherLessonDetail = {
    ...structuredClone(detail), version: detail.version + 4,
    students: detail.students.map(student => ({ ...student, attendanceStatus: 'LEAVE' })),
    ...patch,
  };
  return { ...current, students: current.students.map(student => ({ ...student, photo: student.photo ?? null })) };
}
async function opened() {
  const env = captureTeacherPage('lesson');
  const page = env.instantiate();
  const detail = teacherLesson();
  detail.status = 'SCHEDULED'; detail.canComplete = true; detail.canReverse = false;
  for (const student of detail.students) student.attendanceStatus = 'LEAVE';
  page.onLoad({ id: detail.id }); page.onShow?.();
  env.reply(0, { data: detail }); await flush();
  for (const student of detail.students) page.onAttendanceTap(teacherTap(student.id, 'PRESENT'));
  return { env, page, detail };
}
type Opened = Awaited<ReturnType<typeof opened>>;
async function unknownThenRead(context: Opened, current: TeacherLessonDetail) {
  const { env, page } = context;
  void page.onCompleteLesson(); await flush();
  const original = env.calls[1];
  const frozen = structuredClone(original.data);
  env.reply(1, failure('UNAVAILABLE'), 503); await flush();
  expect(page.data.needsReconcile).toBe(true);
  page.onRetry(); await flush();
  expect(env.calls[2].method).toBe('GET');
  env.reply(2, { data: current }); await flush();
  return { original, frozen };
}
async function replay(context: Opened, current: TeacherLessonDetail) {
  const { env, page } = context;
  const { original, frozen } = await unknownThenRead(context, current);
  expect(page.data.retryOriginalAvailable).toBe(true);
  expect(page.data.students.map((student: { selectedStatus: string }) => student.selectedStatus))
    .toEqual(current.students.map(student => student.attendanceStatus ?? ''));
  void page.onRetryOriginal(); await flush();
  expect(env.calls).toHaveLength(4);
  expect(env.calls[3]).toMatchObject({ method: original.method, url: original.url,
    header: original.header, data: frozen });
  return { original, frozen };
}
function selections(page: any) {
  return page.data.students.map((student: { id: string; selectedStatus: string }) =>
    ({ studentId: student.id, status: student.selectedStatus }));
}
function expectEditableFailure(page: any, code: string) {
  expect(page.data).toMatchObject({
    submitting: false, needsReconcile: false, retryOriginalAvailable: false,
    conflictCode: code, balanceBlocked: code === 'INSUFFICIENT_LESSON_BALANCE',
  });
  expect(page.pendingCommand).toBeUndefined();
}

describe('teacher lesson definitive retry failure restores only a current legal draft through actual Page/API', () => {
  it('control: direct insufficient-balance 409 retains PRESENT and refresh unlock submits PRESENT', async () => {
    const { env, page, detail } = await opened();
    try {
      const draft = structuredClone(page.attendanceDraft());
      void page.onCompleteLesson(); await flush();
      env.reply(1, balanceFailure, 409); await flush();
      expectEditableFailure(page, 'INSUFFICIENT_LESSON_BALANCE');
      expect(selections(page)).toEqual(draft);
      void page.onCompleteLesson(); await flush();
      expect(env.calls).toHaveLength(2);
      page.onRefreshConflict(); await flush();
      const current = authority(detail);
      env.reply(2, { data: current }); await flush();
      expect(page.data.balanceBlocked).toBe(false);
      void page.onCompleteLesson(); await flush();
      expect(env.calls[3].data).toMatchObject({ lessonVersion: current.version, attendance: draft });
      env.reply(3, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it('regression: LEAVE -> PRESENT -> complete503 -> GET LEAVE -> same-key409 keeps PRESENT through balance refresh and next complete', async () => {
    const context = await opened(), { env, page, detail } = context;
    try {
      const { frozen } = await replay(context, authority(detail, { version: detail.version }));
      const draft = (frozen as { attendance: AttendanceItem[] }).attendance;
      env.reply(3, balanceFailure, 409); await flush();
      expectEditableFailure(page, 'INSUFFICIENT_LESSON_BALANCE');
      expect(selections(page)).toEqual(draft);
      void page.onCompleteLesson(); await flush();
      expect(env.calls).toHaveLength(4);
      page.onRefreshConflict(); await flush();
      const refreshed = authority(detail);
      env.reply(4, { data: refreshed }); await flush();
      expect(page.data.balanceBlocked).toBe(false);
      expect(selections(page)).toEqual(draft);
      void page.onCompleteLesson(); await flush();
      expect(env.calls[5].data).toMatchObject({ lessonVersion: refreshed.version, attendance: draft });
      env.reply(5, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it.each([
    { status: 400, code: 'BAD_REQUEST' },
    { status: 404, code: 'LESSON_NOT_FOUND' },
    { status: 422, code: 'INVALID_ATTENDANCE' },
    { status: 409, code: 'LESSON_VERSION_CONFLICT' },
  ])('definitive $status restores draft while retaining new authority version, names, order and permissions', async ({ status, code }) => {
    const context = await opened(), { env, page, detail } = context;
    try {
      const current = authority(detail, { status: 'IN_PROGRESS', canComplete: false, canReverse: false });
      current.students.reverse();
      current.students[0].displayName = '合成权威新姓名';
      const { frozen } = await replay(context, current);
      env.reply(3, failure(code), status); await flush();
      const expected = current.students.map(student => ({ studentId: student.id, status: 'PRESENT' }));
      expect(selections(page)).toEqual(expected);
      expect(page.data.detail).toEqual(current);
      expect(page.data.students[0].displayName).toBe('合成权威新姓名');
      expect(page.minimumLessonVersion).toBe(current.version);
      expect(page.data).toMatchObject({ canEditAttendance: true, canComplete: false, canReverse: false,
        needsReconcile: false, submitting: false });
      expect(env.calls[3].data).toEqual(frozen);
      void page.onCompleteLesson(); await flush();
      expect(env.calls).toHaveLength(4);
      void page.onSaveAttendance(); await flush();
      expect(env.calls[4].data).toMatchObject({ lessonVersion: current.version, attendance: expected });
      env.reply(4, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it('does not revive a removed member or mark a new unmarked member; next write uses current roster/version', async () => {
    const context = await opened(), { env, page, detail } = context;
    try {
      const retained = { ...detail.students[1], attendanceStatus: 'LEAVE' as const, displayName: '合成保留成员' };
      const added = { ...detail.students[0], id: 'synthetic-new-member', attendanceStatus: null };
      const current = authority(detail, { students: [retained, added] });
      await replay(context, current);
      env.reply(3, failure('LESSON_VERSION_CONFLICT'), 409); await flush();
      expect(selections(page)).toEqual([
        { studentId: retained.id, status: 'PRESENT' }, { studentId: added.id, status: '' },
      ]);
      expect(page.data.students.map((student: { id: string }) => student.id)).toEqual([retained.id, added.id]);
      expect(page.data.detail).toEqual(current);
      expect(page.data.allMarked).toBe(false);
      void page.onCompleteLesson(); void page.onSaveAttendance(); await flush();
      expect(env.calls).toHaveLength(4);
      page.onAttendanceTap(teacherTap(added.id, 'LEAVE'));
      void page.onSaveAttendance(); await flush();
      expect(env.calls[4].data).toMatchObject({ lessonVersion: current.version, attendance: [
        { studentId: retained.id, status: 'PRESENT' }, { studentId: added.id, status: 'LEAVE' },
      ] });
      env.reply(4, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it('does not transfer an obsolete member draft to a replacement with a new identity', async () => {
    const context = await opened(), { env, page, detail } = context;
    try {
      const replacement = { ...detail.students[0], id: 'synthetic-replacement', attendanceStatus: 'ABSENT' as const };
      const current = authority(detail, { students: [replacement], studentCount: 1 });
      await replay(context, current);
      env.reply(3, failure('LESSON_VERSION_CONFLICT'), 409); await flush();
      expect(selections(page)).toEqual([{ studentId: replacement.id, status: 'ABSENT' }]);
      expect(page.data.detail).toEqual(current);
    } finally { env.close(); }
  });

  it('a hidden definitive 409 restores on return without hidden setData and survives the return GET', async () => {
    const context = await opened(), { env, page, detail } = context;
    try {
      const { frozen } = await replay(context, authority(detail));
      page.onHide?.();
      const updates = page.setData.mock.calls.length;
      env.reply(3, balanceFailure, 409); await flush();
      expect(page.setData).toHaveBeenCalledTimes(updates);
      page.onShow?.(); await flush();
      expectEditableFailure(page, 'INSUFFICIENT_LESSON_BALANCE');
      expect(selections(page)).toEqual((frozen as { attendance: AttendanceItem[] }).attendance);
      expect(env.calls[4].method).toBe('GET');
      const current = authority(detail, { version: detail.version + 6 });
      env.reply(4, { data: current }); await flush();
      expect(page.data.detail.version).toBe(current.version);
      expect(selections(page)).toEqual((frozen as { attendance: AttendanceItem[] }).attendance);
    } finally { env.close(); }
  });

  it.each(['COMPLETED', 'REVERSED', 'CANCELLED'] as const)(
    '%s authority settles unknown command and never restores editable old attendance',
    async status => {
      const context = await opened(), { env, page, detail } = context;
      try {
        const current = authority(detail, { status, canComplete: false, canReverse: status === 'COMPLETED' });
        await unknownThenRead(context, current);
        expect(page.data).toMatchObject({ canEditAttendance: false, canComplete: false, needsReconcile: false });
        expect(page.data.detail).toEqual(current);
        expect(selections(page)).toEqual(current.students.map(student => ({ studentId: student.id, status: 'LEAVE' })));
        void page.onRetryOriginal(); void page.onCompleteLesson(); void page.onSaveAttendance(); await flush();
        expect(env.calls).toHaveLength(3);
      } finally { env.close(); }
    },
  );

  it.each([401, 403])('retry %s while hidden clears private data without restoring any command draft', async status => {
    const context = await opened(), { env, page, detail } = context;
    try {
      await replay(context, authority(detail));
      page.onHide?.();
      const updates = page.setData.mock.calls.length;
      env.reply(3, failure('DENIED'), status); await flush();
      expect(page.setData).toHaveBeenCalledTimes(updates);
      page.onShow?.(); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, students: [],
        allMarked: false, canEditAttendance: false, canComplete: false, needsReconcile: false });
      expect(env.calls).toHaveLength(4);
    } finally { env.close(); }
  });

  it('owner replacement before definitive retry failure discards the old draft and private data', async () => {
    const context = await opened(), { env, page, detail } = context;
    try {
      await replay(context, authority(detail));
      env.change({ accessToken: 'synthetic-replacement-owner' });
      env.reply(3, balanceFailure, 409); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, students: [],
        allMarked: false, canEditAttendance: false, canComplete: false, needsReconcile: false });
      expect(env.calls).toHaveLength(4);
    } finally { env.close(); }
  });

  it('unload before definitive retry failure performs no further Page update', async () => {
    const context = await opened(), { env, page, detail } = context;
    try {
      await replay(context, authority(detail));
      page.onUnload?.();
      const updates = page.setData.mock.calls.length;
      env.reply(3, balanceFailure, 409); await flush();
      expect(page.setData).toHaveBeenCalledTimes(updates);
      expect(env.calls).toHaveLength(4);
    } finally { env.close(); }
  });
});
