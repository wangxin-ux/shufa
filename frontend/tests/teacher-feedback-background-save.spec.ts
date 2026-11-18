import {
  captureTeacherPage, flushTeacherPage as flush, teacherLesson, teacherTap,
} from './teacher-page-test-support';

const scores = { classroomPerformance: 0, workCompletion: 7, communication: null, overall: 10 };
const savedImage = {
  id: 'saved-image', accessUrl: 'https://media.synthetic.invalid/saved',
  accessUrlExpiresAt: '2026-10-27T12:00:00Z', mimeType: 'image/png' as const, sizeBytes: 100,
};
const lesson = () => {
  const detail = { ...teacherLesson(), status: 'COMPLETED' as const };
  Object.assign(detail.students[0], {
    canEditFeedback: true, feedback: '原反馈', feedbackVersion: 1,
    teacherRatings: scores, feedbackImages: [savedImage],
  });
  return detail;
};
const receipt = (detail: ReturnType<typeof lesson>) => ({
  lessonSessionId: detail.id, studentId: detail.students[0].id,
  content: '后台保存的反馈', images: [savedImage], performanceRating: null,
  teacherRatings: scores, version: 2, updatedAt: '2026-10-27T11:00:00Z',
});

it.each(['before-return', 'after-return'])(
  'continues from the confirmed save version when its receipt arrives %s',
  async (timing) => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
      page.onLoad({ id: detail.id }); page.onShow();
      env.reply(0, { data: detail }); await flush();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '后台保存的反馈' } });
      const pending = page.onSaveFeedback(teacherTap(id)); await flush();
      expect(env.calls[1].data).toMatchObject({ expectedVersion: 1 });
      page.onHide();
      if (timing === 'after-return') page.onShow();
      const writesBeforeReceipt = page.setData.mock.calls.length;
      env.reply(1, { data: receipt(detail) });
      await pending; await flush();
      expect(env.wx.showToast).not.toHaveBeenCalled();
      if (timing === 'before-return') {
        expect(page.setData).toHaveBeenCalledTimes(writesBeforeReceipt);
        expect(page.data.students[0].feedbackVersion).toBe(1);
        page.onShow(); await flush();
      }
      // Even a failed return read must not erase the already confirmed version.
      env.reply(2, { message: '合成返场读取失败' }, 503); await flush();
      expect(page.data.students[0]).toMatchObject({
        feedback: '后台保存的反馈', feedbackDraft: '后台保存的反馈',
        feedbackVersion: 2, teacherRatingsDraft: scores, ratingConflict: false,
      });
      expect(page.data.feedbackSubmittingId).toBe('');
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '返场后继续编辑' } });
      const next = page.onSaveFeedback(teacherTap(id)); await flush();
      expect(env.calls[3].data).toMatchObject({ content: '返场后继续编辑', expectedVersion: 2 });
      env.reply(3, { data: { ...receipt(detail), content: '返场后继续编辑', version: 3 } });
      await next;
      expect(page.data.students[0].feedbackVersion).toBe(3);
      expect(env.wx.showToast).toHaveBeenCalledTimes(1);
    } finally { env.close(); }
  },
);

it('preserves new return edits and the confirmed base when another writer advances the server', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
    page.onLoad({ id: detail.id }); page.onShow(); env.reply(0, { data: detail }); await flush();
    page.onFeedbackInput({ ...teacherTap(id), detail: { value: '后台保存的反馈' } });
    const pending = page.onSaveFeedback(teacherTap(id)); await flush();
    page.onHide(); env.reply(1, { data: receipt(detail) }); await pending;
    page.onShow(); await flush();
    page.onFeedbackInput({ ...teacherTap(id), detail: { value: '返场期间的新草稿' } });
    const newer = structuredClone(detail);
    Object.assign(newer.students[0], { feedback: '其他位置的修订', feedbackVersion: 3 });
    env.reply(2, { data: newer }); await flush();
    expect(page.data.students[0]).toMatchObject({
      feedbackDraft: '返场期间的新草稿', feedbackVersion: 2,
    });
    const next = page.onSaveFeedback(teacherTap(id)); await flush();
    expect(env.calls[3].data).toMatchObject({ expectedVersion: 2 });
    env.reply(3, { code: 'FEEDBACK_VERSION_CONFLICT', message: '合成并发修改' }, 409);
    await next;
    expect(page.data.students[0]).toMatchObject({
      feedbackDraft: '返场期间的新草稿', feedbackVersion: 2, ratingConflict: true,
    });
  } finally { env.close(); }
});

