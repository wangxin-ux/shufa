import {
  resolveRoleBootstrap,
  RoleBootstrapResult,
  SessionView,
  sessionService,
} from '../../services/session.service';

let codeCountdownTimer: ReturnType<typeof setInterval> | null = null;

function stopCodeCountdown() {
  if (codeCountdownTimer !== null) {
    clearInterval(codeCountdownTimer);
    codeCountdownTimer = null;
  }
}

function isValidPhone(phone: string): boolean {
  return /^1[3-9]\d{9}$/.test(phone);
}

Page({
  inactive: false,
  appNavigating: false,
  appSequence: 0,
  pendingSession: Promise.resolve<SessionView | null>(null),
  data: {
    viewState: 'loading',
    errorMessage: '',
    isTestAccountLogin: sessionService.canSwitchTestAccount(),
    phone: '',
    verificationCode: '',
    canRequestCode: false,
    codeCountdown: 0,
    canSubmit: false,
  },

  onLoad() {
    void this.loadSession();
  },

  loadSession() {
    return this.useSession(() => sessionService.load(), 'loading', '会话加载失败，请重试');
  },

  async useSession(action: () => Promise<SessionView | null>, viewState: string, fallback: string) {
    if (this.inactive || this.appNavigating) return;
    const sequence = ++this.appSequence;
    this.setData({ viewState, errorMessage: '' });
    const pending = this.pendingSession = action();
    const sameSession = sessionService.sessionGuard();
    const current = () => !this.inactive && sequence === this.appSequence && sameSession();
    try {
      const session = await pending;
      if (current()) this.applyBootstrapResult(resolveRoleBootstrap(session));
    } catch (error) {
      if (current()) this.setData({
        viewState: viewState === 'loading' ? 'error' : 'login',
        errorMessage: error instanceof Error ? error.message : fallback,
      });
    }
  },

  applyBootstrapResult(result: RoleBootstrapResult) {
    if (result.kind === 'navigate') {
      wx.reLaunch({ url: result.url });
      return;
    }
    this.setData({
      viewState: result.kind,
    });
  },

  updatePhoneForm(phone: string, verificationCode: string) {
    this.setData({
      phone,
      verificationCode,
      canRequestCode: isValidPhone(phone),
      canSubmit: isValidPhone(phone) && /^\d{6}$/.test(verificationCode),
      errorMessage: '',
    });
  },

  onPhoneInput(event: WechatMiniprogram.Input) {
    this.updatePhoneForm(String(event.detail.value ?? '').replace(/\D/g, '').slice(0, 11),
      String(this.data.verificationCode ?? ''));
  },

  onVerificationCodeInput(event: WechatMiniprogram.Input) {
    this.updatePhoneForm(String(this.data.phone ?? ''),
      String(event.detail.value ?? '').replace(/\D/g, '').slice(0, 6));
  },

  async onRequestPhoneCodeTap() {
    const phone = String(this.data.phone ?? '').trim();
    if (!isValidPhone(phone) || Number(this.data.codeCountdown ?? 0) > 0) {
      return;
    }
    try {
      const result = await sessionService.requestTestPhoneCode(phone);
      stopCodeCountdown();
      this.setData({
        codeCountdown: result.expiresInSeconds,
        errorMessage: '',
      });
      wx.showToast({
        title: '本地验证码：123456',
        icon: 'none',
      });
      codeCountdownTimer = setInterval(() => {
        const nextCountdown = Math.max(
          0,
          Number(this.data.codeCountdown ?? 0) - 1,
        );
        this.setData({ codeCountdown: nextCountdown });
        if (nextCountdown === 0) {
          stopCodeCountdown();
        }
      }, 1000);
    } catch (error) {
      this.setData({
        errorMessage:
          error instanceof Error ? error.message : '验证码获取失败，请重试',
      });
    }
  },

  async onPhoneCodeLoginTap() {
    const phone = String(this.data.phone ?? '').trim();
    const verificationCode = String(this.data.verificationCode ?? '').trim();
    if (!isValidPhone(phone) || !/^\d{6}$/.test(verificationCode)) {
      this.setData({ errorMessage: '请输入正确的手机号和6位验证码' });
      return;
    }
    return this.useSession(
      () => sessionService.loginWithTestPhoneCode(phone, verificationCode),
      'submitting', '手机号验证码登录失败，请重试',
    );
  },

  async onWechatPhoneTap(event: {
    detail: { code?: string; errMsg?: string };
  }) {
    if (this.inactive || this.appNavigating || this.data.viewState !== 'login') return;
    const phoneCode = event.detail.code?.trim() ?? '';
    if (!phoneCode) {
      this.setData({
        viewState: 'login',
        errorMessage: '你已取消手机号授权，请授权后再登录',
      });
      return;
    }
    return this.useSession(
      () => sessionService.bindWechatStaffPhone(phoneCode),
      'submitting', '微信手机号登录失败，请重试',
    );
  },

  onRetry() {
    void this.loadSession();
  },

  onWechatLoginTap() {
    if (this.data.isTestAccountLogin || this.data.viewState !== 'login') return;
    this.openLoginRoute('/pages/partner/login/index');
  },
  async onShow() {
    const resume = this.inactive && ['loading', 'submitting'].includes(this.data.viewState);
    this.inactive = false;
    this.appNavigating = false;
    if (!resume) return;
    const sequence = ++this.appSequence;
    const sameSession = sessionService.sessionGuard();
    try { await this.pendingSession; } catch {}
    if (!this.inactive && sequence === this.appSequence && sameSession()) void this.loadSession();
  },
  onHide() { this.inactive = true; this.appSequence += 1; },
  onOpenApplication() {
    this.openLoginRoute('/pages/partner/application/index');
  },
  openLoginRoute(url: string) {
    if (this.inactive || this.appNavigating ||
        !['login', 'forbidden', 'error'].includes(this.data.viewState)) return;
    this.appNavigating = true;
    const sequence = ++this.appSequence;
    const fail = () => {
      if (this.inactive || sequence !== this.appSequence) return;
      this.appNavigating = false;
      this.setData({ errorMessage: '页面打开失败，请重试' });
    };
    try { wx.navigateTo({ url, fail }); } catch { fail(); }
  },
  onUnload() {
    this.onHide();
    stopCodeCountdown();
  },
});
