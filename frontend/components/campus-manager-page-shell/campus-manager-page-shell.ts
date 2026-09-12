import { navigateCampusManagerBack } from '../../utils/campus-manager-navigation';

Component({
  options: { multipleSlots: true },
  properties: {
    markTitle: { type: String, value: '' },
    markIcon: { type: String, value: '' },
    markIconHasDisc: { type: Boolean, value: false },
    markIconOffsetY: { type: Number, value: 0 },
    markIconSize: { type: Number, value: 32 },
    showBack: { type: Boolean, value: false },
    surfacePage: { type: Boolean, value: false },
    plainMark: { type: Boolean, value: false },
  },
  data: {
    headerTopPx: 0,
    headerHeightPx: 88,
    headerRightPx: 16,
  },
  lifetimes: {
    attached() {
      const windowInfo = wx.getWindowInfo();
      const statusBarHeight = windowInfo.statusBarHeight ?? 20;
      let headerTopPx = statusBarHeight + 8;
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
      navigateCampusManagerBack(
        {
          navigateBack: (options) => wx.navigateBack(options),
          reLaunch: (options) => wx.reLaunch(options),
        },
        getCurrentPages().length,
      );
    },
  },
});
