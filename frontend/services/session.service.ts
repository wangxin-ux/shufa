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
  code: 'PARENT' | 'PARTNER' | 'TEACHER' | 'CAMPUS_MANAGER' | 'SUPER_ADMIN' | 'FINANCE' | 'HR';
  label: string;
  url:
    | '/pages/parent/home/index'
    | '/pages/partner/home/index'
    | '/pages/teacher/home/index'
    | '/pages/campus-manager/home/index'
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
  method: 'GET' | 'POST';
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
const ROLE_SELECTION_DESTINATION = '/pages/bootstrap/index' as const;
let wechatBindSequence = 0;

const ROLE_OPTIONS: ReadonlyArray<RoleBootstrapOption> = [
  {
    code: 'PARENT',
    label: '家长端',
    url: '/pages/parent/home/index',
  },
  {
    code: 'PARTNER',
    label: '合作方端',
    url: '/pages/partner/home/index',
  },
  {
    code: 'TEACHER',
    label: '教师端',
    url: '/pages/teacher/home/index',
  },
  {
    code: 'CAMPUS_MANAGER',
    label: '管理员端',
    url: '/pages/campus-manager/home/index',
  },
  {
    code: 'SUPER_ADMIN',
    label: '总端',
    url: '/pages/super-admin/home/index',
  },
  { code: 'HR', label: '人力端', url: '/pages/hr/home/index' },
  { code: 'FINANCE', label: '财务端', url: '/pages/finance/home/index' },
];

const MOCK_WECHAT_LOGIN_CODES: Record<TestAccountCode, string> = {
  PARENT: 'mock-demo-east-parent',
  PARTNER: 'mock-demo-east-partner',
  TEACHER: 'mock-demo-east-teacher',
  CAMPUS_MANAGER: 'mock-demo-east-campus-manager',
  SUPER_ADMIN: 'mock-demo-super-admin',
  HR: 'mock-demo-hr',
  FINANCE: 'mock-demo-finance',
};

const TEST_PHONE_CODE = '123456';

const MOCK_SESSIONS: Record<TestAccountCode, SessionView> = {
  HR: { userId: 'mock-hr-user', displayName: '何主管', roles: [{ code: 'HR', campusId: null }] },
  FINANCE: { userId: 'mock-finance-user', displayName: '钱会计', roles: [{ code: 'FINANCE', campusId: null }] },
  PARENT: {
    userId: 'mock-parent-user',
    displayName: '陈家长',
    roles: [{ code: 'PARENT', campusId: 'campus-east' }],
  },
  PARTNER: {
    userId: 'mock-partner-user',
    displayName: '朱元璋',
    roles: [{ code: 'PARTNER', campusId: 'campus-east' }],
  },
  TEACHER: {
    userId: 'mock-teacher-user',
    displayName: '林老师',
    roles: [{ code: 'TEACHER', campusId: 'campus-east' }],
  },
  CAMPUS_MANAGER: {
    userId: 'mock-campus-manager-user',
    displayName: '周园长',
    roles: [{ code: 'CAMPUS_MANAGER', campusId: 'campus-east' }],
  },
  SUPER_ADMIN: {
    userId: 'mock-super-admin-user',
    displayName: '系统管理员',
    roles: [{ code: 'SUPER_ADMIN', campusId: null }],
  },
};

interface TestPhoneAccount {
  roleCode: TestAccountCode;
  loginCode: string;
  mockSession: SessionView;
}

const WEST_MOCK_SESSIONS = {
  PARENT: {
    userId: 'mock-west-parent-user',
    displayName: '何家长',
    roles: [{ code: 'PARENT', campusId: 'campus-west' }],
  },
  TEACHER: {
    userId: 'mock-west-teacher-user',
    displayName: '周老师',
    roles: [{ code: 'TEACHER', campusId: 'campus-west' }],
  },
  CAMPUS_MANAGER: {
    userId: 'mock-west-campus-manager-user',
    displayName: '赵园长',
    roles: [{ code: 'CAMPUS_MANAGER', campusId: 'campus-west' }],
  },
  PARTNER: {
    userId: 'mock-west-partner-user',
    displayName: '孙经理',
    roles: [{ code: 'PARTNER', campusId: 'campus-west' }],
  },
} satisfies Record<string, SessionView>;

