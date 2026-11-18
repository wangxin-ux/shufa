import {
  createTeacherRuntimeEnv,
  TeacherDataDriver,
  TeacherRuntimeEnv,
} from '../config/teacher-env';
import {
  createRuntimeAccessTokenProvider,
  LOCAL_RUNTIME_STORAGE_KEY,
  MockWechatAccount,
} from '../config/local-runtime';
import { TeacherProfile } from '../types/teacher';

export type SessionRoleCode =
  | 'PARENT'
  | 'PARTNER'
  | 'TEACHER'
  | 'OPERATOR'
  | 'CAMPUS_MANAGER'
  | 'SUPER_ADMIN'
  | 'HR'
  | 'FINANCE';

export interface SessionRole {
  code: SessionRoleCode;
  campusId: string | null;
}

export interface SessionView {
  userId: string;
  displayName: string;
  roles: SessionRole[];
}

export interface RoleBootstrapOption {
  code: SessionRoleCode;
  label: string;
  url:
    | '/pages/parent/home/index'
    | '/pages/partner/home/index'
    | '/pages/teacher/home/index'
    | '/pages/campus-manager/home/index'
    | '/pages/operator/home/index'
    | '/pages/operator/headquarters/index'
    | '/pages/super-admin/home/index'
    | '/pages/finance/home/index'
    | '/pages/hr/home/index';
}

export type TestAccountCode = MockWechatAccount;

export interface TestAccountOption {
  code: TestAccountCode;
  label: string;
}

export type RoleBootstrapResult =
  | { kind: 'login' }
  | { kind: 'navigate'; url: RoleBootstrapOption['url'] }
  | { kind: 'forbidden' };

export interface SessionStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export interface SessionHttpResponse {
  statusCode: number;
  data: unknown;
}

export interface SessionHttpRequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  header: Record<string, string>;
  data?: unknown;
  success(response: SessionHttpResponse): void;
  fail(error: unknown): void;
}

export type SessionHttpRequest = (
  options: SessionHttpRequestOptions,
) => unknown;

export type SessionLoginCodeProvider = () => Promise<string>;

export interface SessionServiceOptions {
  dataDriver: TeacherDataDriver;
  apiBaseUrl?: string;
  accessToken?: string | (() => string);
  storage?: SessionStorage;
  request?: SessionHttpRequest;
  loginCodeProvider?: SessionLoginCodeProvider;
  testAccountSwitcherEnabled?: boolean;
  mockWechatAccount?: TestAccountCode;
}

export interface TeacherSettingsModel {
  displayName: string;
  identityLabel: string;
  campusLabel: string;
  environmentLabel: '本地演示数据' | '接口联调';
}

const LOGGED_OUT_KEY = 'education.session.logged-out';
const CURRENT_TEST_ACCOUNT_KEY = 'education.test-account.current';
const HEADQUARTERS_ACCOUNT = 'OPERATOR_HEADQUARTERS';
const ROLE_SELECTION_DESTINATION = '/pages/bootstrap/index' as const;
let wechatBindSequence = 0;

const ROLE_OPTIONS: ReadonlyArray<RoleBootstrapOption> = [
  { code: 'PARENT', label: '家长端', url: '/pages/parent/home/index' },
  { code: 'PARTNER', label: '合作方端', url: '/pages/partner/home/index' },
  { code: 'TEACHER', label: '教师端', url: '/pages/teacher/home/index' },
  { code: 'CAMPUS_MANAGER', label: '管理员端', url: '/pages/campus-manager/home/index' },
  { code: 'OPERATOR', label: '运营端', url: '/pages/operator/home/index' },
  { code: 'SUPER_ADMIN', label: '总端', url: '/pages/super-admin/home/index' },
  { code: 'HR', label: '人力端', url: '/pages/hr/home/index' },
  { code: 'FINANCE', label: '财务端', url: '/pages/finance/home/index' },
];

const MOCK_WECHAT_LOGIN_CODES: Record<TestAccountCode, string> = {
  PARENT: 'mock-demo-east-parent',
  PARTNER: 'mock-demo-east-partner',
  TEACHER: 'mock-demo-east-teacher',
  CAMPUS_MANAGER: 'mock-demo-east-campus-manager',
  OPERATOR: 'mock-demo-east-operator',
  OPERATOR_HEADQUARTERS: '',
  SUPER_ADMIN: 'mock-demo-super-admin',
  HR: 'mock-demo-hr',
  FINANCE: 'mock-demo-finance',
};

