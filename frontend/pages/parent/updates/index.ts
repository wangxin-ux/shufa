import { ParentPageLoader } from '../../../services/parent-page-loader';
import { parentService } from '../../../services/parent-runtime';
import { buildParentUpdatesPageModel } from '../../../services/parent-updates.presenter';

const updatesLoader = new ParentPageLoader(() => parentService.loadUpdates());

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    records: [] as ReturnType<typeof buildParentUpdatesPageModel>['records'],
    isEmpty: true,
  },

  onLoad() {
    void this.loadUpdates();
  },

  onPullDownRefresh() {
    void this.loadUpdates().finally(() => wx.stopPullDownRefresh());
  },

  async loadUpdates() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await updatesLoader.load();
    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
      this.setData({
        ...buildParentUpdatesPageModel(snapshot.data),
        viewState: 'ready',
        errorMessage: '',
      });
      return;
    }
    if (snapshot.status === 'error') {
      this.setData({ viewState: 'error', errorMessage: snapshot.message });
    }
  },

  onRetry() {
    void this.loadUpdates();
  },

  onPreviewImages(event: WechatMiniprogram.TouchEvent) {
    const lessonSessionId = String(event.currentTarget.dataset.id ?? '');
    const current = String(event.currentTarget.dataset.url ?? '');
    const record = this.data.records.find(
      (item) => item.lessonSessionId === lessonSessionId,
    );
    if (!record || !current) {
      return;
    }
    wx.previewImage({
      current,
      urls: record.feedbackImages.map(({ accessUrl }) => accessUrl),
    });
  },
});
