import * as fs from 'fs';
import * as path from 'path';
import { capture, flush, tap } from './operator-page-host';
import { lesson, lessonId, studentId, students, roster, list, lessonPage } from './operator-lesson-members.fixture';
import { parseOperatorLessonRoster, validateOperatorMemberWrite } from '../pages/operator/runtime/data/operator-lesson-members-codec';
type Host = ReturnType<typeof capture>;
it('keeps member conditions valid for the native WXML expression compiler', () => {
  const markup = fs.readFileSync(path.resolve(__dirname, '../pages/operator/schedule/index.wxml'), 'utf8');
  const expressions = [...markup.matchAll(/\{\{([\s\S]*?)\}\}/g)].map(match => match[1]);
  expect(expressions.filter(expression => expression.includes('&amp;'))).toEqual([]);
});
async function loaded() {
  const env = capture(['schedule']);
  const page = env.instantiate();
  page.onLoad(); page.onShow(); await flush();
  env.reply(0, list([lesson])); await flush();
  return { env, page };
}
async function opened() {
  const value = await loaded();
  try {
    expect(value.page.onMembersTap).toEqual(expect.any(Function));
    value.page.onMembersTap(tap(lessonId)); await flush();
    value.env.reply(1, { data: roster() }); await flush();
    return value;
  } catch (error) { value.env.close(); throw error; }
}
async function searched(env: Host, page: any) {
  page.onMemberSearch(); await flush();
  env.reply(env.calls.length - 1, list(students.slice(0, 20), 1, 26)); await flush();
  page.onMemberStudentTap(tap(studentId(2)));
}
const member = (id = 2) => ({ studentId: studentId(id), displayName: '安然',
  source: 'TEMPORARY', canRemove: true });

it('adds and removes through the actual Page Context Service API chain then refreshes page one', async () => {
  const { env, page } = await opened();
  try {
    expect(env.calls[1].url).toContain(`/lesson-sessions/${lessonId}/members`);
    expect(page.data.members.roster.members).toHaveLength(1);
    await searched(env, page);
    page.onAddMember(); page.onAddMember(); await flush();
    const write = env.calls[3];
    expect(write).toMatchObject({ method: 'POST', data: { studentId: studentId(2), version: 1 } });
    expect(write.header['Idempotency-Key']).toBeTruthy();
    env.reply(3, { data: roster([roster().members[0], member()], 2) }); await flush();
    expect(env.calls[4].method).toBe('GET');
    env.reply(4, { data: roster([roster().members[0], member()], 2) }); await flush();
    expect(page.data.members.roster.lessonVersion).toBe(2);
    page.onRemoveMemberTap(tap(studentId(2)));
    page.onConfirmRemoveMember(); await flush();
    expect(env.calls[5]).toMatchObject({
      method: 'POST', data: { version: 2 },
      url: expect.stringContaining(`/members/${studentId(2)}/remove`),
    });
    env.reply(5, { data: roster(undefined, 3) }); await flush();
    env.reply(6, { data: roster(undefined, 3) }); await flush();
    expect(page.data.members.roster.members).toHaveLength(1);
    page.onCloseMembers(); await flush();
    expect(new URL(env.calls[7].url).searchParams.get('page')).toBe('1');
    env.reply(7, list([{ ...lesson, version: 3 }])); await flush();
    expect(page.data.items[0].version).toBe(3);
  } finally { env.close(); }
});

it('searches existing students across every page and retains the selected result', async () => {
  const { env, page } = await opened();
  try {
    page.onMemberSearchInput({ detail: { value: ' 王同学 ' } });
    page.onMemberSearch(); await flush();
    expect(new URL(env.calls[2].url).searchParams.get('query')).toBe('王同学');
    env.reply(2, list(students.slice(0, 20), 1, 26)); await flush();
    page.onMemberSearchMore(); await flush();
    expect(new URL(env.calls[3].url).searchParams.get('page')).toBe('2');
    env.reply(3, list(students.slice(20), 2, 26)); await flush();
    expect(page.data.members.students).toHaveLength(26);
    page.onMemberStudentTap(tap(studentId(26)));
    expect(page.data.members.selectedStudentId).toBe(studentId(26));
    expect(env.calls.every((call) => call.method === 'GET')).toBe(true);
  } finally { env.close(); }
});

