import { ensureParentDisplayFont } from './utils/parent-font';

App({
  onLaunch() {
    void ensureParentDisplayFont();
  },
  onShow() {
    void ensureParentDisplayFont();
  },
});
