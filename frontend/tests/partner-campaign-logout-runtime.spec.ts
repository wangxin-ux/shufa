import type { SessionHttpRequestOptions } from '../services/session.service';
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from '../mock/fixtures/group-promotion.fixture';

const draftId = '10000000-0000-4000-8000-000000000001';
const campaignId = '20000000-0000-4000-8000-000000000001';
const versionId = '30000000-0000-4000-8000-000000000001';
const at = '2026-10-15T00:00:00.000Z';
const review = {
  draftId, campaignId, versionId, campusId: draftId, title: '合成批准活动',
  status: 'APPROVED', version: 2, sequence: 1, submittedAt: at, reviewedAt: at, reviewReason: null,
};
const configuration = {
  draftId, version: 1, campusTimezone: 'Asia/Shanghai',
  freeRegistration: {
    startsAt: at, endsAt: '2099-10-15T00:00:00.000Z', capacityMode: 'UNLIMITED', maxRegistrations: null,
  },
  campaignId, publishedVersionId: versionId, publishedVersion: review, publishedShareImage: null, campaignVersion: 2, lifecycle: 'OPEN',
};
const draft = {
  draftId, status: 'DRAFT', version: 1, createdAt: at, updatedAt: at,
  basicInformation: {
    title: '合成私有草稿', campaignType: 'FREE_REGISTRATION', shareDescription: '合成说明', contactPhone: '0000',
  },
};
const promotion = {
  ...GROUP_PROMOTION_CAMPAIGN_FIXTURE, canPromote: true,
  startsAt: at, endsAt: '2099-10-15T00:00:00.000Z',
};
const routes = ['group-campaigns', 'group-detail', 'campaign-editor'] as const;
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };

