import { loadTeacherDisplayFont } from '../runtime/teacher-display-font';

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
const PAGE_SIZE = 10;

import { createSessionService } from '../../../services/session.service';
import { Page as DataPage, TeacherEarningEntry, TeacherEarningRuleView, TeacherEarningSummary, TeacherWithdrawal } from '../../../types/teacher';
import {
  createTeacherPageService, isCurrentTeacherReadContext, readTeacherReadContext, TeacherReadContext,
} from '../runtime/teacher-read-context';
import type { TeacherRankingMetric } from '../../../types/teacher-rankings';
import { teacherRankingMetricLabel, teacherRankingMonthLabel, teacherRankingOwn, teacherRankingRow } from '../../../services/teacher-rankings.presenter';
import {
  createTeacherWithdrawalKey, denyTeacherWithdrawalSession, getTeacherWithdrawalRecovery, loadTeacherWithdrawalRecovery,
  persistTeacherWithdrawalRecovery, teacherWithdrawalSessionKey, withTeacherWithdrawalDeadline,
  TeacherWithdrawalCommand, TeacherWithdrawalRecovery,
} from '../runtime/teacher-withdrawal-recovery';

type Section = 'summary' | 'rule' | 'earnings' | 'withdrawals';
const initialData = () => ({
  viewState: 'loading', errorMessage: '', listError: '',
  summaryError: '', ruleError: '', earningsError: '', withdrawalsError: '',
  summaryLoaded: false, ruleLoaded: false, earningsLoaded: false, withdrawalsLoaded: false,
  summaryLoading: false, ruleLoading: false, earningsLoading: false, withdrawalsLoading: false,
  summaryItems: [] as TeacherEarningSummaryItemModel[], statusItems: [] as TeacherEarningStatusItemModel[],
  summaryHeadline: null as TeacherEarningSummaryItemModel | null,
  rule: buildTeacherEarningRuleModel(null) as TeacherEarningRuleModel, canWithdraw: false,
  selectedTab: 'earnings' as 'earnings' | 'withdrawals',
  earnings: [] as TeacherEarningEntryModel[], earningsPage: 0, earningsHasMore: false,
  withdrawals: [] as TeacherWithdrawalModel[], withdrawalsPage: 0, withdrawalsHasMore: false,
  loadingMore: false, showWithdrawalModal: false, amountYuan: '', amountError: '',
  showFilterSheet: false, showAccountDetails: false, rankingExpanded: false,
  submitting: false, recoveryMessage: '', withdrawalReady: false, recoveryPending: false,
  rankingOpen: false, rankingState: 'idle', rankingError: '', rankingLoading: false,
  rankingMetric: 'EARNINGS' as TeacherRankingMetric, rankingMonth: '', rankingRevision: '',
  rankingRows: [] as ReturnType<typeof teacherRankingRow>[], rankingOwnLabel: '',
  rankingMetricLabel: '课时费', rankingPeriodLabel: '',
  rankingPage: 0, rankingHasMore: false, rankingTimezone: '',
});
const mergeRows = <T extends { id: string }>(current: T[], incoming: T[], reset: boolean): T[] => {
  const rows = new Map((reset ? [] : current).map((row) => [row.id, row]));
  incoming.forEach((row) => rows.set(row.id, row));
  return [...rows.values()];
};

