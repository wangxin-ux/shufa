import * as fs from 'node:fs';
import * as path from 'node:path';

const serviceFile = path.resolve(__dirname, '../pages/super-admin/runtime/campus-subject.service.ts');
const componentFile = path.resolve(__dirname, '../pages/super-admin/components/campus-subjects/index.ts');
const campus = '10000000-0000-4000-8000-000000000001';
const subjectId = '20000000-0000-4000-8000-000000000001';
const archivedId = '20000000-0000-4000-8000-000000000002';
const linkId = '30000000-0000-4000-8000-000000000001';
const subject = { id: subjectId, name: '书法', isActive: true, version: 2 };
const archived = { id: archivedId, name: '绘画旧科目', isActive: false, version: 3 };
const link = { id: linkId, name: '基础课包', studentName: '合成学员', subjectId: archivedId, subjectName: archived.name, version: 4 };
const page = (data: any[], number = 1, pageSize = 20, total = data.length) => ({
  data, meta: { page: number, pageSize, total, totalPages: Math.ceil(total / pageSize) },
});
const envelope = (value: any) => ({ ...value, requestId: 'synthetic-request' });
const fail = (statusCode: number, code = 'CONFLICT') => Object.assign(new Error('内部英文错误不得显示'), { statusCode, code });
const event = (dataset: object = {}, value?: any) => ({ currentTarget: { dataset }, detail: { value } });
const flush = async () => { for (let i = 0; i < 45; i++) await Promise.resolve(); };
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function loadService() {
  expect(fs.existsSync(serviceFile)).toBe(true);
  return require(serviceFile);
}
let env: any;
beforeEach(() => {
  jest.resetModules();
  env = { dataDriver: 'api', apiBaseUrl: 'https://synthetic.invalid/api/', accessToken: 'synthetic-admin' };
  (global as any).wx = { getStorageSync: () => env, request: jest.fn() };
});
afterEach(() => { jest.restoreAllMocks(); delete (global as any).wx; delete (global as any).Component; });

