import { sessionService } from '../../../services/session.service';
import {
  createFinanceService,
  financeToday,
} from '../../../services/finance.service';
import { createRefundApi } from '../../../services/finance-refunds.service';
import { createFinanceReportsService } from '../../../services/finance-reports.service';

const FINANCE_HOME_ACTIONS = [
  {
    key: 'receipts',
    label: '收款',
    icon: '/pages/finance/assets/icon-corrections.png',
  },
  {
    key: 'hours',
    label: '课时',
    icon: '/pages/finance/assets/icon-reports.png',
  },
  {
    key: 'refunds',
    label: '退课',
    icon: '/pages/finance/assets/icon-refunds.png',
  },
  {
    key: 'packages',
    label: '课包',
    icon: '/pages/finance/assets/icon-receipts.png',
  },
] as const;

interface HomeMetric {
  key: string;
  label: string;
  value: string;
  unit: string;
  sub: string;
}

const FINANCE_WORK_ITEMS: ReadonlyArray<HomeMetric> = [
  { key: 'receipts', label: '收款记录', value: '0', unit: '笔', sub: '全部记录' },
  { key: 'refunds', label: '退费申请', value: '0', unit: '笔', sub: '全部申请' },
  { key: 'hours', label: '待核对课耗', value: '0', unit: '笔', sub: '本月记录' },
];

const FINANCE_ROUTES: Readonly<Record<string, string>> = {
  packages: '/pages/finance/packages/index',
  receipts: '/pages/finance/receipts/index',
  hours: '/pages/finance/hours/index',
  refunds: '/pages/finance/refunds/index',
  profile: '/pages/finance/profile/index',
  more: '/pages/finance/more/index',
};

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    displayName: '',
    identityLabel: '总部财务',
    actions: FINANCE_HOME_ACTIONS,
    workItems: FINANCE_WORK_ITEMS,
  },

  onLoad() {
    void this.initialize();
  },

  onPullDownRefresh() {
    void this.initialize().finally(() => wx.stopPullDownRefresh());
  },

  async initialize() {
    this.setData({
      viewState: 'loading',
      errorMessage: '',
      workItems: FINANCE_WORK_ITEMS,
    });
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
          errorMessage: '当前账号无财务端访问权限',
          displayName: '',
        });
        return;
      }
      const to = financeToday();
      const from = `${to.slice(0, 7)}-01`;
      const [receipts, refunds, lessonConsumption] = await Promise.all([
        createFinanceService().list({ page: 1, pageSize: 1 }),
        createRefundApi('FINANCE').list({ page: 1, pageSize: 1 }),
        createFinanceReportsService().lessonConsumption({
          from,
          to,
          page: 1,
          pageSize: 1,
        }),
      ]);
      this.setData({
        viewState: 'ready',
        errorMessage: '',
        displayName: session.displayName.trim() || '财务账号',
        identityLabel: '总部财务',
        workItems: [
          { ...FINANCE_WORK_ITEMS[0], value: String(receipts.total) },
          { ...FINANCE_WORK_ITEMS[1], value: String(refunds.total) },
          {
            ...FINANCE_WORK_ITEMS[2],
            value: String(lessonConsumption.summary.pendingCheckCount),
          },
        ],
      });
    } catch (error) {
      this.setData({
        viewState: 'error',
        errorMessage:
          error instanceof Error ? error.message : '财务账号加载失败',
      });
    }
  },

  onRetry() {
    void this.initialize();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key ?? '');
    const url = FINANCE_ROUTES[key];
    if (!url) {
      wx.showToast({ title: '入口暂不可用', icon: 'none' });
      return;
    }
    wx.navigateTo({
      url,
      fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }),
    });
  },

  onLogoutTap() {
    sessionService.logout();
    wx.reLaunch({ url: sessionService.logoutDestination });
  },
});
