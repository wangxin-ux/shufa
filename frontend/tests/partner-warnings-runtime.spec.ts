import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { PARTNER_WARNINGS_FIXTURE } from '../mock/fixtures/partner.fixture';

interface Runtime { dataDriver: 'api' | 'mock'; apiBaseUrl: string; accessToken: string }
interface WarningsPage {
  data: {
    viewState: string; items: Array<{ studentId: string }>; query: string;
    page: number; total: number; hasMore: boolean; loadingMore: boolean;
    refreshError: string; paginationError: string;
  };
  pendingRequest?: Promise<void>;
  pendingKey: string;
  contentKey: string;
  searchTimer: ReturnType<typeof setTimeout> | null;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onRetry(): void;
  onLogin(): void;
  onLoadMore(): void;
  onSearchInput(event: { detail: { value: string } }): void;
}
const success = (options: PartnerHttpRequestOptions) => options.success({
  statusCode: 200, data: {
    data: PARTNER_WARNINGS_FIXTURE, requestId: 'synthetic-warnings-runtime',
    meta: { page: 1, pageSize: 20, total: PARTNER_WARNINGS_FIXTURE.length, totalPages: 2 },
  },
});
const flush = async () => {
  for (let index = 0; index < 30; index++) await Promise.resolve();
};
function environment(initialDriver: Runtime['dataDriver'] = 'api') {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  let runtime: Runtime = {
    dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-warnings-owner',
  };
  const storage = new Map<string, unknown>();
  const request = jest.fn(success);
  const reLaunch = jest.fn((options: { fail?: () => void }) => options.fail?.());
  let definition!: WarningsPage;
  const pages: WarningsPage[] = [];
  host.wx = {
    getStorageSync: (key: string) => key === 'education.runtime' ? runtime : storage.get(key),
    setStorageSync: (key: string, value: unknown) => {
      if (key === 'education.runtime') runtime = value as Runtime;
      else storage.set(key, value);
    },
    request, reLaunch, stopPullDownRefresh: jest.fn(),
  };
  host.Page = (config: WarningsPage) => { definition = config; };
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
  viewState: 'forbidden', items: [], query: '', page: 0, total: 0,
  hasMore: false, loadingMore: false, refreshError: '', paginationError: '',
};
function expectCleared(page: WarningsPage) {
  expect(page.data).toMatchObject(cleared);
  expect(page.pendingRequest).toBeUndefined();
  expect(page.pendingKey).toBe('');
  expect(page.contentKey).toBe('');
  expect(page.searchTimer).toBeNull();
}
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner warnings current runtime at %s', (timing) => {
  it.each(scenarios)('uses current $change after module loading', async ({ initialDriver, currentDriver }) => {
    const env = environment(initialDriver);
    try {
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/warnings/index');
        env.change({ dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' });
        if (timing === 'before-registration') require('../pages/partner/warnings/index');
      });
      const page = env.instantiate();
      page.onLoad(); page.onShow();
      await flush();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.items.length).toBeGreaterThan(0);
      if (currentDriver === 'api') {
        expect(env.request).toHaveBeenCalledTimes(1);
        expect(env.request.mock.calls[0][0]).toMatchObject({
          url: 'http://current.synthetic.invalid/partners/me/warnings?page=1&pageSize=20',
          header: { Authorization: 'Bearer synthetic-warnings-owner' },
        });
      } else expect(env.request).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});