describe('campus subject private runtime', () => {
  it('uses the configured address, bearer, root page envelope and PATCH idempotency body', async () => {
    const calls: any[] = [];
    (wx.request as jest.Mock).mockImplementation((input: any) => {
      calls.push(input);
      input.success({ statusCode: 200, data: input.method === 'GET'
        ? envelope(page([subject])) : envelope({ data: { ...subject, isActive: false, version: 3 } }) });
    });
    const service = loadService().createCampusSubjectService();
    expect(await service.subjects(campus, 1, 20, '书 法')).toEqual(page([subject]));
    await service.update(campus, subjectId, { name: '书法', isActive: false, expectedVersion: 2 }, 'synthetic-key');
    expect(calls[0].url).toBe(`https://synthetic.invalid/api/management/campuses/${campus}/subjects?page=1&pageSize=20&query=${encodeURIComponent('书 法')}`);
    expect(calls[1]).toMatchObject({ method: 'PATCH',
      header: { Authorization: 'Bearer synthetic-admin', 'Idempotency-Key': 'synthetic-key' },
      data: { name: '书法', isActive: false, expectedVersion: 2 } });
  });

  it('fetches every 100-row options page including archived records', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ ...subject, id: `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}` }));
    (wx.request as jest.Mock).mockImplementation((input: any) => input.success({ statusCode: 200,
      data: envelope(page(input.url.includes('page=2&') ? [archived] : first,
        input.url.includes('page=2&') ? 2 : 1, 100, 101)) }));
    const options = await loadService().createCampusSubjectService().allSubjects(campus);
    expect(options).toHaveLength(101);
    expect(options[100]).toEqual(archived);
    expect(wx.request).toHaveBeenCalledTimes(2);
  });

  it('does not expose partial options if a later page fails', async () => {
    let count = 0;
    (wx.request as jest.Mock).mockImplementation((input: any) => {
      if (++count === 2) input.fail({ errMsg: 'request:fail timeout' });
      else input.success({ statusCode: 200, data: envelope(page(Array.from({ length: 100 }, (_, i) =>
        ({ ...subject, id: `20000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}` })), 1, 100, 101)) });
    });
    await expect(loadService().createCampusSubjectService().allSubjects(campus)).rejects.toMatchObject({ statusCode: 0 });
  });

  it('stops complete-directory pagination after the owning component leaves', async () => {
    let pending: any;
    let current = true;
    (wx.request as jest.Mock).mockImplementation((input: any) => { pending = input; });
    const reading = loadService().createCampusSubjectService().allSubjects(campus, () => current);
    current = false;
    pending.success({ statusCode: 200, data: envelope(page(Array.from({ length: 100 }, (_, i) =>
      ({ ...subject, id: `20000000-0000-4000-8000-${String(i + 10).padStart(12, '0')}` })), 1, 100, 101)) });
    await flush();
    expect(wx.request).toHaveBeenCalledTimes(1);
    await expect(reading).rejects.toMatchObject({ code: 'READ_CANCELLED' });
  });

  it('sends class/package queries and null binding with the attribution version', async () => {
    const requests: any[] = [];
    (wx.request as jest.Mock).mockImplementation((input: any) => {
      requests.push(input);
      input.success({ statusCode: 200, data: input.method === 'GET'
        ? envelope(page([link], 2, 20, 21))
        : envelope({ data: { id: linkId, subjectId: null, version: 5 } }) });
    });
    const service = loadService().createCampusSubjectService();
    await service.links(campus, 'CLASS', 2, '班级');
    await service.bind(campus, 'PACKAGE', linkId, { subjectId: null, expectedVersion: 4, reason: '明确清空' }, 'binding-key');
    expect(requests[0].url).toContain(`/subjects/links?kind=CLASS&page=2&pageSize=20&query=${encodeURIComponent('班级')}`);
    expect(requests[1]).toMatchObject({ method: 'PATCH',
      url: `https://synthetic.invalid/api/management/campuses/${campus}/subjects/links/PACKAGE/${linkId}`,
      data: { subjectId: null, expectedVersion: 4, reason: '明确清空' },
      header: { 'Idempotency-Key': 'binding-key' } });
  });

  it('keeps mock campus scopes, search, pages, conflicts and remount readback independent', async () => {
    env = { dataDriver: 'mock', accessToken: 'mock-admin' };
    const module = loadService();
    const service = module.createCampusSubjectService();
    const second = await service.links(campus, 'CLASS', 2, '');
    expect(second.data).toHaveLength(3);
    expect(second.meta.total).toBe(23);
    expect((await service.links(campus, 'CLASS', 1, '合成班级23')).data).toHaveLength(1);
    const created = await service.create(campus, { name: '本校新科目' }, 'new');
    expect((await module.createCampusSubjectService().subjects(campus, 1, 20, '本校新科目')).data).toEqual([created]);
    expect((await service.subjects('another-mock-campus', 1, 20, '本校新科目')).data).toEqual([]);
    await expect(service.update(campus, created.id,
      { name: '不应更新', isActive: true, expectedVersion: 99 }, 'conflict')).rejects.toMatchObject({ statusCode: 409 });
    env = { ...env, accessToken: 'another-admin' };
    expect(service.getSessionKey()).toBe('');
    expect((await module.createCampusSubjectService().subjects(campus, 1, 20, '本校新科目')).data).toEqual([]);
    expect(wx.request).not.toHaveBeenCalled();
  });

  it.each([401, 403, 409, 500])('maps HTTP %s into Chinese without exposing backend messages', async (statusCode) => {
    (wx.request as jest.Mock).mockImplementation((input: any) => input.success({
      statusCode, data: { code: 'SYNTHETIC_ERROR', message: 'Internal error and credentials' },
    }));
    await expect(loadService().createCampusSubjectService().subjects(campus)).rejects.toMatchObject({
      statusCode, message: expect.stringMatching(/[\u4e00-\u9fff]/),
    });
  });

  it('rejects malformed responses and mismatched binding receipts', async () => {
    (wx.request as jest.Mock).mockImplementation((input: any) => input.success({
      statusCode: 200, data: envelope({ data: { id: linkId, subjectId: archivedId, version: 5 } }),
    }));
    await expect(loadService().createCampusSubjectService().bind(campus, 'PACKAGE', linkId,
      { subjectId, expectedVersion: 4, reason: '明确归属' }, 'key')).rejects.toMatchObject({ statusCode: 502 });
  });

  it('rejects old owner replies and prevents further requests on the stale service', async () => {
    let pending: any;
    (wx.request as jest.Mock).mockImplementation((input: any) => { pending = input; });
    const service = loadService().createCampusSubjectService();
    const reading = service.subjects(campus);
    env = { ...env, accessToken: 'different-admin' };
    pending.success({ statusCode: 200, data: envelope(page([subject])) });
    await expect(reading).rejects.toMatchObject({ statusCode: 401 });
    expect(service.getSessionKey()).toBe('');
    await expect(service.subjects(campus)).rejects.toMatchObject({ statusCode: 401 });
    expect(wx.request).toHaveBeenCalledTimes(1);
  });

  it('fails closed for an empty API address without sending a request', async () => {
    env.apiBaseUrl = '';
    await expect(loadService().createCampusSubjectService().subjects(campus)).rejects.toMatchObject({ statusCode: 400 });
    expect(wx.request).not.toHaveBeenCalled();
  });

  it('round trips create, rename, archive, binding and clearing in explicit local mock without HTTP', async () => {
    env = { dataDriver: 'mock', accessToken: 'mock-owner' };
    const service = loadService().createCampusSubjectService();
    const created = await service.create(campus, { name: '合成音乐' }, 'create');
    expect(await service.create(campus, { name: '合成音乐' }, 'create')).toEqual(created);
    await expect(service.create(campus, { name: '别的请求' }, 'create')).rejects.toMatchObject({ statusCode: 409 });
    const links = await service.links(campus, 'PACKAGE', 1, '');
    const row = links.data[0];
    const assigned = await service.bind(campus, 'PACKAGE', row.id,
      { subjectId: created.id, expectedVersion: row.version, reason: '合成明确关联' }, 'bind');
    expect((await service.links(campus, 'PACKAGE', 1, '')).data[0]).toMatchObject({ subjectId: created.id, subjectName: '合成音乐' });
    await service.update(campus, created.id, { name: '合成音乐新名', isActive: false, expectedVersion: created.version }, 'archive');
    expect((await service.links(campus, 'PACKAGE', 1, '')).data[0].subjectName).toBe('合成音乐新名');
    await expect(service.bind(campus, 'PACKAGE', row.id,
      { subjectId: created.id, expectedVersion: assigned.version, reason: '停用不可选' }, 'inactive')).rejects.toMatchObject({ statusCode: 409 });
    await service.bind(campus, 'PACKAGE', row.id,
      { subjectId: null, expectedVersion: assigned.version, reason: '清空合成关联' }, 'clear');
    expect((await service.links(campus, 'PACKAGE', 1, '')).data[0].subjectId).toBeNull();
    expect(wx.request).not.toHaveBeenCalled();
  });
});

