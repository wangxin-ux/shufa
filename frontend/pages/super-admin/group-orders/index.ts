import { presentManagementGroupOrder } from '../../../services/super-admin-group-buying.presenter';
import { superAdminService } from '../../../services/super-admin-runtime';
import { GroupMemberStatus } from '../../../types/group-buying';
import { SuperAdminCampus } from '../../../types/super-admin';
import { createMutationKey } from '../../../utils/super-admin-format';

const STATUS_OPTIONS: Array<{ label: string; value?: GroupMemberStatus }> = [
  { label: '全部状态' }, { label: '待支付', value: 'PENDING_PAYMENT' },
  { label: '拼团中', value: 'PAID' }, { label: '已结算', value: 'SETTLED' },
  { label: '退款中', value: 'REFUNDING' }, { label: '已退款', value: 'REFUNDED' },
];

Page({
  data: {
    viewState: 'loading', errorMessage: '', loadingMore: false, page: 0, hasMore: false,
    campuses: [{ id: '', name: '全部校区' }] as Array<Pick<SuperAdminCampus, 'id' | 'name'>>,
    campusIndex: 0, statusOptions: STATUS_OPTIONS, statusIndex: 0,
    orders: [] as Array<ReturnType<typeof presentManagementGroupOrder>>,
    refundReason: '家长申请退款', submittingId: '',
  },
  onLoad() { void this.loadCampuses(); void this.load(true); },
  async loadCampuses() {
    const state = await superAdminService.loadCampuses({ page: 1, pageSize: 100 });
    if (state.status === 'success') this.setData({ campuses: [{ id: '', name: '全部校区' }, ...state.data.data.map(({ id, name }) => ({ id, name }))] });
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) { this.setData({ campusIndex: Number(event.detail.value) }); void this.load(true); },
  onStatusChange(event: WechatMiniprogram.PickerChange) { this.setData({ statusIndex: Number(event.detail.value) }); void this.load(true); },
  onReasonInput(event: WechatMiniprogram.Input) { this.setData({ refundReason: event.detail.value }); },
  async load(reset: boolean) {
    if (!reset && (!this.data.hasMore || this.data.loadingMore)) return;
    const page = reset ? 1 : this.data.page + 1;
    this.setData(reset ? { viewState: 'loading', errorMessage: '', orders: [] } : { loadingMore: true });
    const campusId = this.data.campuses[this.data.campusIndex]?.id || undefined;
    const status = this.data.statusOptions[this.data.statusIndex]?.value as GroupMemberStatus | undefined;
    const state = await superAdminService.loadGroupOrders({ page, pageSize: 20, campusId, status });
    if (state.status === 'success' || state.status === 'empty') {
      const next = state.data.data.map(presentManagementGroupOrder);
      const orders = reset ? next : [...this.data.orders, ...next];
      this.setData({ viewState: orders.length ? 'ready' : 'empty', orders, page: state.data.meta.page, hasMore: state.data.meta.page < state.data.meta.totalPages, loadingMore: false }); return;
    }
    if (state.status === 'error') this.setData({ viewState: state.statusCode === 403 ? 'forbidden' : 'error', errorMessage: state.message, loadingMore: false });
  },
  onRefund(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset.id ?? ''); const version = Number(event.currentTarget.dataset.version);
    const reason = this.data.refundReason.trim();
    if (!reason) { wx.showToast({ title: '请先填写退款原因', icon: 'none' }); return; }
    wx.showModal({ title: '确认退款', content: '未消费课包将生成冲正流水；已消费课包会由服务端拒绝自动退款。', confirmText: '确认退款', success: ({ confirm }) => { if (confirm) void this.performRefund(id, version, reason); } });
  },
  async performRefund(id: string, version: number, reason: string) {
    if (this.data.submittingId) return;
    this.setData({ submittingId: id });
    const state = await superAdminService.refundGroupOrder(id, version, reason, createMutationKey('group-refund'));
    this.setData({ submittingId: '' });
    if (state.status === 'success') { wx.showToast({ title: '退款处理已提交', icon: 'success' }); void this.load(true); }
    else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' });
  },
  onRetry() { void this.load(true); },
  onLoadMore() { void this.load(false); },
});
