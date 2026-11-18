import {
  captureTeacherPage, flushTeacherPage, teacherListing, teacherLesson, teacherTap,
} from './teacher-page-test-support';

const summary = (patch: object = {}) => ({
  expectedCount: 3, leaveCount: 2, warningCount: 2, thresholdUnits: 250,
  asOf: '2026-10-29T03:02:15Z', source: 'CURRENT', ...patch,
});
const session = (patch: object = {}) => ({
  ...teacherLesson(), studentCount: 1, rosterSummary: summary(), ...patch,
});
const listing = (lessons = [session()], page = 1, totalPages = 1) => ({
  ...teacherListing(page, [], totalPages), data: lessons,
});
const dashboard = (lesson: unknown = session()) => ({
  teacher: { displayName: '合成教师', subjectLabel: '美术', campusName: '合成校区' },
  nextLesson: lesson, todayPendingCount: 1, todayCompletedCount: 0,
  responsibleStudentCount: 3, serverTime: '2026-10-29T03:02:15Z',
});
const denied = { code: 'FORBIDDEN', message: 'synthetic denied' };
const failure = { code: 'UNAVAILABLE', message: 'synthetic failed' };
const routeResponse = (route: 'home' | 'schedule') =>
  route === 'home' ? { data: dashboard() } : listing();
const privateValue = (page: any, route: 'home' | 'schedule') =>
  route === 'home' ? page.data.nextLesson : page.data.items[0];

