import {
  captureTeacherPage, flushTeacherPage as flush, teacherLesson, teacherTap,
} from './teacher-page-test-support';
import type { TeacherLessonDetail } from '../types/teacher';

type Operation = 'attendance' | 'complete' | 'reverse';
const operations: Operation[] = ['attendance', 'complete', 'reverse'];
const failure = (code = 'UNAVAILABLE') => ({ code, message: '合成失败' });
const changed = (detail: TeacherLessonDetail, status = detail.status, version = detail.version + 1) => ({
  ...detail, status, version, canComplete: ['SCHEDULED', 'IN_PROGRESS'].includes(status),
  canReverse: status === 'COMPLETED',
  students: detail.students.map(student => ({ ...student, attendanceStatus: 'LEAVE' })),
});
const receipt = (detail: TeacherLessonDetail, operation: Operation) => operation === 'attendance'
  ? { ...changed(detail), students: detail.students.map(student => ({
    ...student, attendanceStatus: 'PRESENT', expectedConsumeUnits: detail.lessonUnits,
  })) }
  : { lessonSessionId: detail.id, lessonVersion: detail.version + 1,
    status: operation === 'complete' ? 'COMPLETED' : 'REVERSED',
    teachingRecordId: 'synthetic-record', consumed: [] };
const invoke = (page: any, operation: Operation) => operation === 'attendance'
  ? page.onSaveAttendance() : operation === 'complete' ? page.onCompleteLesson() : page.onReverseLesson();
async function opened(operation: Operation = 'attendance') {
  const env = captureTeacherPage('lesson');
  const page = env.instantiate();
  const detail = teacherLesson();
  detail.status = operation === 'reverse' ? 'COMPLETED' : 'SCHEDULED';
  detail.canComplete = operation !== 'reverse';
  detail.canReverse = operation === 'reverse';
  page.onLoad({ id: detail.id });
  page.onShow?.();
  env.reply(0, { data: detail });
  await flush();
  for (const student of detail.students) page.onAttendanceTap(teacherTap(student.id, 'PRESENT'));
  if (operation === 'reverse') page.onReverseReasonInput({ detail: { value: ' 原撤销原因 ' } });
  return { env, page, detail };
}
function privateCleared(page: any) {
  expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, students: [],
    courseName: '', className: '', campusName: '', reverseReason: '', submitting: false,
    canEditAttendance: false, canComplete: false, canReverse: false });
}
async function assertLocked(env: any, page: any) {
  const before = structuredClone(page.data);
  const count = env.calls.length;
  const student = before.students[0];
  if (student) page.onAttendanceTap(teacherTap(student.id, 'ABSENT'));
  page.onReverseReasonInput({ detail: { value: '新原因不应生效' } });
  void invoke(page, 'attendance');
  void invoke(page, 'complete');
  void invoke(page, 'reverse');
  await flush();
  expect(env.calls).toHaveLength(count);
  expect(page.data.students).toEqual(before.students);
  expect(page.data.reverseReason).toBe(before.reverseReason);
  expect(page.data.needsReconcile).toBe(true);
}