it.each(['IN_PROGRESS', 'COMPLETED', 'REVERSED', 'CANCELLED'])('renders %s roster read-only without ordinary member removal', async (status) => {
  const { env, page } = await loaded();
  try {
    expect(page.onMembersTap).toEqual(expect.any(Function));
    page.onMembersTap(tap(lessonId)); await flush();
    env.reply(1, { data: { ...roster(), status, canChange: false,
      members: [{ ...member(), source: status === 'COMPLETED' || status === 'REVERSED' ? 'HISTORICAL' : 'TEMPORARY', canRemove: false }] } });
    await flush();
    page.onMemberSearch(); page.onRemoveMemberTap(tap(studentId(2))); page.onConfirmRemoveMember();
    page.onAddMember(); await flush();
    expect(page.data.members.roster.status).toBe(status);
    expect(env.calls).toHaveLength(2);
  } finally { env.close(); }
});

it('shows zero and long complete rosters without deriving counts from a student search page', async () => {
  const { env, page } = await opened();
  try {
    page.onRefreshMembers(); await flush(); env.reply(2, { data: roster([]) }); await flush();
    expect(page.data.members.roster.members).toEqual([]);
    page.onRefreshMembers(); await flush();
    env.reply(3, { data: roster(students.map((student) => ({
      studentId: student.id, displayName: student.displayName, source: 'TEMPORARY', canRemove: true,
    }))) }); await flush();
    expect(page.data.members.roster.members).toHaveLength(26);
    page.onRemoveMemberTap(tap(studentId(1))); page.onCancelRemoveMember();
    expect(env.calls.every((call) => call.method === 'GET')).toBe(true);
  } finally { env.close(); }
});

it.each(['INSUFFICIENT_LESSON_BALANCE', 'LESSON_VERSION_CONFLICT'])('reconciles %s with authoritative GET and keeps selection without automatic replay', async (code) => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush();
    const original = env.calls[3];
    env.reply(3, { code, message: 'The server rejected this write', details: { currentVersion: 8 } }, 409);
    await flush(); expect(env.calls[4].method).toBe('GET');
    env.reply(4, { data: roster(undefined, 4) }); await flush();
    expect(page.data.members.selectedStudentId).toBe(studentId(2));
    expect(page.data.members.roster.lessonVersion).toBe(4);
    expect(page.data.members.message).toMatch(code === 'INSUFFICIENT_LESSON_BALANCE' ? /余额不足/ : /变化|更新/);
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    page.onAddMember(); await flush();
    expect(env.calls[5].data).toEqual({ studentId: studentId(2), version: 4 });
    expect(env.calls[5].header['Idempotency-Key']).not.toBe(original.header['Idempotency-Key']);
  } finally { env.close(); }
});

it('retains the exact command and key after 503 and reads before the user retries it', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush();
    const original = env.calls[3];
    env.reply(3, {}, 503); await flush();
    expect(page.data.members.recoveryAvailable).toBe(true);
    page.onAddMember(); page.onCreateTap(); page.onCancelTap(tap(lessonId)); await flush();
    expect(env.calls).toHaveLength(4); expect(env.platform.navigateTo).not.toHaveBeenCalled();
    page.onRecoverMembers(); await flush();
    expect(env.calls[4].method).toBe('GET');
    env.reply(4, { data: roster(undefined, 7) }); await flush();
    expect(env.calls).toHaveLength(5);
    page.onRecoverMembers(); await flush();
    expect(env.calls[5]).toMatchObject({ method: 'POST', data: original.data,
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
    env.reply(5, { data: roster([roster().members[0], member()], 2) }); await flush();
    env.reply(6, { data: roster([roster().members[0], member()], 7) }); await flush();
    expect(page.data.members.roster.lessonVersion).toBe(7);
    expect(page.data.members.recoveryAvailable).toBe(false);
  } finally { env.close(); }
});

