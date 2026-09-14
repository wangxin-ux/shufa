import { loadParentDisplayFont } from './utils/parent-font';

App({
  onLaunch() {
    void loadParentDisplayFont();
  },
});
