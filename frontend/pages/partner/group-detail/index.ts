import { loadPartnerPdfDisplayFont } from '../runtime/partner-pdf-font';
import {
  buildGroupPromotionShareCopy,
  groupPromotionRecipientPath,
} from '../../../services/group-promotion.presenter';
import { presentPartnerPromotionCampaign } from '../runtime/group-promotion';
import { createPartnerService } from '../../../services/partner-runtime';
import { logoutPartnerCampaignSession } from '../runtime/campaign-session-runtime';
import { getPartnerCampaignDraftService } from '../runtime/partner-campaign-draft.service';

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
  requestSequence: 0,
  pendingRequest: undefined as Promise<void> | undefined,
  posterSequence: 0,
  posterTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  promotionTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  // Closing a poster cannot cancel an in-flight native album save.
  saveInFlight: false,
  saveSequence: 0,
  previewInFlight: false,
  previewSequence: 0,
  copyInFlight: false,
  copySequence: 0,
  hidden: false,
  disposed: false,
  loginStopped: false,
  loginSequence: 0,
  pullSequence: 0,
  initialShowPending: false,
  detailOwnerKey: '',
  data: {
    viewState: 'loading',
    errorMessage: '',
    refreshError: '',
    campaignId: '',
    campaign: null as ReturnType<typeof presentPartnerPromotionCampaign> | null,
    shareCopy: '',
    showPoster: false,
    posterGenerating: false,
    posterPath: '',
    posterError: '',
    posterSaving: false,
  },

  onLoad(options: Record<string, string | undefined>) {
    void loadPartnerPdfDisplayFont();
    this.initialShowPending = true;
    this.setData({ campaignId: options.id ?? '' });
    void this.load();
  },

  onShow() {
    if (this.disposed) return;
    this.hidden = false;
    if (!this.validateOwner()) return;
    if (this.initialShowPending) {
      this.initialShowPending = false;
      return;
    }
    void this.load();
  },

  onHide() {
    this.hidden = true;
    this.loginSequence += 1;
    this.pullSequence += 1;
    this.initialShowPending = false;
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.invalidateNativeActions();
    this.invalidatePoster();
    this.clearPromotionTimer();
  },

  onUnload() {
    this.disposed = true;
    this.onHide();
  },

  onPullDownRefresh() {
    if (this.hidden || this.disposed || this.loginStopped) return;
    const sequence = ++this.pullSequence;
    const pending = this.load();
    const owner = this.detailOwnerKey;
    void pending.finally(() => {
      if (!this.hidden && !this.disposed && !this.loginStopped && sequence === this.pullSequence &&
        getPartnerCampaignDraftService().getSessionKey() === owner) wx.stopPullDownRefresh();
    });
  },

  load(): Promise<void> {
    if (this.hidden || this.disposed || !this.validateOwner()) return Promise.resolve();
    this.detailOwnerKey = getPartnerCampaignDraftService().getSessionKey();
    if (this.pendingRequest) return this.pendingRequest;
    this.updateShareMenu(false);
    if (!this.data.campaignId) {
      this.setData({ viewState: 'error', errorMessage: '活动参数无效' });
      return Promise.resolve();
    }
    const sequence = ++this.requestSequence;
    const keepContent = this.data.viewState === 'ready';
    this.invalidateNativeActions();
    this.invalidatePoster();
    this.clearPromotionTimer();
    this.setData({
      ...(keepContent ? {} : { viewState: 'loading' }),
      errorMessage: '',
      refreshError: '',
      showPoster: false,
      posterGenerating: false,
      posterSaving: false,
      posterPath: '',
      posterError: '',
    });
    const request = Promise.resolve()
      .then(() => {
        if (this.hidden || this.disposed || sequence !== this.requestSequence || !this.validateOwner())
          return;
        return createPartnerService().loadGroupPromotionCampaign(this.data.campaignId);
      })
      .catch((error: unknown) => ({
        status: 'error' as const,
        statusCode:
          typeof error === 'object' &&
          error !== null &&
          'statusCode' in error &&
          typeof error.statusCode === 'number'
            ? error.statusCode
            : undefined,
        message: '活动详情加载失败，请稍后重试',
      }))
      .then((state) => {
        if (
          !state ||
          this.hidden ||
          this.disposed ||
          sequence !== this.requestSequence ||
          !this.validateOwner()
        )
          return;
        if (state.status === 'success') {
          const campaign = presentPartnerPromotionCampaign(state.data);
          this.setData({
            viewState: 'ready',
            campaign,
            shareCopy: campaign.canPromote ? buildGroupPromotionShareCopy(campaign) : '',
            errorMessage: '',
          });
          return;
        }
        if (state.status === 'error') {
          if (state.statusCode === 401 || state.statusCode === 403) {
            this.setData({
              viewState: 'forbidden',
              campaign: null,
              shareCopy: '',
              refreshError: '',
              errorMessage:
                state.statusCode === 401
                  ? '登录已失效，请重新登录'
                  : '当前账号无权查看本校区活动',
            });
          } else {
            if (keepContent && state.statusCode === 404) this.revokePromotion('已失效');
            this.setData(
              keepContent
                ? { refreshError: state.message }
                : { viewState: 'error', errorMessage: state.message },
            );
          }
        }
      })
      .finally(() => {
        if (sequence === this.requestSequence) {
          this.pendingRequest = undefined;
          this.schedulePromotionExpiry();
        }
      });
    this.pendingRequest = request;
    return request;
  },

  validateOwner() {
    if (this.loginStopped) return false;
    if (!this.detailOwnerKey ||
      getPartnerCampaignDraftService().getSessionKey() === this.detailOwnerKey) return true;
    this.clearPrivate('登录已更新，请重新登录');
    return false;
  },

  clearPrivate(message: string) {
    this.requestSequence += 1;
    this.pendingRequest = undefined;
    this.invalidateNativeActions();
    this.invalidatePoster();
    this.clearPromotionTimer();
    this.updateShareMenu(false);
    this.setData({
      viewState: 'forbidden', campaign: null, shareCopy: '', posterPath: '',
      showPoster: false, posterGenerating: false, posterSaving: false,
      errorMessage: message, refreshError: '', posterError: '',
    });
  },

  isReady() {
    return (
      !this.hidden &&
      !this.disposed &&
      this.validateOwner() &&
      this.data.viewState === 'ready' &&
      !!this.data.campaign
    );
  },

  canPromote() {
    if (!this.isReady() || this.pendingRequest || !this.data.campaign?.canPromote) return false;
    const endsAt = Date.parse(this.data.campaign.endsAt);
    if (!Number.isFinite(endsAt) || endsAt <= Date.now()) {
      this.revokePromotion('已结束');
      return false;
    }
    return true;
  },

  clearPromotionTimer() {
    if (this.promotionTimer !== undefined) clearTimeout(this.promotionTimer);
    this.promotionTimer = undefined;
  },

  updateShareMenu(enabled: boolean) {
    try {
      if (enabled) wx.showShareMenu?.({ menus: ['shareAppMessage'] });
      else wx.hideShareMenu?.({});
    } catch {
      return;
    }
  },

  revokePromotion(statusLabel: string) {
    if (!this.isReady()) return;
    this.copySequence += 1;
    this.copyInFlight = false;
    this.clearPromotionTimer();
    this.invalidatePoster();
    this.setData({
      campaign: { ...this.data.campaign!, canPromote: false, statusLabel },
      shareCopy: '', showPoster: false, posterGenerating: false,
      posterSaving: false, posterPath: '', posterError: '',
    });
    this.updateShareMenu(false);
  },

  schedulePromotionExpiry() {
    this.clearPromotionTimer();
    if (!this.canPromote()) return;
    this.updateShareMenu(true);
    const delay = Date.parse(this.data.campaign!.endsAt) - Date.now();
    this.promotionTimer = setTimeout(() => {
      this.promotionTimer = undefined;
      this.schedulePromotionExpiry();
    }, Math.min(delay, 2_147_483_647));
  },

  invalidatePoster() {
    this.posterSequence += 1;
    if (this.posterTimer !== undefined) clearTimeout(this.posterTimer);
    this.posterTimer = undefined;
  },

  isCurrentPoster(sequence: number) {
    return (
      this.canPromote() && this.data.showPoster && sequence === this.posterSequence
    );
  },

  failPoster(sequence: number) {
    if (!this.isCurrentPoster(sequence)) return;
    this.setData({
      posterGenerating: false,
      posterPath: '',
      posterError: '海报生成失败，请重试',
    });
  },

  invalidateNativeActions() {
    this.previewSequence += 1;
    this.previewInFlight = false;
    this.copySequence += 1;
    this.copyInFlight = false;
  },

  onPreviewPoster(event: WechatMiniprogram.TouchEvent) {
    if (!this.isReady() || this.pendingRequest || this.previewInFlight) return;
    const current = String(event.currentTarget.dataset.url ?? '');
    const urls =
      this.data.campaign?.posterImages.map(({ accessUrl }) => accessUrl) ?? [];
    if (!current || !urls.includes(current)) return;
    const sequence = ++this.previewSequence;
    const request = this.requestSequence;
    this.previewInFlight = true;
    if (this.data.refreshError === '图片预览失败，请重试') {
      this.setData({ refreshError: '' });
    }
    const finish = (failed: boolean) => {
      if (sequence !== this.previewSequence || !this.previewInFlight) return;
      this.previewInFlight = false;
      if (!this.isReady() || this.pendingRequest ||
        request !== this.requestSequence) return;
      if (failed) this.setData({ refreshError: '图片预览失败，请重试' });
    };
    try {
      wx.previewImage({
        current,
        urls,
        success: () => finish(false),
        fail: () => finish(true),
        complete: () => finish(false),
      });
    } catch {
      finish(true);
    }
  },

  onCopyText() {
    if (!this.canPromote() || !this.data.shareCopy || this.copyInFlight) return;
    const sequence = ++this.copySequence;
    const request = this.requestSequence;
    this.copyInFlight = true;
    const finish = (failed: boolean) => {
      if (sequence !== this.copySequence || !this.copyInFlight) return;
      this.copyInFlight = false;
      if (request !== this.requestSequence || !this.canPromote()) return;
      if (failed) wx.showToast({ title: '文案复制失败，请重试', icon: 'none' });
    };
    try {
      wx.setClipboardData({
        data: this.data.shareCopy,
        success: () => finish(false),
        fail: () => finish(true),
        complete: () => finish(false),
      });
    } catch {
      finish(true);
    }
  },

  onOpenPoster() {
    if (!this.canPromote() || this.pendingRequest || this.data.posterGenerating)
      return;
    this.invalidatePoster();
    const sequence = this.posterSequence;
    this.setData({
      showPoster: true,
      posterGenerating: true,
      posterPath: '',
      posterError: '',
      posterSaving: this.saveInFlight,
    });
    this.posterTimer = setTimeout(() => {
      this.posterTimer = undefined;
      if (this.isCurrentPoster(sequence)) void this.drawPoster(sequence);
    }, 50);
  },

  onClosePoster() {
    if (this.hidden || this.disposed || !this.validateOwner()) return;
    this.invalidatePoster();
    this.setData({
      showPoster: false,
      posterGenerating: false,
      posterSaving: false,
      posterPath: '',
      posterError: '',
    });
  },

  async drawPoster(requestedSequence?: number) {
    const sequence = requestedSequence ?? this.posterSequence;
    const campaign = this.data.campaign;
    if (!campaign || !this.isCurrentPoster(sequence)) return;
    try {
      const backgroundUrl = campaign.posterImages[0]?.accessUrl;
      let background: { path: string; width: number; height: number } | null =
        null;
      if (backgroundUrl) {
        try {
          background = await loadCanvasImage(backgroundUrl);
        } catch {
          background = null;
        }
      }

      if (!this.isCurrentPoster(sequence)) return;
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
      for (const [x, y] of [
        [278, 374],
        [310, 374],
        [278, 406],
        [294, 390],
        [318, 414],
      ]) {
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
        if (!this.isCurrentPoster(sequence)) return;
        try {
          wx.canvasToTempFilePath(
            {
              canvasId: 'partnerGroupPoster',
              width: 360,
              height: 540,
              destWidth: 720,
              destHeight: 1080,
              success: ({ tempFilePath }) => {
                if (this.isCurrentPoster(sequence)) {
                  this.setData({
                    posterPath: tempFilePath,
                    posterGenerating: false,
                  });
                }
              },
              fail: () => this.failPoster(sequence),
            },
            this,
          );
        } catch {
          this.failPoster(sequence);
        }
      });
    } catch {
      this.failPoster(sequence);
    }
  },

  onSavePoster() {
    if (!this.isCurrentPoster(this.posterSequence) || this.saveInFlight) return;
    if (!this.data.posterPath) {
      wx.showToast({ title: '请等待海报生成', icon: 'none' });
      return;
    }
    const sequence = this.posterSequence;
    const saveSequence = ++this.saveSequence;
    this.saveInFlight = true;
    this.setData({ posterSaving: true });
    const finish = (success: boolean) => {
      if (!this.saveInFlight || saveSequence !== this.saveSequence) return;
      this.saveInFlight = false;
      if (this.isReady() && this.data.showPoster) {
        this.setData({ posterSaving: false });
      }
      if (!this.isCurrentPoster(sequence)) return;
      wx.showToast({
        title: success ? '已保存到相册' : '未能保存，请检查相册权限',
        icon: success ? 'success' : 'none',
      });
    };
    try {
      wx.saveImageToPhotosAlbum({
        filePath: this.data.posterPath,
        success: () => finish(true),
        fail: () => finish(false),
      });
    } catch {
      finish(false);
    }
  },

  onRetry() {
    void this.load();
  },

  onLogin() {
    if (this.hidden || this.disposed) return;
    this.loginStopped = true;
    this.pullSequence += 1;
    this.clearPrivate('登录已失效，请重新登录');
    logoutPartnerCampaignSession();
    const sequence = ++this.loginSequence;
    const owner = getPartnerCampaignDraftService().getSessionKey();
    const fail = () => {
      if (!this.hidden && !this.disposed && sequence === this.loginSequence &&
        getPartnerCampaignDraftService().getSessionKey() === owner)
        this.setData({ errorMessage: '登录页打开失败，请重试' });
    };
    try { wx.reLaunch({ url: '/pages/bootstrap/index', fail }); } catch { fail(); }
  },

  noop() {},

  onShareAppMessage() {
    if (!this.canPromote()) {
      return { title: '线下课程拼团', path: '/pages/bootstrap/index' };
    }
    const campaign = this.data.campaign;
    return {
      title: campaign?.title ?? '线下课程拼团',
      path: groupPromotionRecipientPath(this.data.campaignId),
      ...(this.data.posterPath || campaign?.posterImages[0]
        ? {
            imageUrl:
              this.data.posterPath || campaign?.posterImages[0].accessUrl,
          }
        : {}),
    };
  },
});