it.each(['conflict', 'success'])('does not replay a known %s write when authoritative readback fails', async (kind) => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush();
    env.reply(3, kind === 'success' ? { data: roster([roster().members[0], member()], 2) }
      : { code: 'LESSON_VERSION_CONFLICT' }, kind === 'success' ? 200 : 409);
    await flush(); env.reply(4, {}, 503); await flush();
    expect(page.data.members.recoveryAvailable).toBe(true);
    page.onRecoverMembers(); await flush(); expect(env.calls[5].method).toBe('GET');
    env.reply(5, { data: roster([roster().members[0], member()], 2) }); await flush();
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(page.data.members.recoveryAvailable).toBe(false);
  } finally { env.close(); }
});

it.each([401, 403])('clears private roster/search/pending state on hidden %s and rejects late success', async (status) => {
  const { env, page } = await opened();
  try {
    await searched(env, page);
    page.onMemberSearch(); await flush(); const search = env.calls.length - 1;
    page.onRefreshMembers(); await flush(); const old = env.calls.length - 1;
    expect(old).not.toBe(search);
    page.onHide(); env.reply(search, {}, status); await flush();
    env.reply(old, { data: roster([member()]) }); await flush();
    page.onShow(); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.members.roster).toBeNull();
    expect(page.data.members.students).toEqual([]);
    expect(page.data.members.selectedStudentId).toBe('');
    expect(page.data.members.recoveryAvailable).toBe(false);
  } finally { env.close(); }
});

it('blocks new writes on a failed authority refresh until a successful GET and shows existing selection membership', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page);
    page.onRefreshMembers(); await flush();
    env.reply(3, {}, 503); await flush();
    page.onAddMember(); page.onRemoveMemberTap(tap(studentId(2))); await flush();
    expect(env.calls).toHaveLength(4);
    expect(page.data.members.errorMessage).toBeTruthy();
    page.onRefreshMembers(); await flush();
    env.reply(4, { data: roster([roster().members[0], member()], 2) }); await flush();
    expect(page.data.members.selectedInRoster).toBe(true);
    page.onAddMember(); await flush();
    expect(env.calls).toHaveLength(5);
    page.onRemoveMemberTap(tap(studentId(2))); page.onConfirmRemoveMember(); await flush();
    expect(env.calls[5].data).toEqual({ version: 2 });
  } finally { env.close(); }
});

it('never removes regular members and retries remove with the original body/key after unknown receipt', async () => {
  const { env, page } = await opened();
  try {
    page.onRemoveMemberTap(tap(roster().members[0].studentId)); page.onConfirmRemoveMember(); await flush();
    expect(env.calls).toHaveLength(2);
    page.onRefreshMembers(); await flush();
    env.reply(2, { data: roster([member()], 3) }); await flush();
    page.onRemoveMemberTap(tap(studentId(2))); page.onConfirmRemoveMember(); await flush();
    const original = env.calls[3];
    original.fail(new Error('unknown')); await flush();
    page.onRecoverMembers(); await flush();
    env.reply(4, { data: roster([], 4) }); await flush();
    page.onRecoverMembers(); await flush();
    expect(env.calls[5]).toMatchObject({ url: original.url, data: { version: 3 },
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
    env.reply(5, { data: roster([], 4) }); await flush();
    env.reply(6, { data: roster([], 4) }); await flush();
    expect(page.data.members.roster.members).toEqual([]);
    expect(page.data.members.blocking).toBe(false);
  } finally { env.close(); }
});

it('treats malformed write receipts as unknown and requires reconciliation before retry', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush();
    env.reply(3, { data: { ...roster(), lessonSessionId: studentId(77) } }); await flush();
    expect(page.data.members.blocking).toBe(true);
    expect(env.calls).toHaveLength(4);
    page.onRecoverMembers(); await flush();
    expect(env.calls[4].method).toBe('GET');
  } finally { env.close(); }
});

