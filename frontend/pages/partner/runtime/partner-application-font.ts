import { APPLICATION_DISPLAY_FONT_SOURCE } from '../assets/fonts/application-display-font';

export async function loadApplicationDisplayFont(
  api: { loadFontFace?: (options: WechatMiniprogram.LoadFontFaceOption) => unknown } =
    typeof wx === 'undefined' ? {} : wx,
): Promise<boolean> {
  if (typeof api.loadFontFace !== 'function') return false;
  return new Promise<boolean>((resolve) => {
    try {
      api.loadFontFace!({
        family: 'PartnerApplicationDisplay',
        source: `url("${APPLICATION_DISPLAY_FONT_SOURCE}")`,
        global: false,
        desc: { style: 'normal', weight: 'normal' },
        scopes: ['webview'],
        success: () => resolve(true),
        fail: () => resolve(false),
      });
    } catch { resolve(false); }
  });
}
