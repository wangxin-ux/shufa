import {
  buildGroupShareCopy,
  groupSharePath,
  presentParentGroupCampaign,
  presentParentGroupTeam,
} from '../../../services/parent-group-buying.presenter';
import { ParentGroupBuyingWorkflow } from '../../../services/parent-group-buying.workflow';
import { parentDataSource, parentService } from '../../../services/parent-runtime';
import { GroupCampaignView } from '../../../types/group-buying';
import { createMutationKey } from '../../../utils/super-admin-format';

const workflow = new ParentGroupBuyingWorkflow(parentDataSource);

function loadCanvasImage(src: string): Promise<{ path: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: ({ path, width, height }) => resolve({ path, width, height }),
      fail: () => reject(new Error('活动海报底图加载失败')),
    });
  });
}

Page({
  data: {
    viewState: 'loading', errorMessage: '', campaignId: '', requestedTeamId: '',
    campaign: null as ReturnType<typeof presentParentGroupCampaign> | null,
    teams: [] as Array<ReturnType<typeof presentParentGroupTeam>>,
    students: [] as GroupCampaignView['boundStudents'], studentIndex: 0,
    submitting: false, paymentConfirming: false,
    showService: false, showPoster: false, posterPath: '', posterGenerating: false,
    shareCopy: '', needsLogin: false,
  },
  onLoad(options: Record<string, string | undefined>) {
    this.setData({ campaignId: options.id ?? '', requestedTeamId: options.teamId ?? '' });
    void this.load();
  },
  onPullDownRefresh() { void this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (!this.data.campaignId) { this.setData({ viewState: 'error', errorMessage: '活动参数无效' }); return; }
    this.setData({ viewState: 'loading', errorMessage: '', needsLogin: false });
    const state = await parentService.loadGroupCampaign(this.data.campaignId, this.data.requestedTeamId || undefined);
    if (state.status === 'success') {
      const campaign = presentParentGroupCampaign(state.data);
      const studentIndex = Math.min(this.data.studentIndex, Math.max(0, state.data.boundStudents.length - 1));
      this.setData({
        viewState: 'ready', campaign,
        teams: state.data.joinableTeams.map(presentParentGroupTeam), students: state.data.boundStudents,
        studentIndex,
        shareCopy: buildGroupShareCopy(campaign, state.data.boundStudents[studentIndex]?.name),
      }); return;
    }
    if (state.status === 'error') this.setData({
      viewState: state.statusCode === 403 ? 'forbidden' : 'error',
      errorMessage: state.message,
      needsLogin: state.statusCode === 401,
    });
  },
  onStudentChange(event: WechatMiniprogram.PickerChange) {
    const studentIndex = Number(event.detail.value);
    const campaign = this.data.campaign;
    this.setData({
      studentIndex,
      shareCopy: campaign
        ? buildGroupShareCopy(campaign, this.data.students[studentIndex]?.name)
        : '',
    });
  },
  onStart() { void this.submit(); },
  onJoin(event: WechatMiniprogram.TouchEvent) { void this.submit(String(event.currentTarget.dataset.team ?? '')); },
  async submit(teamId?: string) {
    if (this.data.submitting) return;
    const campaign = this.data.campaign;
    const student = this.data.students[this.data.studentIndex];
    if (!campaign || !student) { wx.showToast({ title: '请选择已绑定学员', icon: 'none' }); return; }
    if (!campaign.canParticipate) { wx.showToast({ title: campaign.actionLabel, icon: 'none' }); return; }
    this.setData({ submitting: true, paymentConfirming: false });
    try {
      const input = { campaignId: campaign.id, studentId: student.id };
      const invocation = teamId
        ? await workflow.join(teamId, input, createMutationKey('group-join'))
        : await workflow.start(input, createMutationKey('group-create'));
      if (invocation.kind === 'wechat') {
        await this.requestWechatPayment(invocation.payment);
        workflow.markWechatPaymentAccepted();
      }
      this.setData({ paymentConfirming: true });
      wx.showToast({ title: invocation.kind === 'mock' ? '模拟支付已确认' : '支付确认中', icon: 'none' });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error instanceof Error ? error.message : '拼团请求失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
  requestWechatPayment(payment: { timeStamp: string; nonceStr: string; package: string; signType: 'RSA'; paySign: string }): Promise<void> {
    return new Promise((resolve, reject) => wx.requestPayment({ ...payment, success: () => resolve(), fail: (error) => reject(new Error(error.errMsg.includes('cancel') ? '已取消支付，可稍后继续' : '支付未完成，请稍后重试')) }));
  },
  onOpenService() { this.setData({ showService: true }); },
  onCloseService() { this.setData({ showService: false }); },
  onCall() {
    const phoneNumber = this.data.campaign?.customerService.phone ?? '';
    if (!phoneNumber) { wx.showToast({ title: '校区暂未配置客服电话', icon: 'none' }); return; }
    wx.makePhoneCall({ phoneNumber });
  },
  onPreviewQr() {
    const url = this.data.campaign?.customerService.qrCodeUrl;
    if (url) wx.previewImage({ current: url, urls: [url] });
    else wx.showToast({ title: '校区暂未配置客服二维码', icon: 'none' });
  },
  onOpenPoster() {
    const campaign = this.data.campaign;
    const studentName = this.data.students[this.data.studentIndex]?.name;
    this.setData({
      showPoster: true,
      posterGenerating: true,
      posterPath: '',
      shareCopy: campaign ? buildGroupShareCopy(campaign, studentName) : '',
    });
    setTimeout(() => { void this.drawPoster(); }, 50);
  },
  onClosePoster() { this.setData({ showPoster: false }); },
  async drawPoster() {
    const campaign = this.data.campaign;
    if (!campaign) return;
    const studentName = this.data.students[this.data.studentIndex]?.name ?? '学员';
    const backgroundUrl = campaign.posterImages[0]?.accessUrl;
    let background: { path: string; width: number; height: number } | null = null;
    if (backgroundUrl) {
      try {
        background = await loadCanvasImage(backgroundUrl);
      } catch {
        background = null;
      }
    }

    const context = wx.createCanvasContext('groupPoster', this);
    if (background) {
      const cropSize = Math.min(background.width, background.height);
      context.drawImage(background.path, 0, 0, cropSize, cropSize, 0, 0, 360, 360);
    } else {
      context.setFillStyle('#f6d468'); context.fillRect(0, 0, 360, 360);
      context.setFillStyle('#fe8419'); context.fillRect(0, 0, 360, 118);
      context.setFillStyle('#ffffff'); context.setFontSize(18); context.fillText('线下课程拼团', 24, 42);
      context.setFontSize(27); context.fillText(campaign.courseName.slice(0, 14), 24, 84);
      context.setFillStyle('#231b16'); context.setFontSize(20); context.fillText(campaign.title.slice(0, 17), 24, 164);
      context.setFillStyle('#eb561d'); context.setFontSize(52); context.fillText(`¥${campaign.priceLabel}`, 24, 232);
      context.setFillStyle('#382d25'); context.setFontSize(16); context.fillText('1 人 1 次 · 2 人 3 次 · 3 人 5 次', 24, 282);
    }

    context.setFillStyle('#fffdf8');
    context.fillRect(0, 344, 360, 196);
    context.setFillStyle('#fe8419');
    context.fillRect(0, 344, 360, 5);
    context.setFillStyle('#a44a18');
    context.setFontSize(14);
    context.fillText('好友拼团邀请', 24, 378);
    context.setFillStyle('#2a211b');
    context.setFontSize(20);
    context.fillText(`和 ${studentName.slice(0, 5)} 一起上${campaign.courseName.slice(0, 8)}`, 24, 410);
    context.setFillStyle('#5c493c');
    context.setFontSize(13);
    context.fillText(`¥${campaign.priceLabel} 参与 · 3 人拼成每人得 5 次`, 24, 440);
    context.setFillStyle('#806d5f');
    context.setFontSize(11);
    context.fillText(`${campaign.campusName.slice(0, 12)} · 截止 ${campaign.endsAtLabel.slice(5)}`, 24, 466);
    context.setFillStyle('#fe8419');
    context.fillRect(24, 482, 312, 40);
    context.setFillStyle('#ffffff');
    context.setFontSize(15);
    const actionLabel = '微信内打开活动';
    const actionLabelWidth = context.measureText(actionLabel).width;
    context.fillText(actionLabel, (360 - actionLabelWidth) / 2, 508);
    context.setFillStyle('#a26a3c');
    context.setFontSize(9);
    context.fillText('演示入口 · 正式小程序码接入后替换', 102, 535);
    context.draw(false, () => {
      wx.canvasToTempFilePath({
        canvasId: 'groupPoster', width: 360, height: 540, destWidth: 720, destHeight: 1080,
        success: ({ tempFilePath }) => this.setData({ posterPath: tempFilePath, posterGenerating: false }),
        fail: () => { this.setData({ posterGenerating: false }); wx.showToast({ title: '海报生成失败，请重试', icon: 'none' }); },
      }, this);
    });
  },
  onCopyPosterText() {
    if (!this.data.shareCopy) return;
    wx.setClipboardData({ data: this.data.shareCopy });
  },
  onSavePoster() {
    if (!this.data.posterPath) { wx.showToast({ title: '请等待海报生成', icon: 'none' }); return; }
    wx.saveImageToPhotosAlbum({ filePath: this.data.posterPath, success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }), fail: () => wx.showToast({ title: '未能保存，请检查相册权限', icon: 'none' }) });
  },
  onRetry() {
    if (this.data.needsLogin) {
      wx.reLaunch({ url: '/pages/bootstrap/index' });
      return;
    }
    void this.load();
  },
  noop() {},
  onShareAppMessage() {
    const campaign = this.data.campaign;
    return {
      title: campaign?.title ?? '线下课程拼团',
      path: groupSharePath(this.data.campaignId, this.data.teams[0]?.id || this.data.requestedTeamId || undefined),
      ...(this.data.posterPath ? { imageUrl: this.data.posterPath } : {}),
    };
  },
});
