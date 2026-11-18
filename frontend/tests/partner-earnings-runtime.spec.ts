import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import {
  PARTNER_EARNING_SUMMARY_FIXTURE, PARTNER_EARNING_RULE_FIXTURE, PARTNER_EARNINGS_FIXTURE,
} from '../mock/fixtures/partner.fixture';

interface Runtime {
  dataDriver: 'api' | 'mock';
  apiBaseUrl: string;
  accessToken: string;
}
interface EarningsPage {
  data: { viewState: string; anchorDate: string; summary: unknown; rule: unknown; entries: unknown[] };
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onLogin(): void;
  onRetry(): void;
}
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner earnings current runtime at %s', (timing) => {
  it.each(scenarios)('uses the current $change environment after loading modules', async ({ initialDriver, currentDriver }) => {
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
    let runtime: Runtime = {
      dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-earnings-owner',
    };
    let definition!: EarningsPage;
    let page: EarningsPage | undefined;
    const request = jest.fn((options: PartnerHttpRequestOptions) => {
      const route = new URL(options.url).pathname;
      const data = route.endsWith('/summary') ? PARTNER_EARNING_SUMMARY_FIXTURE
        : route.endsWith('/earning-rule') ? PARTNER_EARNING_RULE_FIXTURE : PARTNER_EARNINGS_FIXTURE;
      options.success({ statusCode: 200, data: {
        data, requestId: 'synthetic-current-earnings',
        ...(Array.isArray(data) ? { meta: { page: 1, pageSize: 20, total: data.length, totalPages: 1 } } : {}),
      } });
    });
    try {
      host.wx = { getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined, request };
      host.Page = (config: EarningsPage) => { definition = config; };
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/earnings/index');
        runtime = { ...runtime, dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' };
        if (timing === 'before-registration') require('../pages/partner/earnings/index');
      });
      const instance = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(instance.data, patch),
      };
      page = instance;
      page.data.anchorDate = '2026-09-01';
      page.onLoad(); page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.summary).not.toBeNull();
      expect(page.data.rule).not.toBeNull();
      expect(page.data.entries.length).toBeGreaterThan(0);
      if (currentDriver === 'api') {
        expect(request).toHaveBeenCalledTimes(3);
        expect(request.mock.calls.every(([options]) =>
          options.url.startsWith('http://current.synthetic.invalid/partners/me/') &&
          options.header.Authorization === 'Bearer synthetic-earnings-owner')).toBe(true);
      } else expect(request).not.toHaveBeenCalled();
    } finally {
      page?.onUnload();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    }
  });
});

it('logs out the current API environment when its module was cached in mock and navigation fails', async () => {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  let runtime: Runtime = { dataDriver: 'mock', apiBaseUrl: '', accessToken: '' };
  const storage = new Map<string, unknown>();
  let definition!: EarningsPage, page: EarningsPage | undefined;
  const request = jest.fn((options: PartnerHttpRequestOptions) => {
    options.success({ statusCode: 403, data: { code: 'FORBIDDEN' } });
  });
  const reLaunch = jest.fn((options: { fail?: () => void }) => options.fail?.());
  try {
    host.wx = {
      getStorageSync: (key: string) => key === 'education.runtime' ? runtime : storage.get(key),
      setStorageSync: (key: string, value: unknown) => {
        if (key === 'education.runtime') runtime = value as Runtime;
        else storage.set(key, value);
      },
      request, reLaunch,
    };
    host.Page = (config: EarningsPage) => { definition = config; };
    jest.isolateModules(() => {
      require('../pages/partner/earnings/index');
      runtime = { dataDriver: 'api', apiBaseUrl: 'http://current.synthetic.invalid', accessToken: 'synthetic-logout-owner' };
    });
    const instance = {
      ...definition, data: structuredClone(definition.data),
      setData: (patch: object) => Object.assign(instance.data, patch),
    };
    page = instance;
    page.onLoad(); page.onShow();
    await page.pendingRequest;
    expect(page.data.viewState).toBe('forbidden');
    page.onLogin();
    expect(runtime.accessToken).toBe('');
    expect(storage.get('education.session.logged-out')).toBe(true);
    expect(reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    const reads = request.mock.calls.length;
    page.onRetry(); page.onShow();
    await page.pendingRequest;
    expect(page.data).toMatchObject({ viewState: 'forbidden', summary: null, rule: null, entries: [] });
    expect(request).toHaveBeenCalledTimes(reads);
  } finally {
    page?.onUnload();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(host, key, descriptor); else Reflect.deleteProperty(host, key);
    }
  }
});
