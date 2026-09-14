interface BootstrapPage {
  data: Record<string, unknown>;
  setData(patch: Record<string, unknown>): void;
  onPhoneInput(event: { detail: { value?: string } }): void;
  onVerificationCodeInput(event: { detail: { value?: string } }): void;
  onRequestPhoneCodeTap(): Promise<void>;
  onPhoneCodeLoginTap(): Promise<void>;
  onUnload(): void;
}

const sessionService = {
  usesMockWechatSimulation: jest.fn(() => true),
  canSwitchTestAccount: jest.fn(() => true),
  load: jest.fn(),
  requestTestPhoneCode: jest.fn(),
  loginWithTestPhoneCode: jest.fn(),
  bindWechatStaffPhone: jest.fn(),
};
const resolveRoleBootstrap = jest.fn();

jest.mock('../services/session.service', () => ({
  sessionService,
  resolveRoleBootstrap,
}));

describe('local account selection', () => {
  const originalPage = Object.getOwnPropertyDescriptor(globalThis, 'Page');
  const originalWx = Object.getOwnPropertyDescriptor(globalThis, 'wx');
  const reLaunch = jest.fn();
  const showToast = jest.fn();
  let page: BootstrapPage;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.resetAllMocks();
    sessionService.usesMockWechatSimulation.mockReturnValue(true);
    sessionService.canSwitchTestAccount.mockReturnValue(true);
    Object.defineProperty(globalThis, 'wx', {
      configurable: true,
      value: { reLaunch, showToast },
    });
    Object.defineProperty(globalThis, 'Page', {
      configurable: true,
      value: (definition: BootstrapPage) => {
        page = definition;
        page.setData = (patch) => Object.assign(page.data, patch);
      },
    });
    jest.isolateModules(() => require('../pages/bootstrap/index'));
  });

  afterEach(() => {
    page.onUnload();
    jest.useRealTimers();
  });

  afterAll(() => {
    if (originalPage) Object.defineProperty(globalThis, 'Page', originalPage);
    else Reflect.deleteProperty(globalThis, 'Page');
    if (originalWx) Object.defineProperty(globalThis, 'wx', originalWx);
    else Reflect.deleteProperty(globalThis, 'wx');
  });

  it('shows the local phone-code login mode without exposing a role list', () => {
    expect(page.data).toMatchObject({
      isTestAccountLogin: true,
      phone: '',
      verificationCode: '',
      canRequestCode: false,
      codeCountdown: 0,
      canSubmit: false,
    });
    expect(page.data).not.toHaveProperty('testAccounts');
  });

  it('enables code request and login only when their inputs are valid', () => {
    page.onPhoneInput({ detail: { value: '13800000001' } });
    expect(page.data).toMatchObject({
      phone: '13800000001',
      verificationCode: '',
      canRequestCode: true,
      canSubmit: false,
    });

    page.onVerificationCodeInput({ detail: { value: '123456' } });
    expect(page.data).toMatchObject({
      phone: '13800000001',
      verificationCode: '123456',
      canSubmit: true,
    });

    page.onPhoneInput({ detail: { value: '138' } });
    expect(page.data.canSubmit).toBe(false);
  });

  it('starts a 60 second countdown after requesting a local code', async () => {
    sessionService.requestTestPhoneCode.mockResolvedValue({
      expiresInSeconds: 60,
    });
    page.onPhoneInput({ detail: { value: '13800000001' } });

    await page.onRequestPhoneCodeTap();

    expect(sessionService.requestTestPhoneCode).toHaveBeenCalledWith(
      '13800000001',
    );
    expect(page.data.codeCountdown).toBe(60);
    expect(showToast).toHaveBeenCalledWith({
      title: '本地验证码：123456',
      icon: 'none',
    });
    jest.advanceTimersByTime(1000);
    expect(page.data.codeCountdown).toBe(59);
  });

  it('enters the account supplied by the phone-code inputs', async () => {
    const session = {
      userId: 'mock-parent-user',
      displayName: '陈家长',
      roles: [{ code: 'PARENT', campusId: 'campus-east' }],
    };
    sessionService.loginWithTestPhoneCode.mockResolvedValue(session);
    resolveRoleBootstrap.mockReturnValue({
      kind: 'navigate',
      url: '/pages/parent/home/index',
    });

    page.onPhoneInput({ detail: { value: '13800000001' } });
    page.onVerificationCodeInput({ detail: { value: '123456' } });

    await page.onPhoneCodeLoginTap();

    expect(sessionService.loginWithTestPhoneCode).toHaveBeenCalledWith(
      '13800000001',
      '123456',
    );
    expect(reLaunch).toHaveBeenCalledWith({
      url: '/pages/parent/home/index',
    });
  });
});
