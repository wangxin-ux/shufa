import { presentManagementGroupCampaign } from '../../../services/super-admin-group-buying.presenter';
import { superAdminService } from '../../../services/super-admin-runtime';
import { GroupCampaignMutationInput, GroupCampaignView } from '../../../types/group-buying';
import { SuperAdminCampus } from '../../../types/super-admin';
import { createMutationKey } from '../../../utils/super-admin-format';

type ProductOption = { id: string; name: string; campusId: string };
const today = () => new Date().toISOString().slice(0, 10);

Page({
  data: {
    viewState: 'loading', errorMessage: '', submitting: false,
    campuses: [] as SuperAdminCampus[], campusIndex: 0,
    products: [] as ProductOption[], availableProducts: [] as ProductOption[], productIndex: 0,
    title: '19.9 元线下体验课拼团', description: '三人同行，每位学员可获得五次线下课程。', priceYuan: '19.9',
    startsOn: today(), endsOn: '2026-09-30', editId: '', editVersion: 0, cancelReason: '活动安排调整',
    campaigns: [] as Array<ReturnType<typeof presentManagementGroupCampaign>>,
  },
  onLoad() { void this.load(); },
  async load() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const [campaigns, campuses, courseProducts] = await Promise.all([
      superAdminService.loadGroupCampaigns({ page: 1, pageSize: 100 }),
      superAdminService.loadCampuses({ page: 1, pageSize: 100 }),
      superAdminService.loadCourseProducts({ page: 1, pageSize: 100, status: 'ACTIVE' }),
    ]);
    if ((campaigns.status === 'success' || campaigns.status === 'empty') && (campuses.status === 'success' || campuses.status === 'empty') && (courseProducts.status === 'success' || courseProducts.status === 'empty')) {
      const products = courseProducts.data.data.map(({ id, name, campusId }) => ({ id, name, campusId }));
      const campusIndex = Math.min(this.data.campusIndex, Math.max(0, campuses.data.data.length - 1));
      const availableProducts = products.filter((item) => item.campusId === campuses.data.data[campusIndex]?.id);
      this.setData({
        viewState: campaigns.data.data.length ? 'ready' : 'empty',
        campaigns: campaigns.data.data.map(presentManagementGroupCampaign),
        campuses: campuses.data.data, products, availableProducts, campusIndex,
        productIndex: Math.min(this.data.productIndex, Math.max(0, availableProducts.length - 1)),
      }); return;
    }
    this.setData({ viewState: 'error', errorMessage: '拼团活动加载失败，请稍后重试' });
  },
  onCampusChange(event: WechatMiniprogram.PickerChange) {
    const campusIndex = Number(event.detail.value);
    const campusId = this.data.campuses[campusIndex]?.id;
    this.setData({ campusIndex, availableProducts: this.data.products.filter((item) => item.campusId === campusId), productIndex: 0 });
  },
  onProductChange(event: WechatMiniprogram.PickerChange) { this.setData({ productIndex: Number(event.detail.value) }); },
  onTitleInput(event: WechatMiniprogram.Input) { this.setData({ title: event.detail.value }); },
  onDescriptionInput(event: WechatMiniprogram.Input) { this.setData({ description: event.detail.value }); },
  onPriceInput(event: WechatMiniprogram.Input) { this.setData({ priceYuan: event.detail.value }); },
  onStartDate(event: WechatMiniprogram.PickerChange) { this.setData({ startsOn: String(event.detail.value) }); },
  onEndDate(event: WechatMiniprogram.PickerChange) { this.setData({ endsOn: String(event.detail.value) }); },
  onReasonInput(event: WechatMiniprogram.Input) { this.setData({ cancelReason: event.detail.value }); },
  async onSubmit() {
    if (this.data.submitting) return;
    const input = this.buildInput();
    if (!input) return;
    this.setData({ submitting: true });
    const state = this.data.editId
      ? await superAdminService.updateGroupCampaign(this.data.editId, input, this.data.editVersion, createMutationKey('group-campaign-update'))
      : await superAdminService.createGroupCampaign(input, createMutationKey('group-campaign-create'));
    this.setData({ submitting: false });
    if (state.status === 'success') { wx.showToast({ title: this.data.editId ? '草稿已修改' : '草稿已创建', icon: 'success' }); this.resetForm(); void this.load(); }
    else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' });
  },
  buildInput(): GroupCampaignMutationInput | null {
    const campus = this.data.campuses[this.data.campusIndex];
    const product = this.data.availableProducts[this.data.productIndex];
    const priceFen = Math.round(Number(this.data.priceYuan) * 100);
    if (!campus || !product || !this.data.title.trim() || !this.data.description.trim() || !Number.isInteger(priceFen) || priceFen <= 0 || !this.data.startsOn || !this.data.endsOn) {
      wx.showToast({ title: '请完整填写活动信息', icon: 'none' }); return null;
    }
    if (this.data.endsOn < this.data.startsOn) { wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' }); return null; }
    return { campusId: campus.id, courseProductId: product.id, title: this.data.title.trim(), description: this.data.description.trim(), priceFen, startsAt: `${this.data.startsOn}T00:00:00+08:00`, endsAt: `${this.data.endsOn}T23:59:59+08:00` };
  },
  onEdit(event: WechatMiniprogram.TouchEvent) {
    const campaign = this.data.campaigns.find((item) => item.id === String(event.currentTarget.dataset.id ?? ''));
    if (!campaign) return;
    const campusIndex = Math.max(0, this.data.campuses.findIndex((item) => item.id === campaign.campusId));
    const availableProducts = this.data.products.filter((item) => item.campusId === campaign.campusId);
    this.setData({
      editId: campaign.id, editVersion: campaign.version, campusIndex, availableProducts,
      productIndex: Math.max(0, availableProducts.findIndex((item) => item.id === campaign.courseProductId)),
      title: campaign.title, description: campaign.description, priceYuan: String(campaign.priceFen / 100),
      startsOn: campaign.startsAt.slice(0, 10), endsOn: campaign.endsAt.slice(0, 10),
    });
  },
  onCancelEdit() { this.resetForm(); },
  resetForm() { this.setData({ editId: '', editVersion: 0, title: '19.9 元线下体验课拼团', description: '三人同行，每位学员可获得五次线下课程。', priceYuan: '19.9' }); },
  onTransition(event: WechatMiniprogram.TouchEvent) {
    const action = String(event.currentTarget.dataset.action ?? '') as 'activate' | 'close' | 'cancel';
    const id = String(event.currentTarget.dataset.id ?? ''); const version = Number(event.currentTarget.dataset.version);
    const labels = { activate: '启用活动', close: '结束活动', cancel: '取消活动' };
    if (action === 'cancel' && !this.data.cancelReason.trim()) { wx.showToast({ title: '请先填写取消原因', icon: 'none' }); return; }
    wx.showModal({ title: `确认${labels[action]}`, content: action === 'close' ? '结束后将按各团最终已支付人数结算课包。' : action === 'cancel' ? `取消原因：${this.data.cancelReason.trim()}` : '启用后家长端即可参与。', success: ({ confirm }) => { if (confirm) void this.performTransition(id, action, version); } });
  },
  async performTransition(id: string, action: 'activate' | 'close' | 'cancel', version: number) {
    if (this.data.submitting) return; this.setData({ submitting: true });
    const state = await superAdminService.transitionGroupCampaign(id, action, version, action === 'cancel' ? this.data.cancelReason.trim() : undefined, createMutationKey(`group-campaign-${action}`));
    this.setData({ submitting: false });
    if (state.status === 'success') { wx.showToast({ title: action === 'activate' ? '活动已启用' : action === 'close' ? '活动已结束' : '活动已取消', icon: 'success' }); void this.load(); }
    else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' });
  },
  onChoosePosters(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return;
    const campaign = this.data.campaigns.find(
      (item) => item.id === String(event.currentTarget.dataset.id ?? ''),
    );
    if (!campaign || !campaign.canManagePosters) return;
    const remaining = 6 - campaign.posterImages.length;
    if (remaining <= 0) {
      wx.showToast({ title: '每个活动最多上传 6 张海报', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: ({ tempFiles }) => {
        void this.uploadPosterFiles(
          campaign.id,
          campaign.version,
          tempFiles.map(({ tempFilePath }) => tempFilePath),
        );
      },
    });
  },
  async uploadPosterFiles(id: string, version: number, filePaths: string[]) {
    if (this.data.submitting || filePaths.length === 0) return;
    this.setData({ submitting: true });
    let currentVersion = version;
    for (const filePath of filePaths) {
      const state = await superAdminService.uploadGroupCampaignPoster(
        id,
        filePath,
        currentVersion,
        createMutationKey('group-poster-upload'),
      );
      if (state.status !== 'success') {
        if (state.status === 'error') {
          wx.showToast({ title: state.message, icon: 'none' });
        }
        break;
      }
      currentVersion = state.data.version;
      this.replaceCampaign(state.data);
    }
    this.setData({ submitting: false });
  },
  onMovePoster(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return;
    const campaign = this.data.campaigns.find(
      (item) => item.id === String(event.currentTarget.dataset.id ?? ''),
    );
    const posterId = String(event.currentTarget.dataset.poster ?? '');
    const direction = Number(event.currentTarget.dataset.direction ?? 0);
    if (!campaign || !campaign.canManagePosters || !direction) return;
    const posterIds = campaign.posterImages.map(({ id }) => id);
    const index = posterIds.indexOf(posterId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= posterIds.length) return;
    [posterIds[index], posterIds[target]] = [posterIds[target], posterIds[index]];
    void this.applyPosterOrder(campaign.id, posterIds, campaign.version);
  },
  async applyPosterOrder(id: string, posterIds: string[], version: number) {
    this.setData({ submitting: true });
    const state = await superAdminService.reorderGroupCampaignPosters(
      id,
      posterIds,
      version,
      createMutationKey('group-poster-reorder'),
    );
    this.setData({ submitting: false });
    if (state.status === 'success') this.replaceCampaign(state.data);
    else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' });
  },
  onDetachPoster(event: WechatMiniprogram.TouchEvent) {
    if (this.data.submitting) return;
    const id = String(event.currentTarget.dataset.id ?? '');
    const posterId = String(event.currentTarget.dataset.poster ?? '');
    const version = Number(event.currentTarget.dataset.version ?? 0);
    wx.showModal({
      title: '移除活动海报',
      content: '只会从本活动移除，不会删除历史文件。',
      success: ({ confirm }) => {
        if (confirm) void this.detachPoster(id, posterId, version);
      },
    });
  },
  async detachPoster(id: string, posterId: string, version: number) {
    this.setData({ submitting: true });
    const state = await superAdminService.detachGroupCampaignPoster(
      id,
      posterId,
      version,
      createMutationKey('group-poster-detach'),
    );
    this.setData({ submitting: false });
    if (state.status === 'success') this.replaceCampaign(state.data);
    else if (state.status === 'error') wx.showToast({ title: state.message, icon: 'none' });
  },
  replaceCampaign(campaign: GroupCampaignView) {
    this.setData({
      campaigns: this.data.campaigns.map((item) =>
        item.id === campaign.id ? presentManagementGroupCampaign(campaign) : item,
      ),
    });
  },
  onOrders() { wx.navigateTo({ url: '/pages/super-admin/group-orders/index' }); },
  onRetry() { void this.load(); },
});
