import {
  buildParentProfilePageModel,
  formatUnreadMessageBadge,
  ParentProfileAction,
  resolveParentProfileAction,
} from '../../../services/parent-profile.presenter';
import { ParentPageLoader } from '../../../services/parent-page-loader';
import { parentService } from '../../../services/parent-runtime';

const profileLoader = new ParentPageLoader(() => parentService.loadProfile());
const PROFILE_ACTIONS: Array<{
  key: ParentProfileAction;
  label: string;
  commandLabel: string;
}> = [
  { key: 'student', label: '学员资料', commandLabel: '查看' },
  { key: 'messages', label: '消息通知', commandLabel: '查看' },
  { key: 'hours', label: '课时记录', commandLabel: '查看' },
  { key: 'groups', label: '我的拼团', commandLabel: '查看' },
];

Page({
  data: {
    viewState: 'loading',
    errorMessage: '',
    isEmpty: true,
    studentName: '',
    studentAgeLabel: '',
    unreadMessageCount: 0,
    unreadBadge: '',
    emptyMessage: '',
    actions: PROFILE_ACTIONS,
  },

  onLoad() {
    void this.loadProfile();
  },

  onPullDownRefresh() {
    void this.loadProfile().finally(() => wx.stopPullDownRefresh());
  },

  async loadProfile() {
    this.setData({ viewState: 'loading', errorMessage: '' });
    const snapshot = await profileLoader.load();

    if (snapshot.status === 'ready' || snapshot.status === 'empty') {
      const model = buildParentProfilePageModel(snapshot.data);
      this.setData({
        ...model,
        unreadBadge: formatUnreadMessageBadge(model.unreadMessageCount),
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
    void this.loadProfile();
  },

  onActionTap(e: WechatMiniprogram.TouchEvent) {
    const action = e.currentTarget.dataset.action as ParentProfileAction;
    if (!PROFILE_ACTIONS.some((item) => item.key === action)) {
      return;
    }

    const result = resolveParentProfileAction(action);
    if (result.kind === 'navigate') {
      wx.navigateTo({ url: result.url });
      return;
    }
    wx.showToast({ title: result.title, icon: 'none' });
  },
});