const TEST_PHONE_CODE = '123456';

function mockSession(
  userId: string, displayName: string, code: SessionRoleCode, campusId: string | null,
): SessionView {
  return { userId, displayName, roles: [{ code, campusId }] };
}

const MOCK_SESSIONS: Record<TestAccountCode, SessionView> = {
  HR: mockSession('mock-hr-user', '何主管', 'HR', null),
  FINANCE: mockSession('mock-finance-user', '钱会计', 'FINANCE', null),
  PARENT: mockSession('mock-parent-user', '陈家长', 'PARENT', 'campus-east'),
  PARTNER: mockSession('mock-partner-user', '朱元璋', 'PARTNER', 'campus-east'),
  TEACHER: mockSession('mock-teacher-user', '林老师', 'TEACHER', 'campus-east'),
  CAMPUS_MANAGER: mockSession('mock-campus-manager-user', '周园长', 'CAMPUS_MANAGER', 'campus-east'),
  OPERATOR: mockSession('mock-operator-user', '校区运营', 'OPERATOR', 'campus-east'),
  OPERATOR_HEADQUARTERS: mockSession('72000000-0000-4000-8000-000000000900', '总部演示运营', 'OPERATOR', null),
  SUPER_ADMIN: mockSession('mock-super-admin-user', '系统管理员', 'SUPER_ADMIN', null),
};

interface TestPhoneAccount {
  roleCode: TestAccountCode;
  loginCode: string;
  mockSession: SessionView;
}

const WEST_MOCK_SESSIONS = {
  PARENT: mockSession('mock-west-parent-user', '何家长', 'PARENT', 'campus-west'),
  TEACHER: mockSession('mock-west-teacher-user', '周老师', 'TEACHER', 'campus-west'),
  CAMPUS_MANAGER: mockSession('mock-west-campus-manager-user', '赵园长', 'CAMPUS_MANAGER', 'campus-west'),
  PARTNER: mockSession('mock-west-partner-user', '孙经理', 'PARTNER', 'campus-west'),
} satisfies Record<string, SessionView>;

const TEST_PHONE_ACCOUNTS: Readonly<Record<string, TestPhoneAccount>> =
  Object.fromEntries(([
    ['13800000001', 'PARENT', MOCK_SESSIONS.PARENT],
    ['13800000002', 'PARTNER', MOCK_SESSIONS.PARTNER],
    ['13800000003', 'TEACHER', MOCK_SESSIONS.TEACHER],
    ['13800000004', 'CAMPUS_MANAGER', MOCK_SESSIONS.CAMPUS_MANAGER],
    ['13800000005', 'SUPER_ADMIN', MOCK_SESSIONS.SUPER_ADMIN],
    ['13800000006', 'HR', MOCK_SESSIONS.HR],
    ['13800000007', 'FINANCE', MOCK_SESSIONS.FINANCE],
    ['13800000008', 'PARENT', WEST_MOCK_SESSIONS.PARENT, 'mock-demo-west-parent'],
    ['13800000009', 'TEACHER', WEST_MOCK_SESSIONS.TEACHER, 'mock-demo-west-teacher'],
    ['13800000010', 'CAMPUS_MANAGER', WEST_MOCK_SESSIONS.CAMPUS_MANAGER, 'mock-demo-west-campus-manager'],
    ['13800000011', 'PARTNER', WEST_MOCK_SESSIONS.PARTNER, 'mock-demo-west-partner'],
    ['13800000012', 'OPERATOR', MOCK_SESSIONS.OPERATOR],
  ] satisfies Array<[string, TestAccountCode, SessionView, string?]>)
    .map(([phone, roleCode, mockSession, code]) => [phone, {
      roleCode, mockSession, loginCode: code ?? MOCK_WECHAT_LOGIN_CODES[roleCode],
    }]));

export const defaultStorage: SessionStorage = {
  get: (key) =>
    typeof wx === 'undefined' ? undefined : wx.getStorageSync(key),
  set: (key, value) => {
    if (typeof wx !== 'undefined') {
      wx.setStorageSync(key, value);
    }
  },
};