it.each([
  ['another lesson', { lessonSessionId: studentId(90) }],
  ['zero version', { lessonVersion: 0 }],
  ['fractional version', { lessonVersion: 1.5 }],
  ['invalid time', { startsAt: 'invalid' }],
  ['past writable', { startsAt: '2038-01-01T00:00:00Z' }],
  ['terminal writable', { status: 'COMPLETED' }],
  ['duplicate member', { members: [member(), member()] }],
  ['regular removable', { members: [{ ...member(), source: 'CLASS' }] }],
  ['terminal regular', { status: 'COMPLETED', canChange: false,
    members: [{ ...member(), source: 'CLASS', canRemove: false }] }],
  ['unknown source', { members: [{ ...member(), source: 'OTHER' }] }],
])('rejects malformed roster: %s', (_name, patch) => {
  expect(() => parseOperatorLessonRoster({ data: { ...roster(), ...patch } }, lessonId)).toThrow();
});

it('projects known roster fields only and validates outgoing identity/version/key without transport', () => {
  const parsed = parseOperatorLessonRoster({ data: { ...roster(), campusSecret: 'discard',
    members: [{ ...member(), phone: 'discard' }] } }, lessonId);
  expect(parsed).not.toHaveProperty('campusSecret');
  expect(parsed.members[0]).not.toHaveProperty('phone');
  expect(() => validateOperatorMemberWrite(lessonId, 1, 'command', studentId(2))).not.toThrow();
  for (const args of [['bad-id', 1, 'key'], [lessonId, 0, 'key'], [lessonId, 1, ' '],
    [lessonId, 1, 'key', 'bad-student']] as const)
    expect(() => validateOperatorMemberWrite(args[0], args[1], args[2], args[3])).toThrow();
});

it.each([{ accessToken: 'synthetic-new-owner' }, { apiBaseUrl: 'https://new.example.test' }, { dataDriver: 'mock' }])(
  'rejects late roster/search on runtime change %j', async (patch) => {
    const { env, page } = await opened();
    try {
      page.onMemberSearch(); await flush(); const index = env.calls.length - 1;
      env.change(patch); env.reply(index, list(students)); await flush();
      expect(page.data.members.students).toEqual([]);
      expect(page.data.members.roster).toBeNull();
      expect(page.data.viewState).toBe('forbidden');
    } finally { env.close(); }
  },
);

it('clears on hide, returns to list page one and rejects hidden search and unloaded replies', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onMemberSearchMore(); await flush();
    const hidden = env.calls.length - 1;
    page.onHide();
    expect(page.data.members.roster).toBeNull(); expect(page.data.members.students).toEqual([]);
    expect(page.data.items).toEqual([]);
    env.reply(hidden, list(students.slice(20), 2, 26)); await flush();
    page.onShow(); await flush(); const current = env.calls.length - 1;
    expect(new URL(env.calls[current].url).searchParams.get('page')).toBe('1');
    env.reply(current, list([lesson])); await flush();
    page.onMembersTap(tap(lessonId)); await flush(); const unloaded = env.calls.length - 1;
    page.onUnload(); const count = page.setData.mock.calls.length;
    env.reply(unloaded, { data: roster() }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(count);
  } finally { env.close(); }
});

it('retains an unknown command across hide and requires a fresh read before replay', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush();
    const original = env.calls[3]; page.onHide(); original.fail(new Error('unknown'));
    await flush(); expect(page.data.members.roster).toBeNull();
    page.onShow(); await flush();
    // An unresolved write keeps the member panel blocking, which is exactly
    // what stops the schedule list from refreshing over an unconfirmed roster.
    expect(page.data.members.blocking).toBe(true);
    expect(env.calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    // No *additional* schedule list read is issued while the roster is
    // unconfirmed; index 0 is the initial list load from before the write.
    expect(env.calls.slice(1).some((call) =>
      new URL(call.url).pathname.endsWith('/lesson-sessions'))).toBe(false);
    page.onRecoverMembers(); await flush();
    const read = env.calls.length - 1;
    expect(env.calls[read].method).toBe('GET');
    expect(new URL(env.calls[read].url).pathname.endsWith('/members')).toBe(true);
    env.reply(read, { data: roster() }); await flush();
    page.onRecoverMembers(); await flush();
    expect(env.calls[env.calls.length - 1]).toMatchObject({ method: 'POST', data: original.data,
      header: { 'Idempotency-Key': original.header['Idempotency-Key'] } });
  } finally { env.close(); }
});

