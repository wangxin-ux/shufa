import type { OperatorHttpRequest, OperatorHttpRequestOptions } from '../pages/operator/runtime/data/api-operator-data-source';
import { NORMAL_OPERATOR_FIXTURE as fixture } from '../pages/operator/runtime/mock/fixtures/operator.fixture';

export { fixture };
// Mirrors the product rule in mock-operator-data-source.ts: a leave request is
// actionable only when it is PENDING and canReview. Requests flagged
// canReview: false are visible in the list but never counted as pending work.
export const pendingLeaves = fixture.leaveRequests.filter(
  (item) => item.status === 'PENDING' && item.canReview === true,
);
// Every PENDING row regardless of canReview. Pages that start their own review
// flow need more than one selectable row, and they re-flag canReview themselves.
export const pendingRows = fixture.leaveRequests.filter((item) => item.status === 'PENDING');
export const tap = (id: string) => ({ currentTarget: { dataset: { id, key: id } } });
export async function flush() {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}
type Route = 'home' | 'profile' | 'leave-requests' | 'students' | 'student-detail' | 'schedule' | 'schedule-editor' | 'teachers' | 'warnings' | 'campus-settings' | 'student-form' | 'teacher-archives' | 'rankings' | 'lesson-account';

// Capture the actual Page definition and real Service/API chain, only replacing wx transport.
export function capture(
  routes: Route[] = ['home'],
  driver: 'api' | 'mock' = 'api',
  transport?: OperatorHttpRequest,
) {
  const host = globalThis as any;
  const previous = ['wx', 'Page', 'getCurrentPages'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(host, key)] as const,
  );
  const values = new Map<string, any>([
    ['education.runtime', {
      dataDriver: driver, apiBaseUrl: 'https://operator.example.test',
      accessToken: 'synthetic-owner-a', enableTestAccountSwitcher: driver === 'mock',
      mockWechatAccount: 'OPERATOR',
    }],
    ['education.session.logged-out', false],
  ]);
  const calls: OperatorHttpRequestOptions[] = [];
  const sessionCalls: OperatorHttpRequestOptions[] = [];
  let session: unknown = { userId: 'synthetic-operator', displayName: '测试运营',
    roles: [{ code: 'OPERATOR', campusId: fixture.profile.campusId }] };
  const downloads: Array<{
    url: string; header: Record<string, string>;
    success(value: { statusCode: number; tempFilePath: string }): void;
    fail(value: unknown): void;
    abort: jest.Mock;
  }> = [];
  const definitions = new Map<Route, any>();
  const instances: any[] = [];
  let pageStack: Array<{ route: string }> = [];
  let registering: Route;
  const platform = {
    env: { USER_DATA_PATH: 'synthetic-user-data' },
    getWindowInfo: jest.fn(() => ({ windowWidth: 390, statusBarHeight: 20 })),
    getMenuButtonBoundingClientRect: jest.fn(() => ({ top: 28, height: 32, left: 294 })),
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
    request: jest.fn((options: OperatorHttpRequestOptions) => {
      if (options.url.endsWith('/me')) {
        sessionCalls.push(options);
        options.success({ statusCode: 200, data: { data: session } });
        return;
      }
      calls.push(options);
      return transport?.(options);
    }),
    downloadFile: jest.fn((options) => {
      const abort = jest.fn();
      downloads.push({ ...options, abort });
      return { abort };
    }),
    previewImage: jest.fn(),
    stopPullDownRefresh: jest.fn(), showToast: jest.fn(), navigateTo: jest.fn(),
    reLaunch: jest.fn(), redirectTo: jest.fn(), showModal: jest.fn(),
    navigateBack: jest.fn(), enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn(),
  };
  host.wx = platform;
  host.getCurrentPages = () => pageStack;
  host.Page = (definition: any) => definitions.set(registering, definition);
  jest.isolateModules(() => {
    for (const route of routes) {
      registering = route;
      require(`../pages/operator/${route}/index`);
    }
  });
  return {
    calls, downloads, values, platform, sessionCalls,
    setSession(value: unknown) { session = value; },
    setPages(pages: Array<{ route: string }>) { pageStack = pages; },
    instantiate(route: Route = routes[0]) {
      const definition = definitions.get(route);
      const page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
      instances.push(page);
      return page;
    },
    reply(index: number, data: unknown, statusCode = 200) {
      calls[index].success({ statusCode, data });
    },
    list(index: number, data = pendingLeaves, page = 1, total = data.length) {
      calls[index].success({ statusCode: 200, data: {
        data, meta: { page, pageSize: 20, total, totalPages: Math.ceil(total / 20) },
      } });
    },
    change(patch: object) {
      values.set('education.runtime', { ...values.get('education.runtime'), ...patch });
    },
    close() {
      for (const page of instances) page.onUnload?.();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(host, key, descriptor);
        else Reflect.deleteProperty(host, key);
      }
    },
  };
}
