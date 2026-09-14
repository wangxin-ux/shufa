import {
  resolveRoleBootstrap,
  RoleBootstrapResult,
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

  async loadSession() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    try {
      this.applyBootstrapResult(resolveRoleBootstrap(await sessionService.load()));
    } catch (error) {
      this.setData({
        viewState: 'error',
        errorMessage:
          error instanceof Error ? error.message : '会话加载失败，请重试',
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

  onPhoneInput(event: WechatMiniprogram.Input) {
    const phone = String(event.detail.value ?? '')
      .replace(/\D/g, '')
      .slice(0, 11);
    this.setData({
      phone,
      canRequestCode: isValidPhone(phone),
      canSubmit:
        isValidPhone(phone) &&
        /^\d{6}$/.test(String(this.data.verificationCode ?? '')),
      errorMessage: '',
    });
  },

  onVerificationCodeInput(event: WechatMiniprogram.Input) {
    const verificationCode = String(event.detail.value ?? '')
      .replace(/\D/g, '')
      .slice(0, 6);
    this.setData({
      verificationCode,
      canSubmit:
        isValidPhone(String(this.data.phone ?? '')) &&
        /^\d{6}$/.test(verificationCode),
      errorMessage: '',
    });
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
    this.setData({ viewState: 'submitting', errorMessage: '' });
    try {
      this.applyBootstrapResult(
        resolveRoleBootstrap(
          await sessionService.loginWithTestPhoneCode(phone, verificationCode),
        ),
      );
    } catch (error) {
      this.setData({
        viewState: 'login',
        errorMessage:
          error instanceof Error
            ? error.message
            : '手机号验证码登录失败，请重试',
      });
    }
  },

  async onWechatPhoneTap(event: {
    detail: { code?: string; errMsg?: string };
  }) {
    const phoneCode = event.detail.code?.trim() ?? '';
    if (!phoneCode) {
      this.setData({
        viewState: 'login',
        errorMessage: '你已取消手机号授权，请授权后再登录',
      });
      return;
    }
    this.setData({ viewState: 'submitting', errorMessage: '' });
    try {
      this.applyBootstrapResult(
        resolveRoleBootstrap(
          await sessionService.bindWechatStaffPhone(phoneCode),
        ),
      );
    } catch (error) {
      this.setData({
        viewState: 'login',
        errorMessage:
          error instanceof Error ? error.message : '微信手机号登录失败，请重试',
      });
    }
  },

  onRetry() {
    void this.loadSession();
  },

  onUnload() {
    stopCodeCountdown();
  },
});
