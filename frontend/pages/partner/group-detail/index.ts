import {
  buildGroupPromotionShareCopy,
  groupPromotionRecipientPath,
  presentGroupPromotionCampaign,
} from '../../../services/group-promotion.presenter';
import { partnerService } from '../../../services/partner-runtime';

function loadCanvasImage(
  src: string,
): Promise<{ path: string; width: number; height: number }> {
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
    viewState: 'loading',
    errorMessage: '',
    campaignId: '',
    campaign: null as ReturnType<typeof presentGroupPromotionCampaign> | null,
    shareCopy: '',
    showPoster: false,
    posterGenerating: false,
    posterPath: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ campaignId: options.id ?? '' });
    void this.load();
  },

  onPullDownRefresh() {
    void this.load().finally(() => wx.stopPullDownRefresh());
  },

  async load() {
    if (!this.data.campaignId) {
      this.setData({ viewState: 'error', errorMessage: '活动参数无效' });
      return;
    }
    this.setData({ viewState: 'loading', errorMessage: '' });
    const state = await partnerService.loadGroupPromotionCampaign(
      this.data.campaignId,
    );
    if (state.status === 'success') {
      const campaign = presentGroupPromotionCampaign(state.data);
      this.setData({
        viewState: 'ready',
        campaign,
        shareCopy: buildGroupPromotionShareCopy(campaign),
        errorMessage: '',
      });
      return;
    }
    if (state.status === 'error') {
      this.setData({
        viewState: state.statusCode === 403 ? 'forbidden' : 'error',
        errorMessage:
          state.statusCode === 403
            ? '当前账号无权查看本校区活动'
            : state.message,
      });
    }
  },

  onPreviewPoster(event: WechatMiniprogram.TouchEvent) {
    const current = String(event.currentTarget.dataset.url ?? '');
    const urls = this.data.campaign?.posterImages.map(({ accessUrl }) => accessUrl) ?? [];
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  onCopyText() {
    if (!this.data.shareCopy) return;
    wx.setClipboardData({ data: this.data.shareCopy });
  },

  onOpenPoster() {
    if (!this.data.campaign || this.data.posterGenerating) return;
    this.setData({
      showPoster: true,
      posterGenerating: true,
      posterPath: '',
    });
    setTimeout(() => void this.drawPoster(), 50);
  },

  onClosePoster() {
    this.setData({ showPoster: false });
  },

  async drawPoster() {
    const campaign = this.data.campaign;
    if (!campaign) return;
    const backgroundUrl = campaign.posterImages[0]?.accessUrl;
    let background: { path: string; width: number; height: number } | null = null;
    if (backgroundUrl) {
      try {
        background = await loadCanvasImage(backgroundUrl);
      } catch {
        background = null;
      }
    }

    const context = wx.createCanvasContext('partnerGroupPoster', this);
    if (background) {
      const cropSize = Math.min(background.width, background.height);
      context.drawImage(
        background.path,
        0,
        0,
        cropSize,
        cropSize,
        0,
        0,
        360,
        360,
      );
    } else {
      context.setFillStyle('#f6cb43');
      context.fillRect(0, 0, 360, 360);
      context.setFillStyle('#ef7d27');
      context.fillRect(0, 0, 360, 116);
      context.setFillStyle('#ffffff');
      context.setFontSize(17);
      context.fillText('校区好课推荐', 24, 42);
      context.setFontSize(27);
      context.fillText(campaign.courseName.slice(0, 13), 24, 82);
      context.setFillStyle('#2a211b');
      context.setFontSize(20);
      context.fillText(campaign.title.slice(0, 16), 24, 158);
      context.setFillStyle('#c84517');
      context.setFontSize(48);
      context.fillText(campaign.priceLabel, 24, 228);
      context.setFillStyle('#4b392d');
      context.setFontSize(15);
      context.fillText('三人拼成 · 每位学员可得五次课', 24, 278);
    }

    context.setFillStyle('#fffdf8');
    context.fillRect(0, 344, 360, 196);
    context.setFillStyle('#ef7d27');
    context.fillRect(0, 344, 360, 5);
    context.setFillStyle('#8d451b');
    context.setFontSize(13);
    context.fillText('合作方推荐', 22, 376);
    context.setFillStyle('#29211c');
    context.setFontSize(19);
    context.fillText(campaign.title.slice(0, 12), 22, 405);
    context.setFillStyle('#c84517');
    context.setFontSize(17);
    context.fillText(`${campaign.priceLabel} · 3 人拼成得 5 次课`, 22, 434);
    context.setFillStyle('#77665a');
    context.setFontSize(11);
    context.fillText(campaign.campusName.slice(0, 14), 22, 460);
    context.fillText(`截止 ${campaign.endsAtLabel.slice(5)}`, 22, 478);

    context.setFillStyle('#ffffff');
    context.fillRect(272, 368, 66, 66);
    context.setStrokeStyle('#e5b75b');
    context.setLineWidth(1);
    context.strokeRect(272, 368, 66, 66);
    context.setFillStyle('#ef7d27');
    for (const [x, y] of [[278, 374], [310, 374], [278, 406], [294, 390], [318, 414]]) {
      context.fillRect(x, y, 12, 12);
    }
    context.setFillStyle('#7c6b5f');
    context.setFontSize(9);
    context.fillText('本地演示码', 278, 451);
    context.setFontSize(8);
    context.fillText('正式小程序码待接入', 266, 464);

    context.setFillStyle('#ef7d27');
    context.fillRect(22, 492, 316, 32);
    context.setFillStyle('#ffffff');
    context.setFontSize(13);
    const actionLabel = '微信内打开活动详情';
    const actionWidth = context.measureText(actionLabel).width;
    context.fillText(actionLabel, (360 - actionWidth) / 2, 513);
    context.draw(false, () => {
      wx.canvasToTempFilePath(
        {
          canvasId: 'partnerGroupPoster',
          width: 360,
          height: 540,
          destWidth: 720,
          destHeight: 1080,
          success: ({ tempFilePath }) =>
            this.setData({ posterPath: tempFilePath, posterGenerating: false }),
          fail: () => {
            this.setData({ posterGenerating: false });
            wx.showToast({ title: '海报生成失败，请重试', icon: 'none' });
          },
        },
        this,
      );
    });
  },

  onSavePoster() {
    if (!this.data.posterPath) {
      wx.showToast({ title: '请等待海报生成', icon: 'none' });
      return;
    }
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterPath,
      success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
      fail: () =>
        wx.showToast({ title: '未能保存，请检查相册权限', icon: 'none' }),
    });
  },

  onRetry() {
    void this.load();
  },

  noop() {},

  onShareAppMessage() {
    const campaign = this.data.campaign;
    return {
      title: campaign?.title ?? '线下课程拼团',
      path: groupPromotionRecipientPath(this.data.campaignId),
      ...(this.data.posterPath || campaign?.posterImages[0]
        ? { imageUrl: this.data.posterPath || campaign?.posterImages[0].accessUrl }
        : {}),
    };
  },
});
