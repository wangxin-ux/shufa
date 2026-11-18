import type { FreeCampaignReviewDetail, FreeCampaignReviewSummary } from '../pages/super-admin/runtime/free-campaign-review.service';
import type { SessionHttpRequestOptions } from '../services/session.service';

const versionId = '10000000-0000-4000-8000-000000000001';
const at = '2026-10-15T00:00:00.000Z';
const summary: FreeCampaignReviewSummary = {
  versionId, campaignId: '20000000-0000-4000-8000-000000000001',
  draftId: '30000000-0000-4000-8000-000000000001', campusId: '40000000-0000-4000-8000-000000000001',
  title: '合成免费活动', status: 'SUBMITTED', version: 1, sequence: 1,
  submittedAt: at, reviewedAt: null, reviewReason: null,
};
const detail: FreeCampaignReviewDetail = {
  ...summary, configuration: {
    title: summary.title, campaignType: 'FREE_REGISTRATION', shareDescription: '合成冻结说明',
    contactPhone: null, startsAt: at, endsAt: '2099-10-15T00:00:00.000Z', timezone: 'Asia/Shanghai',
    capacityMode: 'UNLIMITED', maxRegistrations: null, feeFen: 0, benefitMode: 'NONE',
    registrationLimit: 'ONCE_PER_STUDENT',
  }, sourceDraftVersion: 1, campaignVersion: 1, lifecycle: 'OPEN', publishedVersionId: null,
};
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

