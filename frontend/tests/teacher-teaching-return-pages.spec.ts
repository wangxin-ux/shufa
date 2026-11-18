import { NORMAL_TEACHER_FIXTURE as fixture } from '../mock/fixtures/teacher.fixture';
import {
  captureTeacherPage, flushTeacherPage as flush, teacherLesson, teacherTap,
} from './teacher-page-test-support';

const records = (page = 1, count = 1) => ({
  data: Array.from({ length: count }, (_, i) => ({
    ...fixture.teachingRecords[0], id: `record-${page}-${i}`,
  })),
  meta: { page, pageSize: 20, total: 21, totalPages: 2 },
});
const failure = { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' };
const completed = () => {
  const lesson = { ...teacherLesson(), status: 'COMPLETED', canComplete: false };
  lesson.students.forEach((student) => { student.canEditFeedback = true; });
  return lesson;
};

describe.each(['feedback', 'records'] as const)('%s return lifecycle', (route) => {
  it('loads once, refreshes on return, and ignores the hidden response', async () => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.();
      expect(env.calls).toHaveLength(1);
      page.onHide?.();
      env.reply(0, records()); await flush();
      expect(page.data.items).toEqual([]);
      page.onShow?.();
      expect(env.calls).toHaveLength(2);
      env.reply(1, records()); await flush();
      expect(page.data.items).toHaveLength(1);
    } finally { env.close(); }
  });

  it('retains content after refresh and pagination errors, retries the same page', async () => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, records()); await flush();
      page.onPullDownRefresh(); env.reply(1, failure, 503); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', page: 1, refreshError: '刷新失败，请重试' });
      expect(page.data.items).toHaveLength(1);
      page.onLoadMore(); env.reply(2, failure, 503); await flush();
      expect(page.data).toMatchObject({ page: 1, loadMoreError: '加载更多失败，请重试' });
      page.onLoadMore(); expect(env.calls[3].url).toContain('page=2');
      env.reply(3, records(2)); await flush();
      expect(page.data.items).toHaveLength(2);
    } finally { env.close(); }
  });

  it('supersedes a pending append when the user pulls to refresh', async () => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow(); env.reply(0, records()); await flush();
      page.onLoadMore(); page.onPullDownRefresh();
      expect(env.calls).toHaveLength(3);
      expect(env.calls[2].url).toContain('page=1');
      env.reply(2, records(1, 0)); await flush();
      env.reply(1, records(2)); await flush();
      expect(page.data).toMatchObject({ viewState: 'empty', page: 1, items: [] });
    } finally { env.close(); }
  });

  it.each([401, 403])('clears private records on current %s and stops the pull indicator', async (code) => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.(); env.reply(0, records()); await flush();
      page.onPullDownRefresh(); env.reply(1, failure, code); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], page: 0 });
      expect(env.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
      page.onPullDownRefresh();
      expect(env.wx.stopPullDownRefresh).toHaveBeenCalledTimes(2);
      page.onRetry(); expect(env.calls).toHaveLength(2);
    } finally { env.close(); }
  });

  it('pins the token and rejects changed owners before receiving or navigating', async () => {
    const env = captureTeacherPage(route);
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow?.();
      expect(env.calls[0].header?.Authorization).toBe('Bearer synthetic-teacher-a');
      env.change({ accessToken: 'synthetic-teacher-b' });
      env.reply(0, records()); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', items: [] });
      page.onFeedbackTap?.(teacherTap(fixture.teachingRecords[0].lessonSessionId));
      expect(env.wx.navigateTo).not.toHaveBeenCalled();
    } finally { env.close(); }
  });

  it('does not let one Page instance suppress another', async () => {
    const env = captureTeacherPage(route);
    try {
      const first = env.instantiate(), second = env.instantiate();
      first.onLoad(); second.onLoad();
      env.reply(0, records()); env.reply(1, records(2)); await flush();
      expect(first.data.items).toHaveLength(1);
      expect(second.data.items).toHaveLength(1);
    } finally { env.close(); }
  });
});

