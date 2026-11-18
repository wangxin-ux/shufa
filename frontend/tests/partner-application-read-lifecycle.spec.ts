import { LOCAL_RUNTIME_STORAGE_KEY } from '../config/local-runtime';
import { PartnerApplicantSessionService } from '../pages/partner/runtime/partner-applicant-session.service';
import { PartnerApplicationService } from '../pages/partner/runtime/partner-application.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const getRuntime = jest.fn();
jest.mock('../pages/partner/runtime/partner-application-runtime', () => ({
  getPartnerApplicationRuntime: () => getRuntime(),
}));
const identity = {
  applicantId: '03f20536-7c49-4eb0-bc68-f66ce27a735a',
  displayName: '合成申请人', formalAccountReady: false,
};
const draft = (version: number, contactPhone = '0000-00000000') => ({
  applicationId: '55883f08-c9f5-4f26-927c-82ea07cb8a02', status: 'DRAFT', version,
  basicInformation: {
    institutionName: '合成机构', province: null, city: null, district: null, detailedAddress: null,
    contactPhone,
  },
  createdAt: '2026-10-09T08:00:00.000Z', updatedAt: '2026-10-09T08:00:00.000Z',
});

describe('application Page with real restricted read services and memory transport', () => {
  let page: any;
  let stored: Record<string, any>;
  let calls: SessionHttpRequestOptions[];
  let sessions: PartnerApplicantSessionService;
  let applications: PartnerApplicationService;
  const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
  const respond = (index: number, value: unknown, statusCode = 200) => calls[index].success({
    statusCode,
    data: statusCode === 200
      ? { data: value, requestId: 'synthetic-read' }
      : { code: statusCode === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', message: '合成旧读取失败' },
  });
  beforeEach(() => {
    stored = {
      accessToken: 'synthetic-formal-token',
      partnerApplicantSession: {
        token: 'synthetic-applicant-token', expiresAt: new Date(Date.now() + 900_000).toISOString(),
        me: { ...identity },
      },
    };
    calls = [];
    sessions = new PartnerApplicantSessionService({
      apiBaseUrl: 'http://127.0.0.1:3000',
      storage: {
        get: (key) => key === LOCAL_RUNTIME_STORAGE_KEY ? stored : undefined,
        set: (_key, value) => { stored = value as Record<string, any>; },
      },
      request: (options) => { calls.push(options); },
      loginCodeProvider: jest.fn(() => { throw new Error('不得自动登录'); }),
    });
    applications = new PartnerApplicationService(sessions);
    getRuntime.mockReset().mockReturnValue({ sessions, applications });
    (global as any).wx = {
      getWindowInfo: () => ({ statusBarHeight: 24, windowWidth: 375 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 280, height: 32 }),
      navigateBack: jest.fn(), reLaunch: jest.fn(), showModal: jest.fn(),
      stopPullDownRefresh: jest.fn(),
    };
    (global as any).getCurrentPages = () => [{}, page];
    (global as any).Page = (config: any) => {
      page = { ...config, data: { ...config.data, form: { ...config.data.form } } };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
    };
    jest.isolateModules(() => require('../pages/partner/application/index'));
  });
  afterEach(() => {
    page.onUnload();
    delete (global as any).wx;
    delete (global as any).Page;
    delete (global as any).getCurrentPages;
  });
  it.each([0, 1].flatMap((deniedRead) => [401, 403].flatMap((statusCode) =>
    [false, true].map((ordinaryFailureFirst) => ({ deniedRead, statusCode, ordinaryFailureFirst })),
  )))('clears loaded private data for read $deniedRead status $statusCode with earlier sibling failure $ordinaryFailureFirst',
    async ({ deniedRead, statusCode, ordinaryFailureFirst }) => {
      page.onLoad(); page.onShow(); await flush();
      respond(0, identity); respond(1, draft(1)); await flush();
      expect(page.data.form.contactPhone).toBe('0000-00000000');
      const pending = page.loadDraft(); await flush();
      expect(calls).toHaveLength(4);
      const sibling = 1 - deniedRead;
      if (ordinaryFailureFirst) {
        respond(2 + sibling, null, 503);
        await pending;
        expect(page.data.viewState).toBe('error');
      }
      respond(2 + deniedRead, null, statusCode); await flush();
      expect(page.data).toMatchObject({
        viewState: 'login', applicationId: '', version: 0, identityLabel: '',
        form: { institutionName: '', contactPhone: '' }, reviewHistory: [],
      });
      expect(page.ownerKey).toBe('');
      if (!ordinaryFailureFirst) {
        respond(2 + sibling, sibling === 0 ? identity : draft(99));
        await pending; await flush();
        expect(page.data.viewState).toBe('login');
        expect(page.data.form.contactPhone).toBe('');
      }
      expect(stored.accessToken).toBe('synthetic-formal-token');
    });
  it.each([0, 1].flatMap((deniedRead) => [401, 403].flatMap((statusCode) =>
    ['return', 'replacement'].map((boundary) => ({ deniedRead, statusCode, boundary })),
  )))('keeps fresh applicant data after a failed pair and old read $deniedRead status $statusCode across $boundary',
    async ({ deniedRead, statusCode, boundary }) => {
      page.onLoad(); page.onShow(); await flush();
      respond(0, identity); respond(1, draft(1)); await flush();
      const pending = page.loadDraft(); await flush();
      respond(2 + 1 - deniedRead, null, 503); await pending;
      expect(page.data.viewState).toBe('error');
      page.onHide();
      if (boundary === 'replacement') stored.partnerApplicantSession.token = 'synthetic-replacement-token';
      page.onShow(); await flush();
      expect(calls).toHaveLength(6);
      respond(4, identity); respond(5, draft(4, '0000-00000004')); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', version: 4, form: { contactPhone: '0000-00000004' } });
      const writes = page.setData.mock.calls.length;
      const credentials = JSON.stringify(stored);
      respond(2 + deniedRead, null, statusCode); await flush();
      expect(page.setData).toHaveBeenCalledTimes(writes);
      expect(page.data).toMatchObject({ viewState: 'ready', version: 4, form: { contactPhone: '0000-00000004' } });
      expect(JSON.stringify(stored)).toBe(credentials);
      expect(calls).toHaveLength(6);
    });
  it.each([200, 403, 401])('starts fresh reads after failed return and ignores both old reads with status %s', async (status) => {
    page.onLoad();
    page.onShow();
    await flush();
    expect(calls).toHaveLength(2);
    page.onBack();
    (global as any).wx.navigateBack.mock.calls[0][0].fail();
    (global as any).wx.reLaunch.mock.calls[0][0].fail();
    page.onRetry();
    await flush();
    expect(calls).toHaveLength(4);
    expect(calls.map((call) => call.method)).toEqual(['GET', 'GET', 'GET', 'GET']);
    respond(2, { ...identity, formalAccountReady: true });
    respond(3, draft(4, '0000-00000004'));
    await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4, readonly: true });
    expect(page.data.form.contactPhone).toBe('0000-00000004');
    const writes = page.setData.mock.calls.length;
    respond(0, identity, status);
    respond(1, draft(99, '0000-00000009'), status);
    await flush();
    expect(page.setData).toHaveBeenCalledTimes(writes);
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4, readonly: true });
    expect(page.data.form.contactPhone).toBe('0000-00000004');
    expect(stored.partnerApplicantSession.me.formalAccountReady).toBe(true);
    expect(sessions.getToken()).toBe('synthetic-applicant-token');
    expect(stored.accessToken).toBe('synthetic-formal-token');
  });
  it.each(['return', 'replacement', 'failed-back'].flatMap((boundary) =>
    [200, 401, 403].map((status) => ({ boundary, status })),
  ))('keeps a new refresh running after old status $status across $boundary', async ({ boundary, status }) => {
    page.onLoad(); page.onShow(); await flush();
    respond(0, identity); respond(1, draft(1)); await flush();
    page.onPullDownRefresh(); await flush();
    expect(calls).toHaveLength(4);
    if (boundary === 'failed-back') {
      page.onBack();
      (global as any).wx.navigateBack.mock.calls[0][0].fail();
      (global as any).wx.reLaunch.mock.calls[0][0].fail();
    } else {
      page.onHide();
      if (boundary === 'replacement') stored.partnerApplicantSession.token = 'synthetic-new-applicant-token';
      page.onShow();
    }
    page.onPullDownRefresh(); await flush();
    expect(calls).toHaveLength(6);
    respond(2, identity, status); respond(3, draft(99), status); await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    expect(page.data.viewState).toBe('loading');
    respond(4, identity); respond(5, draft(4)); await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4 });
    expect(sessions.getToken()).toBe(boundary === 'replacement'
      ? 'synthetic-new-applicant-token' : 'synthetic-applicant-token');
  });
  it.each(['hidden', 'unloaded', 'navigating'])('ignores a queued refresh while %s', async (boundary) => {
    page.onLoad(); page.onShow(); await flush();
    respond(0, identity); respond(1, draft(1)); await flush();
    if (boundary === 'hidden') page.onHide();
    else if (boundary === 'unloaded') page.onUnload();
    else page.onBack();
    page.onPullDownRefresh(); await flush();
    expect(calls).toHaveLength(2);
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
  });
  it.each([200, 401, 403, 503])('ends the current visible refresh once for status %s', async (status) => {
    page.onLoad(); page.onShow(); await flush();
    respond(0, identity); respond(1, draft(1)); await flush();
    page.onPullDownRefresh(); await flush();
    respond(2, identity, status); respond(3, draft(4), status); await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe(status === 200 ? 'ready' : status === 503 ? 'error' : 'login');
  });
  it('coalesces overlapping refresh reads and only ends the latest refresh', async () => {
    page.onLoad(); page.onShow(); await flush();
    respond(0, identity); respond(1, draft(1)); await flush();
    page.onPullDownRefresh(); page.onPullDownRefresh(); await flush();
    expect(calls).toHaveLength(4);
    respond(2, identity); respond(3, draft(4)); await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4 });
  });
  it('ends a blocked dirty refresh immediately without replacing unsaved data', async () => {
    page.onLoad(); page.onShow(); await flush();
    respond(0, identity); respond(1, draft(1)); await flush();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'institutionName' } }, detail: { value: '刷新仍保留修改' },
    });
    page.onPullDownRefresh(); await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(page.data).toMatchObject({ dirty: true, form: { institutionName: '刷新仍保留修改' } });
  });
  it('starts a new read pair when returning from a hidden pending read', async () => {
    page.onLoad();
    page.onShow();
    await flush();
    page.onHide();
    page.onShow();
    await flush();
    expect(calls).toHaveLength(4);
    respond(2, { ...identity, formalAccountReady: true });
    respond(3, draft(4));
    await flush();
    respond(0, identity);
    respond(1, draft(99));
    await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4, readonly: true });
    expect(stored.partnerApplicantSession.me.formalAccountReady).toBe(true);
  });

  it('keeps a new session contact after an old session returns late unauthorized reads', async () => {
    page.onLoad();
    page.onShow();
    await flush();
    page.onHide();
    stored.partnerApplicantSession.token = 'synthetic-new-applicant-token';
    page.onShow();
    await flush();
    expect(calls).toHaveLength(4);
    respond(2, identity);
    respond(3, draft(4, '0000-00000002'));
    await flush();
    respond(0, identity, 401);
    respond(1, draft(99, '0000-00000009'), 401);
    await flush();
    expect(page.data).toMatchObject({ viewState: 'ready', version: 4 });
    expect(page.data.form.contactPhone).toBe('0000-00000002');
    expect(sessions.getToken()).toBe('synthetic-new-applicant-token');
    expect(stored.accessToken).toBe('synthetic-formal-token');
  });
  it('renders a missing archive without creating a draft after real restricted services return formal identity and null', async () => {
    page.onLoad();
    page.onShow();
    await flush();
    respond(0, { ...identity, formalAccountReady: true });
    respond(1, null);
    await flush();
    expect(page.data).toMatchObject({
      viewState: 'empty', archiveEmpty: true, readonly: true, statusLabel: '暂无档案',
    });
    const writes = calls.length;
    await page.onSave();
    expect(calls).toHaveLength(writes);
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
    expect(stored.accessToken).toBe('synthetic-formal-token');
  });
  it('keeps ordinary draft read coalescing after invalidation and does not release the new lock through an old response', async () => {
    const old = applications.load();
    const oldResult = old.catch((error) => error);
    sessions.invalidateReads();
    const next = applications.load();
    expect(applications.load()).toBe(next);
    expect(calls).toHaveLength(2);
    respond(0, draft(99));
    expect(await oldResult).toMatchObject({ code: 'READ_SUPERSEDED' });
    expect(applications.load()).toBe(next);
    respond(1, draft(4));
    expect((await next)?.version).toBe(4);
    expect(calls).toHaveLength(2);
  });
  it('keeps the new identity read lock when an invalidated response completes', async () => {
    const old = sessions.loadMe();
    const oldResult = old.catch((error) => error);
    sessions.invalidateReads();
    const next = sessions.loadMe();
    expect(sessions.loadMe()).toBe(next);
    respond(0, identity);
    expect(await oldResult).toMatchObject({ code: 'READ_SUPERSEDED' });
    expect(sessions.loadMe()).toBe(next);
    respond(1, { ...identity, formalAccountReady: true });
    expect((await next).formalAccountReady).toBe(true);
    expect(calls).toHaveLength(2);
  });
  it('does not restore expired credentials through a new read revision', async () => {
    sessions.invalidateReads();
    stored.partnerApplicantSession.expiresAt = new Date(Date.now() - 1000).toISOString();
    await expect(sessions.loadMe()).rejects.toMatchObject({ statusCode: 401 });
    await expect(applications.load()).rejects.toMatchObject({ statusCode: 401 });
    expect(calls).toHaveLength(0);
    expect(stored.partnerApplicantSession).toBeUndefined();
    expect(stored.accessToken).toBe('synthetic-formal-token');
  });
  it.each([200, 401])('does not cancel or resend a save when leaving, and still handles save status %s', async (status) => {
    page.onLoad();
    page.onShow();
    await flush();
    respond(0, identity);
    respond(1, draft(1));
    await flush();
    page.onFieldInput({
      currentTarget: { dataset: { field: 'contactPhone' } }, detail: { value: '0000-00000001' },
    });
    const pending = page.onSave();
    await flush();
    expect(calls[2].method).toBe('PUT');
    expect(calls[2].data).toMatchObject({
      basicInformation: { contactPhone: '0000-00000001' },
    });
    page.onHide();
    respond(2, draft(2, '0000-00000001'), status);
    await pending;
    expect(calls).toHaveLength(3);
    expect(sessions.getToken()).toBe(status === 200 ? 'synthetic-applicant-token' : '');
    expect(stored.accessToken).toBe('synthetic-formal-token');
    page.onShow();
    await flush();
    if (status === 401) {
      expect(calls).toHaveLength(3);
      expect(page.data.viewState).toBe('login');
      expect(page.data.form.contactPhone).toBe('');
    } else {
      expect(calls).toHaveLength(5);
      respond(3, identity);
      respond(4, draft(2, '0000-00000001'));
      await flush();
      expect(page.data.form.contactPhone).toBe('0000-00000001');
      expect(page.data.dirty).toBe(false);
    }
  });
});