const TEST_PHONE_ACCOUNTS: Readonly<Record<string, TestPhoneAccount>> = {
  '13800000001': {
    roleCode: 'PARENT',
    loginCode: 'mock-demo-east-parent',
    mockSession: MOCK_SESSIONS.PARENT,
  },
  '13800000002': {
    roleCode: 'PARTNER',
    loginCode: 'mock-demo-east-partner',
    mockSession: MOCK_SESSIONS.PARTNER,
  },
  '13800000003': {
    roleCode: 'TEACHER',
    loginCode: 'mock-demo-east-teacher',
    mockSession: MOCK_SESSIONS.TEACHER,
  },
  '13800000004': {
    roleCode: 'CAMPUS_MANAGER',
    loginCode: 'mock-demo-east-campus-manager',
    mockSession: MOCK_SESSIONS.CAMPUS_MANAGER,
  },
  '13800000005': {
    roleCode: 'SUPER_ADMIN',
    loginCode: 'mock-demo-super-admin',
    mockSession: MOCK_SESSIONS.SUPER_ADMIN,
  },
  '13800000006': {
    roleCode: 'HR',
    loginCode: 'mock-demo-hr',
    mockSession: MOCK_SESSIONS.HR,
  },
  '13800000007': {
    roleCode: 'FINANCE',
    loginCode: 'mock-demo-finance',
    mockSession: MOCK_SESSIONS.FINANCE,
  },
  '13800000008': {
    roleCode: 'PARENT',
    loginCode: 'mock-demo-west-parent',
    mockSession: WEST_MOCK_SESSIONS.PARENT,
  },
  '13800000009': {
    roleCode: 'TEACHER',
    loginCode: 'mock-demo-west-teacher',
    mockSession: WEST_MOCK_SESSIONS.TEACHER,
  },
  '13800000010': {
    roleCode: 'CAMPUS_MANAGER',
    loginCode: 'mock-demo-west-campus-manager',
    mockSession: WEST_MOCK_SESSIONS.CAMPUS_MANAGER,
  },
  '13800000011': {
    roleCode: 'PARTNER',
    loginCode: 'mock-demo-west-partner',
    mockSession: WEST_MOCK_SESSIONS.PARTNER,
  },
};

const defaultStorage: SessionStorage = {
  get: (key) =>
    typeof wx === 'undefined' ? undefined : wx.getStorageSync(key),
  set: (key, value) => {
    if (typeof wx !== 'undefined') {
      wx.setStorageSync(key, value);
    }
  },
};

const defaultRequest: SessionHttpRequest = (options) =>
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

const defaultLoginCodeProvider: SessionLoginCodeProvider = () =>
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

function cloneMockSession(code: TestAccountCode): SessionView {
  return cloneSession(MOCK_SESSIONS[code]);
}

