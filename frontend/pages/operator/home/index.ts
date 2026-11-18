import {
  buildOperatorHomePageModel,
  OPERATOR_HOME_ACTIONS,
  resolveOperatorHomeAction,
} from '../runtime/services/operator-home.presenter';
import { createSessionService } from '../../../services/session.service';
import { OperatorPageContext } from '../runtime/operator-page-context';
import { loadOperatorPdfDisplayFont } from '../runtime/operator-pdf-font';

type HomePageModel = ReturnType<typeof buildOperatorHomePageModel>;

const EMPTY_HOME = {
  managerName: '', campusName: '', pendingCount: '', pendingUnit: '请假',
  latestLabel: '', latestStatus: '',
  latestLeaveId: null as HomePageModel['latestLeaveId'],
  stats: [] as HomePageModel['stats'],
};

const MENU_ACTIONS = [
  { key: 'schedule', label: '排课管理' },
  { key: 'approvals', label: '请假审批' },
  { key: 'students', label: '人员管理' },
  { key: 'teacher-archives', label: '教师档案' },
  { key: 'rankings', label: '校区月榜' },
  { key: 'lesson-account', label: '课时账户' },
  { key: 'student-create', label: '快捷录入' },
  { key: 'warnings', label: '预警名单' },
  { key: 'settings', label: '校区设置' },
  { key: 'profile', label: '我的' },
];

Page({
  context: undefined as OperatorPageContext | undefined,
  pendingRequest: undefined as Promise<void> | undefined,
  initialShowPending: true,
  navigating: false,
  navigationSequence: 0,
  pullSequence: 0,

  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    menuExpanded: false,
    menuActions: MENU_ACTIONS,
    ...EMPTY_HOME,
    actions: OPERATOR_HOME_ACTIONS,
  },

  onLoad() {
    void loadOperatorPdfDisplayFont();
    this.context = new OperatorPageContext((errorMessage) => {
      this.pendingRequest = undefined;
      this.navigationSequence += 1;
      this.navigating = false;
      this.setData({
        ...EMPTY_HOME, viewState: 'forbidden', errorMessage,
        refreshError: '', menuExpanded: false,
      });
    });
    void this.loadHome();
  },

  onShow() {
    if (!this.context?.show()) return;
    this.navigating = false;
    this.navigationSequence += 1;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    this.setData({ menuExpanded: false });
    void this.loadHome();
  },

  onHide() {
    this.context?.hide();
    this.initialShowPending = false;
    this.pendingRequest = undefined;
    this.navigationSequence += 1;
    this.pullSequence += 1;
    this.navigating = false;
  },

  onUnload() { this.context?.dispose(); },

  onPullDownRefresh() {
    const sequence = ++this.pullSequence;
    void this.loadHome().finally(() => {
      if (sequence === this.pullSequence && this.context?.isActive()) wx.stopPullDownRefresh();
    });
  },

  loadHome(): Promise<void> {
    const context = this.context;
    if (!context?.isActive()) return Promise.resolve();
    if (this.pendingRequest) return this.pendingRequest;
    const sequence = context.nextRead();
    const keepContent = ['ready', 'empty'].includes(this.data.viewState);
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading' }), errorMessage: '', refreshError: '',
    });
    const request = Promise.resolve().then(() => {
      if (context.accepts(sequence)) return context.service.loadDashboard();
    }).then((state) => {
      if (!state || !context.accepts(sequence)) return;
      if (state.status === 'success' || state.status === 'empty') {
        this.setData({
          ...buildOperatorHomePageModel(state.data),
          viewState: state.status === 'empty' ? 'empty' : 'ready', errorMessage: '', refreshError: '',
        });
      } else if (state.status === 'error') {
        if (state.statusCode === 401 || state.statusCode === 403) {
          context.invalidate(state.message);
        } else this.setData(keepContent
          ? { refreshError: state.message }
          : { viewState: 'error', errorMessage: state.message });
      }
    }).finally(() => {
      if (this.pendingRequest === request) this.pendingRequest = undefined;
    });
    this.pendingRequest = request;
    return request;
  },

  onLogin() {
    const context = this.context;
    if (!context) return;
    if (context.ownsRuntime()) createSessionService().logout();
    context.invalidate('请重新登录');
    wx.reLaunch({ url: '/pages/bootstrap/index' });
  },

  onLatestLeaveTap() {
    const id = this.data.latestLeaveId;
    this.navigate(`/pages/operator/leave-requests/index${id ? `?selectedLeaveId=${encodeURIComponent(id)}` : ''}`);
  },

  onMenuToggle() {
    if (!this.context?.isActive() || !['ready', 'empty'].includes(this.data.viewState)) return;
    this.setData({ menuExpanded: !this.data.menuExpanded });
  },

  navigate(url: string) {
    if (!this.context?.isActive() || this.navigating || !['ready', 'empty'].includes(this.data.viewState)) return;
    this.navigating = true;
    this.setData({ menuExpanded: false });
    const sequence = ++this.navigationSequence;
    wx.navigateTo({
      url,
      fail: () => {
        if (sequence !== this.navigationSequence || !this.context?.isActive()) return;
        this.navigating = false;
        wx.showToast({ title: '页面打开失败，请重试', icon: 'none' });
      },
    });
  },

  onRetry() {
    void this.loadHome();
  },

  onActionTap(event: WechatMiniprogram.TouchEvent) {
    if (!this.context?.isActive()) return;
    const key = String(event.currentTarget.dataset.key ?? '');
    const result = resolveOperatorHomeAction(key);
    if (result.kind === 'unavailable') {
      wx.showToast({ title: result.message, icon: 'none' });
    } else this.navigate(result.url);
  },
});