describe.each(['campaign-reviews', 'campaign-review-detail'])('free review %s current logout runtime', (name) => {
  let stored: Map<string, unknown>;
  let requests: SessionHttpRequestOptions[];
  let page: any;
  let session: any;
  const respond = (input: SessionHttpRequestOptions) => {
    const list = new URL(input.url).pathname === '/management/campaign-reviews';
    input.success({ statusCode: 200, data: {
      data: list ? [summary] : detail, requestId: 'synthetic-review-logout',
      ...(list ? { meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } : {}),
    } });
  };
  const open = async (initialDriver: string) => {
    stored.set('education.runtime', { dataDriver: initialDriver, apiBaseUrl: 'https://old-review.example.test' });
    jest.isolateModules(() => {
      require(`../pages/super-admin/${name}/index`);
      session = require('../services/session.service').sessionService;
    });
    stored.set('education.runtime', {
      dataDriver: 'api', apiBaseUrl: 'https://current-review.example.test',
      accessToken: 'synthetic-current-reviewer', enableTestAccountSwitcher: false,
    });
    page.onLoad({ id: versionId }); page.onShow(); await flush();
    expect(page.data.viewState).toBe('ready');
    if (name === 'campaign-review-detail') page.onReasonInput({ detail: { value: '合成私有原因' } });
  };
  beforeEach(() => {
    stored = new Map(); requests = []; page = undefined; session = undefined;
    (global as any).wx = {
      getStorageSync: (key: string) => stored.get(key),
      setStorageSync: (key: string, value: unknown) => stored.set(key, value),
      request: (input: SessionHttpRequestOptions) => { requests.push(input); respond(input); },
      showModal: jest.fn(), showToast: jest.fn(), reLaunch: jest.fn(), stopPullDownRefresh: jest.fn(),
    };
    (global as any).Page = (definition: any) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) };
      page.setData = (patch: object) => Object.assign(page.data, patch);
    };
  });
  afterEach(() => {
    page?.onUnload();
    delete (global as any).Page; delete (global as any).wx;
  });
  it.each([
    ['mock', 'sync'], ['mock', 'async'], ['api', 'sync'], ['api', 'async'],
  ])('clears the current API session and private state after modules loaded in %s and navigation fails %s', async (driver, failure) => {
    await open(driver);
    const loginCurrent = session.beginExplicitLogin();
    (global as any).wx.reLaunch.mockImplementation((input: { fail?: () => void }) => {
      if (failure === 'sync') throw new Error('synthetic native failure');
      void Promise.resolve().then(() => input.fail?.());
    });
    page.onLogin(); await flush();
    expect(stored.get('education.runtime')).toEqual({
      dataDriver: 'api', apiBaseUrl: 'https://current-review.example.test',
      accessToken: '', enableTestAccountSwitcher: false,
    });
    expect(stored.get('education.session.logged-out')).toBe(true);
    expect(loginCurrent()).toBe(false);
    expect(page.data.viewState).toBe('forbidden');
    expect(page.data.message).toBe('登录页打开失败，请重试');
    if (name === 'campaign-reviews') expect(page.data.rows).toEqual([]);
    else {
      expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe(''); expect(page.reasonDraft).toBe('');
      expect(page.intent).toBeUndefined(); expect(page.data.canApprove).toBe(false);
    }
    const reads = requests.length;
    if (name === 'campaign-reviews') await page.onRetry(); else await page.onReload();
    page.onShow(); page.onPullDownRefresh(); await flush();
    expect(requests).toHaveLength(reads);
    expect((global as any).wx.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
  });
  it('rejects a held old detail or list callback after current logout and failed navigation', async () => {
    await open('mock');
    (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); };
    const pending = name === 'campaign-reviews' ? page.load(true) : page.load();
    await flush(); const held = requests[requests.length - 1];
    (global as any).wx.reLaunch.mockImplementation(() => { throw new Error('synthetic native failure'); });
    page.onLogin(); respond(held); await pending;
    expect((stored.get('education.runtime') as { accessToken: string }).accessToken).toBe('');
    expect(page.data.viewState).toBe('forbidden');
    if (name === 'campaign-reviews') expect(page.data.rows).toEqual([]); else expect(page.data.detail).toBeNull();
    expect((global as any).wx.showToast).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'retry', 'replacement'])('ignores an old login navigation failure after %s', async (cause) => {
    await open('mock'); page.onLogin();
    const options = (global as any).wx.reLaunch.mock.calls[0][0];
    if (cause === 'hidden') page.onHide();
    else if (cause === 'retry') page.onLogin();
    else stored.set('education.runtime', {
      ...(stored.get('education.runtime') as object), accessToken: 'synthetic-replacement-reviewer',
    });
    page.setData({ message: '当前状态' }); options.fail();
    expect(page.data.message).toBe('当前状态');
    if (cause === 'replacement')
      expect((stored.get('education.runtime') as { accessToken: string }).accessToken).toBe('synthetic-replacement-reviewer');
  });
  it.each([401, 403, 404, 500])('finishes the current pull after a %s response', async (statusCode) => {
    await open('api');
    (global as any).wx.request = (input: SessionHttpRequestOptions) => {
      requests.push(input);
      input.success({ statusCode, data: {
        code: 'SYNTHETIC_REVIEW_FAILURE', message: '合成读取失败', requestId: 'synthetic-review-failure',
      } });
    };
    page.onPullDownRefresh(); await flush();
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data.loading).toBe(false);
    if (statusCode === 401 || statusCode === 403) {
      expect(page.data.viewState).toBe('forbidden');
      if (name === 'campaign-reviews') expect(page.data.rows).toEqual([]);
      else { expect(page.data.detail).toBeNull(); expect(page.data.reason).toBe(''); }
    } else if (name === 'campaign-review-detail' && statusCode === 404) {
      expect(page.data.viewState).toBe('error'); expect(page.data.detail).toBeNull();
    } else expect(page.data.viewState).toBe('ready');
  });
  it.each(['hide-show', 'logout-login'])('does not let an old pull callback stop the new refresh after %s', async (cause) => {
    await open('api');
    (global as any).wx.request = (input: SessionHttpRequestOptions) => { requests.push(input); };
    page.onPullDownRefresh(); await flush();
    const oldRead = requests[requests.length - 1];
    if (cause === 'hide-show') {
      page.onHide(); page.onShow();
    } else {
      page.onLogin();
      stored.set('education.runtime', {
        ...(stored.get('education.runtime') as object), accessToken: 'synthetic-replacement-reviewer',
      });
    }
    page.onPullDownRefresh(); await flush();
    const freshRead = requests[requests.length - 1];
    try {
      expect(freshRead).not.toBe(oldRead);
      respond(oldRead); await flush();
      expect((global as any).wx.stopPullDownRefresh).not.toHaveBeenCalled();
    } finally {
      respond(freshRead); await flush();
    }
    expect((global as any).wx.stopPullDownRefresh).toHaveBeenCalledTimes(1);
    expect(page.data.viewState).toBe('ready');
  });
});