export const defaultRequest: SessionHttpRequest = (options) =>
  wx.request({
    url: options.url,
    method: options.method,
    header: options.header,
    data: options.data as WechatMiniprogram.IAnyObject | undefined,
    success: (response) =>
      options.success({
        statusCode: response.statusCode,
        data: response.data,
      }),
    fail: options.fail,
  });

export const defaultLoginCodeProvider: SessionLoginCodeProvider = () =>
  new Promise((resolve, reject) => {
    if (typeof wx === 'undefined') {
      reject(new Error('当前环境无法调用微信登录'));
      return;
    }
    wx.login({
      success: ({ code }) => {
        if (code) {
          resolve(code);
          return;
        }
        reject(new Error('未获取到微信登录凭证，请重试'));
      },
      fail: () => reject(new Error('微信登录失败，请重试')),
    });
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function decodeSessionEnvelope(value: unknown): SessionView {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('会话响应格式无效');
  }
  const data = value.data;
  if (
    typeof data.userId !== 'string' ||
    typeof data.displayName !== 'string' ||
    !Array.isArray(data.roles)
  ) {
    throw new Error('会话响应格式无效');
  }
  return data as unknown as SessionView;
}

function cloneSession(session: SessionView): SessionView {
  return {
    ...session,
    roles: session.roles.map((role) => ({ ...role })),
  };
}

function isTestAccountCode(value: unknown): value is TestAccountCode {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(MOCK_SESSIONS, value);
}

export function resolveLocalTestAccountCode(value: unknown): TestAccountCode | undefined {
  if (isTestAccountCode(value)) return value;
  return typeof value === 'string' ? TEST_PHONE_ACCOUNTS[value]?.roleCode : undefined;
}

function decodeAuthSessionEnvelope(value: unknown): {
  accessToken: string;
  me: SessionView;
} {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new Error('登录响应格式无效');
  }
  const data = value.data;
  if (typeof data.accessToken !== 'string' || !isRecord(data.me)) {
    throw new Error('登录响应格式无效');
  }
  return {
    accessToken: data.accessToken,
    me: data.me as unknown as SessionView,
  };
}

export class SessionServiceError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionServiceError';
  }
}

export function resolveRoleBootstrap(
  session: SessionView | null,
): RoleBootstrapResult {
  if (!session) {
    return { kind: 'login' };
  }

  if (session.roles.length !== 1) {
    return { kind: 'forbidden' };
  }

  const role = session.roles[0];
  if (role.code === 'OPERATOR' && role.campusId === null) {
    return { kind: 'navigate', url: '/pages/operator/headquarters/index' };
  }
  const route = ROLE_OPTIONS.find((option) => option.code === role.code);
  if (!route) {
    return { kind: 'forbidden' };
  }
  const isHeadquartersRole =
    role.code === 'SUPER_ADMIN' ||
    role.code === 'HR' ||
    role.code === 'FINANCE';
  const hasValidScope = isHeadquartersRole
    ? role.campusId === null
    : typeof role.campusId === 'string' && role.campusId.length > 0;
  if (!hasValidScope) {
    return { kind: 'forbidden' };
  }
  return { kind: 'navigate', url: route.url };
}

export function buildTeacherSettingsModel(
  profile: TeacherProfile,
  dataDriver: TeacherDataDriver,
): TeacherSettingsModel {
  const subject = profile.subjectLabel.trim();
  return {
    displayName: profile.displayName,
    identityLabel: subject ? `授课老师 · ${subject}` : '授课老师',
    campusLabel: profile.campusName,
    environmentLabel: dataDriver === 'mock' ? '本地演示数据' : '接口联调',
  };
}

export class SessionService {
  readonly logoutDestination = ROLE_SELECTION_DESTINATION;

  private readonly dataDriver: TeacherDataDriver;
  private readonly apiBaseUrl: string;
  private readonly accessToken: () => string;
  private readonly storage: SessionStorage;
  private readonly request: SessionHttpRequest;
  private readonly loginCodeProvider: SessionLoginCodeProvider;
  private readonly testAccountSwitcherEnabled: boolean;
  private readonly mockWechatAccount: TestAccountCode;
  private revision = 0;
  private readonly auth: SessionService;
  private recovery?: { revision: number; promise: Promise<SessionView | null> };

