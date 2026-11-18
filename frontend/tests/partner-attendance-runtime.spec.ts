import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { PARTNER_ATTENDANCE_FIXTURE, PARTNER_PROFILE_FIXTURE } from '../mock/fixtures/partner.fixture';

interface Runtime { dataDriver: 'api' | 'mock'; apiBaseUrl: string; accessToken: string }
interface AttendancePage {
  data: {
    viewState: string; summary: object; items: { id: string; lessonLabel: string }[];
    page: number; total: number; hasMore: boolean; loadingMore: boolean;
    refreshError: string; pageError: string;
  };
  campusTimeZone?: string;
  pendingRequest?: Promise<void>;
  pendingPage: number;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  onRetry(): void;
  onLoadMore(): void;
  onLogin(): void;
}
const success = (options: PartnerHttpRequestOptions) => options.success({
  statusCode: 200,
  data: {
    data: options.url.endsWith('/profile')
      ? { ...PARTNER_PROFILE_FIXTURE, campus: { ...PARTNER_PROFILE_FIXTURE.campus, timezone: 'America/New_York' } }
      : {
          ...PARTNER_ATTENDANCE_FIXTURE,
          items: [{
            ...PARTNER_ATTENDANCE_FIXTURE.items[0],
            id: options.url.includes('page=2') ? 'synthetic-page-two' : 'synthetic-page-one',
            startsAt: '2026-10-08T02:00:00Z',
          }],
          meta: { page: options.url.includes('page=2') ? 2 : 1, pageSize: 20, total: 21, totalPages: 2 },
        },
    requestId: 'synthetic-attendance-runtime',
  },
});
function environment(initialDriver: Runtime['dataDriver'] = 'api') {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  let runtime: Runtime = {
    dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid',
    accessToken: 'synthetic-attendance-owner',
  };
  const storage = new Map<string, unknown>();
  const request = jest.fn(success);
  const reLaunch = jest.fn((options: { fail?: () => void }) => options.fail?.());
  let definition!: AttendancePage;
  const pages: AttendancePage[] = [];
  host.wx = {
    getStorageSync: (key: string) => key === 'education.runtime' ? runtime : storage.get(key),
    setStorageSync: (key: string, value: unknown) => {
      if (key === 'education.runtime') runtime = value as Runtime;
      else storage.set(key, value);
    },
    request, reLaunch, stopPullDownRefresh: jest.fn(),
  };
  host.Page = (config: AttendancePage) => { definition = config; };
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
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
};
const cleared = {
  viewState: 'forbidden', items: [], page: 0, total: 0, hasMore: false,
  refreshError: '', pageError: '', loadingMore: false,
  summary: {
    attendanceRateLabel: '暂无数据', recordedCountLabel: '0',
    presentCountLabel: '0', absentCountLabel: '0', leaveCountLabel: '0',
  },
};
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner attendance current runtime at %s', (timing) => {
  it.each(scenarios)('uses current $change after module loading for both stages and pagination', async ({ initialDriver, currentDriver }) => {
    const env = environment(initialDriver);
    try {
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/attendance/index');
        env.change({ dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' });
        if (timing === 'before-registration') require('../pages/partner/attendance/index');
      });
      const page = env.instantiate();
      page.onLoad(); page.onShow();
      await page.pendingRequest;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.items.length).toBeGreaterThan(0);
      if (currentDriver === 'api') {
        expect(env.request).toHaveBeenCalledTimes(2);
        expect(env.request.mock.calls.map(([options]) => options.url)).toEqual([
          'http://current.synthetic.invalid/partners/me/profile',
          'http://current.synthetic.invalid/partners/me/attendance?page=1&pageSize=20',
        ]);
        expect(page.data.items[0].lessonLabel).toContain('10月7日 22:00');
        page.onLoadMore();
        await page.pendingRequest;
        expect(env.request).toHaveBeenCalledTimes(3);
        expect(env.request.mock.calls[2][0]).toMatchObject({
          url: 'http://current.synthetic.invalid/partners/me/attendance?page=2&pageSize=20',
          header: { Authorization: 'Bearer synthetic-attendance-owner' },
        });
        expect(page.data.items[1].lessonLabel).toContain('10月7日 22:00');
      } else expect(env.request).not.toHaveBeenCalled();
    } finally { env.close(); }
  });
});

