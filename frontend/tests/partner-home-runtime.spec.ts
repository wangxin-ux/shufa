import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { PARTNER_DASHBOARD_FIXTURE } from '../mock/fixtures/partner.fixture';

interface Runtime { dataDriver: 'api' | 'mock'; apiBaseUrl: string; accessToken: string }
interface HomePage {
  data: { viewState: string; campusName: string; partnerName: string; menuExpanded: boolean; stats: unknown[] };
  pendingRequest?: Promise<void>;
  onLoad(): void; onShow(): void; onUnload(): void; onRetry(): void; onLogin(): void;
}
const success = (options: PartnerHttpRequestOptions) => options.success({
  statusCode: 200, data: { data: PARTNER_DASHBOARD_FIXTURE, requestId: 'synthetic-home-runtime' },
});
function environment(initialDriver: Runtime['dataDriver'] = 'api') {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  let runtime: Runtime = {
    dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-home-owner',
  };
  const storage = new Map<string, unknown>();
  const request = jest.fn(success);
  const reLaunch = jest.fn((options: { fail?: () => void }) => options.fail?.());
  let definition!: HomePage;
  const pages: HomePage[] = [];
  host.wx = {
    getStorageSync: (key: string) => key === 'education.runtime' ? runtime : storage.get(key),
    setStorageSync: (key: string, value: unknown) => {
      if (key === 'education.runtime') runtime = value as Runtime;
      else storage.set(key, value);
    },
    request, reLaunch,
  };
  host.Page = (config: HomePage) => { definition = config; };
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
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;
describe.each(['before-registration', 'cached-page'])('partner home current runtime at %s', (timing) => {
  it.each(scenarios)('uses current $change after module loading', async ({ initialDriver, currentDriver }) => {
    const env = environment(initialDriver);
    try {
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/home/index');
        env.change({ dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' });
        if (timing === 'before-registration') require('../pages/partner/home/index');
      });
      const page = env.instantiate();
      page.onLoad(); page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.campusName).not.toBe('');
      if (currentDriver === 'api') {
        expect(env.request).toHaveBeenCalledTimes(1);
        expect(env.request.mock.calls[0][0]).toMatchObject({
          url: 'http://current.synthetic.invalid/partners/me/dashboard',
          header: { Authorization: 'Bearer synthetic-home-owner' },
        });
      } else expect(env.request).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});
describe.each(['foreground', 'held-response'])('partner home real session change at %s', (timing) => {
  it.each(['token', 'address', 'driver'])('clears loaded private data after current %s changes', async (change) => {
    const env = environment();
    try {
      jest.isolateModules(() => require('../pages/partner/home/index'));
      const page = env.instantiate();
      page.onLoad(); page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      page.data.menuExpanded = true;
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
      if (held) success(held); else page.onShow();
      await reading;
      expect(page.data).toMatchObject({
        viewState: 'forbidden', campusName: '', partnerName: '', menuExpanded: false, stats: [],
      });
      page.onRetry(); page.onShow();
      await page.pendingRequest;
      expect(env.request).toHaveBeenCalledTimes(reads);
      const fresh = env.instantiate();
      fresh.onLoad(); fresh.onShow();
      await fresh.pendingRequest;
      expect(fresh.data.viewState).toBe('ready');
      if (change === 'driver') expect(env.request).toHaveBeenCalledTimes(reads);
      else expect(env.request.mock.calls[env.request.mock.calls.length - 1][0]).toMatchObject({
        header: { Authorization: `Bearer ${env.runtime.accessToken}` },
        url: `${env.runtime.apiBaseUrl}/partners/me/dashboard`,
      });
    } finally { env.close(); }
  });
});
it('logs out current API credentials after caching home in mock even if navigation fails', async () => {
  const env = environment('mock');
  try {
    jest.isolateModules(() => require('../pages/partner/home/index'));
    env.change({ dataDriver: 'api', apiBaseUrl: 'http://current.synthetic.invalid' });
    const page = env.instantiate();
    page.onLoad(); page.onShow();
    await page.pendingRequest;
    page.onLogin();
    expect(env.runtime.accessToken).toBe('');
    expect(env.storage.get('education.session.logged-out')).toBe(true);
    expect(env.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    const reads = env.request.mock.calls.length;
    page.onRetry(); page.onShow();
    await page.pendingRequest;
    expect(page.data).toMatchObject({ viewState: 'forbidden', campusName: '', partnerName: '', stats: [] });
    expect(env.request).toHaveBeenCalledTimes(reads);
  } finally { env.close(); }
});