  constructor(options: SessionServiceOptions, auth?: SessionService) {
    this.auth = auth?.auth ?? this;
    this.dataDriver = options.dataDriver;
    this.apiBaseUrl = (options.apiBaseUrl ?? '').replace(/\/$/, '');
    const token = options.accessToken ?? '';
    this.accessToken = typeof token === 'function' ? token : () => token;
    this.storage = options.storage ?? defaultStorage;
    this.request = options.request ?? defaultRequest;
    this.loginCodeProvider =
      options.loginCodeProvider ?? defaultLoginCodeProvider;
    this.testAccountSwitcherEnabled =
      options.testAccountSwitcherEnabled ?? options.dataDriver === 'mock';
    this.mockWechatAccount = options.mockWechatAccount ?? 'PARENT';
  }

  async load(): Promise<SessionView | null> {
    if (this.storage.get(LOGGED_OUT_KEY) === true) {
      return null;
    }
    if (this.dataDriver === 'mock') {
      const selected = this.storage.get(CURRENT_TEST_ACCOUNT_KEY);
      if (selected === HEADQUARTERS_ACCOUNT && !this.canUseHeadquarters()) return null;
      if (isTestAccountCode(selected)) {
        return cloneSession(MOCK_SESSIONS[selected]);
      }
      if (typeof selected === 'string' && TEST_PHONE_ACCOUNTS[selected]) {
        return cloneSession(TEST_PHONE_ACCOUNTS[selected].mockSession);
      }
      return null;
    }
    const revision = this.auth.revision;
    const cachedSession = await this.loadApiSession();
    this.checkRevision(revision);
    if (cachedSession || this.testAccountSwitcherEnabled) {
      return cachedSession;
    }
    if (this.recovery?.revision !== revision) {
      const promise = this.loginWechatSilently().finally(() => {
        if (this.recovery?.promise === promise) this.recovery = undefined;
      });
      this.recovery = { revision, promise };
    }
    return this.recovery.promise;
  }

  logout(): void {
    this.auth.revision += 1;
    this.storage.set(LOGGED_OUT_KEY, true);
    this.storage.set(CURRENT_TEST_ACCOUNT_KEY, '');
    if (this.dataDriver === 'api') this.persistAccessToken('');
  }

  async bindWechatStaffPhone(
    phoneCode: string,
    idempotencyKey = this.createWechatBindKey(),
  ): Promise<SessionView> {
    if (this.dataDriver !== 'api') {
      throw new Error('当前环境不支持微信手机号登录');
    }
    const normalizedPhoneCode = phoneCode.trim();
    if (!normalizedPhoneCode) {
      throw new Error('未获取到微信手机号授权凭证');
    }
    const revision = ++this.auth.revision;
    const code = await this.loginCodeProvider();
    this.checkRevision(revision);
    const session = await this.requestWechatSession(
      '/auth/wechat/staff/bind-phone',
      { code, phoneCode: normalizedPhoneCode },
      idempotencyKey,
    );
    return this.acceptSession(session, revision);
  }

  canSwitchTestAccount(): boolean {
    return this.testAccountSwitcherEnabled;
  }

  beginExplicitLogin(): () => boolean {
    this.auth.revision++;
    return this.sessionGuard();
  }

  sessionGuard(): () => boolean {
    const revision = this.auth.revision;
    return () => revision === this.auth.revision;
  }

  private canUseHeadquarters(): boolean {
    const raw = this.storage.get(LOCAL_RUNTIME_STORAGE_KEY);
    return this.dataDriver === 'mock' && isRecord(raw) && raw.enableTestAccountSwitcher === true;
  }

  private requireTestAccount(code: TestAccountCode): void {
    if (!isTestAccountCode(code) || (code === HEADQUARTERS_ACCOUNT && !this.canUseHeadquarters()))
      throw new Error('当前环境不支持此登录方式');
  }

  private checkRevision(revision: number) {
    if (revision !== this.auth.revision) throw new Error('登录状态已更新，请重新登录');
  }

