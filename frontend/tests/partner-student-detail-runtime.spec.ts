import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { PARTNER_PROFILE_FIXTURE, PARTNER_STUDENT_DETAILS_FIXTURE, PARTNER_STUDENT_GROWTH_FIXTURE } from '../mock/fixtures/partner.fixture';

interface Runtime {
  dataDriver: 'api' | 'mock';
  apiBaseUrl: string;
  accessToken: string;
}
interface StudentPage {
  data: { viewState: string; detail: { displayName: string } | null; growthState: string };
  pendingRequest?: Promise<void>;
  growthPending?: Promise<void>;
  onLoad(query: { id: string }): void;
  onShow(): void;
  onUnload(): void;
}
const detail = Object.values(PARTNER_STUDENT_DETAILS_FIXTURE)[0];
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner student detail current runtime at %s', (timing) => {
  it.each(scenarios)('uses the current $change environment after loading its module', async ({ initialDriver, currentDriver }) => {
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
    let runtime: Runtime = {
      dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-owner',
    };
    let definition!: StudentPage;
    let page: StudentPage | undefined;
    const request = jest.fn((options: PartnerHttpRequestOptions) => {
      const pathname = new URL(options.url).pathname;
      const data = pathname.endsWith('/profile') ? PARTNER_PROFILE_FIXTURE
        : pathname.endsWith('/growth') ? {
          student: { id: detail.id, displayName: detail.displayName, photo: null },
          items: PARTNER_STUDENT_GROWTH_FIXTURE, meta: { page: 1, pageSize: 5, total: 2, totalPages: 1 },
        } : detail;
      options.success({ statusCode: 200, data: { data, requestId: 'synthetic-current-student' } });
    });
    try {
      host.wx = { getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined, request };
      host.Page = (config: StudentPage) => { definition = config; };
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/student-detail/index');
        runtime = { ...runtime, dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' };
        if (timing === 'before-registration') require('../pages/partner/student-detail/index');
      });
      const instance = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(instance.data, patch),
      };
      page = instance;
      page.onLoad({ id: detail.id }); page.onShow();
      await page.pendingRequest; await page.growthPending;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.detail?.displayName).toBe(detail.displayName);
      expect(page.data.growthState).toBe('ready');
      if (currentDriver === 'api') {
        expect(request).toHaveBeenCalledTimes(3);
        expect(request.mock.calls.every(([options]) =>
          options.url.startsWith('http://current.synthetic.invalid/partners/me/') &&
          options.header.Authorization === 'Bearer synthetic-owner')).toBe(true);
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
