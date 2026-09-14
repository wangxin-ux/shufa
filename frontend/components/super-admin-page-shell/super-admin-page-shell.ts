import { navigateSuperAdminBack } from '../../utils/super-admin-navigation';

Component({
  properties: {
    markTitle: { type: String, value: '' },
    markIcon: { type: String, value: '' },
    showBack: { type: Boolean, value: false },
    surfacePage: { type: Boolean, value: false },
    plainMark: { type: Boolean, value: false },
    fallbackUrl: { type: String, value: '/pages/super-admin/home/index' },
  },
  data: { headerTopPx: 0, headerHeightPx: 88, headerRightPx: 16 },
  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo();
      let headerTopPx = (windowInfo.statusBarHeight ?? 20) + 8;
      let headerHeightPx = 52;
      let headerRightPx = 16;
      try {
        const capsule = wx.getMenuButtonBoundingClientRect();
        if (capsule.height > 0) {
          headerTopPx = capsule.top;
          headerHeightPx = capsule.height + 16;
          headerRightPx = windowInfo.windowWidth - capsule.left + 8;
        }
      } catch {
        // The status bar estimate keeps direct-open pages usable.
      }
      this.setData({ headerTopPx, headerHeightPx, headerRightPx });
    },
  },
  methods: {
    onBackTap() {
      navigateSuperAdminBack(
        {
          navigateBack: (options) => wx.navigateBack(options),
          reLaunch: (options) => wx.reLaunch(options),
        },
        getCurrentPages().length,
        this.data.fallbackUrl,
      );
    },
  },
});