it('retains a hidden known-success command for GET-only readback after returning', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush();
    page.onHide();
    env.reply(3, { data: roster([roster().members[0], member()], 2) }); await flush();
    expect(page.data.members.roster).toBeNull();
    page.onShow(); await flush();
    expect(page.data.members.recoveryAvailable).toBe(true);
    // The known-success write must not replay itself; recovering performs a
    // roster GET so the page learns the version it actually committed.
    page.onRecoverMembers(); await flush();
    const read = env.calls.length - 1;
    expect(env.calls[read].method).toBe('GET');
    env.reply(read, { data: roster([roster().members[0], member()], 2) }); await flush();
    expect(page.data.members.roster.lessonVersion).toBe(2);
    expect(page.data.members.blocking).toBe(false);
    expect(env.calls.filter(call => call.method === 'POST')).toHaveLength(1);
  } finally { env.close(); }
});

it.each([401, 403])('clears a hidden write on %s without retaining retry authority', async (status) => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush();
    page.onHide(); env.reply(3, {}, status); await flush();
    page.onShow(); page.onRecoverMembers(); page.onAddMember(); await flush();
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.members.roster).toBeNull();
    expect(page.data.members.selectedStudentId).toBe('');
    expect(page.data.members.blocking).toBe(false);
    expect(env.calls).toHaveLength(4);
  } finally { env.close(); }
});

it('rejects delayed write success after unloading without setting Page data', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page); page.onAddMember(); await flush(); page.onUnload();
    const count = page.setData.mock.calls.length;
    env.reply(3, { data: roster([member()], 2) }); await flush();
    expect(page.setData).toHaveBeenCalledTimes(count);
    expect(env.calls).toHaveLength(4);
  } finally { env.close(); }
});

it('preserves existing schedule edit/cancel, filters and list pagination', async () => {
  const { env, page } = await loaded();
  try {
    page.onStatusChange({ detail: { value: '1' } }); await flush();
    env.reply(1, lessonPage(1, 21)); await flush();
    page.onLoadMore(); await flush(); expect(new URL(env.calls[2].url).searchParams.get('page')).toBe('2');
    env.reply(2, lessonPage(2, 21)); await flush();
    expect(page.data.items).toHaveLength(21);
    page.onEditTap(tap(lessonId)); expect(env.platform.navigateTo).toHaveBeenCalledTimes(1);
    // navigateTo.fail() asynchronously releases `navigating`; without a flush the
    // cancel tap below is rejected by the navigation guard.
    env.platform.navigateTo.mock.calls[0][0].fail(); await flush();
    page.onCancelTap(tap(lessonId)); await flush();
    const previewIndex = env.calls.findIndex((call) =>
      new URL(call.url).pathname.endsWith('/cancellation-preview'));
    expect(previewIndex).toBeGreaterThanOrEqual(0);
    env.reply(previewIndex, { data: {
      seriesId: null, previewHash: 'a'.repeat(64),
      sessions: [{ id: lesson.id, version: lesson.version,
        startsAt: lesson.startsAt, endsAt: lesson.endsAt }],
    } }); await flush();
    page.onConfirmCancellation(); await flush();
    expect(env.platform.showModal).toHaveBeenCalled();
    env.platform.showModal.mock.calls[0][0].success({ confirm: true });
    await flush();
    const write = env.calls.findIndex((call) =>
      new URL(call.url).pathname.endsWith('/cancel-selection'));
    expect(write).toBeGreaterThanOrEqual(0);
    // The cancel receipt is exactly {seriesId, sessions}; each row carries
    // status:CANCELLED and a version bumped by one from the preview.
    env.reply(write, { data: { seriesId: null, sessions: [{
      id: lesson.id, version: lesson.version + 1, status: 'CANCELLED',
      startsAt: lesson.startsAt, endsAt: lesson.endsAt,
    }] } }); await flush();
    expect(new URL(env.calls[env.calls.length - 1].url).searchParams.get('page')).toBe('1');
  } finally { env.close(); }
});

