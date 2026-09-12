import { navigateTeacherBack } from '../../utils/teacher-navigation';

Component({
  options: { multipleSlots: true },
  properties: {
    markTitle: { type: String, value: '' },
    markIcon: { type: String, value: '' },
    showBack: { type: Boolean, value: false },
    fixedHeader: { type: Boolean, value: false },
    plainMark: { type: Boolean, value: false },
    tone: { type: String, value: 'yellow' },
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
      navigateTeacherBack(
        {
          navigateBack: (options) => wx.navigateBack(options),
          reLaunch: (options) => wx.reLaunch(options),
        },
        getCurrentPages().length,
      );
    },
  },
});
