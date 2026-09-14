import { PARENT_DISPLAY_FONT_SOURCE } from '../assets/fonts/parent-display-font';

type LoadFontFace = (
  options: WechatMiniprogram.LoadFontFaceOption,
) => PromiseLike<unknown> | unknown;

export interface ParentFontApi {
  loadFontFace?: LoadFontFace;
}

function getRuntimeFontApi(): ParentFontApi {
  if (typeof wx === 'undefined' || typeof wx.loadFontFace !== 'function') {
    return {};
  }
  return {
    loadFontFace: (options) => wx.loadFontFace(options),
  };
}

export async function loadParentDisplayFont(
  fontApi: ParentFontApi = getRuntimeFontApi(),
): Promise<boolean> {
  if (!fontApi.loadFontFace) {
    return false;
  }

  try {
    await Promise.resolve(
      fontApi.loadFontFace({
        family: 'ParentDisplay',
        source: `url("${PARENT_DISPLAY_FONT_SOURCE}")`,
        global: true,
        desc: {
          style: 'normal',
          weight: 'normal',
        },
        scopes: ['webview'],
      }),
    );
    return true;
  } catch {
    return false;
  }
}