describe.each(['foreground', 'held-success', 'held-denial', 'held-failure'])('partner warnings real session change at %s', (timing) => {
  it.each(['token', 'address', 'driver'])('clears loaded state after current %s changes and restores a fresh instance', async (change) => {
    const env = environment();
    try {
      jest.isolateModules(() => require('../pages/partner/warnings/index'));
      const page = env.instantiate();
      page.onLoad(); page.onShow();
      await flush();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.items.length).toBeGreaterThan(0);
      page.data.query = 'synthetic-old-query';
      let held: PartnerHttpRequestOptions | undefined;
      let reading: Promise<void> | undefined;
      if (timing !== 'foreground') {
        env.request.mockImplementationOnce((options) => { held = options; });
        page.onRetry();
        reading = page.pendingRequest;
        await flush();
        expect(held).toBeDefined();
      }
      env.change(change === 'token' ? { accessToken: 'synthetic-other-owner' }
        : change === 'address' ? { apiBaseUrl: 'http://other.synthetic.invalid' } : { dataDriver: 'mock' });
      const reads = env.request.mock.calls.length;
      if (held) {
        if (timing === 'held-success') success(held);
        if (timing === 'held-denial') held.success({ statusCode: 403, data: { message: 'synthetic private detail' } });
        if (timing === 'held-failure') held.fail(new Error('synthetic private detail'));
      } else page.onShow();
      await reading;
      await flush();
      expectCleared(page);
      page.onRetry(); page.onShow(); page.onLoadMore();
      page.onSearchInput({ detail: { value: 'synthetic-new-query' } });
      await flush();
      await page.pendingRequest;
      expect(env.request).toHaveBeenCalledTimes(reads);
      expectCleared(page);
      const fresh = env.instantiate();
      fresh.onLoad(); fresh.onShow();
      await flush();
      await fresh.pendingRequest;
      expect(fresh.data.viewState).toBe('ready');
      expect(fresh.data.items.length).toBeGreaterThan(0);
      if (change === 'driver') expect(env.request).toHaveBeenCalledTimes(reads);
      else expect(env.request.mock.calls[env.request.mock.calls.length - 1][0]).toMatchObject({
        header: { Authorization: `Bearer ${env.runtime.accessToken}` },
        url: `${env.runtime.apiBaseUrl}/partners/me/warnings?page=1&pageSize=20`,
      });
    } finally { env.close(); }
  });
});

it('cancels an actual-service queued initial read when the token changes', async () => {
  const env = environment();
  try {
    jest.isolateModules(() => require('../pages/partner/warnings/index'));
    const page = env.instantiate();
    page.onLoad();
    env.change({ accessToken: 'synthetic-other-owner' });
    await flush();
    await page.pendingRequest;
    expectCleared(page);
    expect(env.request).not.toHaveBeenCalled();
  } finally { env.close(); }
});

it.each(['fail', 'throw'])('logs out current API credentials after caching in mock despite navigation %s and a held reply', async (failure) => {
  const env = environment('mock');
  try {
    jest.isolateModules(() => require('../pages/partner/warnings/index'));
    env.change({ dataDriver: 'api', apiBaseUrl: 'http://current.synthetic.invalid' });
    const page = env.instantiate();
    page.onLoad(); page.onShow();
    await flush();
    await page.pendingRequest;
    expect(page.data.viewState).toBe('ready');
    expect(env.request).toHaveBeenCalledTimes(1);
    let held: PartnerHttpRequestOptions | undefined;
    env.request.mockImplementationOnce((options) => { held = options; });
    page.onRetry();
    const reading = page.pendingRequest;
    await flush();
    expect(held).toBeDefined();
    // The page belongs to one runtime; logout must use the environment current at the click.
    env.change({ apiBaseUrl: 'http://logout.synthetic.invalid', accessToken: 'synthetic-logout-owner' });
    env.reLaunch.mockImplementationOnce((options) => {
      if (failure === 'throw') throw new Error('synthetic native failure');
      options.fail?.();
    });
    expect(() => page.onLogin()).not.toThrow();
    expect(env.runtime.accessToken).toBe('');
    expect(env.storage.get('education.session.logged-out')).toBe(true);
    expect(env.reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    success(held!);
    await reading;
    await flush();
    expectCleared(page);
    const reads = env.request.mock.calls.length;
    page.onRetry(); page.onShow(); page.onLoadMore();
    page.onSearchInput({ detail: { value: 'synthetic-old-event' } });
    await flush();
    await page.pendingRequest;
    expect(env.request).toHaveBeenCalledTimes(reads);
    expectCleared(page);
  } finally { env.close(); }
});
