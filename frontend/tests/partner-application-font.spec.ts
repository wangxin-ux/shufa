import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { loadApplicationDisplayFont } from '../pages/partner/runtime/partner-application-font';

describe('private licensed institution application heading font', () => {
  it('loads an embedded page-scoped font without external requests', async () => {
    const loadFontFace = jest.fn((options) => options.success({}));
    expect(await loadApplicationDisplayFont({ loadFontFace })).toBe(true);
    expect(loadFontFace).toHaveBeenCalledWith(expect.objectContaining({
      family: 'PartnerApplicationDisplay', global: false,
      source: expect.stringMatching(/^url\("data:font\/woff;base64,/),
    }));
  });
  it('keeps the system fallback when the native font loader rejects', async () => {
    expect(await loadApplicationDisplayFont({ loadFontFace: () => { throw new Error('unsupported'); } })).toBe(false);
    expect(await loadApplicationDisplayFont({})).toBe(false);
  });
  it('waits for the native success callback rather than claiming an undefined return succeeded', async () => {
    let options: WechatMiniprogram.LoadFontFaceOption | undefined;
    let settled = false;
    const pending = loadApplicationDisplayFont({ loadFontFace: (input) => { options = input; } });
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    options!.success!({ status: 'loaded' });
    expect(await pending).toBe(true);
  });
  it('reports a native failure callback as fallback, not a loaded font', async () => {
    let options: WechatMiniprogram.LoadFontFaceOption | undefined;
    const pending = loadApplicationDisplayFont({ loadFontFace: (input) => { options = input; } });
    await Promise.resolve();
    options!.fail?.({ status: 'error' });
    expect(await pending).toBe(false);
  });
  it('retains the existing per-font limit and counts private fonts in the asset budget', () => {
    const root = path.resolve(__dirname, '..');
    const file = path.join(root, 'pages/partner/assets/fonts/application-display-subset.woff');
    expect(fs.statSync(file).size).toBeLessThanOrEqual(128 * 1024);
    // Keep this list in step with IMAGE_DIRS/FONT_DIR in
    // scripts/check-asset-budget.mjs — the operator role owns a page asset
    // directory without a matching top-level assets/ folder.
    const topLevel = ['parent', 'teacher', 'campus-manager', 'super-admin', 'partner'];
    const pages = ['parent', 'teacher', 'campus-manager', 'operator', 'super-admin', 'partner'];
    const directories = [
      ...topLevel.map((role) => path.join(root, 'assets', role)),
      ...pages.map((role) => path.join(root, 'pages', role, 'assets')),
      path.join(root, 'assets/fonts'),
      ...['finance', 'hr'].map((role) => path.join(root, 'pages', role)),
    ];
    const extensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2', '.ttf', '.otf']);
    const size = (directory: string): number => fs.readdirSync(directory, { withFileTypes: true })
      .reduce((sum, entry) => {
        const file = path.join(directory, entry.name);
        return sum + (entry.isDirectory() ? size(file) :
          extensions.has(path.extname(entry.name).toLowerCase()) ? fs.statSync(file).size : 0);
      }, 0);
    const total = directories.reduce((sum, directory) => sum + size(directory), 0);
    const output = execFileSync(process.execPath, [path.join(root, 'scripts/check-asset-budget.mjs')], { encoding: 'utf8' });
    expect(output).toContain(`assets total: ${(total / 1024).toFixed(1)} KB`);
  });
});