describe('campus subject component behavior', () => {
  let component: any;
  let definition: any;
  let runtime: any;
  let owner: string;
  const open = async () => {
    definition.lifetimes.attached.call(component);
    definition.pageLifetimes.show.call(component);
    await flush();
  };
  beforeEach(() => {
    owner = 'owner-a';
    runtime = {
      getSessionKey: () => owner,
      subjects: jest.fn(async (_campus, number = 1, pageSize = 20) => page([subject, archived], number, pageSize, 42)),
      allSubjects: jest.fn(async () => [subject, archived]),
      links: jest.fn(async (_campus, _kind, number = 1) => page([link], number, 20, 42)),
      create: jest.fn(async () => subject),
      update: jest.fn(async () => ({ ...subject, version: 3 })),
      bind: jest.fn(async () => ({ id: linkId, subjectId, version: 5 })),
    };
    const module = loadService();
    jest.spyOn(module, 'createCampusSubjectService').mockReturnValue(runtime);
    (global as any).Component = (config: any) => {
      definition = config;
      component = { ...config.methods, data: { ...structuredClone(config.data), campusId: campus, blocked: false },
        triggerEvent: jest.fn(), setData(patch: object) { Object.assign(this.data, patch); } };
    };
    expect(fs.existsSync(componentFile)).toBe(true);
    require(componentFile);
  });
  afterEach(() => { if (definition) definition.lifetimes.detached.call(component); definition = undefined; });

  it('loads three independent 20-row lists and complete options only once on attached/show', async () => {
    await open();
    expect(runtime.subjects).toHaveBeenCalledTimes(1);
    expect(runtime.subjects).toHaveBeenCalledWith(campus, 1, 20, '');
    expect(runtime.links.mock.calls).toEqual([[campus, 'CLASS', 1, ''], [campus, 'PACKAGE', 1, '']]);
    expect(component.data.subjects.rows).toHaveLength(2);
    expect(component.data.classes.rows).toHaveLength(1);
    expect(component.data.packages.rows).toHaveLength(1);
    expect(component.data.subjectOptions.map((item: any) => item.id)).toEqual([null, subjectId]);
  });

  it('paginates and searches one list without changing other lists', async () => {
    await open();
    component.onPage(event({ lane: 'packages', direction: 1 }));
    await flush();
    expect(runtime.links).toHaveBeenLastCalledWith(campus, 'PACKAGE', 2, '');
    component.onSearchInput(event({ lane: 'classes' }, '指定班级'));
    component.onSearch(event({ lane: 'classes' }));
    await flush();
    expect(runtime.links).toHaveBeenLastCalledWith(campus, 'CLASS', 1, '指定班级');
    expect(component.data.packages.page).toBe(2);
    expect(runtime.subjects).toHaveBeenCalledTimes(1);
    component.onPage(event({ lane: 'packages', direction: -1 }));
    await flush();
    expect(component.data.packages.page).toBe(1);
  });

  it('merges duplicate reads and ignores late search replies and stale denials', async () => {
    await open();
    const old = deferred();
    runtime.links.mockReturnValueOnce(old.promise);
    const request = component.readLane('classes');
    expect(component.readLane('classes')).toBe(request);
    await flush();
    component.onSearchInput(event({ lane: 'classes' }, '新条件'));
    component.onSearch(event({ lane: 'classes' }));
    await flush();
    old.reject(fail(403));
    await request;
    expect(component.data.classes.query).toBe('新条件');
    expect(component.data.forbidden).toBe(false);
  });

  it('keeps successful lists when another list fails and retries only that list', async () => {
    runtime.links.mockImplementation(async (_campus: string, kind: string) => {
      if (kind === 'CLASS') throw fail(0);
      return page([link], 1, 20, 42);
    });
    await open();
    expect(component.data.classes.error).toMatch(/[\u4e00-\u9fff]/);
    expect(component.data.packages.rows).toHaveLength(1);
    component.onRetry(event({ lane: 'classes' }));
    await flush();
    expect(runtime.subjects).toHaveBeenCalledTimes(1);
    expect(runtime.allSubjects).toHaveBeenCalledTimes(1);
  });

  it('retains a loaded page on network failure and retries the requested next page', async () => {
    await open();
    runtime.links.mockRejectedValueOnce(fail(0));
    component.onPage(event({ lane: 'packages', direction: 1 }));
    await flush();
    expect(component.data.packages.rows).toEqual([link]);
    expect(component.data.packages.page).toBe(1);
    component.onRetry(event({ lane: 'packages' }));
    await flush();
    expect(runtime.links).toHaveBeenLastCalledWith(campus, 'PACKAGE', 2, '');
    expect(component.data.packages.page).toBe(2);
  });

  it('does not permit bindings with a partial or failed options directory', async () => {
    runtime.allSubjects.mockRejectedValueOnce(fail(0));
    await open();
    expect(component.data.subjectOptions).toEqual([]);
    component.onBind(event({ lane: 'packages', id: linkId }));
    expect(component.data.binding).toBeNull();
    component.onRetry(event({ lane: 'options' }));
    await flush();
    component.onBind(event({ lane: 'packages', id: linkId }));
    expect(component.data.binding).not.toBeNull();
  });

  it('preserves the archived current label but only assigns active subjects or explicit null with a reason', async () => {
    await open();
    component.onBind(event({ lane: 'packages', id: linkId }));
    expect(component.data.binding.currentLabel).toContain(archived.name);
    expect(component.data.binding.currentLabel).toContain('停用');
    await component.onSaveBinding();
    expect(runtime.bind).not.toHaveBeenCalled();
    component.onClearSubject();
    expect(component.data.binding.subjectId).toBeNull();
    component.onReasonInput(event({}, '清空错误归属'));
    await component.onSaveBinding();
    expect(runtime.bind).toHaveBeenCalledWith(campus, 'PACKAGE', linkId,
      { subjectId: null, expectedVersion: 4, reason: '清空错误归属' }, expect.any(String));
  });

  it('creates and edits normalized names and status without adding a reason field to the subject contract', async () => {
    await open();
    component.onCreate();
    component.onNameInput(event({}, '  音乐  '));
    await component.onSaveSubject();
    expect(runtime.create).toHaveBeenCalledWith(campus, { name: '音乐' }, expect.any(String));
    await flush();
    component.onEdit(event({ id: subjectId }));
    component.onNameInput(event({}, '新书法'));
    component.onActiveChange(event({}, false));
    await component.onSaveSubject();
    expect(runtime.update).toHaveBeenCalledWith(campus, subjectId,
      { name: '新书法', isActive: false, expectedVersion: 2 }, expect.any(String));
  });

  it('locks an unknown mutation and retries the exact original key/body despite attempted edits or double clicks', async () => {
    await open();
    runtime.create.mockRejectedValueOnce(fail(0));
    component.onCreate();
    component.onNameInput(event({}, '唯一科目'));
    await component.onSaveSubject();
    expect(component.data.mutationState).toBe('unknown');
    component.onNameInput(event({}, '被阻止的改名'));
    component.onCreate();
    await component.onSaveSubject();
    expect(runtime.create).toHaveBeenCalledTimes(1);
    const held = deferred();
    runtime.create.mockReturnValueOnce(held.promise);
    const retry = component.onRetryMutation();
    expect(component.onRetryMutation()).toBe(retry);
    await flush();
    expect(runtime.create.mock.calls[1]).toEqual(runtime.create.mock.calls[0]);
    held.resolve(subject);
    await retry;
    expect(component.data.mutationState).toBe('');
  });

  it('treats malformed success and server failures as unknown instead of permitting a new mutation', async () => {
    await open();
    runtime.update.mockRejectedValueOnce(fail(502));
    component.onEdit(event({ id: subjectId }));
    await component.onSaveSubject();
    expect(component.data.mutationState).toBe('unknown');
    component.onCancelEdit();
    expect(component.data.editor).not.toBeNull();
  });

  it('rereads a version conflict without automatically submitting a new version', async () => {
    await open();
    runtime.update.mockRejectedValueOnce(fail(409));
    component.onEdit(event({ id: subjectId }));
    await component.onSaveSubject();
    await flush();
    expect(component.data.notice).toContain('重新选择');
    expect(component.data.editor).toBeNull();
    expect(runtime.subjects).toHaveBeenCalledTimes(2);
    expect(runtime.update).toHaveBeenCalledTimes(1);
  });

  it('retries an unknown binding with its original reason and version', async () => {
    await open();
    component.onBind(event({ lane: 'classes', id: linkId }));
    component.onSubjectPick(event({}, 1));
    component.onReasonInput(event({}, '固定原因'));
    runtime.bind.mockRejectedValueOnce(fail(503));
    await component.onSaveBinding();
    component.onReasonInput(event({}, '不得替换原因'));
    component.onSubjectPick(event({}, 0));
    await component.onRetryMutation();
    expect(runtime.bind.mock.calls[1]).toEqual(runtime.bind.mock.calls[0]);
    expect(runtime.bind.mock.calls[1][3]).toEqual({ subjectId, expectedVersion: 4, reason: '固定原因' });
  });

  it('keeps the original operation locked on an idempotency-in-progress 409', async () => {
    await open();
    component.onCreate();
    component.onNameInput(event({}, '唯一提交'));
    runtime.create.mockRejectedValueOnce(fail(0)).mockRejectedValueOnce(fail(409, 'IDEMPOTENCY_CONFLICT'));
    await component.onSaveSubject();
    await component.onRetryMutation();
    expect(component.data.mutationState).toBe('unknown');
    await component.onRetryMutation();
    expect(runtime.create.mock.calls[2]).toEqual(runtime.create.mock.calls[0]);
  });

  it('hides all data and drafts, then restores only a same-owner unknown operation for safe replay', async () => {
    await open();
    const held = deferred();
    runtime.create.mockReturnValueOnce(held.promise);
    component.onCreate();
    component.onNameInput(event({}, '离页科目'));
    const saving = component.onSaveSubject();
    await flush();
    definition.pageLifetimes.hide.call(component);
    expect(component.data.subjects.rows).toEqual([]);
    expect(component.data.editor).toBeNull();
    held.resolve(subject);
    await saving;
    expect(component.data.subjects.rows).toEqual([]);
    definition.pageLifetimes.show.call(component);
    await flush();
    expect(component.data.mutationState).toBe('unknown');
    await component.onRetryMutation();
    expect(runtime.create.mock.calls[1]).toEqual(runtime.create.mock.calls[0]);
  });

  it.each([401, 403])('clears every list and pending draft on %s and stops further reads', async (statusCode) => {
    await open();
    runtime.create.mockRejectedValueOnce(fail(statusCode));
    component.onCreate();
    component.onNameInput(event({}, '私有草稿'));
    await component.onSaveSubject();
    expect(component.data.forbidden).toBe(true);
    expect(component.data.subjects.rows).toEqual([]);
    expect(component.data.packages.rows).toEqual([]);
    expect(component.data.editor).toBeNull();
    const count = runtime.subjects.mock.calls.length;
    component.onRetry(event({ lane: 'subjects' }));
    definition.pageLifetimes.show.call(component);
    await flush();
    expect(runtime.subjects).toHaveBeenCalledTimes(count);
    expect(component.triggerEvent).toHaveBeenCalledWith('forbidden', { message: expect.any(String) });
    definition.pageLifetimes.hide.call(component);
    definition.pageLifetimes.show.call(component);
    await flush();
    expect(component.data.forbidden).toBe(true);
    expect(component.data.forbiddenMessage).toMatch(/[\u4e00-\u9fff]/);
    expect(runtime.subjects).toHaveBeenCalledTimes(count);
  });

  it('clears and stops after an owner change even if a read returns success', async () => {
    await open();
    const held = deferred();
    runtime.subjects.mockReturnValueOnce(held.promise);
    const reading = component.readLane('subjects');
    await flush();
    owner = 'owner-b';
    held.resolve(page([subject]));
    await reading;
    expect(component.data.forbidden).toBe(true);
    expect(component.data.subjectOptions).toEqual([]);
    expect(component.data.subjects.rows).toEqual([]);
  });

  it('does not send queued reads after hide, detach or a parent block', async () => {
    definition.lifetimes.attached.call(component);
    component.data.blocked = true;
    definition.properties.blocked.observer.call(component, true);
    await flush();
    expect(runtime.subjects).not.toHaveBeenCalled();
    expect(runtime.links).not.toHaveBeenCalled();
  });

  it.each(['hide', 'detached'])('does not send attached reads after immediate %s', async (lifecycle) => {
    definition.lifetimes.attached.call(component);
    if (lifecycle === 'hide') definition.pageLifetimes.hide.call(component);
    else definition.lifetimes.detached.call(component);
    await flush();
    expect(runtime.subjects).not.toHaveBeenCalled();
    expect(runtime.allSubjects).not.toHaveBeenCalled();
  });

  it('rejects old campus replies when the property changes', async () => {
    const held = deferred();
    runtime.subjects.mockReturnValueOnce(held.promise);
    await open();
    const nextCampus = '10000000-0000-4000-8000-000000000002';
    component.data.campusId = nextCampus;
    definition.properties.campusId.observer.call(component, nextCampus);
    await flush();
    held.resolve(page([{ ...subject, name: '旧校区不应出现' }]));
    await flush();
    expect(component.data.subjects.rows[0].name).toBe(subject.name);
    expect(runtime.subjects).toHaveBeenLastCalledWith(nextCampus, 1, 20, '');
  });

  it('connects the real component and configured service through root HTTP envelopes', async () => {
    jest.restoreAllMocks();
    const requests: any[] = [];
    let saved: any;
    (wx.request as jest.Mock).mockImplementation((input: any) => {
      requests.push(input);
      if (input.method === 'POST') {
        saved = { ...subject, id: '54000000-0000-4000-8000-000000000100', name: input.data.name, version: 1 };
        input.success({ statusCode: 200, data: envelope({ data: saved }) });
      } else if (input.method === 'PATCH') {
        input.success({ statusCode: 200, data: envelope({ data: { id: linkId, subjectId: null, version: 5 } }) });
      } else {
        const size = input.url.includes('pageSize=100') ? 100 : 20;
        input.success({ statusCode: 200, data: envelope(page(input.url.includes('/links?')
          ? [link] : [subject, archived, ...(saved ? [saved] : [])], 1, size)) });
      }
    });
    await open();
    expect(requests).toHaveLength(4);
    component.onCreate();
    component.onNameInput(event({}, '新科目'));
    await component.onSaveSubject();
    await flush();
    expect(component.data.subjects.rows.some((item: any) => item.name === '新科目')).toBe(true);
    component.onBind(event({ lane: 'packages', id: linkId }));
    component.onClearSubject();
    component.onReasonInput(event({}, '清空归属'));
    await component.onSaveBinding();
    expect(requests.find((input) => input.method === 'PATCH')).toMatchObject({
      data: { subjectId: null, expectedVersion: 4, reason: '清空归属' },
      header: { 'Idempotency-Key': expect.any(String) },
    });
  });

  it('mounts only inside ready campus content with private component files', () => {
    const root = path.resolve(__dirname, '..');
    const json = JSON.parse(fs.readFileSync(path.join(root, 'pages/super-admin/campus-detail/index.json'), 'utf8'));
    expect(json.usingComponents['campus-subjects']).toBe('../components/campus-subjects/index');
    const markup = fs.readFileSync(path.join(root, 'pages/super-admin/campus-detail/index.wxml'), 'utf8');
    expect(markup).toMatch(/<campus-subjects\b[^>]*\bcampus-id="\{\{campusId\}\}"/);
    const componentMarkup = fs.readFileSync(componentFile.replace('.ts', '.wxml'), 'utf8');
    for (const handler of ['onSaveSubject', 'onSaveBinding', 'onClearSubject', 'onPage', 'onSearch', 'onRetryMutation']) {
      expect(componentMarkup).toContain(handler);
    }
  });
});
