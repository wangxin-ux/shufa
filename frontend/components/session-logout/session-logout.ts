import { sessionService } from '../../services/session.service';

Component({
  methods: {
    onLogoutTap() {
      wx.showModal({
        title: '退出登录',
        content: '确定退出当前账号吗？',
        confirmText: '退出',
        cancelText: '取消',
        success: ({ confirm }) => {
          if (!confirm) {
            return;
          }
          sessionService.logout();
          wx.reLaunch({ url: sessionService.logoutDestination });
        },
      });
    },
  },
});