describe('teacher lesson lifecycle and original-command reconciliation through full Page', () => {
  it('performs one initial GET, refreshes on return and rejects an earlier successful response', async () => {
    const { env, page, detail } = await opened();
    try {
      expect(env.calls).toHaveLength(1);
      page.onPullDownRefresh();
      const old = env.calls.length - 1;
      page.onHide?.(); page.onShow?.();
      expect(env.calls).toHaveLength(3);
      env.reply(2, { data: changed(detail, 'IN_PROGRESS', detail.version + 3) });
      await flush();
      env.reply(old, { data: changed(detail, 'SCHEDULED', detail.version + 1) });
      await flush();
      expect(page.data.detail.version).toBe(detail.version + 3);
      expect(env.wx.stopPullDownRefresh).not.toHaveBeenCalled();
    } finally { env.close(); }
  });

  it.each([401, 403])('retains hidden GET%s denial and clears private data before return GET', async code => {
    const { env, page } = await opened();
    try {
      page.onPullDownRefresh(); page.onHide?.();
      const count = page.setData.mock.calls.length;
      env.reply(1, failure('DENIED'), code); await flush();
      expect(page.setData).toHaveBeenCalledTimes(count);
      page.onShow?.(); await flush();
      privateCleared(page);
      expect(env.calls).toHaveLength(2);
    } finally { env.close(); }
  });

  it.each([401, 403])('prior GET%s denial after return defeats later successful current GET', async code => {
    const { env, page, detail } = await opened();
    try {
      page.onPullDownRefresh(); page.onHide?.(); page.onShow?.();
      expect(env.calls).toHaveLength(3);
      env.reply(1, failure('DENIED'), code); await flush();
      env.reply(2, { data: changed(detail) }); await flush();
      privateCleared(page);
    } finally { env.close(); }
  });

  it.each([{ accessToken: 'synthetic-new' }, { apiBaseUrl: 'https://changed.synthetic.invalid' },
    { dataDriver: 'mock' }])('does not adopt a changed owner/configuration %j', async patch => {
    const { env, page } = await opened();
    try {
      page.onHide?.(); env.change(patch); page.onShow?.(); await flush();
      privateCleared(page);
      expect(env.calls).toHaveLength(1);
    } finally { env.close(); }
  });

  it('does not apply an outstanding read after unload', async () => {
    const { env, page, detail } = await opened();
    try {
      page.onPullDownRefresh(); page.onUnload?.();
      const count = page.setData.mock.calls.length;
      env.reply(1, { data: changed(detail) }); await flush();
      expect(page.setData).toHaveBeenCalledTimes(count);
    } finally { env.close(); }
  });

  it.each(operations)('%s freezes the original command through unknown response and failed GET', async operation => {
    const { env, page } = await opened(operation);
    try {
      void invoke(page, operation); await flush();
      const command = structuredClone(env.calls[1].data);
      const header = { ...env.calls[1].header };
      env.reply(1, failure(), 503); await flush();
      await assertLocked(env, page);
      expect(env.calls).toHaveLength(2);
      page.onRetryOriginal?.(); await flush();
      expect(env.calls).toHaveLength(2);
      page.onRetry(); await flush();
      expect(env.calls[2]?.method).toBe('GET');
      env.reply(2, failure(), 503); await flush();
      await assertLocked(env, page);
      expect(env.calls[1].data).toEqual(command);
      expect(env.calls[1].header).toEqual(header);
      expect(page.data.retryOriginalAvailable).toBe(false);
    } finally { env.close(); }
  });

  it.each(operations)('%s permits only the exact original key/body after authoritative unchanged GET', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush();
      const original = env.calls[1];
      const body = structuredClone(original.data), header = { ...original.header };
      env.reply(1, failure(), 503); await flush();
      page.onRetry(); await flush();
      env.reply(2, { data: detail }); await flush();
      await assertLocked(env, page);
      expect(page.data.retryOriginalAvailable).toBe(true);
      page.onRetryOriginal?.(); page.onRetryOriginal?.(); await flush();
      expect(env.calls).toHaveLength(4);
      expect(env.calls[3]).toMatchObject({ url: original.url, method: original.method, data: body, header });
      env.reply(3, { data: receipt(detail, operation) }); await flush();
      if (operation !== 'attendance') {
        expect(env.calls[4]?.method).toBe('GET');
        env.reply(4, { data: changed(detail, operation === 'complete' ? 'COMPLETED' : 'REVERSED') });
        await flush();
      }
      expect(page.data.needsReconcile).toBe(false);
      expect(page.data.submitting).toBe(false);
    } finally { env.close(); }
  });

  it.each(operations)('%s unknown result arriving hidden remains locked after return GET503', async operation => {
    const { env, page } = await opened(operation);
    try {
      void invoke(page, operation); await flush(); page.onHide?.();
      const count = page.setData.mock.calls.length;
      env.reply(1, failure(), 503); await flush();
      expect(page.setData).toHaveBeenCalledTimes(count);
      page.onShow?.(); await flush();
      expect(env.calls[2]?.method).toBe('GET');
      env.reply(2, failure(), 503); await flush();
      await assertLocked(env, page);
    } finally { env.close(); }
  });

  it.each(operations.flatMap(operation => [401, 403].map(code => ({ operation, code }))))(
    '$operation hidden $code clears private state before refreshing',
    async ({ operation, code }) => {
      const { env, page } = await opened(operation);
      try {
        void invoke(page, operation); await flush(); page.onHide?.();
        const count = page.setData.mock.calls.length;
        env.reply(1, failure('DENIED'), code); await flush();
        expect(page.setData).toHaveBeenCalledTimes(count);
        page.onShow?.(); await flush();
        privateCleared(page);
        expect(env.calls).toHaveLength(2);
      } finally { env.close(); }
    },
  );

  it.each(['before', 'after'] as const)('applies saved attendance receipt %s return even if GET503 follows', async timing => {
    const { env, page, detail } = await opened();
    try {
      void invoke(page, 'attendance'); await flush(); page.onHide?.();
      if (timing === 'after') page.onShow?.();
      env.reply(1, { data: receipt(detail, 'attendance') }); await flush();
      if (timing === 'before') page.onShow?.();
      await flush();
      expect(env.calls[2]?.method).toBe('GET');
      env.reply(2, failure(), 503); await flush();
      expect(page.data.detail.version).toBe(detail.version + 1);
      expect(page.data.submitting).toBe(false);
      expect(page.data.needsReconcile).toBe(false);
      void invoke(page, 'attendance'); await flush();
      expect(env.calls[3].data).toMatchObject({ lessonVersion: detail.version + 1 });
      env.reply(3, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it.each(['complete', 'reverse'] as const)('%s accepted receipt blocks stale/failed refresh and never replays its deleted key', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush();
      env.reply(1, { data: receipt(detail, operation) }); await flush();
      expect(env.calls[2]?.method).toBe('GET');
      env.reply(2, { data: detail }); await flush();
      await assertLocked(env, page);
      expect(page.data.retryOriginalAvailable).toBe(false);
      page.onRetryOriginal?.(); await flush();
      expect(env.calls).toHaveLength(3);
      page.onRetry(); await flush();
      env.reply(3, failure(), 503); await flush();
      await assertLocked(env, page);
      page.onRetry(); await flush();
      env.reply(4, { data: changed(detail, operation === 'complete' ? 'COMPLETED' : 'REVERSED') });
      await flush();
      expect(page.data.needsReconcile).toBe(false);
      expect(env.calls.filter(call => call.method !== 'GET')).toHaveLength(1);
    } finally { env.close(); }
  });

  it.each(operations)('%s accepted after unload performs no GET or Page update', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush(); page.onUnload?.();
      const count = page.setData.mock.calls.length;
      env.reply(1, { data: receipt(detail, operation) }); await flush();
      expect(page.setData).toHaveBeenCalledTimes(count);
      expect(env.calls).toHaveLength(2);
    } finally { env.close(); }
  });

  it.each(operations)('%s definite 400 keeps draft and allows correction', async operation => {
    const { env, page } = await opened(operation);
    try {
      const students = structuredClone(page.data.students), reason = page.data.reverseReason;
      void invoke(page, operation); await flush();
      env.reply(1, failure('BAD_REQUEST'), 400); await flush();
      expect(page.data.students).toEqual(students);
      expect(page.data.reverseReason).toBe(reason);
      expect(page.data.submitting).toBe(false);
      expect(page.data.needsReconcile).toBe(false);
    } finally { env.close(); }
  });

  it.each(operations)('%s transport failure stays unknown until a terminal authority GET', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush();
      env.calls[1].fail(new Error('synthetic connection dropped')); await flush();
      await assertLocked(env, page);
      page.onRetry(); await flush();
      env.reply(2, { data: changed(detail, operation === 'reverse' ? 'REVERSED' : 'COMPLETED') });
      await flush();
      expect(page.data.needsReconcile).toBe(false);
      expect(page.data.canEditAttendance).toBe(false);
      expect(env.calls.filter(call => call.method !== 'GET')).toHaveLength(1);
    } finally { env.close(); }
  });

  it.each(operations)('%s keeps the original command even when authority GET changes version and roster order', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush();
      const original = env.calls[1], data = structuredClone(original.data);
      env.reply(1, failure(), 503); await flush();
      page.onRetry(); await flush();
      const current = changed(detail, detail.status, detail.version + 4);
      current.students.reverse();
      env.reply(2, { data: current }); await flush();
      await assertLocked(env, page);
      page.onRetryOriginal?.(); await flush();
      expect(env.calls).toHaveLength(4);
      expect(env.calls[3]).toMatchObject({ method: original.method, data, header: original.header });
      env.reply(3, failure('LESSON_VERSION_CONFLICT'), 409); await flush();
      expect(page.data.needsReconcile).toBe(false);
      expect(page.data.conflictCode).toBe('LESSON_VERSION_CONFLICT');
    } finally { env.close(); }
  });

  it.each(['complete', 'reverse'] as const)('%s retains a hidden accepted receipt without issuing a hidden GET', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush(); page.onHide?.();
      const count = page.setData.mock.calls.length;
      env.reply(1, { data: receipt(detail, operation) }); await flush();
      expect(env.calls).toHaveLength(2);
      expect(page.setData).toHaveBeenCalledTimes(count);
      page.onShow?.(); await flush();
      expect(env.calls[2]?.method).toBe('GET');
      env.reply(2, failure(), 503); await flush();
      await assertLocked(env, page);
    } finally { env.close(); }
  });

  it.each(operations.flatMap(operation => [401, 403].map(code => ({ operation, code }))))(
    '$operation $code arriving after return clears data without waiting for another GET',
    async ({ operation, code }) => {
      const { env, page } = await opened(operation);
      try {
        void invoke(page, operation); await flush(); page.onHide?.(); page.onShow?.();
        env.reply(1, failure('DENIED'), code); await flush();
        privateCleared(page);
        expect(env.calls).toHaveLength(2);
      } finally { env.close(); }
    },
  );

  it.each(['complete', 'reverse'].flatMap(operation => [401, 403].map(code => ({ operation, code }))))(
    '$operation follow-up GET$code arriving hidden is retained until return',
    async ({ operation, code }) => {
      const op = operation as Operation;
      const { env, page, detail } = await opened(op);
      try {
        void invoke(page, op); await flush();
        env.reply(1, { data: receipt(detail, op) }); await flush();
        expect(env.calls[2]?.method).toBe('GET');
        page.onHide?.();
        const count = page.setData.mock.calls.length;
        env.reply(2, failure('DENIED'), code); await flush();
        expect(page.setData).toHaveBeenCalledTimes(count);
        page.onShow?.(); await flush();
        privateCleared(page);
        expect(env.calls).toHaveLength(3);
      } finally { env.close(); }
    },
  );

  it.each(operations)('%s never follows a changed runtime identity after sending', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush();
      env.change({ accessToken: 'synthetic-other-owner' });
      env.reply(1, { data: receipt(detail, operation) }); await flush();
      privateCleared(page);
      expect(env.calls).toHaveLength(2);
    } finally { env.close(); }
  });

  it.each(operations)('%s cancelled-before-send retry retains the unresolved original command', async operation => {
    const { env, page, detail } = await opened(operation);
    try {
      void invoke(page, operation); await flush();
      const original = env.calls[1], body = structuredClone(original.data);
      env.reply(1, failure(), 503); await flush();
      page.onRetry(); await flush();
      env.reply(2, { data: detail }); await flush();
      page.onRetryOriginal?.();
      page.onHide?.();
      await flush();
      expect(env.calls).toHaveLength(3);
      page.onShow?.(); await flush();
      expect(env.calls[3]?.method).toBe('GET');
      env.reply(3, failure(), 503); await flush();
      await assertLocked(env, page);
      page.onRetry(); await flush();
      env.reply(4, { data: detail }); await flush();
      page.onRetryOriginal?.(); await flush();
      expect(env.calls[5]).toMatchObject({ method: original.method, data: body, header: original.header });
      env.reply(5, failure('LESSON_VERSION_CONFLICT'), 409); await flush();
    } finally { env.close(); }
  });

  it('does not roll saved attendance back to an older authority read on return', async () => {
    const { env, page, detail } = await opened();
    try {
      void invoke(page, 'attendance'); await flush();
      env.reply(1, { data: receipt(detail, 'attendance') }); await flush();
      page.onHide?.(); page.onShow?.(); await flush();
      env.reply(2, { data: detail }); await flush();
      expect(page.data.detail.version).toBe(detail.version + 1);
      expect(page.data.refreshError).not.toBe('');
      void invoke(page, 'attendance'); await flush();
      expect(env.calls[3].data).toMatchObject({ lessonVersion: detail.version + 1 });
      env.reply(3, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it('keeps a newer authority snapshot when original-key replay returns an older saved receipt', async () => {
    const { env, page, detail } = await opened();
    try {
      void invoke(page, 'attendance'); await flush();
      const original = env.calls[1];
      env.reply(1, failure(), 503); await flush();
      page.onRetry(); await flush();
      const current = changed(detail, 'IN_PROGRESS', detail.version + 4);
      current.students.reverse();
      env.reply(2, { data: current }); await flush();
      page.onRetryOriginal?.(); await flush();
      expect(env.calls[3].header).toEqual(original.header);
      env.reply(3, { data: receipt(detail, 'attendance') }); await flush();
      expect(page.data.detail.version).toBe(current.version);
      expect(page.data.detail.status).toBe('IN_PROGRESS');
      expect(page.data.students.map((student: { id: string }) => student.id))
        .toEqual(current.students.map(student => student.id));
      expect(page.data.needsReconcile).toBe(false);
      void invoke(page, 'complete'); await flush();
      expect(env.calls[4].data).toMatchObject({ lessonVersion: current.version });
      env.reply(4, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it('uses saved original attendance after replay instead of the intervening GET selections', async () => {
    const { env, page, detail } = await opened();
    try {
      void invoke(page, 'attendance'); await flush();
      const body = structuredClone(env.calls[1].data) as { attendance: unknown[] };
      env.reply(1, failure(), 503); await flush();
      page.onRetry(); await flush();
      env.reply(2, { data: changed(detail, detail.status, detail.version) }); await flush();
      expect(page.data.students.every((student: { selectedStatus: string }) => student.selectedStatus === 'LEAVE')).toBe(true);
      page.onRetryOriginal?.(); await flush();
      env.reply(3, { data: receipt(detail, 'attendance') }); await flush();
      expect(page.data.students.every((student: { selectedStatus: string }) => student.selectedStatus === 'PRESENT')).toBe(true);
      expect(page.attendanceDraft()).toEqual(body.attendance);
      void invoke(page, 'complete'); await flush();
      expect(env.calls[4].data).toMatchObject({ attendance: body.attendance, lessonVersion: detail.version + 1 });
      env.reply(4, failure('BAD_REQUEST'), 400); await flush();
    } finally { env.close(); }
  });

  it('preserves the workflow default follow-up GET for callers without the Page-owned-read option', async () => {
    const { env, page, detail } = await opened();
    try {
      const workflow = new page.workflow.constructor(page.runtime);
      const pending = workflow.complete(detail, page.attendanceDraft());
      await flush();
      env.reply(1, { data: receipt(detail, 'complete') }); await flush();
      expect(env.calls[2]?.method).toBe('GET');
      env.reply(2, { data: changed(detail, 'COMPLETED') }); await flush();
      expect(await pending).toMatchObject({ status: 'success',
        refreshedLesson: { status: 'success', data: { status: 'COMPLETED' } } });
    } finally { env.close(); }
  });
});