it.each(['owner', 'unload'])('discards a deferred successful receipt after %s', async (change) => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
    page.onLoad({ id: detail.id }); page.onShow(); env.reply(0, { data: detail }); await flush();
    page.onFeedbackInput({ ...teacherTap(id), detail: { value: '后台保存的反馈' } });
    const pending = page.onSaveFeedback(teacherTap(id)); await flush();
    page.onHide(); env.reply(1, { data: receipt(detail) }); await pending;
    if (change === 'owner') {
      env.change({ accessToken: 'synthetic-new-owner' });
      page.onShow();
      expect(page.data).toMatchObject({ viewState: 'forbidden', students: [], detail: null });
    } else {
      page.onUnload();
      const count = page.setData.mock.calls.length;
      page.onShow();
      expect(page.setData).toHaveBeenCalledTimes(count);
      const another = env.instantiate();
      expect(another.data.students).toEqual([]);
    }
    expect(env.calls).toHaveLength(2);
    expect(env.wx.showToast).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it('keeps an unsuccessful hidden save as the original draft and reuses its retry key', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
    page.onLoad({ id: detail.id }); page.onShow(); env.reply(0, { data: detail }); await flush();
    page.onFeedbackInput({ ...teacherTap(id), detail: { value: '后台保存的反馈' } });
    const pending = page.onSaveFeedback(teacherTap(id)); await flush();
    page.onHide(); env.reply(1, { message: '合成保存失败' }, 503); await pending;
    page.onShow(); env.reply(2, { data: detail }); await flush();
    expect(page.data.students[0]).toMatchObject({
      feedbackDraft: '后台保存的反馈', feedbackVersion: 1,
    });
    const retry = page.onSaveFeedback(teacherTap(id)); await flush();
    expect(env.calls[3].header?.['Idempotency-Key']).toBe(env.calls[1].header?.['Idempotency-Key']);
    env.reply(3, { data: receipt(detail) }); await retry;
  } finally { env.close(); }
});

describe.each([401, 403])('feedback write access rejected with HTTP %s', (statusCode) => {
  it.each(['before-return', 'after-return'])(
    'clears private feedback after a save denial arrives %s without needing a return read',
    async (timing) => {
      const env = captureTeacherPage('feedback-detail');
      try {
        const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
        page.onLoad({ id: detail.id }); page.onShow();
        env.reply(0, { data: detail }); await flush();
        page.onFeedbackInput({ ...teacherTap(id), detail: { value: '失权前的私有草稿' } });
        const pending = page.onSaveFeedback(teacherTap(id)); await flush();
        page.onHide();
        if (timing === 'after-return') page.onShow();
        const hiddenWrites = page.setData.mock.calls.length;
        env.reply(1, { message: '合成账号停用或教师权限撤销' }, statusCode);
        await pending; await flush();
        if (timing === 'before-return') {
          expect(page.setData).toHaveBeenCalledTimes(hiddenWrites);
          page.onShow(); await flush();
        }
        // A known rejection must not depend on another request succeeding.
        expect(env.calls).toHaveLength(2);
        expect(page.data).toMatchObject({
          viewState: 'forbidden', students: [], detail: null, lessonId: '',
          courseName: '', progressLabel: '', draftImageUrls: {},
          feedbackSubmittingId: '', feedbackUploadingId: '',
        });
        page.onFeedbackInput({ ...teacherTap(id), detail: { value: '失权后不可写' } });
        await page.onSaveFeedback(teacherTap(id));
        page.onRetryImages();
        page.onPreviewImages({ currentTarget: { dataset: { id, url: savedImage.accessUrl } } });
        expect(env.calls).toHaveLength(2);
        expect(env.wx.showToast).not.toHaveBeenCalled();
      } finally { env.close(); }
    },
  );

  it.each(['before-return', 'after-return'])(
    'clears private feedback after an upload denial arrives %s',
    async (timing) => {
      const env = captureTeacherPage('feedback-detail');
      try {
        const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
        page.onLoad({ id: detail.id }); page.onShow();
        env.reply(0, { data: detail }); await flush();
        env.wx.chooseMedia = jest.fn((options: any) => options.success({
          tempFiles: [{ tempFilePath: 'wxfile://synthetic-private.png', size: 100 }],
        }));
        let upload: any;
        env.wx.uploadFile = jest.fn((options: any) => { upload = options; });
        const pending = page.onChooseImages(teacherTap(id)); await flush();
        expect(env.wx.uploadFile).toHaveBeenCalledTimes(1);
        page.onHide();
        if (timing === 'after-return') page.onShow();
        const hiddenWrites = page.setData.mock.calls.length;
        upload.success({ statusCode, data: JSON.stringify({ message: '合成上传权限撤销' }) });
        await pending; await flush();
        if (timing === 'before-return') {
          expect(page.setData).toHaveBeenCalledTimes(hiddenWrites);
          page.onShow(); await flush();
        }
        expect(page.data).toMatchObject({
          viewState: 'forbidden', students: [], detail: null, draftImageUrls: {},
          feedbackSubmittingId: '', feedbackUploadingId: '',
        });
        await page.onChooseImages(teacherTap(id));
        expect(env.wx.uploadFile).toHaveBeenCalledTimes(1);
        expect(env.calls).toHaveLength(1);
      } finally { env.close(); }
    },
  );

  it('clears an already uploaded local draft and stops the remaining files after a later upload is denied', async () => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
      detail.students[0].feedbackImages = [];
      page.onLoad({ id: detail.id }); page.onShow();
      env.reply(0, { data: detail }); await flush();
      page.onFeedbackInput({ ...teacherTap(id), detail: { value: '批量选图前的私有草稿' } });
      env.wx.chooseMedia = jest.fn((options: any) => options.success({
        tempFiles: [1, 2, 3].map((number) => ({
          tempFilePath: `wxfile://synthetic-private-${number}.png`, size: 100,
        })),
      }));
      let deniedUpload: any;
      env.wx.uploadFile = jest.fn((options: any) => {
        if (options.filePath.endsWith('-1.png')) options.success({
          statusCode: 200, data: JSON.stringify({ data: { ...savedImage, id: 'first-upload' } }),
        });
        else deniedUpload = options;
      });
      const pending = page.onChooseImages(teacherTap(id)); await flush();
      expect(env.wx.uploadFile).toHaveBeenCalledTimes(2);
      expect(page.data.draftImageUrls).toEqual({
        'first-upload': 'wxfile://synthetic-private-1.png',
      });
      page.onHide();
      const hiddenWrites = page.setData.mock.calls.length;
      deniedUpload.success({ statusCode, data: JSON.stringify({ message: '合成第二张上传权限撤销' }) });
      await pending;
      expect(page.setData).toHaveBeenCalledTimes(hiddenWrites);
      page.onShow(); await flush();
      expect(page.data).toMatchObject({
        viewState: 'forbidden', students: [], detail: null, draftImageUrls: {},
      });
      expect(env.wx.uploadFile).toHaveBeenCalledTimes(2);
      expect(env.calls).toHaveLength(1);
    } finally { env.close(); }
  });
});