function isTestAccountCode(value: unknown): value is TestAccountCode {
  return (
    value === 'PARENT' ||
    value === 'PARTNER' ||
    value === 'TEACHER' ||
    value === 'CAMPUS_MANAGER' ||
    value === 'SUPER_ADMIN' ||
    value === 'FINANCE' ||
    value === 'HR'
  );
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

  constructor(options: SessionServiceOptions) {
    this.dataDriver = options.dataDriver;
    this.apiBaseUrl = (options.apiBaseUrl ?? '').replace(/\/$/, '');
    if (typeof options.accessToken === 'function') {
      this.accessToken = options.accessToken;
    } else {
      const accessToken = options.accessToken ?? '';
      this.accessToken = () => accessToken;
    }
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
      if (isTestAccountCode(selected)) {
        return cloneMockSession(selected);
      }
      if (typeof selected === 'string' && TEST_PHONE_ACCOUNTS[selected]) {
        return cloneSession(TEST_PHONE_ACCOUNTS[selected].mockSession);
      }
      return null;
    }
    const cachedSession = await this.loadApiSession();
    if (cachedSession || this.testAccountSwitcherEnabled) {
      return cachedSession;
    }
    return this.loginWechatSilently();
  }

  logout(): void {
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
    const code = await this.loginCodeProvider();
    const session = await this.requestWechatSession(
      '/auth/wechat/staff/bind-phone',
      { code, phoneCode: normalizedPhoneCode },
      idempotencyKey,
    );
    this.storage.set(LOGGED_OUT_KEY, false);
    this.persistAccessToken(session.accessToken);
    return session.me;
  }

  canSwitchTestAccount(): boolean {
    return this.testAccountSwitcherEnabled;
  }

  usesMockWechatSimulation(): boolean {
    return this.dataDriver === 'mock' || this.testAccountSwitcherEnabled;
  }

  async loginWithMockWechat(): Promise<SessionView> {
    if (!this.usesMockWechatSimulation()) {
      throw new Error('当前环境不支持模拟微信登录');
    }
    if (this.dataDriver === 'mock') {
      this.storage.set(LOGGED_OUT_KEY, false);
      this.storage.set(CURRENT_TEST_ACCOUNT_KEY, this.mockWechatAccount);
      return cloneMockSession(this.mockWechatAccount);
    }
    const session = await this.requestMockSession(
      MOCK_WECHAT_LOGIN_CODES[this.mockWechatAccount],
    );
    this.storage.set(LOGGED_OUT_KEY, false);
    this.storage.set(CURRENT_TEST_ACCOUNT_KEY, '');
    this.persistAccessToken(session.accessToken);
    return session.me;
  }

  listTestAccounts(): TestAccountOption[] {
    if (!this.canSwitchTestAccount()) {
      return [];
    }
    return ROLE_OPTIONS.map(({ code, label }) => ({ code, label }));
  }

  needsTestAccountSelection(): boolean {
    return this.canSwitchTestAccount();
  }

  prepareTestAccountSwitch(): typeof ROLE_SELECTION_DESTINATION {
    this.logout();
    return ROLE_SELECTION_DESTINATION;
  }

  async switchTestAccount(code: TestAccountCode): Promise<SessionView> {
    if (!this.canSwitchTestAccount()) {
      throw new Error('当前环境不支持此登录方式');
    }
    if (this.dataDriver === 'mock') {
      this.storage.set(LOGGED_OUT_KEY, false);
      this.storage.set(CURRENT_TEST_ACCOUNT_KEY, code);
      return cloneMockSession(code);
    }
    const session = await this.requestMockSession(MOCK_WECHAT_LOGIN_CODES[code]);
    this.storage.set(LOGGED_OUT_KEY, false);
    this.storage.set(CURRENT_TEST_ACCOUNT_KEY, '');
    this.persistAccessToken(session.accessToken);
    return session.me;
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
    this.storage.set(LOGGED_OUT_KEY, false);
    if (this.dataDriver === 'mock') {
      this.storage.set(CURRENT_TEST_ACCOUNT_KEY, normalizedPhone);
      return cloneSession(account.mockSession);
    }
    const session = await this.requestMockSession(account.loginCode);
    this.storage.set(CURRENT_TEST_ACCOUNT_KEY, '');
    this.persistAccessToken(session.accessToken);
    return session.me;
  }

  private loadApiSession(): Promise<SessionView | null> {
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
          if (response.statusCode === 401) {
            this.persistAccessToken('');
            resolve(null);
            return;
          }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve(decodeSessionEnvelope(response.data));
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(new Error('会话加载失败'));
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
    const code = await this.loginCodeProvider();
    try {
      const session = await this.requestWechatSession(
        '/auth/wechat/login',
        { code },
      );
      this.persistAccessToken(session.accessToken);
      return session.me;
    } catch (error) {
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
          reject(this.toWechatAuthError(response.statusCode, response.data));
        },
        fail: (error) =>
          reject(
            new Error(
              error instanceof Error ? error.message : '微信登录网络请求失败',
            ),
          ),
      });
    });
  }

  private toWechatAuthError(statusCode: number, body: unknown): Error {
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
      stableMessages[code] ??
      (statusCode >= 500
        ? '服务器处理失败，请稍后重试'
        : '微信登录失败，请重试');
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
    if (!this.apiBaseUrl) {
      return Promise.reject(new Error('API 地址不能为空'));
    }
    return new Promise((resolve, reject) => {
      this.request({
        url: `${this.apiBaseUrl}/auth/login`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: { code },
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve(decodeAuthSessionEnvelope(response.data));
            } catch (error) {
              reject(error);
            }
            return;
          }
          reject(
            new SessionServiceError(
              response.statusCode,
              isRecord(response.data) &&
              typeof response.data.code === 'string'
                ? response.data.code
                : 'UNKNOWN_ERROR',
              response.statusCode >= 500
                ? '服务器处理失败，请稍后重试'
                : '模拟微信登录失败，请重试',
            ),
          );
        },
        fail: (error) =>
          reject(
            new Error(
              error instanceof Error
                ? error.message
                : '模拟微信登录网络请求失败',
            ),
          ),
      });
    });
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
