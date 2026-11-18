export {};
const updatesPageLoad = jest.fn();
const updatesPageLogout = jest.fn();
const updatesPageReview = jest.fn();
const updatesPageUpload = jest.fn();
const updatesPagePhoto = jest.fn();
jest.mock('../services/parent-runtime', () => ({ parentService: {
  loadUpdates: () => updatesPageLoad(),
  submitLessonReview: (...args: unknown[]) => updatesPageReview(...args),
  uploadStudentPhoto: (...args: unknown[]) => updatesPageUpload(...args),
  replaceStudentPhoto: (...args: unknown[]) => updatesPagePhoto(...args),
} }));
jest.mock('../services/session.service', () => ({ sessionService: {
  logout: () => updatesPageLogout(),
} }));

describe('parent classroom update session boundary', () => {
  let page: any;
  const view = {
    student: { id: 'student', name: '陈晨', age: 9, profileVersion: 1, photo: null },
    records: [
      { lessonSessionId: 'lesson', studentId: 'student', courseName: '专业美术', campusName: '启明校区',
        teacherName: '林老师', startsAt: '2026-10-06T01:00:00Z', lessonStatus: 'COMPLETED',
        attendanceStatus: 'PRESENT', performanceRating: 9, feedback: '课堂认真', feedbackImages: [], canReview: true, review: null },
      { lessonSessionId: 'reversed', studentId: 'student', courseName: '创意书写', campusName: '启明校区',
        teacherName: '林老师', startsAt: '2026-10-05T01:00:00Z', lessonStatus: 'REVERSED',
        attendanceStatus: 'PRESENT', feedback: null, feedbackImages: [], canReview: false, review: null },
    ],
  };
  const rate = (field: string, score: number) => ({ currentTarget: { dataset: { field, score } } });
  beforeEach(() => {
    jest.useFakeTimers();
    updatesPageLoad.mockReset().mockResolvedValue({ status: 'success', data: view });
    updatesPageLogout.mockReset();
    updatesPageReview.mockReset();
    updatesPageUpload.mockReset();
    updatesPagePhoto.mockReset();
    (global as any).wx = { reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(), showToast: jest.fn(), previewImage: jest.fn(), showActionSheet: jest.fn(),
      getWindowInfo: jest.fn(() => ({ windowWidth: 375, windowHeight: 812, screenHeight: 812,
        statusBarHeight: 47, safeArea: { bottom: 778 } })),
      getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 50, bottom: 82, height: 32 })),
      chooseMedia: jest.fn((options: any) => options.success({ tempFiles: [{ tempFilePath: 'temp-photo', size: 100 }] })),
    };
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (patch: unknown) => Object.assign(page.data, patch);
    };
    jest.isolateModules(() => require('../pages/parent/updates/index'));
  });
  afterEach(() => {
    page.onUnload?.();
    jest.useRealTimers();
    delete (global as any).wx;
    delete (global as any).Page;
  });
  it('initializes the lifecycle without locking page length to window or capsule geometry', () => {
    page._visible = false;
    page._unloaded = true;
    page.onLoad();
    expect(page._visible).toBe(true);
    expect(page._unloaded).toBe(false);
    expect(page.data).not.toHaveProperty('contentHeight');
    expect((global as any).wx.getWindowInfo).not.toHaveBeenCalled();
    expect((global as any).wx.getMenuButtonBoundingClientRect).not.toHaveBeenCalled();
    expect(updatesPageLoad).not.toHaveBeenCalled();
  });
  it('preserves a 500-character multiline draft across refresh and history changes', async () => {
    page.onLoad();
    await page.loadUpdates();
    const note = '课堂反馈\n'.repeat(100);
    expect(note).toHaveLength(500);
    page.onReviewNote({ detail: { value: note } });
    await page.loadUpdates(true);
    page.onLessonChange({ detail: { value: '1' } });
    page.onLessonChange({ detail: { value: '0' } });
    expect(page.data.reviewDraft.note).toBe(note);
    expect(page.data).not.toHaveProperty('contentHeight');
    expect(updatesPageLoad).toHaveBeenCalledTimes(2);
  });
  it('uses the rounded source 95rpx name while retaining the existing long-name calculation', async () => {
    await page.loadUpdates();
    expect(page.data.nameFontSize).toBe(95);
    updatesPageLoad.mockResolvedValue({
      status: 'success',
      data: { ...view, student: { ...view.student, name: '陈晨同学超长姓名展示测试' } },
    });
    await page.loadUpdates();
    expect(page.data.nameFontSize).toBe(36);
  });
  it('loads the PDF identity and keeps half-star drafts when refreshed or navigating history', async () => {
    await page.loadUpdates();
    expect(page.data.student).toMatchObject({ name: '陈晨', age: 9 });
    page.onRate(rate('teaching', 9));
    page.onReviewNote({ detail: { value: '进步明显' } });
    await page.loadUpdates(true);
    expect(page.data.reviewDraft).toMatchObject({ teaching: 9, note: '进步明显' });
    page.onLessonChange({ detail: { value: '1' } });
    page.onRate(rate('teaching', 1));
    expect(page.data.current.canReview).toBe(false);
    page.onLessonChange({ detail: { value: '0' } });
    expect(page.data.reviewDraft.teaching).toBe(9);
  });
  it('keeps teacher four scores read-only and independent from the family draft', async () => {
    const teacherRatings = { classroomPerformance: 0, workCompletion: 7, communication: null, overall: 10 };
    updatesPageLoad.mockResolvedValue({ status: 'success', data: {
      ...view, records: [{ ...view.records[0], teacherRatings, feedbackAuthorName: '原反馈教师', feedbackVersion: 3 }],
    } });
    await page.loadUpdates();
    expect(page.data.current.teacherRatingRows.map((row: any) => row.ratingLabel))
      .toEqual(['0 星', '3.5 星', '未评分', '5 星']);
    expect(page.data.current.feedbackAuthorName).toBe('原反馈教师');
    page.onRate(rate('overall', 3));
    expect(page.data.reviewDraft.overall).toBe(3);
    expect(page.data.current.teacherRatingRows[3].ratingLabel).toBe('5 星');
    expect(updatesPageReview).not.toHaveBeenCalled();
  });
  it('requires all four scores, retries with the same key, and makes successful reviews read-only', async () => {
    await page.loadUpdates();
    await page.onSubmitReview();
    expect(updatesPageReview).not.toHaveBeenCalled();
    for (const field of ['teaching', 'communication', 'environment', 'overall']) page.onRate(rate(field, 9));
    updatesPageReview.mockResolvedValue({ status: 'error', statusCode: 503, message: '稍后重试' });
    await page.onSubmitReview();
    await page.onSubmitReview();
    expect(updatesPageReview.mock.calls[0][3]).toBe(updatesPageReview.mock.calls[1][3]);
    const review = { teaching: 9, communication: 9, environment: 9, overall: 9, note: '',
      id: 'review', lessonSessionId: 'lesson', studentId: 'student', createdAt: '2026-10-06T01:00:00Z', valid: true };
    updatesPageReview.mockResolvedValue({ status: 'success', data: review });
    await page.onSubmitReview();
    expect(page.data.current).toMatchObject({ canReview: false, review });
    page.onRate(rate('teaching', 1));
    await page.onSubmitReview();
    expect(updatesPageReview).toHaveBeenCalledTimes(3);
    expect(page.data.reviewDraft.teaching).toBe(9);
  });
  it('ignores late reads after hiding and stops foreground polling', async () => {
    await page.loadUpdates();
    page.onShow();
    await jest.advanceTimersByTimeAsync(0);
    const before = updatesPageLoad.mock.calls.length;
    await jest.advanceTimersByTimeAsync(30000);
    expect(updatesPageLoad.mock.calls.length).toBe(before + 1);
    let resolve!: (value: unknown) => void;
    updatesPageLoad.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = page.loadUpdates(true);
    page.onHide();
    resolve({ status: 'success', data: { ...view, student: { ...view.student, name: '迟到响应' } } });
    await pending;
    expect(page.data.student.name).toBe('陈晨');
    const calls = updatesPageLoad.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60000);
    expect(updatesPageLoad).toHaveBeenCalledTimes(calls);
  });
  it('retains a staged photo after a failed replacement and retries without uploading again', async () => {
    await page.loadUpdates();
    updatesPageUpload.mockResolvedValue({ status: 'success', data: { id: 'file', mimeType: 'image/png', sizeBytes: 100 } });
    updatesPagePhoto.mockResolvedValue({ status: 'error', statusCode: 503, message: '稍后重试' });
    await page.onChoosePhoto();
    await page.onRetryPhoto();
    expect(updatesPageUpload).toHaveBeenCalledTimes(1);
    expect(updatesPagePhoto.mock.calls[0][2]).toBe(updatesPagePhoto.mock.calls[1][2]);
    updatesPagePhoto.mockResolvedValue({ status: 'success', data: { ...view.student, profileVersion: 2,
      photo: { id: 'file', accessUrl: 'https://example.test/photo' } } });
    await page.onRetryPhoto();
    expect(page.data.student.profileVersion).toBe(2);
    expect(page.data.pendingPhoto).toBeNull();
  });
  it('does not upload oversized photos or duplicates while busy', async () => {
    await page.loadUpdates();
    (global as any).wx.chooseMedia.mockImplementation((options: any) =>
      options.success({ tempFiles: [{ tempFilePath: 'big-photo', size: 3145729 }] }));
    await page.onChoosePhoto();
    expect(updatesPageUpload).not.toHaveBeenCalled();
    expect(page.data.mutationMessage).toContain('3');
    page.setData({ reviewSubmitting: true });
    await page.onChoosePhoto();
    expect(updatesPageUpload).not.toHaveBeenCalled();
  });
  it('offers photo replacement on long press without uploading before a choice', async () => {
    await page.loadUpdates();
    const choose = jest.spyOn(page, 'onChoosePhoto').mockResolvedValue(undefined);
    page.onPhotoLongPress();
    const sheet = (global as any).wx.showActionSheet.mock.calls[0][0];
    expect(sheet.itemList).toEqual(['更换学员照片']);
    expect(choose).not.toHaveBeenCalled();
    sheet.success({ tapIndex: 0 });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(updatesPageUpload).not.toHaveBeenCalled();
  });
  it('ignores photo menus while busy and does nothing without a choice or after unload', async () => {
    await page.loadUpdates();
    const choose = jest.spyOn(page, 'onChoosePhoto').mockResolvedValue(undefined);
    page.setData({ photoBusy: true });
    page.onPhotoLongPress();
    expect((global as any).wx.showActionSheet).not.toHaveBeenCalled();
    page.setData({ photoBusy: false, reviewSubmitting: true });
    page.onPhotoLongPress();
    expect((global as any).wx.showActionSheet).not.toHaveBeenCalled();
    page.setData({ reviewSubmitting: false });
    page.onPhotoLongPress();
    expect(choose).not.toHaveBeenCalled();
    const sheet = (global as any).wx.showActionSheet.mock.calls[0][0];
    sheet.success({ tapIndex: -1 });
    expect(choose).not.toHaveBeenCalled();
    page.onUnload();
    sheet.success({ tapIndex: 0 });
    expect(choose).not.toHaveBeenCalled();
  });
  it('locks photo selection and review drafts until selection is canceled', async () => {
    await page.loadUpdates();
    let selection: any;
    (global as any).wx.chooseMedia.mockImplementation((options: any) => { selection = options; });
    const pending = page.onChoosePhoto();
    expect(page.data.photoBusy).toBe(true);
    await page.onChoosePhoto();
    page.onRate(rate('teaching', 9));
    page.onReviewNote({ detail: { value: '不能在选择期间改动' } });
    expect((global as any).wx.chooseMedia).toHaveBeenCalledTimes(1);
    expect(page.data.reviewDraft).toMatchObject({ teaching: 0, note: '' });
    selection.fail({ errMsg: 'chooseMedia:fail cancel' });
    await pending;
    expect(page.data.photoBusy).toBe(false);
    expect(page.data.mutationMessage).toBe('');
  });
  it('clears expired sessions and old records before returning to the login page', async () => {
    page.setData({ records: [{ lessonSessionId: 'old' }], isEmpty: false });
    updatesPageLoad.mockResolvedValue({
      status: 'error', statusCode: 401, message: '登录已失效',
    });
    await page.loadUpdates();
    expect(updatesPageLogout).toHaveBeenCalledTimes(1);
    expect(page.data.records).toEqual([]);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
});
