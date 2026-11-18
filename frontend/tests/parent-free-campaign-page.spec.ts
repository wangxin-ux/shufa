export {};
import * as fs from 'fs';
import * as path from 'path';
import type { SessionHttpRequestOptions } from '../services/session.service';

const campaignId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000002';
const studentId = '00000000-0000-4000-8000-000000000003';
const registrationId = '00000000-0000-4000-8000-000000000004';
const configuration = {
  title: '合成免费活动', campaignType: 'FREE_REGISTRATION', shareDescription: '纯文本登记',
  contactPhone: '0000', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2030-10-01T00:00:00.000Z',
  timezone: 'Asia/Shanghai', capacityMode: 'UNLIMITED', maxRegistrations: null,
  feeFen: 0, benefitMode: 'NONE', registrationLimit: 'ONCE_PER_STUDENT',
};
const receipt = {
  registrationId, campaignId, versionId, studentId, status: 'REGISTERED', version: 1,
  registeredAt: '2026-10-13T00:00:00.000Z', cancelledAt: null,
};
const result = {
  ...receipt, title: configuration.title, startsAt: configuration.startsAt,
  endsAt: configuration.endsAt, timezone: configuration.timezone, canCancel: true,
};
const detail = {
  campaignId, versionId, configuration, availability: 'AVAILABLE', registeredCount: 0,
  remainingRegistrations: null,
  eligibleStudents: [{ studentId, displayName: '合成学员', eligibility: 'ELIGIBLE', registration: null }],
};
const summary = {
  campaignId, versionId, title: configuration.title, startsAt: configuration.startsAt,
  endsAt: configuration.endsAt, timezone: configuration.timezone, availability: 'AVAILABLE',
  registeredCount: 0, maxRegistrations: null, remainingRegistrations: null,
};
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); };
describe('parent free campaign actual Page through defaultRequest', () => {
  let page: any;
  let runtime: { dataDriver: string; apiBaseUrl: string; accessToken: string };
  let calls: SessionHttpRequestOptions[];
  let respond: (options: SessionHttpRequestOptions) => void;
  let host: Record<string, any>;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const success = (options: SessionHttpRequestOptions, data: unknown, meta?: object) =>
    options.success({ statusCode: 200, data: { data, requestId: 'synthetic-page', ...(meta ? { meta } : {}) } });
  const failure = (options: SessionHttpRequestOptions, statusCode: number) =>
    options.success({ statusCode, data: { error: { code: 'CONFLICT', message: 'internal' } } });
  const open = async (query: object = { campaignId, versionId }) => {
    page.onLoad(query);
    page.onShow();
    await flush();
  };
  const select = () => page.onStudentChange({ detail: { value: studentId } });
  beforeEach(() => {
    calls = [];
    runtime = { dataDriver: 'api', apiBaseUrl: 'http://127.0.0.1:3001', accessToken: 'synthetic-parent' };
    host = globalThis as any;
    for (const key of ['wx', 'Page', 'getCurrentPages']) originals.set(key, Object.getOwnPropertyDescriptor(host, key));
    respond = (options) => {
      if (options.method === 'POST') success(options, receipt);
      else if (/campaign-registrations\/[^/?]+$/.test(options.url)) success(options, result);
      else if (/free-campaigns\/[^/?]+/.test(options.url)) success(options, detail);
      else success(options, options.url.includes('campaign-registrations') ? [result] : [summary],
        { page: 1, pageSize: 20, total: 1, totalPages: 1 });
    };
    host.wx = {
      getStorageSync: () => runtime,
      setStorageSync: jest.fn(),
      request: (options: SessionHttpRequestOptions) => { calls.push(options); void Promise.resolve().then(() => respond(options)); },
      showModal: jest.fn(), reLaunch: jest.fn(), navigateTo: jest.fn(), stopPullDownRefresh: jest.fn(),
    };
    host.getCurrentPages = () => [page];
    host.Page = (definition: any) => {
      page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
    jest.isolateModules(() => jest.requireActual('../pages/parent/campaign-registration/index.ts'));
  });
  afterEach(async () => {
    page?.onUnload();
    await flush();
    jest.useRealTimers();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(host, key, descriptor);
      else Reflect.deleteProperty(host, key);
    }
    originals.clear();
  });
  it('loads an approved deep link once and takes status and occupancy from the server', async () => {
    await open();
    expect(calls).toHaveLength(1);
    expect(page.data).toMatchObject({ viewState: 'ready', campaign: { availability: 'AVAILABLE', registeredCount: 0 } });
    expect(page.data.selectedStudentId).toBe('');
  });
  it.each(['CLOSED', 'REPLACED', 'NOT_STARTED', 'ENDED', 'FULL'])('never posts for server availability %s', async (availability) => {
    respond = (options) => success(options, { ...detail, availability });
    await open();
    select();
    await page.onRegister();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
  it('does not expose a different guardian registration or invent cancellation rights', async () => {
    respond = (options) => success(options, { ...detail, eligibleStudents: [
      { ...detail.eligibleStudents[0], eligibility: 'ALREADY_REGISTERED', registration: null },
    ] });
    await open();
    select();
    await page.onRegister();
    expect(page.data.registration).toBeNull();
    expect(calls).toHaveLength(1);
  });
  it('deduplicates register and reads the current result after an original execution receipt', async () => {
    await open();
    select();
    const base = respond;
    respond = (options) => options.url.includes('/campaign-registrations/')
      ? success(options, { ...result, status: 'CANCELLED', version: 2, canCancel: false, cancelledAt: '2026-10-13T01:00:00.000Z' })
      : base(options);
    const a = page.onRegister();
    const b = page.onRegister();
    await Promise.all([a, b]);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(page.data.registration.status).toBe('CANCELLED');
    expect(page.data.registration.canCancel).toBe(false);
  });
  it('retries unknown registration using the same key and student/version', async () => {
    await open();
    select();
    const base = respond;
    let lost = true;
    respond = (options) => {
      if (options.method === 'POST' && lost) { lost = false; options.fail({}); }
      else base(options);
    };
    await page.onRegister();
    expect(page.data.uncertain).toBe(true);
    page.onStudentChange({ detail: { value: registrationId } });
    await page.onRegister();
    const writes = calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[1].data).toEqual(writes[0].data);
    expect(writes[1].header['Idempotency-Key']).toBe(writes[0].header['Idempotency-Key']);
    expect(page.data.registration.status).toBe('REGISTERED');
  });
  it('keeps selection on 409 and requires explicit refresh before a new write', async () => {
    await open();
    select();
    const base = respond;
    respond = (options) => options.method === 'POST' ? failure(options, 409) : base(options);
    await page.onRegister();
    expect(page.data).toMatchObject({ conflict: true, selectedStudentId: studentId });
    await page.onRegister();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    await page.onReload();
    expect(page.data).toMatchObject({ conflict: false, selectedStudentId: studentId });
  });
  it.each([401, 403])('clears all private content on HTTP %s', async (status) => {
    await open();
    select();
    respond = (options) => failure(options, status);
    await page.onRegister();
    expect(page.data).toMatchObject({
      viewState: 'forbidden', campaign: null, registration: null, selectedStudentId: '',
      campaigns: [], registrations: [], uncertain: false,
    });
  });
  it('keeps a committed receipt separate when reading current result fails, retrying only GET', async () => {
    await open();
    select();
    const base = respond;
    let broken = true;
    respond = (options) => {
      if (options.url.includes('/campaign-registrations/') && broken) options.fail({});
      else base(options);
    };
    await page.onRegister();
    expect(page.data).toMatchObject({ readbackRequired: true, registration: null });
    broken = false;
    await page.onReload();
    expect(page.data.registration.status).toBe('REGISTERED');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
  it('applies a hidden write only after show and rereads its current result', async () => {
    await open();
    select();
    const base = respond;
    let held!: SessionHttpRequestOptions;
    respond = (options) => options.method === 'POST' ? (held = options) : base(options);
    const saving = page.onRegister();
    await flush();
    page.onHide();
    success(held, receipt);
    await saving;
    expect(page.data.registration).toBeNull();
    page.onShow();
    await flush();
    expect(page.data.registration.status).toBe('REGISTERED');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });
  it('drops a delayed old response after same-page credential replacement', async () => {
    let held!: SessionHttpRequestOptions;
    respond = (options) => { held = options; };
    await open();
    runtime.accessToken = 'another-parent';
    success(held, detail);
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', campaign: null, selectedStudentId: '' });
  });
  it.each(
    (['campaign', 'campaign-list', 'registration-list', 'registration'] as const)
      .flatMap((mode) => (['old-first', 'new-first'] as const).map((order) => ({ mode, order }))),
  )('rereads $mode after hide/show with the same token and ignores $order stale data', async ({ mode, order }) => {
    const base = respond;
    const held: SessionHttpRequestOptions[] = [];
    const matches = (url: string) => mode === 'campaign'
      ? /\/free-campaigns\/[^/?]+/.test(url)
      : mode === 'campaign-list' ? url.includes('/free-campaigns?')
        : mode === 'registration-list' ? url.includes('/campaign-registrations?')
          : /\/campaign-registrations\/[^/?]+$/.test(url);
    respond = (options) => matches(options.url) ? held.push(options) : base(options);
    await open(mode === 'campaign' ? { campaignId, versionId } : {});
    if (mode === 'registration-list' || mode === 'registration') {
      page.onTabChange({ currentTarget: { dataset: { tab: 'REGISTRATIONS' } } });
      await flush();
    }
    if (mode === 'registration') {
      void page.onOpenRegistration({ currentTarget: { dataset: { id: registrationId } } });
      await flush();
    }
    expect(held).toHaveLength(1);
    const tokenBefore = runtime.accessToken;
    page.onHide();
    page.onShow();
    await flush();
    const old = held[0];
    const fresh = held[1];
    const oldReply = () => success(old, mode === 'campaign' ? detail : mode === 'registration' ? result
      : mode === 'campaign-list' ? [summary] : [result],
    mode.endsWith('-list') ? { page: 1, pageSize: 20, total: 1, totalPages: 1 } : undefined);
    const freshReply = () => {
      if (!fresh) return;
      if (mode === 'campaign') success(fresh, { ...detail, eligibleStudents: [] });
      else if (mode === 'registration-list') success(fresh, [], { page: 1, pageSize: 20, total: 0, totalPages: 0 });
      else failure(fresh, 403);
    };
    if (order === 'old-first') { oldReply(); await flush(); freshReply(); }
    else { freshReply(); await flush(); oldReply(); }
    await flush();
    expect(runtime.accessToken).toBe(tokenBefore);
    if (mode === 'campaign') expect(page.data.campaign.eligibleStudents).toEqual([]);
    else if (mode === 'registration-list') expect(page.data).toMatchObject({ viewState: 'empty', registrations: [] });
    else expect(page.data).toMatchObject({ viewState: 'forbidden', campaign: null, registration: null, campaigns: [] });
    expect(held).toHaveLength(2);
  });
  it('does not set data after unloading a pending read', async () => {
    let held!: SessionHttpRequestOptions;
    respond = (options) => { held = options; };
    await open();
    page.onUnload();
    const before = page.setData.mock.calls.length;
    success(held, detail);
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(before);
  });
  it('shows both independent lists and handles pagination with stable ID deduplication', async () => {
    await open({});
    expect(page.data.campaigns).toHaveLength(1);
    const base = respond;
    respond = (options) => {
      if (options.url.endsWith('page=2&pageSize=20')) success(options, [summary],
        { page: 2, pageSize: 20, total: 21, totalPages: 2 });
      else base(options);
    };
    page.setData({ hasMore: true });
    const a = page.onReachBottom();
    const b = page.onReachBottom();
    await Promise.all([a, b]);
    expect(page.data.campaigns).toHaveLength(1);
    page.onTabChange({ currentTarget: { dataset: { tab: 'REGISTRATIONS' } } });
    await flush();
    expect(page.data.registrations).toHaveLength(1);
    expect(page.data.campaigns).toHaveLength(0);
  });
  it('requires native confirmation and consumes a cancellation callback once', async () => {
    await open({});
    page.onTabChange({ currentTarget: { dataset: { tab: 'REGISTRATIONS' } } });
    await flush();
    await page.onOpenRegistration({ currentTarget: { dataset: { id: registrationId } } });
    page.onCancel();
    page.onCancel();
    expect(host.wx.showModal).toHaveBeenCalledTimes(1);
    const modal = host.wx.showModal.mock.calls[0][0];
    modal.success({ confirm: false, cancel: true });
    await flush();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    page.onCancel();
    const second = host.wx.showModal.mock.calls[1][0];
    const base = respond;
    respond = (options) => options.method === 'POST'
      ? success(options, { ...receipt, status: 'CANCELLED', version: 2, cancelledAt: '2026-10-13T01:00:00.000Z' })
      : options.url.includes('/campaign-registrations/')
        ? success(options, { ...result, status: 'CANCELLED', version: 2, cancelledAt: '2026-10-13T01:00:00.000Z', canCancel: false })
        : base(options);
    second.success({ confirm: true });
    second.success({ confirm: true });
    await flush();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(page.data.registration.status).toBe('CANCELLED');
  });
  it('invalidates a cancellation confirmation after hide', async () => {
    await open({});
    page.onTabChange({ currentTarget: { dataset: { tab: 'REGISTRATIONS' } } });
    await flush();
    await page.onOpenRegistration({ currentTarget: { dataset: { id: registrationId } } });
    page.onCancel();
    const modal = host.wx.showModal.mock.calls[0][0];
    page.onHide();
    modal.success({ confirm: true });
    await flush();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
  });
  it('keeps a 409 conflict over hide/show until the user explicitly rereads', async () => {
    await open();
    select();
    const base = respond;
    respond = (options) => options.method === 'POST' ? failure(options, 409) : base(options);
    await page.onRegister();
    const count = calls.length;
    page.onHide();
    page.onShow();
    await flush();
    expect(page.data.conflict).toBe(true);
    expect(calls).toHaveLength(count);
    await page.onReload();
    expect(page.data.conflict).toBe(false);
    expect(page.data.selectedStudentId).toBe(studentId);
  });
  it('does not let an old login confirmation log out the replacement session', async () => {
    await open();
    page.onLogin();
    const modal = host.wx.showModal.mock.calls[0][0];
    runtime.accessToken = 'replacement-parent';
    modal.success({ confirm: true });
    await flush();
    expect(host.wx.reLaunch).not.toHaveBeenCalled();
    expect(host.wx.setStorageSync).not.toHaveBeenCalled();
  });
  it('keeps an explicit login exit usable after the page has detected a replaced session', async () => {
    await open();
    runtime.accessToken = 'replacement-parent';
    page.onShow();
    expect(page.data.viewState).toBe('forbidden');
    page.onLogin();
    expect(host.wx.showModal).toHaveBeenCalledTimes(1);
    host.wx.showModal.mock.calls[0][0].success({ confirm: true });
    expect(host.wx.setStorageSync).toHaveBeenCalledWith('education.session.logged-out', true);
    expect(host.wx.setStorageSync).toHaveBeenCalledWith('education.runtime', expect.objectContaining({ accessToken: '' }));
    expect(host.wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/bootstrap/index' });
  });
  it('does not let a login prompt from an obsolete runtime log out a later account', async () => {
    await open();
    runtime.apiBaseUrl = 'http://127.0.0.1:3002';
    page.onShow();
    expect(page.data.viewState).toBe('forbidden');
    page.onLogin();
    expect(host.wx.showModal).toHaveBeenCalledTimes(1);
    runtime.accessToken = 'later-parent';
    host.wx.showModal.mock.calls[0][0].success({ confirm: true });
    await flush();
    expect(host.wx.reLaunch).not.toHaveBeenCalled();
    expect(host.wx.setStorageSync).not.toHaveBeenCalled();
  });
  it('retries an unknown cancellation without another confirmation, preserving its key/version', async () => {
    await open({});
    page.onTabChange({ currentTarget: { dataset: { tab: 'REGISTRATIONS' } } });
    await flush();
    await page.onOpenRegistration({ currentTarget: { dataset: { id: registrationId } } });
    const base = respond;
    let lost = true;
    respond = (options) => {
      if (options.method === 'POST') {
        if (lost) { lost = false; options.fail({}); }
        else success(options, { ...receipt, status: 'CANCELLED', version: 2, cancelledAt: '2026-10-13T01:00:00.000Z' });
      } else if (options.url.includes('/campaign-registrations/')) {
        success(options, { ...result, status: 'CANCELLED', version: 2, canCancel: false, cancelledAt: '2026-10-13T01:00:00.000Z' });
      } else base(options);
    };
    page.onCancel();
    host.wx.showModal.mock.calls[0][0].success({ confirm: true });
    await flush();
    expect(page.data.uncertain).toBe(true);
    await page.onRetryWrite();
    const writes = calls.filter((call) => call.method === 'POST');
    expect(writes).toHaveLength(2);
    expect(writes[1].data).toEqual(writes[0].data);
    expect(writes[1].header['Idempotency-Key']).toBe(writes[0].header['Idempotency-Key']);
    expect(host.wx.showModal).toHaveBeenCalledTimes(1);
    expect(page.data.registration.status).toBe('CANCELLED');
  });
  it('ignores stale list success after switching to the private results tab', async () => {
    let held!: SessionHttpRequestOptions;
    const base = respond;
    respond = (options) => options.url.includes('/free-campaigns?') ? (held = options) : base(options);
    await open({});
    page.onTabChange({ currentTarget: { dataset: { tab: 'REGISTRATIONS' } } });
    await flush();
    success(held, [summary], { page: 1, pageSize: 20, total: 1, totalPages: 1 });
    await flush();
    expect(page.data.tab).toBe('REGISTRATIONS');
    expect(page.data.campaigns).toHaveLength(0);
    expect(page.data.registrations).toHaveLength(1);
  });
  it('starts a fresh list read when returning to a tab whose old GET is still held', async () => {
    const base = respond;
    const held: SessionHttpRequestOptions[] = [];
    respond = (options) => options.url.includes('/free-campaigns?') ? held.push(options) : base(options);
    await open({});
    page.onTabChange({ currentTarget: { dataset: { tab: 'REGISTRATIONS' } } });
    await flush();
    page.onTabChange({ currentTarget: { dataset: { tab: 'CAMPAIGNS' } } });
    await flush();
    expect(held).toHaveLength(2);
    failure(held[1], 403);
    await flush();
    success(held[0], [summary], { page: 1, pageSize: 20, total: 1, totalPages: 1 });
    await flush();
    expect(page.data).toMatchObject({ viewState: 'forbidden', campaigns: [], registrations: [] });
  });
});
describe('parent free campaign local page surface', () => {
  const root = path.resolve(__dirname, '..');
  const read = (file: string) => fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : '';
  it('adds a distinct free entry without changing the legacy paid route', () => {
    expect(read('pages/parent/group-campaigns/index.ts')).toContain('/pages/parent/campaign-registration/index');
    expect(read('pages/parent/group-campaigns/index.wxml')).toContain('bindtap="onFreeCampaigns"');
    expect(read('pages/parent/group-campaigns/index.ts')).toContain('/pages/parent/group-detail/index?id=');
  });
  it('uses the existing shell, private font, native student radio and plain text', () => {
    const markup = read('pages/parent/campaign-registration/index.wxml');
    expect(markup).toContain('<parent-page-shell');
    expect(markup).toContain('<radio-group');
    expect(markup).toContain('我的报名');
    expect(markup).not.toContain('<rich-text');
    expect(read('pages/parent/campaign-registration/index.wxss')).toContain('../runtime/parent-pdf-font.wxss');
  });
});