it.each(['navigation', 'confirmation'])('review regression: remove confirmation respects pending %s', async (kind) => {
  const env = capture(['schedule']);
  try {
    const page = env.instantiate();
    page.onLoad(); page.onShow(); await flush();
    env.reply(0, lessonPage(1, 21)); await flush();
    page.onMembersTap(tap(lessonId)); await flush();
    // The roster must actually contain the removable row; the page rejects a
    // removal for any student that is not currently listed.
    env.reply(1, { data: roster([member(2)]) }); await flush();
    page.onRemoveMemberTap(tap(studentId(2))); await flush();
    expect(page.data.members.removingStudentId).toBe(studentId(2));
    if (kind === 'navigation') page.onEditTap(tap(lessonId));
    else {
      page.onCancelTap(tap(lessonId)); await flush();
      // onCancelTap closes the member panel, so the pending removal is dropped
      // rather than silently coexisting with the cancellation dialog.
      expect(page.data.members.removingStudentId).toBe('');
      const previewIndex = env.calls.findIndex((call) =>
        new URL(call.url).pathname.endsWith('/cancellation-preview'));
      expect(previewIndex).toBeGreaterThanOrEqual(0);
      env.reply(previewIndex, { data: {
        seriesId: null,
        previewHash: 'a'.repeat(64),
        sessions: [{ id: lesson.id, version: lesson.version,
          startsAt: lesson.startsAt, endsAt: lesson.endsAt }],
      } }); await flush();
      // The dialog only enters its confirming state once the operator confirms,
      // after the preview has landed.
      page.onConfirmCancellation(); await flush();
      expect(page.confirming).toBe(true);
    }
    if (kind === 'navigation') expect(page.navigating).toBe(true);
    page.onConfirmRemoveMember(); await flush();
    expect(env.calls.filter(call => call.method !== 'GET')).toHaveLength(kind === 'navigation' ? 0 : 1);
  } finally { env.close(); }
});

it.each([
  ['missing meta', { data: students.slice(0, 20) }],
  ['wrong page', list(students.slice(0, 20), 3, 41)],
  ['inconsistent totals', { ...list(students.slice(0, 20), 1, 26),
    meta: { page: 1, pageSize: 20, total: 26, totalPages: 1 } }],
  ['invalid student', list([{ ...students[0], id: 'invalid' }], 1, 1)],
  ['duplicate student', list([students[0], students[0]], 1, 2)],
])('review regression: malformed search %s becomes a retryable error without page advancement', async (_name, response) => {
  const { env, page } = await opened();
  try {
    const search = page.memberPanel.search(true);
    await flush(); env.reply(2, response);
    const rejected = await search.then(() => false, () => true);
    expect(rejected).toBe(false);
    expect(page.data.members.searching).toBe(false);
    expect(page.data.members.searchError).toBeTruthy();
    expect(page.data.members.searchPage).toBe(0);
    expect(page.data.members.students).toEqual([]);
    page.onMemberSearch(); await flush();
    expect(new URL(env.calls[3].url).searchParams.get('page')).toBe('1');
    env.reply(3, list(students.slice(0, 20), 1, 26)); await flush();
    expect(page.data.members.students).toHaveLength(20);
    expect(page.data.members.searchPage).toBe(1);
  } finally { env.close(); }
});

it('review regression: invalid later search page retains rows and retries that same page', async () => {
  const { env, page } = await opened();
  try {
    await searched(env, page);
    const search = page.memberPanel.search(false);
    await flush(); env.reply(3, list(students.slice(20), 3, 26));
    await search.catch(() => undefined);
    expect(page.data.members.searchError).toBeTruthy();
    expect(page.data.members.searchPage).toBe(1);
    expect(page.data.members.students).toHaveLength(20);
    expect(page.data.members.selectedStudentId).toBe(studentId(2));
    page.onMemberSearchMore(); await flush();
    expect(new URL(env.calls[4].url).searchParams.get('page')).toBe('2');
    env.reply(4, list(students.slice(20), 2, 26)); await flush();
    expect(page.data.members.students).toHaveLength(26);
    expect(page.data.members.searchHasMore).toBe(false);
  } finally { env.close(); }
});
