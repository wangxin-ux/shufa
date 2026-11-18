import {
  captureTeacherPage, flushTeacherPage as flush, teacherLesson, teacherTap,
} from './teacher-page-test-support';

const originalScores = {
  classroomPerformance: 2, workCompletion: 7, communication: null, overall: 10,
};
const draftScores = { ...originalScores, classroomPerformance: 4 };
const image = {
  id: 'synthetic-conflict-image', accessUrl: 'https://media.synthetic.invalid/conflict',
  accessUrlExpiresAt: '2026-10-28T12:00:00Z', mimeType: 'image/png' as const, sizeBytes: 100,
};
const lesson = () => {
  const detail = { ...teacherLesson(), status: 'COMPLETED' as const };
  Object.assign(detail.students[0], {
    canEditFeedback: true, feedback: '原反馈', feedbackVersion: 1,
    teacherRatings: originalScores, feedbackImages: [image],
  });
  Object.assign(detail.students[1], {
    canEditFeedback: true, feedback: '另一学员原反馈', feedbackVersion: 3,
    teacherRatings: originalScores,
  });
  return detail;
};
const conflict = {
  code: 'FEEDBACK_VERSION_CONFLICT', message: '合成其他位置已更新',
};
const newerLesson = (detail: ReturnType<typeof lesson>) => {
  const newer = structuredClone(detail);
  Object.assign(newer.students[0], {
    feedback: '服务器版本二', feedbackVersion: 2,
    teacherRatings: { ...originalScores, overall: 5 }, feedbackImages: [],
  });
  return newer;
};

describe.each(['before-return', 'after-return'])('hidden conflict received %s', (timing) => {
  it.each([200, 503])(
    'requires an explicit student reload after return GET %s while preserving both drafts',
    async (returnStatus) => {
      const env = captureTeacherPage('feedback-detail');
      try {
        const detail = lesson(), page = env.instantiate();
        const [first, second] = detail.students;
        page.onLoad({ id: detail.id }); page.onShow();
        env.reply(0, { data: detail }); await flush();
        page.onFeedbackInput({ ...teacherTap(first.id), detail: { value: '保留本学员草稿' } });
        page.onTeacherRatingChange({
          currentTarget: { dataset: { id: first.id, field: 'classroomPerformance' } },
          detail: { value: '5' },
        });
        page.onFeedbackInput({ ...teacherTap(second.id), detail: { value: '保留另一学员草稿' } });
        const otherDraft = structuredClone(page.data.students[1]);
        const pending = page.onSaveFeedback(teacherTap(first.id)); await flush();
        expect(env.calls[1].data).toMatchObject({
          content: '保留本学员草稿', expectedVersion: 1,
          teacherRatings: draftScores, imageFileIds: [image.id],
        });
        page.onHide();
        if (timing === 'after-return') page.onShow();
        expect(env.calls).toHaveLength(2);
        const hiddenWrites = page.setData.mock.calls.length;
        env.reply(1, conflict, 409); await pending; await flush();
        if (timing === 'before-return') {
          expect(page.setData).toHaveBeenCalledTimes(hiddenWrites);
          expect(page.data.students[0].ratingConflict).toBe(false);
          page.onShow(); await flush();
        }
        // A known conflict must survive even if the return read cannot succeed.
        expect(page.data.students[0]).toMatchObject({
          feedbackDraft: '保留本学员草稿', feedbackVersion: 1, ratingConflict: true,
          teacherRatingsDraft: draftScores, feedbackImages: [image],
        });
        expect(env.calls).toHaveLength(3);
        env.reply(2, returnStatus === 200 ? { data: newerLesson(detail) }
          : { message: '合成返场读取失败' }, returnStatus);
        await flush();
        expect(page.data.students[0]).toMatchObject({
          feedbackDraft: '保留本学员草稿', feedbackVersion: 1, ratingConflict: true,
          teacherRatingsDraft: draftScores, feedbackImages: [image],
        });
        expect(page.data.students[1]).toEqual(otherDraft);
        expect(page.data.feedbackSubmittingId).toBe('');
        if (returnStatus === 503) expect(page.data.refreshError).toContain('刷新失败');
        await page.onSaveFeedback(teacherTap(first.id)); await flush();
        expect(env.calls).toHaveLength(3);
        expect(env.wx.showToast).not.toHaveBeenCalled();

        page.onReloadFeedback(teacherTap(first.id)); await flush();
        expect(env.calls).toHaveLength(4);
        expect(page.data.students[0].feedbackVersion).toBe(1);
        env.reply(3, { data: newerLesson(detail) }); await flush();
        expect(page.data.students[0]).toMatchObject({
          feedbackDraft: '服务器版本二', feedbackVersion: 2, ratingConflict: false,
          teacherRatingsDraft: { ...originalScores, overall: 5 }, feedbackImages: [],
        });
        expect(page.data.students[1]).toEqual(otherDraft);
        const next = page.onSaveFeedback(teacherTap(first.id)); await flush();
        expect(env.calls[4].data).toMatchObject({ expectedVersion: 2, content: '服务器版本二' });
        env.reply(4, { data: {
          lessonSessionId: detail.id, studentId: first.id, content: '服务器版本二',
          images: [], teacherRatings: { ...originalScores, overall: 5 }, version: 3,
          updatedAt: '2026-10-28T11:00:00Z',
        } });
        await next;
        expect(page.data.students[0].feedbackVersion).toBe(3);
      } finally { env.close(); }
    },
  );
});

