import { sessionService } from '../../../services/session.service';

const PROFILE_ACTIONS = [
  { key: 'overview', label: '财务业务总览', command: '全部' },
  { key: 'receipts', label: '收款总览', command: '查看' },
  { key: 'refunds', label: '退课明细', command: '查看' },
] as const;

const PROFILE_ROUTES: Readonly<Record<string, string>> = {
  overview: '/pages/finance/more/index',
  receipts: '/pages/finance/receipts/index',
  refunds: '/pages/finance/refunds/index',
};

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    displayName: '',
    roleCode: 'FINANCE',
    roleLabel: '总部财务',
    accountLabel: '总部账号 · 无校区绑定',
    actions: PROFILE_ACTIONS,
  },

  onLoad() {
    void this.loadProfile();
  },

  onPullDownRefresh() {
    void this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  async loadProfile() {
    this.setData({ viewState: 'loading', errorMessage: '', displayName: '' });
    try {
      const session = await sessionService.load();
      const role = session?.roles[0];
      if (
        !session ||
        session.roles.length !== 1 ||
        role?.code !== 'FINANCE' ||
        role.campusId !== null
      ) {
        this.setData({
          viewState: 'forbidden',
          errorMessage: '当前账号无总部财务端访问权限',
        });
        return;
      }
      this.setData({
        viewState: 'ready',
        errorMessage: '',
        displayName: session.displayName.trim() || '总部财务账号',
      });
    } catch (error) {
      this.setData({
        viewState: 'error',
        errorMessage: error instanceof Error ? error.message : '财务资料加载失败',
      });
    }
  },

  onRetry() {
    void this.loadProfile();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? '');
    const url = PROFILE_ROUTES[key];
    if (url) wx.navigateTo({ url });
  },
});
