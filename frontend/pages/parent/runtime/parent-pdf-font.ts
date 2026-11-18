import { PARENT_PDF_DISPLAY_FONT_SOURCE } from '../assets/fonts/pdf-display-font';

export async function loadParentPdfDisplayFont(
  api: { loadFontFace?: (options: WechatMiniprogram.LoadFontFaceOption) => unknown } =
    typeof wx === 'undefined' ? {} : wx,
): Promise<boolean> {
  if (typeof api.loadFontFace !== 'function') return false;
  return new Promise<boolean>((resolve) => {
    try {
      const result = api.loadFontFace!({
        family: 'ParentPdfDisplay',
        source: `url("${PARENT_PDF_DISPLAY_FONT_SOURCE}")`,
        global: false,
        desc: { style: 'normal', weight: 'normal' },
        scopes: ['webview'],
        success: () => resolve(true),
        fail: () => resolve(false),
      });
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).then(() => resolve(true), () => resolve(false));
      }
    } catch { resolve(false); }
  });
}