describe.each(['home', 'schedule'] as const)('%s actual Page/Context/Service/API', route => {
  let env: ReturnType<typeof captureTeacherPage>;
  afterEach(() => env?.close());
  const start = async () => {
    env = captureTeacherPage(route, { autoClock: false });
    const page = env.instantiate();
    page.onLoad(); page.onShow?.();
    await flushTeacherPage();
    expect(env.calls).toHaveLength(1);
    return page;
  };
  const readSummary = (page: any) =>
    route === 'home' ? page.data.rosterSummary : page.data.items[0]?.rosterSummary;
  const reply = async (page: any, lesson = session()) => {
    env.reply(env.calls.length - 1,
      route === 'home' ? { data: dashboard(lesson) } : listing([lesson]));
    await flushTeacherPage();
    return readSummary(page);
  };

  it('uses server summary; leave/warning overlap is valid and never counts first-page rows', async () => {
    const page = await start(), model = await reply(page);
    expect(model).toMatchObject({
      known: true, expectedLabel: '应到 3 人', leaveLabel: '请假 2 人',
      warningLabel: '当前预警 2 人', sourceLabel: '当前在班名单',
      thresholdLabel: '预警阈值 2.5 节',
    });
    expect(model.asOfLabel).toContain('2026-10-29 11:02');
    expect(model.asOfLabel).toContain('北京时间');
  });

  it('keeps all genuine zeros as known', async () => {
    const page = await start();
    const model = await reply(page, session({
      rosterSummary: summary({ expectedCount: 0, leaveCount: 0, warningCount: 0, thresholdUnits: 0 }),
    }));
    expect(model).toMatchObject({ known: true, expectedLabel: '应到 0 人',
      leaveLabel: '请假 0 人', warningLabel: '当前预警 0 人' });
    if (route === 'home') expect(page.data.nextLesson.statusPrefix).toBe('');
  });

  it('shows historical attendance 3 with current warning and calculation time', async () => {
    const page = await start();
    const model = await reply(page, session({
      status: 'COMPLETED', rosterSummary: summary({ source: 'HISTORICAL_ATTENDANCE' }),
    }));
    expect(model).toMatchObject({ known: true, expectedLabel: '应到 3 人',
      sourceLabel: '历史点名名单', warningLabel: '当前预警 2 人' });
    expect(model.asOfLabel).toContain('2026-10-29 11:02');
  });

  it.each([
    undefined, null, {}, summary({ expectedCount: -1 }), summary({ leaveCount: 4 }),
    summary({ warningCount: 4 }), summary({ expectedCount: 1.5 }),
    summary({ warningCount: '0' }), summary({ thresholdUnits: Number.MAX_SAFE_INTEGER + 1 }),
    summary({ asOf: '2026-02-30T03:02:15Z' }), summary({ asOf: '2026-10-29 03:02' }),
    summary({ source: 'UNKNOWN' }), summary({ source: 'HISTORICAL_ATTENDANCE' }),
  ])('does not invent counts for invalid/missing summary %#', async value => {
    const page = await start(), model = await reply(page, session({ rosterSummary: value }));
    expect(model).toMatchObject({ known: false, expectedLabel: '应到待核对',
      leaveLabel: '请假待核对', warningLabel: '当前预警待核对' });
    if (route === 'home') expect(page.data.nextLesson.statusPrefix).toBe('');
    else expect(page.data.items[0].studentCountLabel).toBe('应到待核对');
  });

  it('retains usable content on return read failure, then retry replaces it', async () => {
    const page = await start();
    await reply(page);
    page.onHide?.(); page.onShow?.(); await flushTeacherPage();
    expect(env.calls).toHaveLength(2);
    env.reply(1, failure, 503); await flushTeacherPage();
    expect(page.data.viewState).toBe('ready');
    expect(page.data.refreshError).toBeTruthy();
    expect(readSummary(page).expectedLabel).toBe('应到 3 人');
    page.onRetry(); await flushTeacherPage();
    await reply(page, session({ rosterSummary: summary({ expectedCount: 4 }) }));
    expect(readSummary(page).expectedLabel).toBe('应到 4 人');
    expect(page.data.refreshError).toBe('');
  });

  it.each([401, 403])('clears private content and stops navigation after %i', async code => {
    const page = await start(); await reply(page);
    page.onRetry(); await flushTeacherPage();
    env.reply(1, denied, code); await flushTeacherPage();
    expect(page.data.viewState).toBe('forbidden');
    expect(privateValue(page, route)).toBeFalsy();
    if (route === 'home') page.onActionTap({ currentTarget: { dataset: { key: 'schedule' } } });
    else page.onLessonTap(teacherTap(session().id));
    expect(env.wx.navigateTo).not.toHaveBeenCalled();
    page.onRetry(); await flushTeacherPage();
    expect(env.calls).toHaveLength(2);
  });

  it.each([401, 403])('prioritizes a hidden denial over a successful newer return GET: %i', async code => {
    const page = await start(); await reply(page);
    page.onRetry(); await flushTeacherPage();
    page.onHide?.(); page.onShow?.(); await flushTeacherPage();
    expect(env.calls).toHaveLength(3);
    env.reply(2, routeResponse(route)); await flushTeacherPage();
    env.reply(1, denied, code); await flushTeacherPage();
    expect(page.data.viewState).toBe('forbidden');
    expect(privateValue(page, route)).toBeFalsy();
  });

  it('defers same-owner hidden denial until show without another GET', async () => {
    const page = await start(); await reply(page);
    page.onRetry(); await flushTeacherPage(); page.onHide?.();
    env.reply(1, denied, 403); await flushTeacherPage();
    const count = env.calls.length;
    page.onShow?.(); await flushTeacherPage();
    expect(page.data.viewState).toBe('forbidden');
    expect(privateValue(page, route)).toBeFalsy();
    expect(env.calls).toHaveLength(count);
  });

  it.each([
    { accessToken: 'synthetic-teacher-b' },
    { apiBaseUrl: 'https://changed.synthetic.invalid' },
    { dataDriver: 'mock' },
  ])('rejects a late reply and clears data after owner/runtime change %#', async change => {
    const page = await start(); await reply(page);
    page.onRetry(); await flushTeacherPage(); env.change(change);
    env.reply(1, routeResponse(route)); await flushTeacherPage();
    expect(page.data.viewState).toBe('forbidden');
    expect(privateValue(page, route)).toBeFalsy();
    page.onShow?.(); page.onRetry(); await flushTeacherPage();
    expect(env.calls).toHaveLength(2);
  });

  it.each(['hide', 'unload'])('ignores a successful reply after %s', async event => {
    const page = await start();
    if (event === 'hide') page.onHide?.(); else page.onUnload?.();
    env.reply(0, routeResponse(route)); await flushTeacherPage();
    expect(privateValue(page, route)).toBeFalsy();
    if (event === 'hide') {
      page.onShow?.(); await flushTeacherPage();
      expect(env.calls).toHaveLength(2);
    }
  });

  it('does not share request sequence or service state between Page instances', async () => {
    const page = await start(), second = env.instantiate();
    second.onLoad(); second.onShow?.(); await flushTeacherPage();
    env.reply(1, routeResponse(route)); env.reply(0, routeResponse(route));
    await flushTeacherPage();
    expect(page.data.viewState).toBe('ready'); expect(second.data.viewState).toBe('ready');
    expect(readSummary(page).expectedLabel).toBe('应到 3 人');
  });
});