describe.each(['foreground', 'held-profile', 'held-attendance', 'held-pagination'])(
  'partner attendance real session change at %s', (timing) => {
    it.each(['token', 'address', 'driver'])('clears loaded data after %s changes and restores only a fresh instance', async (change) => {
      const env = environment();
      try {
        jest.isolateModules(() => require('../pages/partner/attendance/index'));
        const page = env.instantiate();
        page.onLoad(); page.onShow();
        await page.pendingRequest;
        expect(page.data.viewState).toBe('ready');
        let held: PartnerHttpRequestOptions | undefined;
        let reading: Promise<void> | undefined;
        if (timing !== 'foreground') {
          if (timing === 'held-attendance') env.request.mockImplementationOnce(success);
          env.request.mockImplementationOnce((options) => { held = options; });
          if (timing === 'held-pagination') page.onLoadMore();
          else page.onRetry();
          reading = page.pendingRequest;
          await flush();
          expect(held).toBeDefined();
          expect(held!.url).toContain(timing === 'held-profile' ? '/profile' : '/attendance');
        }
        env.change(change === 'token' ? { accessToken: 'synthetic-other-owner' }
          : change === 'address' ? { apiBaseUrl: 'http://other.synthetic.invalid' } : { dataDriver: 'mock' });
        const reads = env.request.mock.calls.length;
        if (held) success(held);
        else page.onShow();
        await reading;
        expect(page.data).toMatchObject(cleared);
        expect(page.campusTimeZone).toBeUndefined();
        expect(page.pendingPage).toBe(0);
        expect(page.pendingRequest).toBeUndefined();
        page.onRetry(); page.onShow(); page.onLoadMore();
        await page.pendingRequest;
        expect(env.request).toHaveBeenCalledTimes(reads);
        const fresh = env.instantiate();
        fresh.onLoad(); fresh.onShow();
        await fresh.pendingRequest;
        expect(fresh.data.viewState).toBe('ready');
        if (change === 'driver') expect(env.request).toHaveBeenCalledTimes(reads);
        else expect(env.request.mock.calls.slice(-2).map(([options]) => ({
          url: options.url, token: options.header.Authorization,
        }))).toEqual([
          { url: `${env.runtime.apiBaseUrl}/partners/me/profile`, token: `Bearer ${env.runtime.accessToken}` },
          { url: `${env.runtime.apiBaseUrl}/partners/me/attendance?page=1&pageSize=20`, token: `Bearer ${env.runtime.accessToken}` },
        ]);
      } finally { env.close(); }
    });
  },
);

it.each(['fail', 'throw'])('logs out current API credentials after mock module caching even when navigation %s', async (failure) => {
  const env = environment('mock');
  try {
    jest.isolateModules(() => require('../pages/partner/attendance/index'));
    env.change({ dataDriver: 'api', apiBaseUrl: 'http://current.synthetic.invalid' });
    const page = env.instantiate();
    page.onLoad(); page.onShow();
    await page.pendingRequest;
    let held!: PartnerHttpRequestOptions;
    env.request.mockImplementationOnce((options) => { held = options; });
    page.onLoadMore();
    const reading = page.pendingRequest;
    await flush();
    expect(held).toBeDefined();
    env.reLaunch.mockImplementationOnce((options) => {
      if (failure === 'throw') throw new Error('synthetic native navigation failure');
      options.fail?.();
    });
    expect(() => page.onLogin()).not.toThrow();
    expect(env.runtime.accessToken).toBe('');
    expect(env.storage.get('education.session.logged-out')).toBe(true);
    expect(page.data).toMatchObject(cleared);
    const reads = env.request.mock.calls.length;
    success(held);
    await reading;
    page.onRetry(); page.onShow(); page.onLoadMore();
    await page.pendingRequest;
    expect(page.data).toMatchObject(cleared);
    expect(page.campusTimeZone).toBeUndefined();
    expect(env.request).toHaveBeenCalledTimes(reads);
  } finally { env.close(); }
});
