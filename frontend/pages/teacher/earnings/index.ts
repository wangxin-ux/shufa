import {
  buildTeacherEarningEntryModel,
  buildTeacherEarningRuleModel,
  buildTeacherEarningSummaryModel,
  buildTeacherEarningStatusModel,
  buildTeacherWithdrawalModel,
  parseTeacherWithdrawalYuan,
  TeacherEarningEntryModel,
  TeacherEarningRuleModel,
  TeacherEarningSummaryItemModel,
  TeacherEarningStatusItemModel,
  TeacherWithdrawalModel,
} from '../../../services/teacher-earnings.presenter';
import { teacherService } from '../../../services/teacher-runtime';

const PAGE_SIZE = 10;
let requestSequence = 0;
let commandSequence = 0;
let pendingCreateKey = '';
const pendingCancelKeys = new Map<string, string>();

function createCommandKey(operation: string): string {
  commandSequence += 1;
  return `teacher-${operation}-${Date.now()}-${commandSequence}`;
}

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    listError: '',
    summaryItems: [] as TeacherEarningSummaryItemModel[],
    statusItems: [] as TeacherEarningStatusItemModel[],
    rule: buildTeacherEarningRuleModel(null) as TeacherEarningRuleModel,
    canWithdraw: false,
    selectedTab: 'earnings' as 'earnings' | 'withdrawals',
    earnings: [] as TeacherEarningEntryModel[],
    earningsPage: 0,
    earningsHasMore: false,
    withdrawals: [] as TeacherWithdrawalModel[],
    withdrawalsPage: 0,
    withdrawalsHasMore: false,
    loadingMore: false,
    showWithdrawalModal: false,
    amountYuan: '',
    amountError: '',
    submitting: false,
  },

  onLoad() {
    void this.loadOverview();
  },

  onPullDownRefresh() {
    void this.refreshCurrentView().finally(() => wx.stopPullDownRefresh());
  },

  async refreshCurrentView() {
    await this.loadOverview();
    if (this.data.selectedTab === 'withdrawals') {
      await this.loadWithdrawals(true);
    }
  },

  async loadOverview() {
    const sequence = ++requestSequence;
    this.setData({
      viewState: 'loading',
      errorMessage: '',
      listError: '',
      loadingMore: false,
    });
    const [summaryState, ruleState, earningsState] = await Promise.all([
      teacherService.loadEarningSummary(),
      teacherService.loadCurrentEarningRule(),
      teacherService.loadEarnings({ page: 1, pageSize: PAGE_SIZE }),
    ]);
    if (sequence !== requestSequence) {
      return;
    }

    if (
      !('data' in summaryState) ||
      !('data' in ruleState) ||
      !('data' in earningsState)
    ) {
      const failure = [summaryState, ruleState, earningsState].find(
        (state) => state.status === 'error',
      );
      this.setData({
        viewState:
          failure?.status === 'error' && failure.statusCode === 403
            ? 'forbidden'
            : 'error',
        errorMessage:
          failure?.status === 'error'
            ? failure.statusCode === 403
              ? '当前账号无权查看教师收益'
              : failure.message
            : '收益数据暂不可用',
      });
      return;
    }

    const earnings = earningsState.data.data.map(buildTeacherEarningEntryModel);
    this.setData({
      summaryItems: buildTeacherEarningSummaryModel(summaryState.data),
      statusItems: buildTeacherEarningStatusModel(summaryState.data),
      rule: buildTeacherEarningRuleModel(ruleState.data),
      canWithdraw: summaryState.data.availableFen > 0,
      earnings,
      earningsPage: earningsState.data.meta.page,
      earningsHasMore:
        earningsState.data.meta.page < earningsState.data.meta.totalPages,
      viewState: 'ready',
      errorMessage: '',
    });
  },

  async loadEarnings(reset: boolean) {
    if (!reset && (!this.data.earningsHasMore || this.data.loadingMore)) {
      return;
    }
    const page = reset ? 1 : this.data.earningsPage + 1;
    this.setData({ loadingMore: true, listError: '' });
    const state = await teacherService.loadEarnings({ page, pageSize: PAGE_SIZE });
    if ('data' in state) {
      const incoming = state.data.data.map(buildTeacherEarningEntryModel);
      this.setData({
        earnings: reset ? incoming : [...this.data.earnings, ...incoming],
        earningsPage: state.data.meta.page,
        earningsHasMore: state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
      });
      return;
    }
    this.setData({
      loadingMore: false,
      listError: state.status === 'error' ? state.message : '收益明细加载失败',
    });
  },

  async loadWithdrawals(reset: boolean) {
    if (!reset && (!this.data.withdrawalsHasMore || this.data.loadingMore)) {
      return;
    }
    const page = reset ? 1 : this.data.withdrawalsPage + 1;
    this.setData({ loadingMore: true, listError: '' });
    const state = await teacherService.loadWithdrawals({
      page,
      pageSize: PAGE_SIZE,
    });
    if ('data' in state) {
      const incoming = state.data.data.map(buildTeacherWithdrawalModel);
      this.setData({
        withdrawals: reset
          ? incoming
          : [...this.data.withdrawals, ...incoming],
        withdrawalsPage: state.data.meta.page,
        withdrawalsHasMore:
          state.data.meta.page < state.data.meta.totalPages,
        loadingMore: false,
      });
      return;
    }
    this.setData({
      loadingMore: false,
      listError: state.status === 'error' ? state.message : '提现记录加载失败',
    });
  },

  onRetry() {
    void this.refreshCurrentView();
  },

  onTabTap(event: WechatMiniprogram.TouchEvent) {
    const selectedTab = String(event.currentTarget.dataset.tab ?? 'earnings');
    if (
      (selectedTab !== 'earnings' && selectedTab !== 'withdrawals') ||
      selectedTab === this.data.selectedTab
    ) {
      return;
    }
    this.setData({ selectedTab, listError: '' });
    if (selectedTab === 'withdrawals' && this.data.withdrawalsPage === 0) {
      void this.loadWithdrawals(true);
    }
  },

  onLoadMore() {
    if (this.data.selectedTab === 'earnings') {
      void this.loadEarnings(false);
      return;
    }
    void this.loadWithdrawals(false);
  },

  noop() {},

  onOpenWithdrawal() {
    if (this.data.submitting || !this.data.canWithdraw) {
      return;
    }
    pendingCreateKey = '';
    this.setData({
      showWithdrawalModal: true,
      amountYuan: '',
      amountError: '',
    });
  },

  onCloseWithdrawal() {
    if (this.data.submitting) {
      return;
    }
    this.setData({ showWithdrawalModal: false, amountError: '' });
  },

  onAmountInput(event: WechatMiniprogram.Input) {
    pendingCreateKey = '';
    this.setData({ amountYuan: event.detail.value, amountError: '' });
  },

  async onSubmitWithdrawal() {
    if (this.data.submitting) {
      return;
    }
    const parsed = parseTeacherWithdrawalYuan(this.data.amountYuan);
    if (!parsed.ok) {
      this.setData({ amountError: parsed.message });
      return;
    }

    pendingCreateKey =
      pendingCreateKey || createCommandKey('withdrawal-create');
    this.setData({ submitting: true, amountError: '' });
    const state = await teacherService.createWithdrawal(
      parsed.amountFen,
      pendingCreateKey,
    );
    if (state.status === 'error') {
      this.setData({ submitting: false, amountError: state.message });
      return;
    }
    pendingCreateKey = '';
    this.setData({
      submitting: false,
      showWithdrawalModal: false,
      amountYuan: '',
      selectedTab: 'withdrawals',
    });
    await this.refreshCurrentView();
  },

  onCancelWithdrawal(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) {
      return;
    }
    const id = String(event.currentTarget.dataset.id ?? '');
    const version = Number(event.currentTarget.dataset.version);
    if (!id || !Number.isSafeInteger(version)) {
      return;
    }
    wx.showModal({
      title: '取消提现申请',
      content: '仅待审核的申请可以取消，确认继续吗？',
      confirmText: '确认取消',
      cancelText: '暂不取消',
      success: ({ confirm }) => {
        if (confirm) {
          void this.executeCancelWithdrawal(id, version);
        }
      },
    });
  },

  async executeCancelWithdrawal(id: string, version: number) {
    if (this.data.submitting) {
      return;
    }
    const key =
      pendingCancelKeys.get(id) ?? createCommandKey('withdrawal-cancel');
    pendingCancelKeys.set(id, key);
    this.setData({ submitting: true, listError: '' });
    const state = await teacherService.cancelWithdrawal(id, version, key);
    if (state.status === 'error') {
      this.setData({ submitting: false, listError: state.message });
      return;
    }
    pendingCancelKeys.delete(id);
    this.setData({ submitting: false });
    await this.refreshCurrentView();
  },
});
