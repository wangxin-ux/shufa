import type {
  SessionHttpRequestOptions,
  SessionService,
  SessionView,
  TestAccountCode,
} from '../services/session.service';

export const HEADQUARTERS_ALIAS = 'OPERATOR_HEADQUARTERS';
export const HEADQUARTERS_URL = '/pages/operator/headquarters/index';
export const OPERATOR_URL = '/pages/operator/home/index';
export const API_BASE = 'https://headquarters-bootstrap.example.test';
export const aliasInput = HEADQUARTERS_ALIAS as TestAccountCode;
export const headquartersMe: SessionView = {
  userId: '72000000-0000-4000-8000-000000000900',
  displayName: '合成总部运营',
  roles: [{ code: 'OPERATOR', campusId: null }],
};
export const campusMe: SessionView = {
  userId: '72000000-0000-4000-8000-000000000901',
  displayName: '合成校区运营',
  roles: [{ code: 'OPERATOR', campusId: '72000000-0000-4000-8000-000000000001' }],
};
export const apiRuntime = (extra: Record<string, unknown> = {}) => ({
  dataDriver: 'api', apiBaseUrl: API_BASE, accessToken: 'synthetic-bootstrap-owner-a',
  enableTestAccountSwitcher: false, ...extra,
});

export async function flushBootstrap() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

export async function outcome<T>(promise: Promise<T>) {
  try { return { value: await promise, error: undefined }; }
  catch (error) { return { value: undefined, error }; }
}

interface BootstrapPage {
  data: Record<string, unknown>;
  setData: jest.Mock;
  onLoad(): void;
  onShow(): void;
  onHide(): void;
  onUnload(): void;
  loadSession(): Promise<void>;
}

interface LogoutDefinition {
  methods: { onLogoutTap(): void };
}

// Only the platform boundary is synthetic. All session/resolver/Page functions are real.
export function captureHeadquartersBootstrap(
  runtime: Record<string, unknown>,
  selected?: unknown,
) {
  const host = globalThis as unknown as Record<string, unknown>;
  const keys = ['wx', 'Page', 'Component', 'getCurrentPages'];
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(host, key)] as const);
  const values = new Map<string, unknown>([
    ['education.runtime', structuredClone(runtime)],
    ['education.session.logged-out', false],
  ]);
  if (selected !== undefined) values.set('education.test-account.current', selected);
  const calls: SessionHttpRequestOptions[] = [];
  const pages: BootstrapPage[] = [];
  let definition: Record<string, unknown> | undefined;
  let logout: LogoutDefinition | undefined;
  let modules!: typeof import('../services/session.service');
  let local!: typeof import('../config/local-runtime');
  let teacher!: typeof import('../config/teacher-env');
  const platform = {
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => { values.set(key, value); },
    request: jest.fn((options: SessionHttpRequestOptions) => {
      calls.push(options);
      return { abort: jest.fn() };
    }),
    login: jest.fn((options: { success(value: { code: string }): void }) =>
      options.success({ code: 'synthetic-bootstrap-wechat-code' })),
    reLaunch: jest.fn(),
    navigateTo: jest.fn(),
    showToast: jest.fn(),
    showModal: jest.fn(),
  };
  try {
    host.wx = platform;
    host.Page = (value: Record<string, unknown>) => { definition = value; };
    host.Component = (value: LogoutDefinition) => { logout = value; };
    host.getCurrentPages = () => pages;
    jest.isolateModules(() => {
      modules = require('../services/session.service');
      local = require('../config/local-runtime');
      teacher = require('../config/teacher-env');
      require('../pages/bootstrap/index');
      require('../components/session-logout/session-logout');
    });
    if (!definition || !logout) throw new Error('HOST_SETUP: Page/Component registration missing');
  } catch (error) {
    restore();
    throw error;
  }
  function restore() {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(host, key, descriptor);
      else Reflect.deleteProperty(host, key);
    }
  }
  return {
    modules, local, teacher, service: modules.sessionService, platform, values, calls,
    logout: logout!,
    instantiate() {
      const page = { ...definition, data: structuredClone(definition!.data) } as unknown as BootstrapPage;
      page.setData = jest.fn((patch: Record<string, unknown>) => Object.assign(page.data, patch));
      pages.push(page);
      return page;
    },
    runtime() { return values.get('education.runtime') as Record<string, unknown>; },
    reply(index: number, data: unknown, statusCode = 200) {
      if (!calls[index]) throw new Error(`HOST_SETUP: request ${index} was not issued`);
      calls[index].success({ statusCode, data });
    },
    replyMe(index: number, me: unknown, statusCode = 200) {
      this.reply(index, { data: me, requestId: 'synthetic-headquarters-bootstrap-read' }, statusCode);
    },
    replyLogin(index: number, me: unknown, accessToken = 'synthetic-bootstrap-owner-b') {
      this.reply(index, {
        data: { me, accessToken, refreshToken: 'synthetic-unused-refresh', expiresInSeconds: 3600 },
        requestId: 'synthetic-headquarters-bootstrap-login',
      });
    },
    rejectUnexpectedPosts() {
      for (const call of calls.filter(call => call.method === 'POST')) {
        call.success({ statusCode: 400, data: { code: 'SYNTHETIC_SERVER_REFUSAL' } });
      }
    },
    snapshot() { return structuredClone([...values]); },
    close() {
      for (const page of pages) page.onUnload();
      restore();
    },
  };
}

export type BootstrapHost = ReturnType<typeof captureHeadquartersBootstrap>;

export function expectHeadquartersSession(me: SessionView | null | undefined) {
  expect(me).toMatchObject({ roles: [{ code: 'OPERATOR', campusId: null }] });
  expect(me?.roles).toHaveLength(1);
  expect(me?.userId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

export async function finishNewIdentity(host: BootstrapHost, service: SessionService = host.service) {
  const pending = service.bindWechatStaffPhone('synthetic-new-phone-code');
  await flushBootstrap();
  const index = host.calls.length - 1;
  expect(host.calls[index]).toMatchObject({ method: 'POST', url: `${API_BASE}/auth/wechat/staff/bind-phone` });
  host.replyLogin(index, campusMe);
  await expect(pending).resolves.toEqual(campusMe);
}
