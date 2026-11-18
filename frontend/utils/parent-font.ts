import { PARENT_DISPLAY_FONT_SOURCE } from '../assets/fonts/parent-display-font';

type LoadFontFace = (
  options: WechatMiniprogram.LoadFontFaceOption,
) => PromiseLike<unknown> | unknown;

export interface ParentFontApi {
  loadFontFace?: LoadFontFace;
}

export interface ParentFontLoadOptions {
  retryDelaysMs?: readonly number[];
  timeoutMs?: number;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [0, 300, 1000, 3000, 10000];
const DEFAULT_TIMEOUT_MS = 8000;

function getRuntimeFontApi(): ParentFontApi {
  if (typeof wx === 'undefined' || typeof wx.loadFontFace !== 'function') {
    return {};
  }
  return {
    loadFontFace: (options) => wx.loadFontFace(options),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function attemptLoad(
  fontApi: ParentFontApi,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const loadFontFace = fontApi.loadFontFace;
    if (!loadFontFace) {
      resolve(false);
      return;
    }
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(ok);
    };
    timer = setTimeout(() => settle(false), timeoutMs);
    try {
      const result = loadFontFace({
        family: 'ParentDisplay',
        source: `url("${PARENT_DISPLAY_FONT_SOURCE}")`,
        global: true,
        desc: {
          style: 'normal',
          weight: 'normal',
        },
        scopes: ['webview'],
        success: () => settle(true),
        fail: () => settle(false),
      });
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        (result as PromiseLike<unknown>).then(
          () => settle(true),
          () => settle(false),
        );
      }
    } catch {
      settle(false);
    }
  });
}

export async function loadParentDisplayFont(
  fontApi: ParentFontApi = getRuntimeFontApi(),
  options: ParentFontLoadOptions = {},
): Promise<boolean> {
  if (!fontApi.loadFontFace) {
    return false;
  }
  const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  for (const delay of delays) {
    if (delay > 0) {
      await sleep(delay);
    }
    if (await attemptLoad(fontApi, timeoutMs)) {
      return true;
    }
  }
  return false;
}

let ensured: Promise<boolean> | undefined;

export function ensureParentDisplayFont(
  fontApi: ParentFontApi = getRuntimeFontApi(),
): Promise<boolean> {
  if (!ensured) {
    ensured = loadParentDisplayFont(fontApi).then((ok) => {
      if (!ok) {
        ensured = undefined;
      }
      return ok;
    });
  }
  return ensured;
}