describe.each(['cached', 'late'])('%s hidden conflict isolation', (timing) => {
  it.each(['owner', 'unload'])('discards the conflict after %s without changing a new Page', async (change) => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
      page.onLoad({ id: detail.id }); page.onShow();
      env.reply(0, { data: detail }); await flush();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '旧身份的草稿' } });
      const pending = page.onSaveFeedback(teacherTap(id)); await flush();
      page.onHide();
      if (timing === 'cached') { env.reply(1, conflict, 409); await pending; }
      if (change === 'owner') {
        env.change({ accessToken: 'synthetic-conflict-new-owner' });
        page.onShow();
      } else page.onUnload();
      const nextPage = env.instantiate();
      nextPage.onLoad({ id: detail.id }); nextPage.onShow();
      env.reply(2, { data: detail }); await flush();
      const nextData = structuredClone(nextPage.data), oldWrites = page.setData.mock.calls.length;
      if (timing === 'late') { env.reply(1, conflict, 409); await pending; await flush(); }
      page.onShow();
      expect(env.calls).toHaveLength(3);
      expect(nextPage.data).toEqual(nextData);
      expect(nextPage.data.students[0].ratingConflict).toBe(false);
      expect(page.pendingFeedbackConflict).toBeUndefined();
      if (change === 'unload') expect(page.setData).toHaveBeenCalledTimes(oldWrites);
      else expect(page.data).toMatchObject({ viewState: 'forbidden', students: [], detail: null });
      expect(env.wx.showToast).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});

describe.each([401, 403])('authority rejection takes priority over a conflict with HTTP %s', (statusCode) => {
  it('clears a deferred conflict and its private drafts when the return read is denied', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
      page.onLoad({ id: detail.id }); page.onShow();
      env.reply(0, { data: detail }); await flush();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '失权前的私有草稿' } });
      const pending = page.onSaveFeedback(teacherTap(id)); await flush();
      page.onHide(); env.reply(1, conflict, 409); await pending;
      page.onShow(); await flush();
      env.reply(2, { message: '合成返场权限撤销' }, statusCode); await flush();
      expect(page.data).toMatchObject({
        viewState: 'forbidden', students: [], detail: null, lessonId: '',
        mutationMessage: '', draftImageUrls: {}, feedbackSubmittingId: '', feedbackUploadingId: '',
      });
      expect(page.pendingFeedbackConflict).toBeUndefined();
      page.onReloadFeedback(teacherTap(id)); await page.onSaveFeedback(teacherTap(id));
      page.onShow();
      expect(env.calls).toHaveLength(3);
      expect(env.wx.showToast).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});
