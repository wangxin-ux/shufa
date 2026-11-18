const loadHomeSummary = jest.fn();
const logout = jest.fn();
const fontInputs = require('../../docs/verification/fixtures/parent-home-font-input.json')[0];
jest.mock('../services/session.service', () => ({
  sessionService: { logout: () => logout() },
}));
jest.mock('../services/parent-runtime', () => ({
  parentService: { loadHomeSummary: () => loadHomeSummary() },
}));

interface HomePage {
  data: Record<string, any>;
  disposed: boolean;
  setData(values: Record<string, unknown>): void;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  loadHome(silent?: boolean): Promise<void>;
  onRetry(): void;
  onQuickAction(event: unknown): void;
  onRemindTap(): void;
}

describe('parent home foreground refresh and quick menu', () => {
  let page: HomePage;
  const summary = {
    student: { id: 'student', name: '陈晨', age: 9 },
    nextLesson: null,
    remainingHoursLabel: '11',
    attendanceRateLabel: '--',
    teachers: [{ id: 'teacher', name: '林老师', specialties: ['书法'] }],
    reminders: [],
  };

  beforeEach(() => {
    jest.useFakeTimers();
    loadHomeSummary.mockReset().mockResolvedValue({ status: 'empty', data: summary });
    logout.mockReset();
    (global as any).wx = { showToast: jest.fn(), navigateTo: jest.fn(), reLaunch: jest.fn(), redirectTo: jest.fn() };
    (global as any).Page = (config: HomePage) => {
      page = { ...config, data: { ...config.data } };
      page.setData = (values) => Object.assign(page.data, values);
    };
    jest.isolateModules(() => require('../pages/parent/home/index'));
  });

  afterEach(() => {
    page.onUnload?.();
    jest.useRealTimers();
    delete (global as any).Page;
    delete (global as any).wx;
  });

  async function flush() {
    for (let count = 0; count < 6; count += 1) await Promise.resolve();
  }

  it('keeps metrics and navigation ready without a recent lesson', async () => {
    await page.loadHome();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.course).toBeNull();
    expect(page.data.metrics[0].value).toBe('11');
    expect(page.data.teachers).toMatchObject(summary.teachers);
    expect(page.data.teachers[0].specialtyLabel).toBe('书法');
  });

  it.each(Object.entries(fontInputs))('presents the raw font-boundary summary %s without truncating model facts', async (name, raw: any) => {
    loadHomeSummary.mockResolvedValue({ status: raw.nextLesson ? 'success' : 'empty', data: raw });
    await page.loadHome();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.student).toEqual(raw.student);
    expect(page.data.hasTeachers).toBe(raw.teachers.length > 0);
    expect(page.data.hasReminders).toBe(raw.reminders.length > 0);
    expect(page.data.metrics[0]).toMatchObject({ value: raw.remainingHoursLabel, unit: '节' });
    if (raw.nextLesson) {
      expect(page.data.course).toMatchObject({
        name: raw.nextLesson.courseName, campus: raw.nextLesson.campusName,
        teacher: raw.nextLesson.teacherName, time: raw.nextLesson.timeLabel,
      });
      expect(page.data.metrics[2]).toMatchObject({ value: '100', unit: '%' });
      if (name === 'single-date') {
        expect(page.data.course).toMatchObject({ day: '7', weekday: 'Wednesday' });
        expect(page.data.metrics[1]).toMatchObject({ value: '周三', unit: '14:00' });
      }
    } else {
      expect(page.data.course).toBeNull();
      expect(page.data.metrics[1]).toMatchObject({ value: '--', unit: '' });
      expect(page.data.metrics[2]).toMatchObject({ value: '--', unit: '' });
    }
    expect((global as any).wx.redirectTo).not.toHaveBeenCalled();
    expect(page.data.quickActions).toHaveLength(3);
  });

  it.each([
    ['one Chinese character', '书', true],
    ['the four-character source course', '硬笔书法', true],
    ['the five-character restored course', '专业美术B', false],
    ['eleven Chinese characters', '书'.repeat(11), false],
    ['twelve Chinese characters', '书'.repeat(12), false],
    ['four supplementary Unicode characters', '\u{1f680}'.repeat(4), true],
    ['five supplementary Unicode characters', '\u{1f680}'.repeat(5), false],
    ['empty course name', '', false],
  ])('selects source-standard short typography for %s without changing course facts', async (_label, name, short) => {
    const raw = {
      ...summary,
      nextLesson: { ...fontInputs['source-standard'].nextLesson, courseName: name },
    };
    loadHomeSummary.mockResolvedValue({ status: 'success', data: raw });
    await page.loadHome();
    expect(page.data.hasShortCourseName).toBe(short);
    expect(page.data.hasLongCourseName).toBe(Array.from(name).length >= 12);
    expect(page.data.course.name).toBe(name);
  });

  it('updates short typography atomically across short, medium, long and empty summaries', async () => {
    expect(page.data.hasShortCourseName).toBe(false);
    for (const [name, short] of [
      ['硬笔书法', true], ['专业美术B', false],
      [fontInputs['long-content'].nextLesson.courseName, false], ['硬笔书法', true],
    ] as const) {
      loadHomeSummary.mockResolvedValue({
        status: 'success',
        data: { ...summary, nextLesson: { ...fontInputs['source-standard'].nextLesson, courseName: name } },
      });
      const update = jest.spyOn(page, 'setData');
      update.mockClear();
      await page.loadHome(true);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        course: expect.objectContaining({ name }), hasShortCourseName: short,
      }));
      expect(page.data.hasShortCourseName).toBe(short);
    }
    loadHomeSummary.mockResolvedValue({ status: 'empty', data: summary });
    await page.loadHome(true);
    expect(page.data.hasShortCourseName).toBe(false);
    expect(page.data.hasLongCourseName).toBe(false);
    expect(page.data.course).toBeNull();
  });

  it('preserves short typography with its ready course when a silent refresh fails', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['source-standard'] });
    await page.loadHome();
    loadHomeSummary.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    expect(page.data.hasShortCourseName).toBe(true);
    expect(page.data.hasLongCourseName).toBe(false);
    expect(page.data.course.name).toBe('硬笔书法');
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshError).toBe('网络请求失败');
  });

  it.each([
    ['eleven Chinese characters', '书'.repeat(11), false],
    ['twelve Chinese characters', '书'.repeat(12), true],
    ['the sixteen-character course', fontInputs['long-content'].nextLesson.courseName, true],
    ['six supplementary Unicode characters', '\u{1f680}'.repeat(6), false],
  ])('selects compact course typography for %s without replacing the full name', async (_label, name, compact) => {
    const raw = {
      ...summary,
      nextLesson: { ...fontInputs['source-standard'].nextLesson, courseName: name },
    };
    loadHomeSummary.mockResolvedValue({ status: 'success', data: raw });
    await page.loadHome();
    expect(page.data.hasLongCourseName).toBe(compact);
    expect(page.data.course.name).toBe(name);
  });

  it('clears compact course typography when a short course or no course replaces a long one', async () => {
    expect(page.data.hasLongCourseName).toBe(false);
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['long-content'] });
    await page.loadHome();
    expect(page.data.hasLongCourseName).toBe(true);
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['source-standard'] });
    await page.loadHome(true);
    expect(page.data.hasLongCourseName).toBe(false);
    expect(page.data.courseNamePrefix).toBe('');
    expect(page.data.courseNameTail).toBe('');
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['long-content'] });
    await page.loadHome(true);
    loadHomeSummary.mockResolvedValue({ status: 'empty', data: summary });
    await page.loadHome(true);
    expect(page.data.hasLongCourseName).toBe(false);
    expect(page.data.course).toBeNull();
    expect(page.data.courseNamePrefix).toBe('');
    expect(page.data.courseNameTail).toBe('');
  });

  it.each([13, 16, 19])('preserves all %i course-name characters while grouping the final pair', async (length) => {
    const name = '专业美术综合教学'.repeat(3).slice(0, length);
    loadHomeSummary.mockResolvedValue({
      status: 'success',
      data: {
        ...summary,
        nextLesson: { ...fontInputs['source-standard'].nextLesson, courseName: name },
      },
    });
    await page.loadHome();
    expect(page.data.courseNameTail).toBe(name.slice(-2));
    expect(page.data.courseNamePrefix + page.data.courseNameTail).toBe(name);
    expect(page.data.course.name).toBe(name);
  });

  it.each(['专业美术书法', '专业美术综合教学书法课', '\u{1f680}'.repeat(6)])(
    'protects the final pair of medium-length %s without selecting the compact font',
    async (name) => {
      loadHomeSummary.mockResolvedValue({
        status: 'success',
        data: { ...summary, nextLesson: { ...fontInputs['source-standard'].nextLesson, courseName: name } },
      });
      await page.loadHome();
      expect(page.data.hasShortCourseName).toBe(false);
      expect(page.data.hasLongCourseName).toBe(false);
      expect(page.data.courseNamePrefix).toBe(Array.from(name).slice(0, -2).join(''));
      expect(page.data.courseNameTail).toBe(Array.from(name).slice(-2).join(''));
      expect(page.data.course.name).toBe(name);
    },
  );

  it('clears protected medium-course fields when a five-character course or no course replaces it', async () => {
    const medium = { ...summary, nextLesson: {
      ...fontInputs['source-standard'].nextLesson, courseName: '专业美术综合教学书法课',
    } };
    loadHomeSummary.mockResolvedValue({ status: 'success', data: medium });
    await page.loadHome();
    expect(page.data.courseNameTail).toBe('法课');
    loadHomeSummary.mockResolvedValue({ status: 'success', data: {
      ...medium, nextLesson: { ...medium.nextLesson, courseName: '专业美术B' },
    } });
    await page.loadHome(true);
    expect(page.data.courseNamePrefix).toBe('');
    expect(page.data.courseNameTail).toBe('');
    loadHomeSummary.mockResolvedValue({ status: 'success', data: medium });
    await page.loadHome(true);
    loadHomeSummary.mockResolvedValue({ status: 'empty', data: summary });
    await page.loadHome(true);
    expect(page.data.course).toBeNull();
    expect(page.data.courseNamePrefix).toBe('');
    expect(page.data.courseNameTail).toBe('');
  });

  it('preserves the protected medium name on a silent failure without changing its font category', async () => {
    const name = '专业美术综合教学书法课';
    loadHomeSummary.mockResolvedValue({ status: 'success', data: {
      ...summary, nextLesson: { ...fontInputs['source-standard'].nextLesson, courseName: name },
    } });
    await page.loadHome();
    loadHomeSummary.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    expect(page.data.courseNameTail).toBe('法课');
    expect(page.data.courseNamePrefix + page.data.courseNameTail).toBe(name);
    expect(page.data.hasShortCourseName).toBe(false);
    expect(page.data.hasLongCourseName).toBe(false);
    expect(page.data.viewState).toBe('ready');
  });

  it('preserves long course typography with its content when a silent refresh fails', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['long-content'] });
    await page.loadHome();
    loadHomeSummary.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    expect(page.data.hasLongCourseName).toBe(true);
    expect(page.data.course.name).toBe(fontInputs['long-content'].nextLesson.courseName);
    expect(page.data.viewState).toBe('ready');
  });

  it.each([
    ['three-character name', '林小禾', 64],
    ['seven-character name', '禾'.repeat(7), 64],
    ['eight-character name', '禾'.repeat(8), 60],
    ['nine-character name', fontInputs['long-content'].student.name, 53],
    ['sixteen-character name', '禾'.repeat(16), 30],
    ['extreme name', '禾'.repeat(100), 24],
    ['empty name', '', 64],
    ['six supplementary characters', '\u{1f680}'.repeat(6), 64],
  ])('uses a page-local readable name size for %s without changing the student', async (_label, name, size) => {
    const student = { ...summary.student, name };
    loadHomeSummary.mockResolvedValue({ status: 'empty', data: { ...summary, student } });
    await page.loadHome();
    expect(page.data.studentNameFontSize).toBe(size);
    expect(page.data.student).toEqual(student);
    expect(page.data.course).toBeNull();
  });

  it.each([
    ['fourteen-character campus', '区'.repeat(14), false],
    ['fifteen-character campus', '区'.repeat(15), true],
    ['sixteen-character campus', '区'.repeat(16), true],
    ['the recorded long campus', fontInputs['long-content'].nextLesson.campusName, true],
    ['fourteen supplementary characters', '\u{1f680}'.repeat(14), false],
    ['fifteen supplementary characters', '\u{1f680}'.repeat(15), true],
  ])('groups the final campus pair for %s without changing its full name', async (_label, campus, long) => {
    loadHomeSummary.mockResolvedValue({
      status: 'success',
      data: {
        ...summary,
        nextLesson: { ...fontInputs['source-standard'].nextLesson, campusName: campus },
      },
    });
    await page.loadHome();
    expect(page.data.hasLongCampusName).toBe(long);
    expect(page.data.course.campus).toBe(campus);
    expect(page.data.campusNamePrefix).toBe(long ? Array.from(campus).slice(0, -2).join('') : '');
    expect(page.data.campusNameTail).toBe(long ? Array.from(campus).slice(-2).join('') : '');
  });

  it('resets fifteen-character campus grouping when fourteen-character or empty content replaces it', async () => {
    for (const length of [15, 14]) {
      const campus = '区'.repeat(length);
      loadHomeSummary.mockResolvedValue({
        status: 'success',
        data: { ...summary, nextLesson: { ...fontInputs['source-standard'].nextLesson, campusName: campus } },
      });
      await page.loadHome(true);
      expect(page.data.hasLongCampusName).toBe(length === 15);
      expect(page.data.campusNamePrefix).toBe(length === 15 ? campus.slice(0, -2) : '');
      expect(page.data.campusNameTail).toBe(length === 15 ? '区区' : '');
      expect(page.data.course.campus).toBe(campus);
    }
    loadHomeSummary.mockResolvedValue({ status: 'empty', data: fontInputs['no-course'] });
    await page.loadHome(true);
    expect(page.data.course).toBeNull();
    expect(page.data.hasLongCampusName).toBe(false);
    expect(page.data.campusNamePrefix).toBe('');
    expect(page.data.campusNameTail).toBe('');
  });

  it('keeps the fifteen-character campus and its protected pair after a silent refresh error', async () => {
    const campus = '区'.repeat(15);
    loadHomeSummary.mockResolvedValue({
      status: 'success',
      data: { ...summary, nextLesson: { ...fontInputs['source-standard'].nextLesson, campusName: campus } },
    });
    await page.loadHome();
    loadHomeSummary.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    expect(page.data.course.campus).toBe(campus);
    expect(page.data.hasLongCampusName).toBe(true);
    expect(page.data.campusNamePrefix + page.data.campusNameTail).toBe(campus);
    expect(page.data.campusNameTail).toBe('区区');
  });

  it('resets name sizing and campus tail fields when ordinary content replaces long content', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['long-content'] });
    await page.loadHome();
    expect(page.data.studentNameFontSize).toBe(53);
    expect(page.data.hasLongCampusName).toBe(true);
    expect(page.data.campusNameTail).toBe('校区');
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['source-standard'] });
    await page.loadHome(true);
    expect(page.data.studentNameFontSize).toBe(64);
    expect(page.data.hasLongCampusName).toBe(false);
    expect(page.data.campusNamePrefix).toBe('');
    expect(page.data.campusNameTail).toBe('');
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['long-content'] });
    await page.loadHome(true);
    loadHomeSummary.mockResolvedValue({ status: 'empty', data: fontInputs['no-course'] });
    await page.loadHome(true);
    expect(page.data.course).toBeNull();
    expect(page.data.studentNameFontSize).toBe(64);
    expect(page.data.hasLongCampusName).toBe(false);
    expect(page.data.campusNamePrefix).toBe('');
    expect(page.data.campusNameTail).toBe('');
  });

  it('keeps the long identity display atomic when a silent refresh fails', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: fontInputs['long-content'] });
    await page.loadHome();
    loadHomeSummary.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    expect(page.data.student).toEqual(fontInputs['long-content'].student);
    expect(page.data.studentNameFontSize).toBe(53);
    expect(page.data.course.campus).toBe(fontInputs['long-content'].nextLesson.campusName);
    expect(page.data.hasLongCampusName).toBe(true);
    expect(page.data.campusNamePrefix + page.data.campusNameTail).toBe(page.data.course.campus);
  });

  it('routes an incomplete bound profile to first-time setup and stops polling', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'empty', data: { ...summary, profileSetupRequired: true } });
    page.onShow();
    await flush();
    expect((global as any).wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/parent/profile-setup/index' }));
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(loadHomeSummary).toHaveBeenCalledTimes(1);
  });

  it('handles the setup gate in a direct load before presenting metrics or starting a timer', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: { ...summary, profileSetupRequired: true } });
    await page.loadHome();
    expect((global as any).wx.redirectTo).toHaveBeenCalledTimes(1);
    expect(page.data.metrics).toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops an existing timer when a foreground refresh requires setup', async () => {
    page.onShow();
    await flush();
    expect(jest.getTimerCount()).toBe(1);
    loadHomeSummary.mockResolvedValue({ status: 'success', data: { ...summary, profileSetupRequired: true } });
    await jest.advanceTimersByTimeAsync(30000);
    expect((global as any).wx.redirectTo).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(loadHomeSummary).toHaveBeenCalledTimes(2);
  });

  it('recovers a failed setup navigation as a retryable error without restarting polling', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: { ...summary, profileSetupRequired: true } });
    (global as any).wx.redirectTo.mockImplementationOnce((options: any) => options.fail?.({ errMsg: 'redirectTo:fail' }));
    page.onShow();
    await flush();
    expect(page.disposed).toBe(false);
    expect(page.data.viewState).toBe('error');
    expect(page.data.errorMessage).toContain('重试');
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(loadHomeSummary).toHaveBeenCalledTimes(1);
    page.onRetry();
    await flush();
    expect((global as any).wx.redirectTo).toHaveBeenCalledTimes(2);
    expect(loadHomeSummary).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ignores a setup navigation failure delivered after actual unload', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: { ...summary, profileSetupRequired: true } });
    let navigation: any;
    (global as any).wx.redirectTo.mockImplementation((options: any) => { navigation = options; });
    await page.loadHome();
    expect(typeof navigation.fail).toBe('function');
    page.onUnload();
    const update = jest.spyOn(page, 'setData');
    update.mockClear();
    navigation.fail({ errMsg: 'redirectTo:fail' });
    await page.loadHome();
    expect(update).not.toHaveBeenCalled();
    expect(page.disposed).toBe(true);
    expect(loadHomeSummary).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('can retry on show after a navigation failure while hidden', async () => {
    loadHomeSummary.mockResolvedValue({ status: 'success', data: { ...summary, profileSetupRequired: true } });
    let navigation: any;
    (global as any).wx.redirectTo.mockImplementation((options: any) => { navigation = options; });
    page.onShow();
    await flush();
    expect(typeof navigation.fail).toBe('function');
    page.onHide();
    navigation.fail({ errMsg: 'redirectTo:fail' });
    page.onShow();
    await flush();
    expect((global as any).wx.redirectTo).toHaveBeenCalledTimes(2);
    expect(loadHomeSummary).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['hide', 'unload'])('does not navigate or start polling for a late setup response after %s', async (lifecycle) => {
    let resolve!: (value: unknown) => void;
    loadHomeSummary.mockImplementation(() => new Promise((done) => { resolve = done; }));
    page.onShow();
    expect(jest.getTimerCount()).toBe(0);
    if (lifecycle === 'hide') page.onHide();
    else page.onUnload();
    const update = jest.spyOn(page, 'setData');
    update.mockClear();
    resolve({ status: 'success', data: { ...summary, profileSetupRequired: true } });
    await flush();
    expect(update).not.toHaveBeenCalled();
    expect((global as any).wx.redirectTo).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('refreshes on show and every 30 seconds, stopping while hidden and unloaded', async () => {
    page.onShow();
    await flush();
    expect(loadHomeSummary).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30000);
    await flush();
    expect(loadHomeSummary).toHaveBeenCalledTimes(2);
    page.onHide();
    jest.advanceTimersByTime(60000);
    expect(loadHomeSummary).toHaveBeenCalledTimes(2);
    page.onShow();
    await flush();
    expect(loadHomeSummary).toHaveBeenCalledTimes(3);
    page.onUnload();
    jest.advanceTimersByTime(30000);
    expect(loadHomeSummary).toHaveBeenCalledTimes(3);
  });

  it('preserves ready content on background failure and exposes a refresh error', async () => {
    await page.loadHome();
    loadHomeSummary.mockResolvedValue({ status: 'error', message: '网络请求失败' });
    await page.loadHome(true);
    expect(page.data.viewState).toBe('ready');
    expect(page.data.metrics[0].value).toBe('11');
    expect(page.data.refreshError).toBe('网络请求失败');
  });

  it('returns an expired session to the usable login entry even during background refresh', async () => {
    await page.loadHome();
    loadHomeSummary.mockResolvedValue({
      status: 'error', message: '登录已失效，请重新登录', statusCode: 401, code: 'UNAUTHORIZED',
    });
    await page.loadHome(true);
    expect(logout).toHaveBeenCalledTimes(1);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });

  it('expands the menu, then opens read-only reminders and teachers', async () => {
    await page.loadHome();
    expect(page.data.menuExpanded).toBe(false);
    page.onRemindTap();
    expect(page.data.menuExpanded).toBe(true);
    expect(page.data.activeSheet).toBe('');
    page.onRemindTap();
    expect(page.data.activeSheet).toBe('reminders');
    page.onQuickAction({ currentTarget: { dataset: { key: 'team' } } });
    expect(page.data.activeSheet).toBe('teachers');
  });
});
