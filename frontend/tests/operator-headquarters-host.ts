import { headquartersMe } from './operator-headquarters.fixture';
type Request = {
  url: string; method: string; header: Record<string, string>;
  success(value: { statusCode: number; data: unknown }): void; fail(error: unknown): void;
};
export async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
export const tap = (id: string) => ({ currentTarget: { dataset: { id } } });
export function captureHeadquarters() {
  const host = globalThis as any;
  const original = ['wx', 'Page', 'getCurrentPages'].map(key => [key, Object.getOwnPropertyDescriptor(host, key)] as const);
  const values = new Map<string, any>([['education.runtime', {
    dataDriver: 'api', apiBaseUrl: 'https://headquarters.example.test', accessToken: 'synthetic-hq',
  }]]);
  const calls: Request[] = [], sessionCalls: Request[] = [], instances: any[] = [];
  let definition: any, me: unknown = headquartersMe(), manualMe = false, depth = 1;
  const platform = {
    env: { USER_DATA_PATH: 'synthetic-headquarters-only' },
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: jest.fn((key: string, value: unknown) => values.set(key, value)),
    getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 28, height: 32, left: 294 }),
    request: jest.fn((request: Request) => {
      if (request.url.endsWith('/me')) {
        sessionCalls.push(request);
        if (!manualMe) request.success({ statusCode: 200, data: { data: me } });
      } else calls.push(request);
      return { abort: jest.fn() };
    }),
    reLaunch: jest.fn((_options?: unknown) => undefined), navigateBack: jest.fn((_options?: unknown) => undefined),
    stopPullDownRefresh: jest.fn(), showToast: jest.fn(),
  };
  host.wx = platform;
  host.Page = (value: any) => { definition = value; };
  host.getCurrentPages = () => Array.from({ length: depth }, () => ({ route: 'pages/operator/headquarters/index' }));
  jest.isolateModules(() => { require('../pages/operator/headquarters/index'); });
  return {
    platform, calls, sessionCalls, values,
    setMe(value: unknown) { me = value; },
    manualMe() { manualMe = true; },
    depth(value: number) { depth = value; },
    instantiate() {
      const page = { ...definition, data: structuredClone(definition.data) };
      page.setData = jest.fn((patch: object) => Object.assign(page.data, patch));
      instances.push(page); page.onLoad(); page.onShow?.(); return page;
    },
    reply(index: number, data: unknown, statusCode = 200) { calls[index].success({ statusCode, data }); },
    change(value: object) { values.set('education.runtime', { ...values.get('education.runtime'), ...value }); },
    close() {
      for (const instance of instances) instance.onUnload?.();
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(host, key, descriptor); else Reflect.deleteProperty(host, key);
      }
    },
  };
}