Page({
  context: undefined as TeacherReadContext | undefined,

  runtime: undefined as ReturnType<typeof createTeacherPageService> | undefined,

  reads: undefined as Map<Section, { sequence: number; reset: boolean; pending: Promise<boolean> }> | undefined,

  readSequence: 0,

  lifecycleSequence: 0,

  pullSequence: 0,

  pullPending: false,

  hidden: false,

  disposed: false,

  blocked: false,

  initialShowPending: false,

  rankingSequence: 0,

  recovery: undefined as TeacherWithdrawalRecovery | undefined,
  withdrawalsFresh: false,
  ownerSequence: 0,
  confirmationSequence: 0,
  observedRecovery: undefined as Promise<void> | undefined,
  completedCreateKey: undefined as string | undefined,
  stopObservingAccess: undefined as (() => void) | undefined,

  data: initialData(),

  nativeReady: false,
  onReady() { this.nativeReady = true; void this.ensureRankingPreview(); },

  onLoad() {
    void loadTeacherDisplayFont();
    this.context = readTeacherReadContext();
    this.reads = new Map();
    this.initialShowPending = true;
    if (!this.validateOwner()) return;
    try {
      this.runtime = createTeacherPageService(this.context);
      this.recovery = getTeacherWithdrawalRecovery(this.context);
      this.completedCreateKey = this.recovery.completedCreateKey;
      this.observeWithdrawalAccess();
    }
    catch {
      this.setData({ viewState: 'error', errorMessage: '教师端配置不可用，请重新登录' });
      return;
    }
    void this.refreshCurrentView();
    void this.verifyWithdrawalOwner();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.recovery?.deniedSessions?.has(teacherWithdrawalSessionKey(this.context!))) {
      this.invalidateOwner('登录已失效或无权操作提现，请重新登录'); return;
    }
    if (this.initialShowPending) { this.initialShowPending = false; return; }
    this.setData({ withdrawalReady: false, amountYuan: '', showWithdrawalModal: false,
      submitting: !!this.recovery?.inflight });
    void this.verifyWithdrawalOwner();
    void this.refreshCurrentView();
  },

  onHide() {
    this.hidden = true;
    this.initialShowPending = false;
    this.lifecycleSequence += 1;
    this.pullSequence += 1;
    this.pullPending = false;
    this.reads?.clear();
    this.rankingSequence += 1;
    this.ownerSequence += 1;
    this.confirmationSequence += 1;
    this.withdrawalsFresh = false;
    this.setData({ rankingLoading: false, showAccountDetails: false, showFilterSheet: false });
  },

  onUnload() {
    this.disposed = true; this.onHide();
    this.stopObservingAccess?.();
    this.setData({ ...initialData() });
  },

  invalidateOwner(message: string) {
    this.blocked = true;
    this.lifecycleSequence += 1;
    this.reads?.clear();
    this.ownerSequence += 1;
    this.confirmationSequence += 1;
    this.withdrawalsFresh = false;
    if (this.pullPending) {
      this.pullPending = false;
      this.pullSequence += 1;
      wx.stopPullDownRefresh();
    }
    this.setData({ ...initialData(), viewState: 'forbidden', errorMessage: message });
  },

  validateOwner(): boolean {
    if (this.blocked || !this.context) return false;
    const access = this.recovery?.accessTarget ?? this.recovery;
    if (access?.deniedSessions?.has(teacherWithdrawalSessionKey(this.context))) {
      this.invalidateOwner('登录已失效或无权操作提现，请重新登录'); return false;
    }
    if (isCurrentTeacherReadContext(this.context)) return true;
    this.invalidateOwner('登录已更新，请重新登录');
    return false;
  },

  handleReadAccessDenied(code: number | undefined, message: string, source: TeacherWithdrawalRecovery | undefined): boolean {
    if (code !== 401 && code !== 403) return false;
    source = source?.accessTarget ?? source;
    if (source && this.context) denyTeacherWithdrawalSession(source, this.context);
    if (source !== (this.recovery?.accessTarget ?? this.recovery)) return true;
    if (!this.disposed && this.validateOwner()) {
      if (!this.blocked) this.invalidateOwner(message);
    }
    return true;
  },

  canReceive(sequence: number): boolean {
    return !this.hidden && !this.disposed && sequence === this.lifecycleSequence && this.validateOwner();
  },

  canAct(): boolean {
    return !this.hidden && !this.disposed && this.validateOwner() && !!this.runtime;
  },

  observeWithdrawalAccess() {
    this.stopObservingAccess?.();
    const recovery = this.recovery, context = this.context;
    if (!recovery || !context) return;
    const listener = () => {
      const access = recovery.accessTarget ?? recovery;
      if (!this.disposed && !this.blocked && this.recovery === recovery &&
        isCurrentTeacherReadContext(context) &&
        access.deniedSessions?.has(teacherWithdrawalSessionKey(context))) {
        this.invalidateOwner('登录已失效或无权操作提现，请重新登录');
      }
    };
    (recovery.denialListeners ??= new Set()).add(listener);
    this.stopObservingAccess = () => {
      recovery.denialListeners?.delete(listener);
      recovery.accessTarget?.denialListeners?.delete(listener);
    };
  },

  restoreRecovery() {
    if (!this.data.withdrawalReady || !this.recovery) return;
    const command = this.recovery.command;
    const completed = this.recovery.completedCreateKey;
    const createFinished = !!completed && completed !== this.completedCreateKey;
    this.completedCreateKey = completed;
    this.setData({
      submitting: !!this.recovery.inflight,
      recoveryPending: !!command,
      recoveryMessage: command ? '上次操作结果待核对，请先核对原申请' : '',
      ...(createFinished ? { showWithdrawalModal: false, amountYuan: '', amountError: '', selectedTab: 'withdrawals' }
        : command?.kind === 'create' ? { amountYuan: command.amountYuan } : {}),
    });
  },

  watchRecovery() {
    const pending = this.recovery?.inflight;
    if (!pending || pending === this.observedRecovery) return;
    this.observedRecovery = pending;
    const lifecycle = this.lifecycleSequence;
    this.setData({ submitting: true });
    void pending.then(() => {
      if (!this.canReceive(lifecycle)) return;
      if (this.recovery?.deniedSessions?.has(teacherWithdrawalSessionKey(this.context!))) {
        this.invalidateOwner('登录已失效或无权操作提现，请重新登录'); return;
      }
      this.restoreRecovery();
      void this.refreshCurrentView();
    });
  },

  async verifyWithdrawalOwner() {
    if (!this.canAct()) return;
    const sequence = ++this.ownerSequence, lifecycle = this.lifecycleSequence;
    const source = this.recovery;
    this.setData({ withdrawalReady: false });
    try {
      const recovery = await loadTeacherWithdrawalRecovery(this.context!, code => {
        this.handleReadAccessDenied(code, '登录已失效或无权操作提现，请重新登录', source);
      });
      if (!this.canReceive(lifecycle) || sequence !== this.ownerSequence) return;
      const attached = this.recovery !== recovery;
      if (attached) {
        const changedOwner = !!source?.owner && !!recovery.owner &&
          (source.owner.userId !== recovery.owner.userId || source.owner.campusId !== recovery.owner.campusId ||
            source.owner.apiBaseUrl !== recovery.owner.apiBaseUrl);
        const interrupted = [...(this.reads?.keys() ?? [])];
        this.lifecycleSequence += 1;
        this.rankingSequence += 1;
        this.reads?.clear();
        this.withdrawalsFresh = false;
        if (changedOwner) {
          this.completedCreateKey = undefined;
          this.setData({ ...initialData(), selectedTab: this.data.selectedTab, rankingOpen: this.data.rankingOpen,
            rankingMetric: this.data.rankingMetric, rankingMonth: this.data.rankingMonth });
        }
        this.setData({ showWithdrawalModal: false, amountYuan: '', amountError: '', canWithdraw: false, rankingLoading: false,
          ...Object.fromEntries(interrupted.map(section => [`${section}Loading`, false])) });
      }
      this.recovery = recovery;
      this.observeWithdrawalAccess();
      this.setData({ withdrawalReady: true, recoveryMessage: '' });
      this.restoreRecovery(); this.watchRecovery();
      if (attached && !recovery.inflight) void this.refreshCurrentView();
    } catch (error) {
      const code = (error as { statusCode?: number })?.statusCode;
      if ((code === 401 || code === 403) && this.handleReadAccessDenied(code,
        '登录已失效或无权操作提现，请重新登录', source)) return;
      if (this.canReceive(lifecycle) && sequence === this.ownerSequence) {
        this.setData({ withdrawalReady: false, recoveryMessage: '提现操作记录暂时无法核对，请重试核对' });
      }
    }
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed) return;
    if (!this.validateOwner()) { wx.stopPullDownRefresh(); return; }
    const pull = ++this.pullSequence;
    this.pullPending = true;
    void this.refreshCurrentView().finally(() => {
      if (!this.hidden && !this.disposed && pull === this.pullSequence) {
        this.pullPending = false;
        wx.stopPullDownRefresh();
      }
    });
  },

  async refreshCurrentView() {
    await Promise.all([this.readSection('summary'), this.readSection('rule'), this.readSection(this.data.selectedTab),
      ...(this.data.rankingOpen ? [this.loadRankings()] : [])]);
    await this.ensureRankingPreview();
  },

  ensureRankingPreview() {
    if (!this.nativeReady || this.data.rankingOpen || !this.canAct()) return Promise.resolve();
    this.setData({ rankingOpen: true });
    return this.loadRankings();
  },

  onOpenRankings() {
    if (!this.canAct()) return Promise.resolve();
    if (this.data.rankingOpen) {
      this.rankingSequence += 1;
      this.setData({ rankingOpen: false, rankingLoading: false });
      return Promise.resolve();
    }
    this.setData({ rankingOpen: true });
    return this.loadRankings();
  },

  onRankingRefresh() { return this.loadRankings(); },

  onRankingMore() {
    if (!this.data.rankingHasMore || this.data.rankingState === 'conflict') return Promise.resolve();
    return this.loadRankings(false);
  },

  onRankingMetric(event: WechatMiniprogram.TouchEvent) {
    const metric = String(event.currentTarget.dataset.metric);
    if (!this.canAct() || !['EARNINGS', 'ATTENDANCE'].includes(metric) || metric === this.data.rankingMetric) return;
    this.setData({ rankingMetric: metric as TeacherRankingMetric, rankingRows: [], rankingOwnLabel: '',
      rankingMetricLabel: teacherRankingMetricLabel(metric as TeacherRankingMetric),
      rankingRevision: '', rankingHasMore: false });
    return this.loadRankings();
  },

  // PSD a3 卡内只有一行「按课时费排名」，点它切换口径；未展开时先展开月榜。
  onToggleRankingMetric() {
    if (!this.canAct() || this.data.rankingLoading) return Promise.resolve();
    if (!this.data.rankingOpen) return this.onOpenRankings();
    const metric: TeacherRankingMetric = this.data.rankingMetric === 'EARNINGS' ? 'ATTENDANCE' : 'EARNINGS';
    this.setData({ rankingMetric: metric, rankingRows: [], rankingOwnLabel: '',
      rankingMetricLabel: teacherRankingMetricLabel(metric), rankingRevision: '', rankingHasMore: false });
    return this.loadRankings();
  },

  // 卡底「查看更多」：未展开时拉取月榜，已展开时翻页。
  onRankingMoreTap() {
    if (!this.canAct()) return Promise.resolve();
    return this.data.rankingOpen ? this.onRankingMore() : this.onOpenRankings();
  },

  onRankingMonth(event: WechatMiniprogram.PickerChange) {
    const month = String(event.detail.value);
    if (!this.canAct() || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || month === this.data.rankingMonth) return;
    this.setData({ rankingMonth: month, rankingRows: [], rankingOwnLabel: '', rankingRevision: '', rankingHasMore: false });
    return this.loadRankings();
  },

  async loadRankings(reset = true) {
    if (!this.canAct() || !this.data.rankingOpen || (!reset && this.data.rankingLoading)) return;
    const sequence = ++this.rankingSequence, lifecycle = this.lifecycleSequence;
    const source = this.recovery;
    const page = reset ? 1 : this.data.rankingPage + 1;
    const metric = this.data.rankingMetric, month = this.data.rankingMonth;
    const revision = this.data.rankingRevision;
    this.setData({ rankingLoading: true, rankingError: '',
      ...(reset ? { rankingState: 'loading' } : {}) });
    const accepts = () => this.canReceive(lifecycle) && sequence === this.rankingSequence && this.data.rankingOpen;
    try {
      const result = await this.runtime!.loadRankings({ metric, month: month || undefined, page, pageSize: PAGE_SIZE,
        ...(!reset ? { revision } : {}) });
      if (result.status === 'error' && this.handleReadAccessDenied(result.statusCode,
        '登录已失效或无权查看本校区月榜，请重新登录', source)) return;
      if (!accepts()) return;
      if (result.status === 'error') {
        this.setData({ rankingState: result.statusCode === 409 ? 'conflict' : 'error',
          ...(result.statusCode === 409 ? { rankingHasMore: false, rankingRevision: '' } : {}),
          rankingError: result.statusCode === 409 ? '榜单已更新或来源待核对，请刷新后继续' : '月榜加载失败，请重试' });
        return;
      }
      if (!('data' in result)) return;
      const board = result.data;
      if (board.metric !== metric || (month && board.month !== month) ||
          (!reset && board.revision !== revision)) {
        this.setData({ rankingState: 'conflict', rankingHasMore: false, rankingRevision: '',
          rankingError: '榜单已更新，请刷新后继续' });
        return;
      }
      const rows = new Map((reset ? [] : this.data.rankingRows).map(row => [row.position, row]));
      board.rows.map(teacherRankingRow).forEach(row => rows.set(row.position, row));
      this.setData({ rankingState: board.meta.total === 0 ? 'empty' : 'ready',
        rankingRows: [...rows.values()], rankingOwnLabel: teacherRankingOwn(board),
        rankingMetricLabel: teacherRankingMetricLabel(board.metric),
        rankingPeriodLabel: teacherRankingMonthLabel(board.month),
        rankingMonth: board.month, rankingTimezone: board.timezone, rankingRevision: board.revision,
        rankingPage: board.meta.page, rankingHasMore: board.meta.page < board.meta.totalPages });
    } catch {
      if (accepts()) this.setData({ rankingState: 'error', rankingError: '月榜加载失败，请重试' });
    } finally {
      if (accepts()) this.setData({ rankingLoading: false });
    }
  },

  loadOverview() { return this.refreshCurrentView(); },

  loadEarnings(reset: boolean) { return this.readSection('earnings', reset); },

  loadWithdrawals(reset: boolean) { return this.readSection('withdrawals', reset); },

  readSection(section: Section, reset = true): Promise<boolean> {
    if (!this.canAct() || !this.reads || this.recovery?.writing) return Promise.resolve(false);
    const current = this.reads.get(section);
    if (current && !reset) return current.pending;
    if (!reset && ((section !== 'earnings' && section !== 'withdrawals') ||
        !this.data[`${section}HasMore`])) return Promise.resolve(false);
    const sequence = ++this.readSequence, lifecycle = this.lifecycleSequence, source = this.recovery;
    const page = !reset && (section === 'earnings' || section === 'withdrawals')
      ? this.data[`${section}Page`] + 1 : 1;
    const active = section === this.data.selectedTab;
    if (section === 'withdrawals') this.withdrawalsFresh = false;
    this.setData({
      [`${section}Loading`]: true, [`${section}Error`]: '',
      ...(section === 'summary' ? { canWithdraw: false } : {}),
      ...(active ? { loadingMore: !reset, listError: '' } : {}),
    });
    const runtime = this.runtime!;
    const load = section === 'summary' ? runtime.loadEarningSummary()
      : section === 'rule' ? runtime.loadCurrentEarningRule()
      : section === 'earnings' ? runtime.loadEarnings({ page, pageSize: PAGE_SIZE })
      : runtime.loadWithdrawals({ page, pageSize: PAGE_SIZE });
    const accepts = () => this.canReceive(lifecycle) && this.reads?.get(section)?.sequence === sequence;
    const fail = () => this.setData({
      viewState: 'ready', [`${section}Error`]: '加载失败，请重试',
      ...(section === this.data.selectedTab ? { listError: '记录加载失败，请重试' } : {}),
    });
    const pending = load.then((state) => {
      if (state.status === 'error' && this.handleReadAccessDenied(state.statusCode,
        '登录已失效或无权查看本人收益，请重新登录', source)) return false;
      if (!accepts()) return false;
      if (state.status === 'error') { fail(); return false; }
      if (!('data' in state)) return false;
      if (section === 'summary') {
        const summary = state.data as TeacherEarningSummary;
        const summaryItems = buildTeacherEarningSummaryModel(summary);
        this.setData({
          summaryItems, statusItems: buildTeacherEarningStatusModel(summary),
          summaryHeadline: summaryItems.find((item) => item.key === 'estimated') ?? summaryItems[summaryItems.length - 1] ?? null,
          canWithdraw: summary.availableFen > 0,
        });
      } else if (section === 'rule') {
        this.setData({ rule: buildTeacherEarningRuleModel(state.data as TeacherEarningRuleView | null) });
      } else {
        const result = state.data as DataPage<TeacherEarningEntry | TeacherWithdrawal>;
        const rows = section === 'earnings'
          ? (result.data as TeacherEarningEntry[]).map(buildTeacherEarningEntryModel)
          : (result.data as TeacherWithdrawal[]).map(buildTeacherWithdrawalModel);
        this.setData({
          [section]: mergeRows<TeacherEarningEntryModel | TeacherWithdrawalModel>(this.data[section], rows, reset),
          [`${section}Page`]: result.meta.page,
          [`${section}HasMore`]: result.meta.page < result.meta.totalPages,
        });
        if (section === 'withdrawals') this.withdrawalsFresh = true;
      }
      this.setData({ viewState: 'ready', [`${section}Loaded`]: true });
      return true;
    }).catch(() => {
      if (accepts()) fail();
      return false;
    }).finally(() => {
      if (accepts()) {
        this.reads?.delete(section);
        this.setData({
          [`${section}Loading`]: false,
          ...(section === this.data.selectedTab ? { loadingMore: false } : {}),
        });
      }
    });
    this.reads.set(section, { sequence, reset, pending });
    return pending;
  },

  onRetry() {
    void this.refreshCurrentView();
  },

  onRetrySection(event: WechatMiniprogram.TouchEvent) {
    const section = String(event.currentTarget.dataset.section);
    if (['summary', 'rule', 'earnings', 'withdrawals'].includes(section)) void this.readSection(section as Section);
  },

  onTabTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.canAct()) return;
    const selectedTab = String(event.currentTarget.dataset.tab ?? 'earnings');
    if (
      (selectedTab !== 'earnings' && selectedTab !== 'withdrawals') ||
      selectedTab === this.data.selectedTab
    ) {
      this.setData({ showFilterSheet: false });
      return;
    }
    this.reads?.delete(this.data.selectedTab);
    this.setData({ selectedTab, listError: '', loadingMore: false, showFilterSheet: false });
    void this.readSection(selectedTab);
  },

  // PSD a3 在「课时流水」标题右侧只有一个「筛选」入口，类型切换收进筛选面板。
  onAccountDetails() {
    if (this.canAct()) this.setData({ showAccountDetails: !this.data.showAccountDetails });
  },
  onExpandRankings() {
    if (this.canAct()) this.setData({ rankingExpanded: true });
  },

  onToggleFilter() {
    if (!this.canAct()) return;
    this.setData({ showFilterSheet: !this.data.showFilterSheet });
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
    if (!this.canAct() || !this.data.withdrawalReady || !this.recovery ||
      this.recovery.inflight || (!this.data.canWithdraw && !this.recovery.command)) return;
    const command = this.recovery.command;
    if (command?.kind === 'cancel') { this.restoreRecovery(); return; }
    this.setData({
      showWithdrawalModal: true,
      amountYuan: command?.amountYuan ?? '',
      amountError: '',
    });
  },

  onCloseWithdrawal() {
    if (!this.canAct() || this.recovery?.inflight) return;
    this.setData({ showWithdrawalModal: false, amountError: '' });
  },

  onAmountInput(event: WechatMiniprogram.Input) {
    if (!this.canAct() || !this.data.withdrawalReady || this.recovery?.inflight ||
      this.recovery?.command || !this.data.showWithdrawalModal) return;
    this.setData({ amountYuan: event.detail.value, amountError: '' });
  },

  async onSubmitWithdrawal() {
    if (!this.canAct() || !this.data.withdrawalReady || !this.recovery ||
      this.recovery.inflight || !this.data.showWithdrawalModal) return;
    const command = this.recovery.command;
    if (command) {
      if (command.kind === 'create') await this.runCommand(command);
      return;
    }
    if (!this.data.canWithdraw) return;
    const parsed = parseTeacherWithdrawalYuan(this.data.amountYuan);
    if (!parsed.ok) {
      this.setData({ amountError: parsed.message });
      return;
    }

    await this.runCommand({
      kind: 'create', key: createTeacherWithdrawalKey(), amountFen: parsed.amountFen,
      amountYuan: this.data.amountYuan, uncertain: false,
    });
  },

  onCancelWithdrawal(event: WechatMiniprogram.TouchEvent) {
    if (!this.canAct() || !this.data.withdrawalReady || !this.recovery ||
      this.recovery.inflight || this.recovery.command) return;
    const id = String(event.currentTarget.dataset.id ?? '');
    const version = Number(event.currentTarget.dataset.version);
    if (!this.withdrawalsFresh || !this.data.withdrawals.some(row =>
      row.id === id && row.version === version && row.canCancel)) return;
    const lifecycle = this.lifecycleSequence, confirmation = ++this.confirmationSequence;
    wx.showModal({
      title: '取消提现申请',
      content: '仅待审核的申请可以取消，确认继续吗？',
      confirmText: '确认取消',
      cancelText: '暂不取消',
      success: ({ confirm }) => {
        if (confirm && confirmation === this.confirmationSequence && this.canReceive(lifecycle)) {
          void this.executeCancelWithdrawal(id, version);
        }
      },
    });
  },

  async executeCancelWithdrawal(id: string, version: number) {
    if (!this.canAct() || !this.data.withdrawalReady || !this.recovery ||
      this.recovery.inflight || this.recovery.command || !this.withdrawalsFresh ||
      !this.data.withdrawals.some(row => row.id === id && row.version === version && row.canCancel)) return;
    await this.runCommand({ kind: 'cancel', id, version, key: createTeacherWithdrawalKey(), uncertain: false });
  },

  onRecoverCommand() {
    if (!this.canAct()) return;
    if (!this.data.withdrawalReady) { void this.verifyWithdrawalOwner(); return; }
    if (!this.recovery?.command || this.recovery.inflight) return;
    if (this.recovery.command.kind === 'create') this.onOpenWithdrawal();
    else void this.runCommand(this.recovery.command);
  },

  runCommand(command: TeacherWithdrawalCommand): Promise<void> {
    if (!this.canAct() || !this.data.withdrawalReady || !this.recovery ||
      this.recovery.inflight || (this.recovery.command && this.recovery.command.key !== command.key)) return Promise.resolve();
    const recovery = this.recovery, runtime = this.runtime!, context = this.context!;
    const lifecycle = this.lifecycleSequence;
    const accepts = () => this.canReceive(lifecycle) && this.recovery === recovery;
    recovery.command = command;
    try { persistTeacherWithdrawalRecovery(recovery); } catch {
      const message = '无法保存操作记录，请稍后重试；本次未提交';
      this.setData({ recoveryPending: true, recoveryMessage: message,
        [command.kind === 'create' ? 'amountError' : 'listError']: message });
      return Promise.resolve();
    }
    this.setData({ submitting: true, recoveryPending: true, amountError: '', listError: '' });
    let interrupted: Section[] = [];
    const work = async () => {
      if (command.uncertain) {
        const read = await withTeacherWithdrawalDeadline(this.loadWithdrawals(true));
        if (!read || !accepts()) return;
      }
      if (!accepts()) return;
      interrupted = [...(this.reads?.keys() ?? [])];
      this.reads?.clear();
      this.withdrawalsFresh = false;
      this.setData({ ...Object.fromEntries(interrupted.map(section => [`${section}Loading`, false])),
        loadingMore: false, canWithdraw: false });
      recovery.writing = true;
      const request = command.kind === 'create'
        ? runtime.createWithdrawal(command.amountFen, command.key)
        : runtime.cancelWithdrawal(command.id, command.version, command.key);
      const authoritative = request.then(state => {
        if (state.status === 'error' && (state.statusCode === 401 || state.statusCode === 403)) {
          denyTeacherWithdrawalSession(recovery, context);
        }
        return state;
      });
      const state = await withTeacherWithdrawalDeadline(authoritative);
      recovery.writing = false;
      if (state.status === 'success') {
        persistTeacherWithdrawalRecovery(recovery, null);
        if (recovery.command?.key === command.key) recovery.command = undefined;
        if (command.kind === 'create') recovery.completedCreateKey = command.key;
        if (!accepts()) return;
        this.setData({ showWithdrawalModal: false, amountYuan: '', amountError: '', selectedTab: 'withdrawals' });
        this.restoreRecovery();
        return;
      }
      const code = state.status === 'error' ? state.statusCode : undefined;
      if (code === 401 || code === 403) { command.uncertain = true; return; }
      if (code && code >= 400 && code < 500 && !command.uncertain) {
        persistTeacherWithdrawalRecovery(recovery, null);
        if (recovery.command?.key === command.key) recovery.command = undefined;
      } else command.uncertain = true;
      if (!accepts()) return;
      const message = command.uncertain ? '操作结果待核对，请核对后重试原申请'
        : code === 409 ? '申请状态或余额已更新，请核对后重试' : '申请未完成，请核对金额及当前提现规则后重试';
      this.setData({ recoveryPending: !!recovery.command, recoveryMessage: recovery.command ? message : '',
        [command.kind === 'create' ? 'amountError' : 'listError']: message });
    };
    const pending = work().catch(() => {
      command.uncertain = true;
      if (accepts()) {
        const message = '操作结果待核对，请重试原申请';
        this.setData({ recoveryPending: true, recoveryMessage: message,
          [command.kind === 'create' ? 'amountError' : 'listError']: message });
      }
    }).finally(() => {
      recovery.writing = false;
      if (recovery.inflight === pending) recovery.inflight = undefined;
      if (accepts()) {
        this.setData({ submitting: false });
        if (!recovery.command) void this.refreshCurrentView();
        else interrupted.forEach(section => { void this.readSection(section); });
      }
    });
    recovery.inflight = pending;
    return pending;
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    createSessionService().logout();
    this.invalidateOwner('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },
});