describe.each(['save', 'upload'])('late %s denial isolation', (operation) => {
  it.each(['owner', 'unload'])('does not affect a new Page after %s', async (change) => {
    const env = captureTeacherPage('feedback-detail');
    try {
      const detail = lesson(), id = detail.students[0].id, page = env.instantiate();
      page.onLoad({ id: detail.id }); page.onShow();
      env.reply(0, { data: detail }); await flush();
      let upload: any;
      env.wx.chooseMedia = jest.fn((options: any) => options.success({
        tempFiles: [{ tempFilePath: 'wxfile://synthetic-late.png', size: 100 }],
      }));
      env.wx.uploadFile = jest.fn((options: any) => { upload = options; });
      const pending = operation === 'save'
        ? page.onSaveFeedback(teacherTap(id)) : page.onChooseImages(teacherTap(id));
      await flush();
      page.onHide();
      if (change === 'owner') {
        env.change({ accessToken: 'synthetic-new-owner' });
        page.onShow();
      } else page.onUnload();
      const nextPage = env.instantiate();
      nextPage.onLoad({ id: detail.id }); nextPage.onShow();
      const nextRead = env.calls.length - 1;
      env.reply(nextRead, { data: detail }); await flush();
      const nextData = structuredClone(nextPage.data), count = env.calls.length;
      const oldWrites = page.setData.mock.calls.length;
      if (operation === 'save') env.reply(1, { message: '合成迟到权限拒绝' }, 403);
      else upload.success({ statusCode: 403, data: JSON.stringify({ message: '合成迟到上传拒绝' }) });
      await pending; await flush();
      page.onShow();
      expect(nextPage.data).toEqual(nextData);
      expect(nextPage.data.viewState).toBe('ready');
      expect(env.calls).toHaveLength(count);
      if (change === 'unload') expect(page.setData).toHaveBeenCalledTimes(oldWrites);
      else expect(page.data).toMatchObject({ viewState: 'forbidden', students: [], detail: null });
      expect(env.wx.showToast).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});
