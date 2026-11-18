import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { PARTNER_PROFILE_FIXTURE } from '../mock/fixtures/partner.fixture';

interface Runtime { dataDriver: 'api' | 'mock'; apiBaseUrl: string; accessToken: string }
interface ProfilePage {
  data: {
    viewState: string; displayName: string; campusName: string; identityLabel: string;
    campusCodeLabel: string; contactPhoneLabel: string; addressLabel: string;
    warningThresholdLabel: string; activeStudentCountLabel: string; moreExpanded: boolean;
  };
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onRetry(): void;
  onLogin(): void;
  onMoreToggle(): void;
}
const success = (options: PartnerHttpRequestOptions) => options.success({
  statusCode: 200, data: { data: PARTNER_PROFILE_FIXTURE, requestId: 'synthetic-profile-runtime' },
});
function environment(initialDriver: Runtime['dataDriver'] = 'api') {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  let runtime: Runtime = {
    dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-profile-owner',
  };
  const storage = new Map<string, unknown>();
  const request = jest.fn(success);
  const reLaunch = jest.fn((options: { fail?: () => void }) => options.fail?.());
  let definition!: ProfilePage;
  const pages: ProfilePage[] = [];
  host.wx = {
    getStorageSync: (key: string) => key === 'education.runtime' ? runtime : storage.get(key),
    setStorageSync: (key: string, value: unknown) => {
      if (key === 'education.runtime') runtime = value as Runtime;
      else storage.set(key, value);
    },
    request, reLaunch,
  };
  host.Page = (config: ProfilePage) => { definition = config; };
  return {
    request, reLaunch, storage,
    get runtime() { return runtime; },
    change: (patch: Partial<Runtime>) => { runtime = { ...runtime, ...patch }; },
    instantiate: () => {
      const page = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(page.data, patch),
      };
      pages.push(page);
      return page;
    },
    close: () => {
      for (const page of pages) page.onUnload();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    },
  };
}
const cleared = {
  viewState: 'forbidden', displayName: '', campusName: '', identityLabel: '',
  campusCodeLabel: '', contactPhoneLabel: '', addressLabel: '', warningThresholdLabel: '',
  activeStudentCountLabel: '', moreExpanded: false,
};
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner profile current runtime at %s', (timing) => {
  it.each(scenarios)('uses current $change after module loading', async ({ initialDriver, currentDriver }) => {
    const env = environment(initialDriver);
    try {
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/profile/index');
        env.change({ dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' });
        if (timing === 'before-registration') require('../pages/partner/profile/index');
      });
      const page = env.instantiate();
      page.onLoad(); page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.campusName).not.toBe('');
      if (currentDriver === 'api') {
        expect(env.request).toHaveBeenCalledTimes(1);
        expect(env.request.mock.calls[0][0]).toMatchObject({
          url: 'http://current.synthetic.invalid/partners/me/profile',
          header: { Authorization: 'Bearer synthetic-profile-owner' },
        });
      } else expect(env.request).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});

describe.each(['foreground', 'held-response'])('partner profile real session change at %s', (timing) => {
  it.each(['token', 'address', 'driver'])('clears loaded data after current %s changes and restores a fresh instance', async (change) => {
    const env = environment();
    try {
      jest.isolateModules(() => require('../pages/partner/profile/index'));
      const page = env.instantiate();
      page.onLoad(); page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      page.onMoreToggle();
      expect(page.data.moreExpanded).toBe(true);
      let held: PartnerHttpRequestOptions | undefined;
      let reading: Promise<void> | undefined;
      if (timing === 'held-response') {
        env.request.mockImplementationOnce((options) => { held = options; });
        page.onRetry();
        reading = page.pendingRequest;
        for (let index = 0; index < 10; index++) await Promise.resolve();
        expect(held).toBeDefined();
      }
      env.change(change === 'token' ? { accessToken: 'synthetic-other-owner' }
        : change === 'address' ? { apiBaseUrl: 'http://other.synthetic.invalid' } : { dataDriver: 'mock' });
      const reads = env.request.mock.calls.length;
      if (held) success(held);
      else page.onShow();
      await reading;
      expect(page.data).toMatchObject(cleared);
      expect(page.pendingRequest).toBeUndefined();
      page.onRetry(); page.onShow(); page.onMoreToggle();
      await page.pendingRequest;
      expect(env.request).toHaveBeenCalledTimes(reads);
      const fresh = env.instantiate();
      fresh.onLoad(); fresh.onShow();
      await fresh.pendingRequest;
      expect(fresh.data.viewState).toBe('ready');
      if (change === 'driver') expect(env.request).toHaveBeenCalledTimes(reads);
      else expect(env.request.mock.calls[env.request.mock.calls.length - 1][0]).toMatchObject({
        header: { Authorization: `Bearer ${env.runtime.accessToken}` },
        url: `${env.runtime.apiBaseUrl}/partners/me/profile`,
      });
    } finally { env.close(); }
  });
});

it.each(['fail', 'throw'])('logs out current API credentials after caching in mock even if navigation %s', async (failure) => {
  const env = environment('mock');
  try {
    jest.isolateModules(() => require('../pages/partner/profile/index'));
    env.change({ dataDriver: 'api', apiBaseUrl: 'http://current.synthetic.invalid' });
    const page = env.instantiate();
    page.onLoad(); page.onShow();
    await page.pendingRequest;
    env.reLaunch.mockImplementationOnce((options) => {
      if (failure === 'throw') throw new Error('native navigation failed');
      options.fail?.();
    });
    expect(() => page.onLogin()).not.toThrow();
    expect(env.runtime.accessToken).toBe('');
    expect(env.storage.get('education.session.logged-out')).toBe(true);
    expect(env.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    const reads = env.request.mock.calls.length;
    page.onRetry(); page.onShow();
    await page.pendingRequest;
    expect(page.data).toMatchObject(cleared);
    expect(env.request).toHaveBeenCalledTimes(reads);
  } finally { env.close(); }
});
