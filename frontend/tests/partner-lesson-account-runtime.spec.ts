import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { PARTNER_PROFILE_FIXTURE, PARTNER_LESSON_ACCOUNT_FIXTURE } from '../mock/fixtures/partner.fixture';

interface Runtime {
  dataDriver: 'api' | 'mock';
  apiBaseUrl: string;
  accessToken: string;
}
interface AccountPage {
  data: { viewState: string; summary: { totalBalanceLabel: string } | null; items: unknown[] };
  pendingRequest?: Promise<void>;
  earningPreviewPending?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
}
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner lesson account current runtime at %s', (timing) => {
  it.each(scenarios)('uses the current $change environment after loading its modules', async ({ initialDriver, currentDriver }) => {
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
    let runtime: Runtime = {
      dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-lesson-owner',
    };
    let definition!: AccountPage;
    let page: AccountPage | undefined;
    const request = jest.fn((options: PartnerHttpRequestOptions) => {
      const route = new URL(options.url).pathname;
      if (route.endsWith('/subjects')) {
        options.success({ statusCode: 200, data: { data: [], meta: {
          page: 1, pageSize: 100, total: 0, totalPages: 0,
        } } });
        return;
      }
      const data = route.endsWith('/profile') ? PARTNER_PROFILE_FIXTURE :
        route.endsWith('/earnings') ? { data: [], meta: { page: 1, pageSize: 3, total: 0, totalPages: 0 } } :
        route.endsWith('/earnings/summary') ? { estimatedTotalFen: 0, pendingReviewFen: 0, availableFen: 0, reversedNetFen: 0 } :
          PARTNER_LESSON_ACCOUNT_FIXTURE;
      options.success({ statusCode: 200, data: { data, requestId: 'synthetic-current-account' } });
    });
    try {
      host.wx = { getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined, request };
      host.Page = (config: AccountPage) => { definition = config; };
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        require('../pages/partner/runtime/partner-lesson-runtime');
        if (timing === 'cached-page') require('../pages/partner/lesson-account/index');
        runtime = { ...runtime, dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' };
        if (timing === 'before-registration') require('../pages/partner/lesson-account/index');
      });
      const instance = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(instance.data, patch),
      };
      page = instance;
      page.onLoad(); page.onShow();
      await page.pendingRequest;
      await page.earningPreviewPending;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.summary?.totalBalanceLabel).toBe('49');
      expect(page.data.items).toHaveLength(PARTNER_LESSON_ACCOUNT_FIXTURE.items.length);
      if (currentDriver === 'api') {
        expect(request).toHaveBeenCalledTimes(5);
        expect(request.mock.calls.every(([options]) =>
          options.url.startsWith('http://current.synthetic.invalid/partners/me/') &&
          options.header.Authorization === 'Bearer synthetic-lesson-owner')).toBe(true);
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
