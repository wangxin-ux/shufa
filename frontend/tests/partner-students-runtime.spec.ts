import type { PartnerHttpRequestOptions } from '../data/api-partner-data-source';
import { PARTNER_STUDENTS_FIXTURE, PARTNER_STUDENT_DETAILS_FIXTURE } from '../mock/fixtures/partner.fixture';

interface Runtime { dataDriver: 'api' | 'mock'; apiBaseUrl: string; accessToken: string }
interface StudentsPage {
  data: { viewState: string; items: Array<{ id: string }>; expandedDetail: unknown };
  pendingResetRequest?: Promise<void>;
  expansionRequests: Map<string, Promise<void>>;
  onLoad(): void;
  onShow(): void;
  onUnload(): void;
  onRetry(): void;
  onLogin(): void;
  onStudentToggle(event: { currentTarget: { dataset: { id: string } } }): void;
}
const scenarios = [
  { change: 'address', initialDriver: 'api', currentDriver: 'api' },
  { change: 'mock-to-api', initialDriver: 'mock', currentDriver: 'api' },
  { change: 'api-to-mock', initialDriver: 'api', currentDriver: 'mock' },
] as const;

describe.each(['before-registration', 'cached-page'])('partner students current runtime at %s', (timing) => {
  it.each(scenarios)('reads the current $change list and expansion after module loading', async ({ initialDriver, currentDriver }) => {
    const host = globalThis as unknown as Record<string, unknown>;
    const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
    let runtime: Runtime = {
      dataDriver: initialDriver, apiBaseUrl: 'http://initial.synthetic.invalid', accessToken: 'synthetic-students-owner',
    };
    let definition!: StudentsPage, page: StudentsPage | undefined;
    const request = jest.fn((options: PartnerHttpRequestOptions) => {
      const list = new URL(options.url).pathname === '/partners/me/students';
      const subjects = new URL(options.url).pathname === '/partners/me/subjects';
      options.success({ statusCode: 200, data: {
        data: subjects ? [] : list ? PARTNER_STUDENTS_FIXTURE : PARTNER_STUDENT_DETAILS_FIXTURE[0],
        requestId: 'synthetic-current-students',
        ...(subjects ? { meta: { page: 1, pageSize: 100, total: 0, totalPages: 0 } } : {}),
        ...(list ? { meta: { page: 1, pageSize: 20, total: PARTNER_STUDENTS_FIXTURE.length, totalPages: 1 } } : {}),
      } });
    });
    try {
      host.wx = { getStorageSync: (key: string) => key === 'education.runtime' ? runtime : undefined, request };
      host.Page = (config: StudentsPage) => { definition = config; };
      jest.isolateModules(() => {
        require('../services/partner-runtime');
        if (timing === 'cached-page') require('../pages/partner/students/index');
        runtime = { ...runtime, dataDriver: currentDriver, apiBaseUrl: 'http://current.synthetic.invalid' };
        if (timing === 'before-registration') require('../pages/partner/students/index');
      });
      const instance = {
        ...definition, data: structuredClone(definition.data),
        setData: (patch: object) => Object.assign(instance.data, patch),
      };
      page = instance;
      page.onLoad(); page.onShow();
      await page.pendingResetRequest;
      expect(page.data.viewState).toBe('ready');
      expect(page.data.items.length).toBeGreaterThan(0);
      page.onStudentToggle({ currentTarget: { dataset: { id: page.data.items[0].id } } });
      await Promise.all([...page.expansionRequests.values()]);
      expect(page.data.expandedDetail).not.toBeNull();
      if (currentDriver === 'api') {
        expect(request).toHaveBeenCalledTimes(3);
        expect(request.mock.calls.every(([options]) =>
          options.url.startsWith('http://current.synthetic.invalid/partners/me/') &&
          options.header.Authorization === 'Bearer synthetic-students-owner')).toBe(true);
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

it('logs out current API credentials when the page was cached in mock and reLaunch fails', async () => {
  const host = globalThis as unknown as Record<string, unknown>;
  const previous = new Map(['wx', 'Page'].map((key) => [key, Object.getOwnPropertyDescriptor(host, key)]));
  const storage = new Map<string, unknown>();
  let runtime: Runtime = { dataDriver: 'mock', apiBaseUrl: '', accessToken: '' };
  let definition!: StudentsPage, page: StudentsPage | undefined;
  const request = jest.fn((options: PartnerHttpRequestOptions) =>
    options.success({ statusCode: 403, data: { code: 'FORBIDDEN' } }));
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
    host.Page = (config: StudentsPage) => { definition = config; };
    jest.isolateModules(() => {
      require('../pages/partner/students/index');
      runtime = { dataDriver: 'api', apiBaseUrl: 'http://current.synthetic.invalid', accessToken: 'synthetic-logout-owner' };
    });
    const instance = {
      ...definition, data: structuredClone(definition.data),
      setData: (patch: object) => Object.assign(instance.data, patch),
    };
    page = instance;
    page.onLoad(); page.onShow();
    await page.pendingResetRequest;
    page.onLogin();
    expect(runtime.accessToken).toBe('');
    expect(storage.get('education.session.logged-out')).toBe(true);
    expect(reLaunch).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/bootstrap/index' }));
    const reads = request.mock.calls.length;
    page.onRetry(); page.onShow();
    await page.pendingResetRequest;
    expect(page.data).toMatchObject({ viewState: 'forbidden', items: [], expandedDetail: null });
    expect(request).toHaveBeenCalledTimes(reads);
  } finally {
    page?.onUnload();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(host, key, descriptor); else Reflect.deleteProperty(host, key);
    }
  }
});
