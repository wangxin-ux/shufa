import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { GROUP_PROMOTION_CAMPAIGN_FIXTURE } from '../mock/fixtures/group-promotion.fixture';

interface Runtime {
  dataDriver: 'api' | 'mock';
  apiBaseUrl: string;
  accessToken: string;
}
interface DetailPage {
  data: { viewState: string; campaign: { id: string } | null };
  pendingRequest?: Promise<void>;
  onLoad(options: { id: string }): void;
  onShow(): void;
  onUnload(): void;
}
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner detail current runtime at %s', (timing) => {
  it.each(scenarios)('uses the current $change environment after the module was loaded', async ({ initialDriver, currentDriver }) => {
    jest.useFakeTimers({ now: new Date('2026-09-15T00:00:00.000Z') });
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
    let runtime: Runtime = {
      dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-owner',
    };
    let definition!: DetailPage;
    let page: DetailPage | undefined;
    const request = jest.fn((options: PartnerHttpRequestOptions) => options.success({
      statusCode: 200,
      data: {
        data: { ...GROUP_PROMOTION_CAMPAIGN_FIXTURE, canPromote: true },
        requestId: 'synthetic-current-detail',
      },
    }));
    try {
      host.wx = {
        getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined,
        request, hideShareMenu: jest.fn(), showShareMenu: jest.fn(),
      };
      host.Page = (config: DetailPage) => { definition = config; };
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/group-detail/index');
        runtime = { ...runtime, dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' };
        if (timing === 'before-registration') require('../pages/partner/group-detail/index');
      });
      const instance = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(instance.data, patch),
      };
      page = instance;
      page.onLoad({ id: GROUP_PROMOTION_CAMPAIGN_FIXTURE.id });
      page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      if (currentDriver === 'api') {
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][0]).toMatchObject({
          method: 'GET',
          url: `http://current.synthetic.invalid/partners/me/group-campaigns/${GROUP_PROMOTION_CAMPAIGN_FIXTURE.id}`,
          header: { Authorization: 'Bearer synthetic-owner' },
        });
      } else expect(request).not.toHaveBeenCalled();
      expect(page.data.campaign?.id).toBe(GROUP_PROMOTION_CAMPAIGN_FIXTURE.id);
    } finally {
      page?.onUnload();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
      jest.useRealTimers();
    }
  });
});
