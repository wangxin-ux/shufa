import {
  captureTeacherPage, flushTeacherPage as flush, teacherLesson, teacherTap,
} from './teacher-page-test-support';
import type { AttendanceStatus, LessonSessionStatus, TeacherLessonDetail } from '../types/teacher';

function serverLesson(
  detail: TeacherLessonDetail,
  status: LessonSessionStatus,
  attendanceStatus: AttendanceStatus | null = 'LEAVE',
): TeacherLessonDetail {
  return {
    ...detail, status, version: detail.version + 1,
    canComplete: status === 'SCHEDULED' || status === 'IN_PROGRESS',
    canReverse: status === 'COMPLETED',
    students: detail.students.map(student => ({
      ...student, attendanceStatus,
      expectedConsumeUnits: attendanceStatus === 'PRESENT' ? detail.lessonUnits : 0,
    })),
  };
}

async function openMarkedLesson() {
  const env = captureTeacherPage('lesson');
  const page = env.instantiate(), detail = teacherLesson();
  page.onLoad({ id: detail.id });
  env.reply(0, { data: detail });
  await flush();
  for (const student of detail.students) page.onAttendanceTap(teacherTap(student.id, 'PRESENT'));
  return { env, page, detail };
}

describe('teacher lesson terminal attendance display through the full current main Page', () => {
  it.each(['COMPLETED', 'REVERSED'] as const)(
    'uses saved server attendance after %s pull-down refresh despite an older local draft',
    async status => {
      const { env, page, detail } = await openMarkedLesson();
      try {
        page.onPullDownRefresh();
        env.reply(1, { data: serverLesson(detail, status) });
        await flush();
        expect(page.data.students.map((student: { selectedStatus: string }) => student.selectedStatus))
          .toEqual(detail.students.map(() => 'LEAVE'));
        expect(page.data.canEditAttendance).toBe(false);
        expect(page.data.canComplete).toBe(false);
        expect(env.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
      } finally { env.close(); }
    },
  );

  it.each(['SCHEDULED', 'IN_PROGRESS'] as const)(
    'retains the local selection while the refreshed lesson remains %s',
    async status => {
      const { env, page, detail } = await openMarkedLesson();
      try {
        const loading = page.loadLesson(true);
        env.reply(1, { data: serverLesson(detail, status) });
        await loading;
        expect(page.data.students.map((student: { selectedStatus: string }) => student.selectedStatus))
          .toEqual(detail.students.map(() => 'PRESENT'));
        expect(page.data.detail.version).toBe(detail.version + 1);
        expect(page.data.canEditAttendance).toBe(true);
      } finally { env.close(); }
    },
  );

  it('uses a blank saved terminal status instead of inventing attendance from the old draft', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      const loading = page.loadLesson(true);
      env.reply(1, { data: serverLesson(detail, 'COMPLETED', null) });
      await loading;
      expect(page.data.students.every((student: { selectedStatus: string }) => student.selectedStatus === ''))
        .toBe(true);
      expect(page.data.allMarked).toBe(false);
    } finally { env.close(); }
  });

  it('respects an explicit draft discard for an unfinished lesson', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      const loading = page.loadLesson(false);
      env.reply(1, { data: serverLesson(detail, 'SCHEDULED') });
      await loading;
      expect(page.data.students.every((student: { selectedStatus: string }) => student.selectedStatus === 'LEAVE'))
        .toBe(true);
    } finally { env.close(); }
  });

  it('uses only the refreshed roster and does not retain a removed row or copy a draft to a new student', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      const refreshed = serverLesson(detail, 'SCHEDULED');
      const incoming = { ...refreshed.students[0], id: 'synthetic-new-student' };
      refreshed.students = [incoming];
      refreshed.studentCount = 1;
      const loading = page.loadLesson(true);
      env.reply(1, { data: refreshed });
      await loading;
      expect(page.data.students).toHaveLength(1);
      expect(page.data.students[0]).toMatchObject({ id: incoming.id, selectedStatus: 'LEAVE' });
      expect(page.data.detail.studentCount).toBe(1);
    } finally { env.close(); }
  });

  it('keeps the existing draft after a normal attendance save while the lesson is unfinished', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      const saving = page.onSaveAttendance();
      await flush();
      expect(env.calls[1].method).toBe('PUT');
      env.reply(1, { data: serverLesson(detail, 'SCHEDULED') });
      await saving;
      expect(page.data.students.every((student: { selectedStatus: string }) => student.selectedStatus === 'PRESENT'))
        .toBe(true);
      expect(page.data.submitting).toBe(false);
      expect(env.wx.showToast).toHaveBeenCalledWith({ title: '点名已保存', icon: 'success' });
    } finally { env.close(); }
  });

  it('keeps a 409 draft until refresh and then accepts final saved attendance', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      const saving = page.onSaveAttendance();
      await flush();
      env.reply(1, { code: 'LESSON_VERSION_CONFLICT', message: 'synthetic-conflict' }, 409);
      await saving;
      expect(page.data.conflictCode).toBe('LESSON_VERSION_CONFLICT');
      expect(page.data.students[0].selectedStatus).toBe('PRESENT');
      page.onRefreshConflict();
      env.reply(2, { data: serverLesson(detail, 'COMPLETED') });
      await flush();
      expect(page.data.students[0].selectedStatus).toBe('LEAVE');
      expect(page.data.conflictCode).toBe('');
      expect(page.data.submitting).toBe(false);
    } finally { env.close(); }
  });

  it('retains the existing successful completion receipt and follow-up read behavior', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      const completing = page.onCompleteLesson();
      await flush();
      env.reply(1, { data: {
        lessonSessionId: detail.id, lessonVersion: detail.version + 1, status: 'COMPLETED',
        teachingRecordId: 'synthetic-record', consumed: [],
      } });
      await flush();
      expect(env.calls[2].method).toBe('GET');
      const reading = page.pendingRequest;
      expect(reading).toBeDefined();
      env.reply(2, { data: serverLesson(detail, 'COMPLETED') });
      await completing;
      await reading;
      expect(page.data.students[0].selectedStatus).toBe('LEAVE');
      expect(page.data.detail.status).toBe('COMPLETED');
      expect(page.data.needsReconcile).toBe(false);
      expect(page.data.canComplete).toBe(false);
      expect(page.data.submitting).toBe(false);
    } finally { env.close(); }
  });

  it('accepts saved final attendance when an explicit refresh follows a lost completion response', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      const completing = page.onCompleteLesson();
      await flush();
      env.calls[1].fail({ errMsg: 'synthetic-lost-reply' });
      await completing;
      expect(page.data.students[0].selectedStatus).toBe('PRESENT');
      page.onRefreshConflict();
      env.reply(2, { data: serverLesson(detail, 'COMPLETED') });
      await flush();
      expect(page.data.students[0].selectedStatus).toBe('LEAVE');
      expect(page.data.canComplete).toBe(false);
      expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
    } finally { env.close(); }
  });

  it('clears private lesson data when an attendance write is forbidden', async () => {
    const { env, page } = await openMarkedLesson();
    try {
      const saving = page.onSaveAttendance();
      await flush();
      env.reply(1, { code: 'FORBIDDEN', message: 'synthetic-forbidden' }, 403);
      await saving;
      expect(page.data.viewState).toBe('forbidden');
      expect(page.data.errorMessage).toBe('登录已失效或无权处理该课次，请重新登录');
      expect(page.data.detail).toBeNull();
      expect(page.data.students).toEqual([]);
      expect(page.data.lessonId).toBe('');
      expect(page.data.reverseReason).toBe('');
      expect(page.data.submitting).toBe(false);
      expect(env.wx.showToast).not.toHaveBeenCalled();
    } finally { env.close(); }
  });

  it('keeps successful reversal readback and clears its reason', async () => {
    const { env, page, detail } = await openMarkedLesson();
    try {
      page.applyLesson(serverLesson(detail, 'COMPLETED', 'PRESENT'), false);
      page.onReverseReasonInput({ detail: { value: 'synthetic-reversal' } });
      const reversing = page.onReverseLesson();
      await flush();
      env.reply(1, { data: {
        lessonSessionId: detail.id, lessonVersion: detail.version + 2, status: 'REVERSED',
        teachingRecordId: 'synthetic-reversal-record', consumed: [],
      } });
      await flush();
      expect(env.calls[2].method).toBe('GET');
      const reading = page.pendingRequest;
      expect(reading).toBeDefined();
      env.reply(2, { data: { ...serverLesson(detail, 'REVERSED'), version: detail.version + 2 } });
      await reversing;
      await reading;
      expect(page.data.students[0].selectedStatus).toBe('LEAVE');
      expect(page.data.detail.status).toBe('REVERSED');
      expect(page.data.needsReconcile).toBe(false);
      expect(page.data.canReverse).toBe(false);
      expect(page.data.reverseReason).toBe('');
    } finally { env.close(); }
  });
});
