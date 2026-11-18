import { captureTeacherPage, flushTeacherPage as flush, teacherLesson, teacherTap } from './teacher-page-test-support';

it('refreshes a failed signed image explicitly and retains text, rating and image order drafts', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const lesson = { ...teacherLesson(), status: 'COMPLETED' };
    lesson.students.forEach((student) => { student.canEditFeedback = true; });
    const image = { id: 'saved-image', accessUrl: 'https://media.synthetic.invalid/old',
      accessUrlExpiresAt: '2026-10-24T00:00:00Z', mimeType: 'image/png' as const, sizeBytes: 100 };
    lesson.students[0].feedbackImages = [
      { ...image, id: 'removed-image' }, image, { ...image, id: 'saved-third' },
    ];
    lesson.students[0].performanceRating = 8;
    const page = env.instantiate(); page.onLoad({ id: lesson.id }); page.onShow();
    env.reply(0, { data: lesson }); await flush();
    const id = lesson.students[0].id;
    page.onFeedbackInput({ currentTarget: { dataset: { id } }, detail: { value: '尚未保存的文字' } });
    page.onPerformanceChange({ ...teacherTap(id), detail: { value: '0' } });
    page.onRemoveImage({ currentTarget: { dataset: { id, imageId: 'removed-image' } } });
    const uploaded = { ...image, id: 'new-upload', accessUrl: 'https://media.synthetic.invalid/new-upload' };
    env.wx.chooseMedia = jest.fn((options: any) => options.success({
      tempFiles: [{ tempFilePath: 'synthetic-new-image', size: 100 }],
    }));
    env.wx.uploadFile = jest.fn((options: any) => options.success({
      statusCode: 200, data: JSON.stringify({ data: uploaded }),
    }));
    await page.onChooseImages(teacherTap(id));
    page.onFeedbackImageError?.({ currentTarget: { dataset: { id, imageId: image.id, url: image.accessUrl } } });
    expect(env.calls).toHaveLength(1);
    expect(page.data.imageError).toContain('图片');
    page.onRetryImages?.(); expect(env.calls).toHaveLength(2);
    const updated = structuredClone(lesson);
    updated.students[0].performanceRating = 9;
    updated.students[0].feedbackImages = updated.students[0].feedbackImages.map((item) =>
      ({ ...item, accessUrl: `https://media.synthetic.invalid/new-${item.id}` }));
    env.reply(1, { data: updated }); await flush();
    expect(page.data.students[0].feedbackDraft).toBe('尚未保存的文字');
    expect(page.data.students[0].performanceRatingDraft).toBeNull();
    expect(page.data.students[0].feedbackImages.map((item: any) => [item.id, item.accessUrl])).toEqual([
      ['saved-image', 'https://media.synthetic.invalid/new-saved-image'],
      ['saved-third', 'https://media.synthetic.invalid/new-saved-third'],
      ['new-upload', uploaded.accessUrl],
    ]);
    // A late image error for the old signature must not mark the new image as failed.
    page.onFeedbackImageError?.({ currentTarget: { dataset: { id, imageId: image.id, url: image.accessUrl } } });
    expect(page.data.imageError).toBe('');
  } finally { env.close(); }
});

it.each(['hidden', 'owner', '401', '403'])('protects signed-image recovery when %s changes during the read', async (change) => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const lesson = { ...teacherLesson(), status: 'COMPLETED' };
    lesson.students[0].feedbackImages = [{
      id: 'saved-image', accessUrl: 'https://media.synthetic.invalid/old',
      accessUrlExpiresAt: '2026-10-24T00:00:00Z', mimeType: 'image/png', sizeBytes: 100,
    }];
    const page = env.instantiate(); page.onLoad({ id: lesson.id }); page.onShow();
    env.reply(0, { data: lesson }); await flush();
    page.onRetryImages();
    if (change === 'hidden') page.onHide();
    if (change === 'owner') env.change({ accessToken: 'synthetic-other' });
    env.reply(1, change === 'owner' ? { data: lesson } : { message: 'Forbidden' },
      change === 'owner' ? 200 : change === '401' ? 401 : 403);
    await flush();
    if (change === 'hidden') {
      expect(page.data.viewState).toBe('ready');
      expect(page.data.students[0].feedbackImages[0].accessUrl).toContain('/old');
      page.onShow(); expect(env.calls).toHaveLength(3);
      env.reply(2, { data: lesson }); await flush();
    } else {
      expect(page.data).toMatchObject({ viewState: 'forbidden', students: [], detail: null });
      page.onRetryImages(); expect(env.calls).toHaveLength(2);
    }
  } finally { env.close(); }
});

