import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from '../mock/fixtures/group-promotion.fixture';

interface Runtime {
  dataDriver: 'api' | 'mock';
  apiBaseUrl: string;
  accessToken: string;
}
interface ListPage {
  data: { viewState: string; campaigns: Array<{ id: string }>; errorMessage: string };
  pendingRequest?: Promise<void>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
}
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner list current runtime at %s', (timing) => {
  it.each(scenarios)('uses the current $change environment after the module was loaded', async ({ initialDriver, currentDriver }) => {
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
    let runtime: Runtime = {
      dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-owner',
    };
    let definition!: ListPage;
    let page: ListPage | undefined;
    const request = jest.fn((options: PartnerHttpRequestOptions) => options.success({
      statusCode: 200,
      data: {
        data: [{ ...GROUP_PROMOTION_CAMPAIGN_FIXTURE, id: 'current-campus', canPromote: true }],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        requestId: 'synthetic-current-list',
      },
    }));
    try {
      host.wx = {
        getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined,
        request, navigateTo: jest.fn(),
      };
      host.Page = (config: ListPage) => { definition = config; };
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/group-campaigns/index');
        runtime = { ...runtime, dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' };
        if (timing === 'before-registration') require('../pages/partner/group-campaigns/index');
      });
      const instance = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(instance.data, patch),
      };
      page = instance;
      page.onLoad();
      page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      if (currentDriver === 'api') {
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][0]).toMatchObject({
          method: 'GET',
          url: 'http://current.synthetic.invalid/partners/me/group-campaigns?page=1&pageSize=20&phase=ONGOING',
          header: { Authorization: 'Bearer synthetic-owner' },
        });
        expect(page.data.campaigns.map((row) => row.id)).toEqual(['current-campus']);
      } else {
        expect(request).not.toHaveBeenCalled();
        expect(page.data.campaigns.map((row) => row.id)).toEqual([GROUP_PROMOTION_CAMPAIGN_FIXTURE.id]);
      }
    } finally {
      page?.onUnload();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    }
  });
});