describe('schedule expansion and paging', () => {
  let env: ReturnType<typeof captureTeacherPage>, page: any;
  beforeEach(async () => {
    env = captureTeacherPage('schedule', { autoClock: false }); page = env.instantiate();
    page.onLoad(); page.onShow?.(); await flushTeacherPage();
  });
  afterEach(() => env.close());
  it('expands history without enabling historical lesson navigation', async () => {
    const historical = session({ id: 'history', status: 'REVERSED',
      rosterSummary: summary({ source: 'HISTORICAL_ATTENDANCE' }) });
    env.reply(0, listing([session({ id: 'current' }), historical]));
    await flushTeacherPage();
    page.onToggleLesson(teacherTap('history'));
    expect(page.data.expandedId).toBe('history');
    expect(page.data.items[1].rosterSummary.expectedLabel).toBe('应到 3 人');
    page.onLessonTap(teacherTap('history'));
    expect(env.wx.navigateTo).not.toHaveBeenCalled();
    page.onLessonTap(teacherTap('current'));
    expect(env.wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/teacher/lesson/index?id=current' });
    page.onToggleLesson(teacherTap('history')); expect(page.data.expandedId).toBe('');
  });
  it('keeps first-page counts when page 2 fails, retries page 2, and merges updated duplicates', async () => {
    env.reply(0, listing([session({ id: 'one' })], 1, 2));
    await flushTeacherPage(); page.onLoadMore(); await flushTeacherPage();
    env.reply(1, failure, 503); await flushTeacherPage();
    expect(page.data.items).toHaveLength(1); expect(page.data.page).toBe(1);
    expect(page.data.viewState).toBe('ready');
    page.onLoadMore(); await flushTeacherPage();
    expect(env.calls[2].url).toContain('page=2');
    env.reply(2, listing([
      session({ id: 'one', rosterSummary: summary({ expectedCount: 4 }) }),
      session({ id: 'two', rosterSummary: undefined }),
    ], 2, 2));
    await flushTeacherPage();
    expect(page.data.items).toHaveLength(2);
    expect(page.data.items[0].rosterSummary.expectedLabel).toBe('应到 4 人');
    expect(page.data.items[1].rosterSummary.known).toBe(false);
    expect(page.data.hasMore).toBe(false);
  });
  it('ignores a stale response after changing status and date', async () => {
    page.onStatusTap(teacherTap('', 'COMPLETED')); await flushTeacherPage();
    expect(env.calls[1].url).toContain('status=COMPLETED');
    page.onDateChange({ detail: { value: '2026-10-29' } }); await flushTeacherPage();
    expect(env.calls[2].url).toContain('from=');
    env.reply(2, listing([session({ id: 'new' })]));
    env.reply(0, listing([session({ id: 'old' })]));
    env.reply(1, listing([session({ id: 'older' })]));
    await flushTeacherPage();
    expect(page.data.items.map((item: any) => item.id)).toEqual(['new']);
  });
  it('pull refresh supersedes an in-flight page2 and reads page1 again', async () => {
    env.reply(0, listing([session({ id: 'one' })], 1, 2));
    await flushTeacherPage();
    page.onLoadMore(); await flushTeacherPage();
    page.onPullDownRefresh(); await flushTeacherPage();
    expect(env.calls).toHaveLength(3);
    expect(env.calls[2].url).toContain('page=1');
    env.reply(2, listing([session({ id: 'fresh', rosterSummary: summary({ expectedCount: 4 }) })]));
    env.reply(1, listing([session({ id: 'stale-page2' })], 2, 2));
    await flushTeacherPage();
    expect(page.data.page).toBe(1);
    expect(page.data.items.map((item: any) => item.id)).toEqual(['fresh']);
    expect(page.data.items[0].rosterSummary.expectedLabel).toBe('应到 4 人');
    expect(env.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('schedule retry operation', () => {
  let env: ReturnType<typeof captureTeacherPage>, page: any;
  const requestedPages = () => env.calls.map(call =>
    Number(new URL(call.url).searchParams.get('page')));
  const replyPage = async (index: number, pageNumber: number, id = `page-${pageNumber}`) => {
    env.reply(index, listing([session({ id })], pageNumber, 3));
    await flushTeacherPage();
  };
  const fail = async (index: number, code = 503) => {
    env.reply(index, code === 401 || code === 403 ? denied : failure, code);
    await flushTeacherPage();
  };
  const failThirdPage = async () => {
    await replyPage(0, 1);
    page.onLoadMore(); await flushTeacherPage(); await replyPage(1, 2);
    page.onToggleLesson(teacherTap('page-2'));
    page.onLoadMore(); await flushTeacherPage(); await fail(2);
    expect(requestedPages()).toEqual([1, 2, 3]);
    expect(page.data.page).toBe(2);
    expect(page.data.items.map((item: any) => item.id)).toEqual(['page-1', 'page-2']);
  };
  beforeEach(async () => {
    env = captureTeacherPage('schedule', { autoClock: false });
    page = env.instantiate(); page.onLoad(); page.onShow(); await flushTeacherPage();
  });
  afterEach(() => env.close());

  it('visible onRetry continues failed page3 while retaining page1/page2 and expansion', async () => {
    await failThirdPage();
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 3]);
    expect(page.data.items).toHaveLength(2);
    await replyPage(3, 3);
    expect(page.data.page).toBe(3);
    expect(page.data.items.map((item: any) => item.id)).toEqual(['page-1', 'page-2', 'page-3']);
    expect(page.data.expandedId).toBe('page-2');
    expect(page.data.refreshError).toBe('');
    expect(page.data.hasMore).toBe(false);
  });

  it('repeated onRetry failure stays on page3 and a second tap cannot replace an in-flight retry', async () => {
    await failThirdPage();
    page.onRetry(); await flushTeacherPage();
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 3]);
    await fail(3);
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 3, 3]);
    await replyPage(4, 3);
    expect(page.data.items.map((item: any) => item.id)).toEqual(['page-1', 'page-2', 'page-3']);
  });

  it('first read failure retries page1', async () => {
    await fail(0); expect(page.data.viewState).toBe('error');
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 1]);
    await replyPage(1, 1); expect(page.data.viewState).toBe('ready');
  });

  it('explicit refresh failure replaces the pagination failure context and retries page1', async () => {
    await failThirdPage();
    page.onPullDownRefresh(); await flushTeacherPage(); await fail(3);
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 1, 1]);
    await replyPage(4, 1, 'fresh');
    expect(page.data.items.map((item: any) => item.id)).toEqual(['fresh']);
  });

  it('hide/show clears the pagination retry context; failed return read retries page1', async () => {
    await failThirdPage();
    page.onHide(); page.onRetry(); await flushTeacherPage();
    expect(env.calls).toHaveLength(3);
    page.onShow(); await flushTeacherPage(); await fail(3);
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 1, 1]);
    await replyPage(4, 1, 'returned');
    expect(page.data.items.map((item: any) => item.id)).toEqual(['returned']);
  });

  it.each(['date', 'status'])('changing %s clears the failed pagination operation', async filter => {
    await failThirdPage();
    if (filter === 'date') page.onDateChange({ detail: { value: '2026-10-29' } });
    else page.onStatusTap(teacherTap('', 'COMPLETED'));
    await flushTeacherPage();
    expect(page.data.items).toEqual([]);
    await fail(3); page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 1, 1]);
    expect(env.calls[4].url).toContain(filter === 'date' ? 'from=' : 'status=COMPLETED');
    await replyPage(4, 1, 'filtered');
    expect(page.data.items.map((item: any) => item.id)).toEqual(['filtered']);
  });

  it('unload cannot retry; a new Page starts from page1 independently', async () => {
    await failThirdPage();
    page.onUnload(); page.onRetry(); await flushTeacherPage();
    expect(env.calls).toHaveLength(3); expect(page.data.items).toEqual([]);
    const next = env.instantiate(); next.onLoad(); next.onShow(); await flushTeacherPage();
    await fail(3); next.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 1, 1]);
    await replyPage(4, 1, 'new-page');
    expect(next.data.items.map((item: any) => item.id)).toEqual(['new-page']);
    expect(page.data.items).toEqual([]);
  });

  it.each([
    { accessToken: 'synthetic-retry-teacher-b' },
    { apiBaseUrl: 'https://retry-changed.synthetic.invalid' },
    { dataDriver: 'mock' },
  ])('runtime change blocks the old failed-operation retry %#', async change => {
    await failThirdPage();
    env.change(change); page.onRetry(); await flushTeacherPage();
    expect(env.calls).toHaveLength(3);
    expect(page.data.items).toEqual([]); expect(page.data.viewState).toBe('forbidden');
    page.onLoadMore(); page.onRetry(); await flushTeacherPage();
    expect(env.calls).toHaveLength(3);
  });

  it('refresh still supersedes in-flight page2 and ignores its late503 when choosing retry', async () => {
    await replyPage(0, 1);
    page.onLoadMore(); await flushTeacherPage();
    page.onPullDownRefresh(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 1]);
    await fail(2); await fail(1);
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 1, 1]);
    await replyPage(3, 1, 'fresh');
    expect(page.data.items.map((item: any) => item.id)).toEqual(['fresh']);
  });

  it.each([401, 403])('old pagination retry denial%i remains authoritative after a fresh successful read', async code => {
    await failThirdPage();
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 3]);
    page.onPullDownRefresh(); await flushTeacherPage();
    await replyPage(4, 1, 'fresh');
    await fail(3, code);
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.items).toEqual([]);
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 3, 1]);
  });

  it.each([401, 403])('hidden pagination retry denial%i is applied before return GET', async code => {
    await failThirdPage();
    page.onRetry(); await flushTeacherPage();
    expect(requestedPages()).toEqual([1, 2, 3, 3]);
    page.onHide(); await fail(3, code);
    page.onShow(); page.onRetry(); await flushTeacherPage();
    expect(page.data.viewState).toBe('forbidden'); expect(page.data.items).toEqual([]);
    expect(requestedPages()).toEqual([1, 2, 3, 3]);
  });
});