  usesMockWechatSimulation(): boolean {
    return this.dataDriver === 'mock' || this.testAccountSwitcherEnabled;
  }

  async loginWithMockWechat(): Promise<SessionView> {
    this.requireTestAccount(this.mockWechatAccount);
    if (!this.usesMockWechatSimulation()) {
      throw new Error('当前环境不支持模拟微信登录');
    }
    const revision = ++this.auth.revision;
    if (this.dataDriver === 'mock') {
      return this.selectMock(this.mockWechatAccount, MOCK_SESSIONS[this.mockWechatAccount]);
    }
    const session = await this.requestMockSession(
      MOCK_WECHAT_LOGIN_CODES[this.mockWechatAccount],
    );
    return this.acceptSession(session, revision);
  }

  listTestAccounts(): TestAccountOption[] {
    if (!this.canSwitchTestAccount()) {
      return [];
    }
    const accounts: TestAccountOption[] = ROLE_OPTIONS.map(({ code, label }) => ({ code, label }));
    if (this.canUseHeadquarters()) accounts.push({ code: HEADQUARTERS_ACCOUNT, label: '总部运营端' });
    return accounts;
  }

  needsTestAccountSelection(): boolean {
    return this.canSwitchTestAccount();
  }

  prepareTestAccountSwitch(): typeof ROLE_SELECTION_DESTINATION {
    this.logout();
    return ROLE_SELECTION_DESTINATION;
  }

  async switchTestAccount(code: TestAccountCode): Promise<SessionView> {
    this.requireTestAccount(code);
    if (!this.canSwitchTestAccount()) {
      throw new Error('当前环境不支持此登录方式');
    }
    const revision = ++this.auth.revision;
    if (this.dataDriver === 'mock') {
      return this.selectMock(code, MOCK_SESSIONS[code]);
    }
    const session = await this.requestMockSession(MOCK_WECHAT_LOGIN_CODES[code]);
    return this.acceptSession(session, revision);
  }

  async requestTestPhoneCode(
    phone: string,
  ): Promise<{ expiresInSeconds: 60 }> {
    if (!this.canSwitchTestAccount()) {
      throw new Error('当前环境不支持此登录方式');
    }
    if (!TEST_PHONE_ACCOUNTS[phone.trim()]) {
      throw new Error('手机号或验证码错误');
    }
    return { expiresInSeconds: 60 };
  }

  async loginWithTestPhoneCode(
    phone: string,
    verificationCode: string,
  ): Promise<SessionView> {
    if (!this.canSwitchTestAccount()) {
      throw new Error('当前环境不支持此登录方式');
    }
    const normalizedPhone = phone.trim();
    const account = TEST_PHONE_ACCOUNTS[normalizedPhone];
    if (!account || verificationCode.trim() !== TEST_PHONE_CODE) {
      throw new Error('手机号或验证码错误');
    }
    const revision = ++this.auth.revision;
    if (this.dataDriver === 'mock') {
      return this.selectMock(normalizedPhone, account.mockSession);
    }
    const session = await this.requestMockSession(account.loginCode);
    return this.acceptSession(session, revision);
  }

  private selectMock(code: string, session: SessionView): SessionView {
    this.storage.set(LOGGED_OUT_KEY, false);
    this.storage.set(CURRENT_TEST_ACCOUNT_KEY, code);
    return cloneSession(session);
  }

  private acceptSession(session: { accessToken: string; me: SessionView }, revision: number): SessionView {
    this.checkRevision(revision);
    this.storage.set(LOGGED_OUT_KEY, false);
    this.storage.set(CURRENT_TEST_ACCOUNT_KEY, '');
    this.persistAccessToken(session.accessToken);
    return session.me;
  }

  private loadApiSession(): Promise<SessionView | null> {
    const revision = this.auth.revision;
    const token = this.accessToken().trim();
    if (!token || !this.apiBaseUrl) {
      return Promise.resolve(null);
    }
    return new Promise<SessionView | null>((resolve, reject) => {
      this.request({
        url: `${this.apiBaseUrl}/me`,
        method: 'GET',
        header: { Authorization: `Bearer ${token}` },
        success: (response) => {
          try {
            this.checkRevision(revision);
            if (response.statusCode === 401) {
              this.persistAccessToken('');
              resolve(null);
              return;
            }
            if (response.statusCode >= 200 && response.statusCode < 300) {
              resolve(decodeSessionEnvelope(response.data));
              return;
            }
            throw new Error('会话加载失败');
          } catch (error) { reject(error); }
        },
        fail: (error) =>
          reject(
            new Error(
              error instanceof Error ? error.message : '会话网络请求失败',
            ),
          ),
      });
    });
  }

