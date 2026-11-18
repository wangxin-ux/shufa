import * as fs from 'node:fs';
import * as path from 'node:path';
import { capture, flush } from './operator-page-host';
import { classes as sourceClasses, lesson as sourceLesson } from './operator-schedule.fixture';
const uuid = (value: number) => `64000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const lesson = { ...sourceLesson, id: uuid(1), campusId: uuid(100), classGroupId: uuid(200), teacherId: uuid(300) };
const classes = sourceClasses.map((item, index) => ({
  ...item, classGroupId: uuid(200 + index), teacherId: uuid(300 + index),
}));
const otherRows = () => Array.from({ length: 20 }, (_, index) => ({ ...lesson, id: uuid(index + 2) }));
const frontendRoot = process.env.OPERATOR_LEGACY_TEST_FRONTEND_ROOT ?? path.resolve(__dirname, '..');

type Env = ReturnType<typeof capture>;
const options = (env: Env, index: number, rows = classes) => env.reply(index, { data: { classes: rows } });
function list(env: Env, index: number, rows = [lesson], page = 1, total = rows.length) {
  env.reply(index, { data: rows, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) } });
}
async function loaded(mode: 'create' | 'edit' = 'create') {
  const env = capture(['schedule-editor']);
  const page = env.instantiate();
  page.onLoad(mode === 'edit' ? { mode, id: lesson.id } : {}); page.onShow(); await flush();
  if (mode === 'edit') list(env, 0); else options(env, 0);
  await flush();
  return { env, page };
}
function fill(page: any) {
  page.onClassChange({ detail: { value: '0' } });
  page.onFormDateChange({ detail: { value: '2040-02-01' } });
}
function confirm(env: Env) {
  const calls = env.platform.showModal.mock.calls;
  calls[calls.length - 1][0].success({ confirm: true });
}
afterEach(() => jest.useRealTimers());

it('registers the editor in the existing ordinary operator subpackage', () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(frontendRoot, 'app.json'), 'utf8'));
  expect(app.subPackages.find((entry: { root: string }) => entry.root === 'pages/operator').pages)
    .toContain('schedule-editor/index');
});

it('keeps an unselected class until an explicit selection and marks the form dirty', async () => {
  const { env, page } = await loaded();
  try {
    expect(page.data).toMatchObject({ selectedClassId: '', classIndex: -1, dirty: false });
    fill(page);
    expect(page.data).toMatchObject({ selectedClassId: classes[0].classGroupId, dirty: true, selectedTeacherLabel: '王老师' });
    expect(env.platform.enableAlertBeforeUnload).toHaveBeenCalled();
  } finally { env.close(); }
});

it('requires one native confirmation before saving and ignores a stale confirmation after hide', async () => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onSubmit(); page.onSubmit(); await flush();
    expect(env.platform.showModal).toHaveBeenCalledTimes(1);
    expect(env.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
    const modal = env.platform.showModal.mock.calls[0][0];
    page.onHide(); modal.success({ confirm: true }); await flush();
    expect(env.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  } finally { env.close(); }
});

it('confirms unsaved cancellation and falls back to this roles home when directly opened', async () => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onBack?.(); page.onBack?.();
    expect(env.platform.showModal).toHaveBeenCalledTimes(1);
    env.platform.showModal.mock.calls[0][0].success({ confirm: false });
    expect(env.platform.reLaunch).not.toHaveBeenCalled();
    page.onBack?.(); confirm(env);
    expect(env.platform.disableAlertBeforeUnload).toHaveBeenCalled();
    expect(env.platform.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/operator/home/index' }));
  } finally { env.close(); }
});

it('confirms the actual top return entry in a single-page stack before navigating home', async () => {
  const { env, page } = await loaded();
  try {
    env.setPages([{ route: 'pages/operator/schedule-editor/index' }]);
    fill(page);
    const markup = fs.readFileSync(path.resolve(frontendRoot, 'pages/operator/schedule-editor/index.wxml'), 'utf8');
    const top = markup.match(/<button\b[^>]*aria-label="返回上一页"[^>]*>/)![0];
    const handler = top.match(/(?:bindtap|catchtap)="(\w+)"/)![1];
    page[handler]();
    expect(env.platform.showModal).toHaveBeenCalledTimes(1);
    expect(env.platform.reLaunch).not.toHaveBeenCalled();
    confirm(env);
    expect(env.platform.reLaunch).toHaveBeenCalledTimes(1);
  } finally { env.close(); }
});

it('uses the existing shell capsule geometry and its status-bar fallback', async () => {
  const env = capture(['schedule-editor']);
  try {
    env.platform.getWindowInfo.mockReturnValue({ windowWidth: 430, statusBarHeight: 30 });
    env.platform.getMenuButtonBoundingClientRect.mockReturnValueOnce({ top: 38, height: 34, left: 328 });
    const first = env.instantiate(); first.onLoad({}); first.onShow(); await flush();
    expect(first.data).toMatchObject({ headerTopPx: 38, headerHeightPx: 50, headerRightPx: 110 });
    env.platform.getMenuButtonBoundingClientRect.mockImplementationOnce(() => { throw new Error('synthetic unavailable geometry'); });
    const fallback = env.instantiate(); fallback.onLoad({}); fallback.onShow(); await flush();
    expect(fallback.data).toMatchObject({ headerTopPx: 38, headerHeightPx: 52, headerRightPx: 16 });
    options(env, 0); options(env, 1); await flush();
  } finally { env.close(); }
});

it.each([
  ['class', '', '请选择班级'], ['date', '2040-02-30', '请选择有效日期'],
  ['date', '2000-01-01', '只能安排未来课次'], ['end', '14:00', '结束时间必须晚于开始时间'],
  ['end', '13:59', '结束时间必须晚于开始时间'],
])('rejects invalid %s input %s before confirmation', async (field, value, message) => {
  const { env, page } = await loaded();
  try {
    fill(page);
    if (field === 'class') page.setData({ selectedClassId: '', classIndex: -1 });
    if (field === 'date') page.onFormDateChange({ detail: { value } });
    if (field === 'end') page.onEndTimeChange({ detail: { value } });
    page.onSubmit(); await flush();
    expect(page.data.formError).toBe(message);
    expect(env.platform.showModal).not.toHaveBeenCalled();
    expect(env.calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  } finally { env.close(); }
});

it('shows empty class options and cannot create with a forged or removed selection', async () => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onRetry(); await flush(); options(env, 1, []); await flush();
    expect(page.data.viewState).toBe('empty');
    page.setData({ selectedClassId: uuid(999), classIndex: 0 });
    page.onSubmit(); await flush();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('retains selected class by ID after return, preserving the unsaved draft and not submitting stale options', async () => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onClassChange({ detail: { value: '1' } });
    page.onHide(); page.onShow(); await flush();
    options(env, 1, [classes[1], classes[0]]); await flush();
    expect(page.data).toMatchObject({ classIndex: 0, selectedClassId: classes[1].classGroupId, formDate: '2040-02-01' });
    page.onRetry(); await flush(); env.reply(2, {}, 503); await flush();
    page.onSubmit(); await flush();
    expect(env.calls).toHaveLength(3);
    expect(page.data.selectedClassId).toBe(classes[1].classGroupId);
  } finally { env.close(); }
});

it('finds an edit ID beyond page one and uses the lesson facts without create options', async () => {
  const env = capture(['schedule-editor']);
  try {
    const page = env.instantiate(); page.onLoad({ mode: 'edit', id: lesson.id }); page.onShow(); await flush();
    list(env, 0, otherRows(), 1, 21); await flush();
    expect(new URL(env.calls[1].url).searchParams.get('page')).toBe('2');
    list(env, 1, [lesson], 2, 21); await flush();
    expect(page.data).toMatchObject({ mode: 'edit', editingId: lesson.id, editingVersion: 1, selectedClassId: lesson.classGroupId, dirty: false });
    expect(env.calls.every((call) => !call.url.includes('scheduling-options'))).toBe(true);
    page.onClassChange({ detail: { value: '1' } });
    expect(page.data.selectedClassId).toBe(lesson.classGroupId);
  } finally { env.close(); }
});

it.each([{ mode: 'edit' }, { mode: 'edit', id: lesson.id }])('never changes a missing or invalid edit target into create (%j)', async (query) => {
  const env = capture(['schedule-editor']);
  try {
    const page = env.instantiate(); page.onLoad(query); page.onShow(); await flush();
    if ('id' in query) { list(env, 0, []); await flush(); }
    expect(page.data.viewState).toBe('error');
    page.onSubmit(); await flush();
    expect(env.calls.every((call) => call.method === 'GET')).toBe(true);
  } finally { env.close(); }
});

it('keeps successful write receipt separate from readback failure and never resubmits a received create', async () => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onSubmit(); confirm(env); await flush();
    env.reply(1, { data: lesson }); await flush();
    expect(page.data).toMatchObject({ viewState: 'saved', savedId: lesson.id });
    env.reply(2, {}, 503); await flush();
    expect(page.data.readbackError).toBeTruthy();
    page.onSubmit(); await flush();
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    page.onRetryReadback(); await flush(); list(env, 3); await flush();
    expect(env.platform.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/operator/home/index' }));
  } finally { env.close(); }
});

it('emits the verified saved ID and returns to the opener once, guarding navigation failure retries', async () => {
  const { env, page } = await loaded();
  try {
    const emit = jest.fn(); page.opener = { emit };
    env.setPages([{ route: 'pages/operator/schedule/index' }, { route: 'pages/operator/schedule-editor/index' }]);
    fill(page); page.onSubmit(); confirm(env); await flush();
    env.reply(1, { data: lesson }); await flush(); list(env, 2); await flush();
    expect(emit).toHaveBeenCalledWith('scheduleSaved', expect.objectContaining({ id: lesson.id }));
    expect(env.platform.navigateBack).toHaveBeenCalledTimes(1);
    page.onReturn(); expect(env.platform.navigateBack).toHaveBeenCalledTimes(1);
    env.platform.navigateBack.mock.calls[0][0].fail({});
    page.onReturn(); expect(env.platform.navigateBack).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(1);
  } finally { env.close(); }
});

it('preserves an uncertain original save across hiding, time passing and failed options without automatic resend', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2040-02-01T05:59:00Z'));
  const { env, page } = await loaded();
  try {
    fill(page); page.onSubmit(); confirm(env); await flush();
    const first = env.calls[1]; page.onHide();
    first.fail(new Error('synthetic unknown result')); await flush();
    expect(env.calls.filter((call) => call.method !== 'GET')).toHaveLength(1);
    jest.setSystemTime(new Date('2040-02-01T06:01:00Z'));
    page.onShow(); await flush(); env.reply(2, {}, 503); await flush();
    expect(page.data.recoveryAvailable).toBe(true);
    page.onFormDateChange({ detail: { value: '2040-02-02' } });
    page.onRetryWrite(); page.onRetryWrite(); await flush();
    expect(env.calls[3]).toMatchObject({ method: 'GET',
      url: 'https://operator.example.test/operators/me/lesson-sessions?page=1&pageSize=20' });
    expect(page.data.recoveryReady).toBe(false);
    list(env, 3); await flush();
    expect(page.data.recoveryReady).toBe(true);
    expect(env.calls.filter(call => call.method !== 'GET')).toHaveLength(1);
    page.onRetryWrite(); page.onRetryWrite(); await flush();
    expect(env.calls[4]).toMatchObject({
      url: first.url, method: 'POST',
      data: first.data, header: { 'Idempotency-Key': first.header['Idempotency-Key'] },
    });
    env.reply(4, { data: lesson }); await flush(); list(env, 5); await flush();
  } finally { env.close(); }
});

it('uses the original version in PATCH and requires an explicit refresh after a 409', async () => {
  const { env, page } = await loaded('edit');
  try {
    page.onStartTimeChange({ detail: { value: '14:15' } }); page.onSubmit(); confirm(env); await flush();
    expect(env.calls[1]).toMatchObject({ method: 'PATCH', data: { version: 1 } });
    expect(env.calls[1].data).not.toHaveProperty('classGroupId');
    env.reply(1, { code: 'LESSON_VERSION_CONFLICT', message: '课次已变化' }, 409); await flush();
    list(env, 2, [{ ...lesson, version: 2 }]); await flush();
    expect(page.data).toMatchObject({ editingVersion: 1, startsAt: '14:15', stale: true });
    page.onSubmit(); await flush(); expect(env.calls).toHaveLength(3);
    page.onReload(); confirm(env); await flush(); list(env, 3, [{ ...lesson, version: 2 }]); await flush();
    expect(page.data).toMatchObject({ editingVersion: 2, stale: false, dirty: false });
  } finally { env.close(); }
});

it.each([401, 403])('clears private draft on hidden read/write %s before any success can return', async (status) => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onSubmit(); confirm(env); await flush(); page.onHide();
    env.reply(1, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', selectedClassId: '', formDate: '', recoveryAvailable: false });
    page.onShow(); page.onRetry(); page.onRetryWrite(); await flush();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('rejects hidden ordinary reads and stale-owner callbacks without changing a new owners runtime', async () => {
  const env = capture(['schedule-editor']);
  try {
    const old = env.instantiate(); old.onLoad({}); old.onShow(); await flush();
    old.onHide(); const count = old.setData.mock.calls.length;
    options(env, 0); await flush(); expect(old.setData).toHaveBeenCalledTimes(count);
    env.change({ apiBaseUrl: 'https://current.example.test', accessToken: 'synthetic-owner-b' });
    const fresh = env.instantiate(); fresh.onLoad({}); fresh.onShow(); await flush();
    expect(env.calls[1]).toMatchObject({ header: { Authorization: 'Bearer synthetic-owner-b' } });
    old.onShow(); old.onLogin(); await flush();
    expect(old.data.viewState).toBe('forbidden');
    expect(env.values.get('education.runtime').accessToken).toBe('synthetic-owner-b');
  } finally { env.close(); }
});

it('locks fields during a confirmed reload so the replacement cannot erase a newer draft', async () => {
  const { env, page } = await loaded('edit');
  try {
    page.onStartTimeChange({ detail: { value: '14:15' } });
    page.onReload(); confirm(env); await flush();
    page.onStartTimeChange({ detail: { value: '14:30' } });
    expect(page.data.startsAt).toBe('14:15');
    list(env, 1, [{ ...lesson, version: 2 }]); await flush();
    expect(page.data).toMatchObject({ editingVersion: 2, dirty: false });
  } finally { env.close(); }
});

it('uses Shanghai tomorrow when each Page is created and clears dirty when edits are reverted', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2039-12-31T18:00:00Z'));
  const env = capture(['schedule-editor']);
  try {
    jest.setSystemTime(new Date('2040-01-01T18:00:00Z'));
    const page = env.instantiate(); page.onLoad({}); page.onShow(); await flush();
    options(env, 0); await flush();
    expect(page.data).toMatchObject({ minDate: '2040-01-02', formDate: '2040-01-03' });
    page.onStartTimeChange({ detail: { value: '14:30' } });
    expect(page.data.dirty).toBe(true);
    page.onStartTimeChange({ detail: { value: '14:00' } });
    expect(page.data.dirty).toBe(false);
    expect(env.platform.disableAlertBeforeUnload).toHaveBeenCalled();
  } finally { env.close(); }
});

it('rejects a forged class ID and retains the draft after a server validation failure', async () => {
  const { env, page } = await loaded();
  try {
    fill(page);
    page.setData({ selectedClassId: uuid(999) });
    page.onSubmit(); expect(env.platform.showModal).not.toHaveBeenCalled();
    fill(page); page.onSubmit(); confirm(env); await flush();
    expect(env.calls[1].data).not.toHaveProperty('teacherId');
    expect(env.calls[1].data).not.toHaveProperty('lessonUnits');
    env.reply(1, { error: { message: '班级已停用' } }, 400); await flush();
    expect(page.data).toMatchObject({ formDate: '2040-02-01', dirty: true, recoveryAvailable: false });
    expect(page.data.formError).toBeTruthy();
  } finally { env.close(); }
});

it('preserves a dirty edits original version on return until explicit discard and reload', async () => {
  const { env, page } = await loaded('edit');
  try {
    page.onStartTimeChange({ detail: { value: '14:15' } });
    page.onHide(); page.onShow(); await flush();
    list(env, 1, [{ ...lesson, version: 2 }]); await flush();
    expect(page.data).toMatchObject({ editingVersion: 1, startsAt: '14:15', dirty: true, stale: true });
    page.onSubmit(); expect(env.platform.showModal).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it('rechecks edit eligibility after the confirmation clock passes the original start', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2040-02-01T05:59:00Z'));
  const { env, page } = await loaded('edit');
  try {
    page.onStartTimeChange({ detail: { value: '14:15' } }); page.onSubmit();
    jest.setSystemTime(new Date('2040-02-01T06:00:00Z'));
    confirm(env); await flush();
    expect(env.calls).toHaveLength(1);
    expect(page.data.formError).toBeTruthy();
  } finally { env.close(); }
});

it('defers a hidden successful receipt, then reads it once without creating again', async () => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onSubmit(); confirm(env); await flush(); page.onHide();
    env.reply(1, { data: lesson }); await flush();
    expect(env.calls).toHaveLength(2);
    expect(env.platform.reLaunch).not.toHaveBeenCalled();
    page.onShow(); await flush();
    expect(page.data.viewState).toBe('saved');
    list(env, 2); await flush();
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(env.platform.reLaunch).toHaveBeenCalledTimes(1);
  } finally { env.close(); }
});

it('rejects old readback versions and keeps only read/navigation retries after a successful receipt', async () => {
  const { env, page } = await loaded('edit');
  try {
    page.onStartTimeChange({ detail: { value: '14:15' } }); page.onSubmit(); confirm(env); await flush();
    env.reply(1, { data: { ...lesson, version: 2 } }); await flush();
    list(env, 2); await flush();
    expect(page.data).toMatchObject({ viewState: 'saved', verified: false });
    expect(env.platform.reLaunch).not.toHaveBeenCalled();
    page.onSubmit(); page.onReturn(); expect(env.calls).toHaveLength(3);
    page.onRetryReadback(); await flush(); list(env, 3, [{ ...lesson, version: 3, status: 'CANCELLED' }]); await flush();
    expect(env.platform.reLaunch).toHaveBeenCalledTimes(1);
    expect(env.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  } finally { env.close(); }
});

it.each([401, 403])('clears a hidden options read and a hidden readback %s immediately', async (status) => {
  const env = capture(['schedule-editor']);
  try {
    const source = env.instantiate(); source.onLoad({}); source.onShow(); await flush(); source.onHide();
    env.reply(0, {}, status); await flush();
    expect(source.data).toMatchObject({ viewState: 'forbidden', formDate: '', selectedClassId: '' });
    const page = env.instantiate(); page.onLoad({}); page.onShow(); await flush(); options(env, 1); await flush();
    fill(page); page.onSubmit(); confirm(env); await flush(); env.reply(2, { data: lesson }); await flush();
    page.onHide(); env.reply(3, {}, status); await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', savedId: '', formDate: '', recoveryAvailable: false });
    page.onShow(); page.onRetryReadback(); await flush(); expect(env.calls).toHaveLength(4);
  } finally { env.close(); }
});

it('distinguishes an interrupted ID scan from not found and retries from page one', async () => {
  const env = capture(['schedule-editor']);
  try {
    const page = env.instantiate(); page.onLoad({ mode: 'edit', id: lesson.id }); page.onShow(); await flush();
    list(env, 0, otherRows(), 1, 21); await flush();
    env.reply(1, {}, 503); await flush();
    expect(page.data.viewState).toBe('error');
    expect(page.data.errorMessage).not.toContain('未找到');
    page.onRetry(); await flush();
    expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('1');
    list(env, 2); await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', editingId: lesson.id });
  } finally { env.close(); }
});

it('stops a malformed ID scan and a hidden scan before requesting another page', async () => {
  const env = capture(['schedule-editor']);
  try {
    const malformed = env.instantiate(); malformed.onLoad({ mode: 'edit', id: lesson.id }); malformed.onShow(); await flush();
    env.reply(0, { data: [], meta: { page: 2, pageSize: 20, total: 21, totalPages: 2 } }); await flush();
    expect(malformed.data.viewState).toBe('error');
    expect(env.calls).toHaveLength(1);
    const page = env.instantiate(); page.onLoad({ mode: 'edit', id: lesson.id }); page.onShow(); await flush();
    page.onHide(); list(env, 1, otherRows(), 1, 21); await flush();
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('keeps independent workflow keys for two simultaneous create Pages', async () => {
  const env = capture(['schedule-editor']);
  try {
    const first = env.instantiate(); first.onLoad({}); first.onShow(); await flush();
    const second = env.instantiate(); second.onLoad({}); second.onShow(); await flush();
    options(env, 0); options(env, 1); await flush();
    fill(first); first.onSubmit(); confirm(env);
    fill(second); second.onSubmit(); confirm(env); await flush();
    expect(env.calls[2].header['Idempotency-Key']).not.toBe(env.calls[3].header['Idempotency-Key']);
    env.reply(2, {}, 400); env.reply(3, {}, 400); await flush();
    expect(first.data.submitting).toBe(false);
    expect(second.data.submitting).toBe(false);
  } finally { env.close(); }
});

it('ignores old modal completion and navigation failure callbacks after hide', async () => {
  const { env, page } = await loaded();
  try {
    fill(page); page.onSubmit();
    const old = env.platform.showModal.mock.calls[0][0];
    old.success({ confirm: false }); page.onBack();
    old.complete();
    expect(page.data.confirming).toBe(true);
    confirm(env);
    const navigation = env.platform.reLaunch.mock.calls[0][0];
    page.onHide(); const count = page.setData.mock.calls.length;
    navigation.fail({});
    expect(page.setData).toHaveBeenCalledTimes(count);
  } finally { env.close(); }
});
