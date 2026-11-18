import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import { resolveRoleBootstrap } from '../../../services/session.service';
import { getWechatFormalLoginRuntime } from '../runtime/wechat-formal-login-runtime';

Page({
  inactive: false,
  disposed: false,
  sequence: 0,
  navigating: false,
  runtime: undefined as ReturnType<typeof getWechatFormalLoginRuntime> | undefined,
  pendingLogin: undefined as Promise<void> | undefined,
  data: { viewState: 'login', errorMessage: '', wechatLoggingIn: false, headerTopPx: 32, headerRightPx: 100 },
  onLoad() {
    void loadPartnerPdfDisplayFont();
    try {
      const info = wx.getWindowInfo();
      const capsule = wx.getMenuButtonBoundingClientRect();
      this.setData({
        headerTopPx: capsule.height > 0 ? capsule.top : (info.statusBarHeight ?? 24) + 8,
        headerRightPx: capsule.height > 0 ? info.windowWidth - capsule.left + 8 : 100,
      });
    } catch { /* Keep fallback metrics when native measurement is unavailable. */ }
  },
  active(sequence: number) { return !this.inactive && !this.disposed && sequence === this.sequence; },
  route(session: Parameters<typeof resolveRoleBootstrap>[0]) {
    const result = resolveRoleBootstrap(session);
    if (result.kind !== 'navigate') {
      this.setData({ viewState: 'login', errorMessage: result.kind === 'forbidden' ? '当前账号没有可用权限' : '' });
      return;
    }
    this.navigating = true;
    const sequence = this.sequence;
    const fail = () => {
      if (!this.active(sequence)) return;
      this.navigating = false;
      this.setData({ viewState: 'login', errorMessage: '页面打开失败，请重试' });
    };
    try { wx.reLaunch({ url: result.url, fail }); } catch { fail(); }
  },
  onWechatLoginTap(): Promise<void> {
    if (!this.active(this.sequence) || this.navigating) return Promise.resolve();
    if (this.pendingLogin) return this.pendingLogin;
    if (this.data.viewState !== 'login') return Promise.resolve();
    const sequence = ++this.sequence;
    this.setData({ viewState: 'submitting', wechatLoggingIn: true, errorMessage: '' });
    const pending = Promise.resolve().then(() => {
      if (!this.active(sequence)) return;
      this.runtime = getWechatFormalLoginRuntime();
      return this.runtime.loginWithWechat();
    }).then((session) => {
      if (session && this.active(sequence)) this.route(session);
    }).catch((error: unknown) => {
      if (this.active(sequence)) this.setData({
        viewState: 'login', errorMessage: error instanceof Error ? error.message : '微信登录失败，请重试',
      });
    }).finally(() => {
      if (this.pendingLogin === pending) this.pendingLogin = undefined;
      if (this.active(sequence)) this.setData({ wechatLoggingIn: false });
    });
    this.pendingLogin = pending;
    return pending;
  },
  onShow() {
    if (this.disposed) return;
    this.inactive = false;
    this.navigating = false;
    const sequence = ++this.sequence;
    if (!this.data.wechatLoggingIn && this.data.viewState !== 'loading') return;
    const restore = async () => {
      if (!this.active(sequence)) return;
      this.setData({ wechatLoggingIn: false, viewState: 'loading' });
      try {
        const runtime = this.runtime?.isCurrent?.() ? this.runtime : getWechatFormalLoginRuntime();
        this.runtime = runtime;
        const session = await runtime.load();
        if (this.active(sequence)) this.route(session);
      } catch {
        if (this.active(sequence)) this.setData({ viewState: 'login', errorMessage: '读取登录状态失败，请重试' });
      }
    };
    if (this.pendingLogin) void this.pendingLogin.then(restore);
    else void restore();
  },
  onHide() { this.inactive = true; this.sequence += 1; },
  onUnload() { this.disposed = true; this.onHide(); },
  onBack() {
    if (!this.active(this.sequence) || this.pendingLogin || this.navigating) return;
    this.navigating = true;
    const sequence = ++this.sequence;
    const fail = () => {
      if (!this.active(sequence)) return;
      this.navigating = false;
      this.setData({ viewState: 'login', wechatLoggingIn: false, errorMessage: '返回失败，请重试' });
    };
    const fallback = () => {
      if (!this.active(sequence)) return;
      try { wx.reLaunch({ url: '/pages/bootstrap/index', fail }); } catch { fail(); }
    };
    if (getCurrentPages().length > 1) {
      try { wx.navigateBack({ delta: 1, fail: fallback }); } catch { fallback(); }
    } else fallback();
  },
});