  private async loginWechatSilently(): Promise<SessionView | null> {
    const revision = this.auth.revision;
    const code = await this.loginCodeProvider();
    try {
      this.checkRevision(revision);
      const session = await this.requestWechatSession(
        '/auth/wechat/login',
        { code },
      );
      this.checkRevision(revision);
      this.persistAccessToken(session.accessToken);
      return session.me;
    } catch (error) {
      this.checkRevision(revision);
      if (
        error instanceof SessionServiceError &&
        error.code === 'STAFF_PHONE_BINDING_REQUIRED'
      ) {
        return null;
      }
      throw error;
    }
  }

  private requestWechatSession(
    path: string,
    data: Record<string, string>,
    idempotencyKey?: string,
    mock = false,
  ): Promise<{ accessToken: string; me: SessionView }> {
    if (!this.apiBaseUrl) {
      return Promise.reject(new Error('API 地址不能为空'));
    }
    return new Promise((resolve, reject) => {
      this.request({
        url: `${this.apiBaseUrl}${path}`,
        method: 'POST',
        header: {
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        data,
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve(decodeAuthSessionEnvelope(response.data));
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(this.toWechatAuthError(response.statusCode, response.data, mock));
        },
        fail: (error) =>
          reject(
            new Error(
              error instanceof Error ? error.message : mock ? '模拟微信登录网络请求失败' : '微信登录网络请求失败',
            ),
          ),
      });
    });
  }

  private toWechatAuthError(statusCode: number, body: unknown, mock = false): Error {
    const code =
      isRecord(body) && typeof body.code === 'string'
        ? body.code
        : 'UNKNOWN_ERROR';
    const stableMessages: Partial<Record<string, string>> = {
      STAFF_PHONE_BINDING_REQUIRED: '请授权微信手机号完成工作人员账号绑定',
      STAFF_ACCOUNT_UNAVAILABLE: '暂无对应工作人员账号，请联系管理员',
      WECHAT_IDENTITY_CONFLICT: '该账号或微信已绑定，请联系管理员',
      WECHAT_PROVIDER_RESPONSE_INVALID: '微信授权信息无效，请重试',
    };
    const message =
      (!mock && stableMessages[code]) ||
      (statusCode >= 500
        ? '服务器处理失败，请稍后重试'
        : mock ? '模拟微信登录失败，请重试' : '微信登录失败，请重试');
    return new SessionServiceError(statusCode, code, message);
  }

  private persistAccessToken(accessToken: string): void {
    const storedRuntime = this.storage.get(LOCAL_RUNTIME_STORAGE_KEY);
    this.storage.set(LOCAL_RUNTIME_STORAGE_KEY, {
      ...(isRecord(storedRuntime) ? storedRuntime : {}),
      accessToken,
    });
  }

  private createWechatBindKey(): string {
    wechatBindSequence += 1;
    return `wechat-staff-bind-${Date.now()}-${wechatBindSequence}`;
  }

  private requestMockSession(
    code: string,
  ): Promise<{ accessToken: string; me: SessionView }> {
    return this.requestWechatSession('/auth/login', { code }, undefined, true);
  }
}

export function createSessionService(
  env: TeacherRuntimeEnv = createTeacherRuntimeEnv(),
  overrides: Pick<
    SessionServiceOptions,
    'storage' | 'request' | 'loginCodeProvider'
  > = {},
): SessionService {
  return new SessionService({
    dataDriver: env.dataDriver,
    apiBaseUrl: env.apiBaseUrl,
    accessToken: createRuntimeAccessTokenProvider(env.accessToken),
    testAccountSwitcherEnabled:
      env.dataDriver === 'mock' || env.enableTestAccountSwitcher,
    mockWechatAccount: env.mockWechatAccount,
    ...overrides,
  });
}

export const sessionService = createSessionService();