describe.each(routes)('partner campaign %s current logout runtime', (route) => {
  let stored: Map<string, unknown>;
  let requests: SessionHttpRequestOptions[];
  let page: any;
  let session: any;
  const respond = (input: SessionHttpRequestOptions) => {
    const url = new URL(input.url);
    const list = url.pathname === '/partners/me/group-campaigns';
    const history = url.pathname.endsWith('/versions');
    const data = list ? [promotion] : url.pathname.endsWith('/free-registration') ? configuration
      : url.pathname.endsWith('/images') ? { draftId, version: 1, images: { cover: null, share: null } }
      : history ? [review] : url.pathname.includes('/campaign-drafts/') ? draft : promotion;
    input.success({ statusCode: 200, data: {
      data, requestId: 'synthetic-campaign-logout',
      ...(list || history ? { meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } : {}),
    } });
  };
  const read = () => route === 'group-campaigns' ? page.load(true)
    : route === 'group-detail' ? page.load() : page.onReload();
  const open = async (initialDriver = 'mock', currentDriver = 'api') => {
    stored.set('education.runtime', { dataDriver: initialDriver, apiBaseUrl: 'https://old-campaign.example.test' });
    jest.isolateModules(() => {
      require(`../pages/partner/${route}/index`);
      session = require('../services/session.service').sessionService;
    });
    stored.set('education.runtime', {
      dataDriver: currentDriver, apiBaseUrl: 'https://current-campaign.example.test',
      accessToken: 'synthetic-current-partner', enableTestAccountSwitcher: false,
    });
    page.onLoad(route === 'campaign-editor' && currentDriver === 'mock'
      ? {} : { id: route === 'campaign-editor' ? draftId : promotion.id });
    page.onShow(); await flush();
    expect(page.data.viewState).toBe('ready');
  };
  const expectCleared = () => {
    expect(page.data.viewState).toBe('forbidden');
    if (route === 'group-campaigns') {
      expect(page.data).toMatchObject({ campaigns: [], drafts: [], freeCampaigns: [], page: 0, hasMore: false });
    } else if (route === 'group-detail') {
      expect(page.data).toMatchObject({ campaign: null, shareCopy: '', posterPath: '', showPoster: false });
    } else {
      expect(page.data).toMatchObject({
        draftId: '', version: 0, form: { title: '', contactPhone: '' },
        freeReady: false, history: [], registrations: [], publishedPath: '', canSharePublished: false,
        saving: false, freeSaving: false, submitting: false,
      });
      expect(page.createAttempt).toBeUndefined();
      expect(page.freeSaveAttempt).toBeUndefined();
      expect(page.submitAttempt).toBeUndefined();
    }
  };
  beforeEach(() => {
    jest.useFakeTimers();
    stored = new Map(); requests = []; page = undefined; session = undefined;
    (global as any).wx = {
      getStorageSync: (key: string) => stored.get(key),
      setStorageSync: (key: string, value: unknown) => stored.set(key, value),
      request: (input: SessionHttpRequestOptions) => { requests.push(input); respond(input); },
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 24 }),
      getMenuButtonBoundingClientRect: () => ({ top: 32, left: 290, height: 32 }),
      showModal: jest.fn(), showToast: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
      showShareMenu: jest.fn(), hideShareMenu: jest.fn(),
      enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
    };
    (global as any).getCurrentPages = () => [page];
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: structuredClone(definition.data) };
      page.setData = (patch: object) => Object.assign(page.data, patch);
    };
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).Page; delete (global as any).wx; delete (global as any).getCurrentPages;
    jest.useRealTimers();
  });
  it.each([
    ['mock', 'sync'], ['mock', 'async'], ['api', 'sync'], ['api', 'async'],
  ])('clears the current API credentials and stops the page after module load in %s and %s navigation failure', async (driver, failure) => {
    await open(driver);
    const currentLogin = session.beginExplicitLogin();
    if (failure === 'sync')
      (global as any).wx.reLaunch.mockImplementation(() => { throw new Error('synthetic native failure'); });
    else (global as any).wx.reLaunch.mockImplementation((input: { fail?: () => void }) => {
      void Promise.resolve().then(() => input.fail?.());
    });
    expect(() => page.onLogin()).not.toThrow();
    await flush();
    expect(stored.get('education.runtime')).toEqual({
      dataDriver: 'api', apiBaseUrl: 'https://current-campaign.example.test',
      accessToken: '', enableTestAccountSwitcher: false,
    });
    expect(stored.get('education.session.logged-out')).toBe(true);
    expect(currentLogin()).toBe(false);
    expectCleared();
    expect(route === 'campaign-editor' ? page.data.message : page.data.errorMessage).toBe('登录页打开失败，请重试');
    const count = requests.length;
    await read(); page.onShow(); page.onPullDownRefresh(); await flush();
    expect(requests).toHaveLength(count);
    expectCleared();
  });
  it('uses the current Mock driver when an API module was cached', async () => {
    await open('api', 'mock');
    page.onLogin();
    expect((stored.get('education.runtime') as { accessToken: string }).accessToken).toBe('synthetic-current-partner');
    expect(stored.get('education.session.logged-out')).toBe(true);
    expectCleared();
    await read(); page.onShow(); await flush();
    expectCleared();
  });
  it('can retry login after returning from a hidden stopped page', async () => {
    await open();
    page.onLogin(); page.onHide(); page.onShow(); page.onLogin();
    expect((global as any).wx.reLaunch).toHaveBeenCalledTimes(2);
    expectCleared();
    const count = requests.length;
    await read(); await flush();
    expect(requests).toHaveLength(count);
  });
  if (route === 'campaign-editor') {
    it.each(['success', 'denied'])('discards a late basic save %s after logout', async (outcome) => {
      await open();
      page.onInput({ currentTarget: { dataset: { field: 'title' } }, detail: { value: '合成未保存内容' } });
      (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); };
      const pending = page.onSave(); await flush();
      const held = requests[requests.length - 1];
      expect(held.method).toBe('PUT');
      page.onLogin();
      held.success(outcome === 'success' ? {
        statusCode: 200, data: { data: { ...draft, version: 2 }, requestId: 'synthetic-late-save' },
      } : {
        statusCode: 403, data: { code: 'FORBIDDEN', message: '合成失权', requestId: 'synthetic-denied-save' },
      });
      await pending; await flush();
      expectCleared();
      expect(page.outcome).toBeUndefined();
    });
  }
  it('ignores a held old read after logout and failed login navigation', async () => {
    await open();
    (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); };
    const pending = read(); await flush();
    const held = requests[requests.length - 1];
    (global as any).wx.reLaunch.mockImplementation((input: { fail?: () => void }) => input.fail?.());
    page.onLogin();
    (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); respond(input); };
    respond(held); await pending; await flush();
    expectCleared();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });
  it.each(['hide', 'retry', 'replacement'])('isolates an old login navigation failure after %s', async (cause) => {
    await open();
    page.onLogin();
    const old = (global as any).wx.reLaunch.mock.calls[0][0];
    if (cause === 'hide') page.onHide();
    if (cause === 'retry') page.onLogin();
    if (cause === 'replacement') stored.set('education.runtime', {
      ...(stored.get('education.runtime') as object), accessToken: 'synthetic-replacement-partner',
    });
    const field = route === 'campaign-editor' ? 'message' : 'errorMessage';
    page.setData({ [field]: '当前状态' });
    expect(typeof old.fail).toBe('function');
    old.fail();
    expect(page.data[field]).toBe('当前状态');
  });
  it('finishes a current denied pull and clears private content', async () => {
    await open();
    (global as any).wx.request = (input: SessionHttpRequestOptions) => input.success({
      statusCode: 403, data: { code: 'FORBIDDEN', message: '合成失权', requestId: 'synthetic-denied-pull' },
    });
    page.onPullDownRefresh(); await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expectCleared();
  });
  it('does not let a previous hidden pull finish a new refresh', async () => {
    await open();
    (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); };
    page.onPullDownRefresh(); await flush();
    const old = requests[requests.length - 1];
    page.onHide(); page.onShow();
    page.onPullDownRefresh(); await flush();
    const fresh = requests[requests.length - 1];
    expect(fresh).not.toBe(old);
    respond(old); await flush();
    expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); respond(input); };
    respond(fresh); await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe('ready');
  });
});