describe('feedback detail lifecycle', () => {
  it('keeps edits made while a refresh read is pending', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed(), id = detail.students[0].id;
      page.onLoad({ id: detail.id }); page.onShow(); env.reply(0, { data: detail }); await flush();
      page.onPullDownRefresh();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '刷新中继续输入的草稿' } });
      env.reply(1, { data: detail }); await flush();
      expect(page.data.students[0].feedbackDraft).toBe('刷新中继续输入的草稿');
    } finally { env.close(); }
  });

  it('waits for visibility when the image picker returns before onShow', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed(), id = detail.students[0].id;
      let picker: any;
      env.wx.chooseMedia = jest.fn((input: any) => { picker = input; });
      env.wx.uploadFile = jest.fn((input: any) => input.success({
        statusCode: 200, data: JSON.stringify({ data: { id: 'image', accessUrl: 'synthetic-image' } }),
      }));
      page.onLoad({ id: detail.id }); page.onShow(); env.reply(0, { data: detail }); await flush();
      const choosing = page.onChooseImages(teacherTap(id));
      page.onHide();
      picker.success({ tempFiles: [{ tempFilePath: 'synthetic-image', size: 1 }] });
      await flush(); expect(env.wx.uploadFile).not.toHaveBeenCalled();
      page.onShow(); await choosing; await flush();
      expect(env.wx.uploadFile).toHaveBeenCalledTimes(1);
      env.reply(1, { data: detail }); await flush();
    } finally { env.close(); }
  });

  it('clears feedback drafts after the owner changes before a save receipt', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed(), id = detail.students[0].id;
      page.onLoad({ id: detail.id }); page.onShow(); env.reply(0, { data: detail }); await flush();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '原账号草稿' } });
      const save = page.onSaveFeedback(teacherTap(id)); await flush();
      env.change({ accessToken: 'synthetic-new-owner' });
      env.reply(1, { data: { studentId: id, content: '原账号草稿', images: [] } });
      await save;
      expect(page.data).toMatchObject({ viewState: 'forbidden', students: [], detail: null });
      expect(env.wx.showToast).not.toHaveBeenCalled();
    } finally { env.close(); }
  });

  it('keeps an explicit image selection across the native picker hide/show cycle', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed(), id = detail.students[0].id;
      let picker: any;
      env.wx.chooseMedia = jest.fn((input: any) => { picker = input; });
      env.wx.uploadFile = jest.fn((input: any) => input.success({
        statusCode: 200, data: JSON.stringify({ data: { id: 'synthetic-image', accessUrl: 'synthetic-image-url' } }),
      }));
      page.onLoad({ id: detail.id }); page.onShow?.(); env.reply(0, { data: detail }); await flush();
      const choosing = page.onChooseImages(teacherTap(id));
      page.onHide(); page.onShow();
      picker.success({ tempFiles: [{ tempFilePath: 'synthetic-image-path', size: 1024 }] });
      await choosing; await flush();
      expect(env.wx.uploadFile).toHaveBeenCalledTimes(1);
      expect(env.wx.uploadFile.mock.calls[0][0].header.Authorization).toBe('Bearer synthetic-teacher-a');
      expect(env.calls).toHaveLength(2);
      env.reply(1, { data: detail }); await flush();
      expect(page.data.students[0].feedbackImages).toHaveLength(1);
    } finally { env.close(); }
  });

  it('does not upload queued images or accept upload receipts after unloading', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed(), id = detail.students[0].id;
      let upload: any;
      env.wx.chooseMedia = jest.fn((input: any) => input.success({
        tempFiles: [{ tempFilePath: 'synthetic-a', size: 1 }, { tempFilePath: 'synthetic-b', size: 1 }],
      }));
      env.wx.uploadFile = jest.fn((input: any) => { upload = input; });
      page.onLoad({ id: detail.id }); page.onShow?.(); env.reply(0, { data: detail }); await flush();
      const choosing = page.onChooseImages(teacherTap(id)); await flush();
      page.onUnload(); const before = page.setData.mock.calls.length;
      upload.success({ statusCode: 200, data: JSON.stringify({ data: { id: 'image-a', accessUrl: 'synthetic' } }) });
      await choosing;
      expect(env.wx.uploadFile).toHaveBeenCalledTimes(1);
      expect(page.setData).toHaveBeenCalledTimes(before);
    } finally { env.close(); }
  });

  it('ignores hidden and unloaded reads and refreshes on return', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate();
      page.onLoad({ id: 'lesson-1' }); page.onShow?.(); page.onHide?.();
      env.reply(0, { data: completed() }); await flush();
      expect(page.data.students).toEqual([]);
      page.onShow?.(); expect(env.calls).toHaveLength(2);
      page.onUnload?.(); env.reply(1, { data: completed() }); await flush();
      expect(page.data.students).toEqual([]);
    } finally { env.close(); }
  });

  it('keeps drafts after refresh/save failure and reuses the feedback idempotency key', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed(), id = detail.students[0].id;
      page.onLoad({ id: detail.id }); page.onShow?.(); env.reply(0, { data: detail }); await flush();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '保留的反馈草稿' } });
      const saving = page.onSaveFeedback(teacherTap(id)); await flush();
      env.reply(1, failure, 503); await saving;
      expect(page.data.students[0].feedbackDraft).toBe('保留的反馈草稿');
      page.onPullDownRefresh(); env.reply(2, failure, 503); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', refreshError: '反馈刷新失败，请重试' });
      const retry = page.onSaveFeedback(teacherTap(id)); await flush();
      expect(env.calls[3].header?.['Idempotency-Key']).toBe(env.calls[1].header?.['Idempotency-Key']);
      env.reply(3, failure, 503); await retry;
      expect(page.data.mutationMessage).not.toMatch(/Internal|SERVER/);
    } finally { env.close(); }
  });

  it('waits for a hidden save before reconciling without a stale success toast', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed(), id = detail.students[0].id;
      page.onLoad({ id: detail.id }); page.onShow?.(); env.reply(0, { data: detail }); await flush();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '提交中的草稿' } });
      const save = page.onSaveFeedback(teacherTap(id)); await flush();
      page.onHide?.(); page.onShow?.();
      expect(env.calls).toHaveLength(2);
      env.reply(1, { data: { studentId: id, content: '提交中的草稿', images: [], performanceRating: null } });
      await save; await flush();
      expect(env.wx.showToast).not.toHaveBeenCalled();
      expect(env.calls).toHaveLength(3);
      env.reply(2, { data: { ...detail, students: detail.students.map((s) =>
        s.id === id ? { ...s, feedback: '提交中的草稿' } : s) } }); await flush();
      expect(page.data.students[0]).toMatchObject({ hasFeedback: true, feedback: '提交中的草稿' });
    } finally { env.close(); }
  });

  it.each([401, 403])('clears drafts on current feedback %s', async (status) => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const page = env.instantiate(), detail = completed();
      page.onLoad({ id: detail.id }); page.onShow?.(); env.reply(0, { data: detail }); await flush();
      page.onPullDownRefresh(); env.reply(1, failure, status); await flush();
      expect(page.data).toMatchObject({ viewState: 'forbidden', detail: null, students: [], courseName: '' });
    } finally { env.close(); }
  });
});