it('previews an unsaved upload from its chosen local file after its server signature expires', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const lesson = { ...teacherLesson(), status: 'COMPLETED' };
    lesson.students[0].canEditFeedback = true;
    lesson.students[0].feedbackImages = [];
    const page = env.instantiate(); page.onLoad({ id: lesson.id }); page.onShow();
    env.reply(0, { data: lesson }); await flush();
    const id = lesson.students[0].id;
    const localFile = 'wxfile://synthetic-chosen-feedback.png';
    page.onFeedbackInput({ ...teacherTap(id), detail: { value: '待保存的图片反馈' } });
    const uploaded = { id: 'unsaved-upload', accessUrl: 'https://media.synthetic.invalid/expired',
      accessUrlExpiresAt: '2026-10-24T00:00:00Z', mimeType: 'image/png', sizeBytes: 100 };
    env.wx.chooseMedia = jest.fn((options: any) => options.success({
      tempFiles: [{ tempFilePath: localFile, size: 100 }],
    }));
    env.wx.uploadFile = jest.fn((options: any) => options.success({
      statusCode: 200, data: JSON.stringify({ data: uploaded }),
    }));
    env.wx.previewImage = jest.fn();
    await page.onChooseImages(teacherTap(id));
    const draft = structuredClone(page.data.students[0]);
    page.onHide(); page.onShow();
    env.reply(1, { data: lesson }); await flush();
    expect(page.data.students[0]).toEqual(draft);
    page.onPreviewImages({ currentTarget: { dataset: { id, url: localFile } } });
    expect(env.wx.previewImage).toHaveBeenCalledWith(expect.objectContaining({
      current: localFile, urls: [localFile],
    }));
    const saving = page.onSaveFeedback(teacherTap(id)); await flush();
    expect(env.calls[2].data).toMatchObject({ imageFileIds: [uploaded.id] });
    expect(JSON.stringify(env.calls[2].data)).not.toContain('wxfile:');
    env.reply(2, { message: '保留草稿的合成失败' }, 503); await saving;
    page.onPreviewImages({ currentTarget: { dataset: { id, url: localFile } } });
    expect(env.wx.previewImage).toHaveBeenCalledTimes(2);
    page.onRemoveImage({ currentTarget: { dataset: { id, imageId: uploaded.id } } });
    expect(page.data.draftImageUrls).toEqual({});
    page.onPreviewImages({ currentTarget: { dataset: { id, url: localFile } } });
    expect(env.wx.previewImage).toHaveBeenCalledTimes(2);
  } finally { env.close(); }
});

it.each(['saved', 'readonly', 'owner', '403'])('clears a chosen draft file reference when %s', async (change) => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const lesson = { ...teacherLesson(), status: 'COMPLETED' };
    Object.assign(lesson.students[0], {
      canEditFeedback: true, feedback: '合成反馈', feedbackVersion: 1, feedbackImages: [],
    });
    const page = env.instantiate(); page.onLoad({ id: lesson.id }); page.onShow();
    env.reply(0, { data: lesson }); await flush();
    const id = lesson.students[0].id;
    const image = { id: 'unbound-image', accessUrl: 'https://media.synthetic.invalid/unbound',
      accessUrlExpiresAt: '2026-10-27T12:00:00Z', mimeType: 'image/png', sizeBytes: 100 };
    env.wx.chooseMedia = jest.fn((options: any) => options.success({
      tempFiles: [{ tempFilePath: 'wxfile://synthetic-draft.png', size: 100 }],
    }));
    env.wx.uploadFile = jest.fn((options: any) => options.success({
      statusCode: 200, data: JSON.stringify({ data: image }),
    }));
    env.wx.previewImage = jest.fn();
    await page.onChooseImages(teacherTap(id));
    expect(page.data.draftImageUrls[image.id]).toBe('wxfile://synthetic-draft.png');
    const another = env.instantiate();
    expect(another.data.draftImageUrls).toEqual({});
    if (change === 'saved') {
      const saving = page.onSaveFeedback(teacherTap(id)); await flush();
      env.reply(1, { data: {
        lessonSessionId: lesson.id, studentId: id, content: '合成反馈',
        images: [image], performanceRating: null, teacherRatings: null,
        version: 2, updatedAt: '2026-10-27T11:00:00Z',
      } }); await saving;
    } else if (change === 'owner') {
      env.change({ accessToken: 'synthetic-other-teacher' });
      page.onPreviewImages({ currentTarget: { dataset: { id, url: 'wxfile://synthetic-draft.png' } } });
      expect(env.wx.previewImage).not.toHaveBeenCalled();
    } else {
      page.onHide(); page.onShow();
      if (change === 'readonly') {
        lesson.students[0].canEditFeedback = false;
        env.reply(1, { data: lesson });
      } else env.reply(1, { message: '合成无权' }, 403);
      await flush();
    }
    expect(page.data.draftImageUrls).toEqual({});
    expect(another.data.draftImageUrls).toEqual({});
  } finally { env.close(); }
});

it('blocks image preview during a feedback save so its successful version remains available', async () => {
  const env = captureTeacherPage('feedback-detail');
  try {
    const lesson = { ...teacherLesson(), status: 'COMPLETED' };
    const image = { id: 'saved-image', accessUrl: 'https://media.synthetic.invalid/saved',
      accessUrlExpiresAt: '2026-10-27T12:00:00Z', mimeType: 'image/png', sizeBytes: 100 };
    Object.assign(lesson.students[0], {
      canEditFeedback: true, feedback: '已保存反馈', feedbackVersion: 1, feedbackImages: [image],
    });
    const page = env.instantiate(); page.onLoad({ id: lesson.id }); page.onShow();
    env.reply(0, { data: lesson }); await flush();
    const id = lesson.students[0].id;
    const preview = { currentTarget: { dataset: { id, url: image.accessUrl } } };
    env.wx.previewImage = jest.fn();
    page.onFeedbackInput({ ...teacherTap(id), detail: { value: '本次更新' } });
    const saving = page.onSaveFeedback(teacherTap(id)); await flush();
    page.onPreviewImages(preview);
    expect(env.wx.previewImage).not.toHaveBeenCalled();
    env.reply(1, { data: {
      lessonSessionId: lesson.id, studentId: id, content: '本次更新', images: [image],
      performanceRating: null, teacherRatings: null, version: 2, updatedAt: '2026-10-27T11:00:00Z',
    } });
    await saving;
    expect(page.data.students[0].feedbackVersion).toBe(2);
    page.onPreviewImages(preview);
    expect(env.wx.previewImage).toHaveBeenCalledTimes(1);
    const next = page.onSaveFeedback(teacherTap(id)); await flush();
    expect(env.calls[2].data).toMatchObject({ expectedVersion: 2 });
    env.reply(2, { message: '合成失败' }, 503); await next;
  } finally { env.close(); }
});
