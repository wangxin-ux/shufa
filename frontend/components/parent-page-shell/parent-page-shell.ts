import { navigateParentBack } from '../../utils/parent-navigation';

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    markTitle: { type: String, value: '' },
    markIcon: { type: String, value: '' },
    bg: { type: String, value: 'yellow' },
    showWave: { type: Boolean, value: true },
    backgroundColor: { type: String, value: '' },
    showBack: { type: Boolean, value: false },
    fixedHeader: { type: Boolean, value: false },
  },
  data: {
    headerTopPx: 0,
    headerHeightPx: 88,
    headerRightPx: 16,
  },
  lifetimes: {
    attached() {
      // 顶部安全区：状态栏高度 + 胶囊位置，不写死具体机型；
      // 右侧预留胶囊宽度，避免页头内容与胶囊重叠。
      const win = wx.getWindowInfo();
      const statusBar = win.statusBarHeight ?? 20;
      let headerTop = statusBar + 8;
      let headerHeight = 52;
      let headerRight = 16;
      try {
        const capsule = wx.getMenuButtonBoundingClientRect();
        if (capsule && capsule.height > 0) {
          headerTop = capsule.top;
          headerHeight = capsule.bottom - capsule.top + 16;
          headerRight = win.windowWidth - capsule.left + 8;
        }
      } catch {
        // 胶囊信息不可用时退回状态栏估算
      }
      this.setData({
        headerTopPx: headerTop,
        headerHeightPx: headerHeight,
        headerRightPx: headerRight,
      });
    },
  },
  methods: {
    onBackTap() {
      navigateParentBack(
        {
          navigateBack: (options) => wx.navigateBack(options),
          reLaunch: (options) => wx.reLaunch(options),
        },
        getCurrentPages().length,
      );
    },
  },
});
