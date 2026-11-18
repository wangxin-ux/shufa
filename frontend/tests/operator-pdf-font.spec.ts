import * as fs from 'node:fs';
import * as path from 'node:path';
import { capture, fixture, flush } from './operator-page-host';

const root = path.resolve(__dirname, '..');
const role = path.join(root, 'pages/operator');
type FontApi = { loadFontFace?: (options: WechatMiniprogram.LoadFontFaceOption) => unknown };

function loader() {
  const file = path.join(role, 'runtime/operator-pdf-font.ts');
  expect(fs.existsSync(file)).toBe(true);
  return require(file).loadOperatorPdfDisplayFont as (api: FontApi) => Promise<boolean>;
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'fonts' || entry.name === 'node_modules') return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

describe('operator homepage font candidate', () => {
  it('loads the role-owned embedded face in the current page only', async () => {
    const loadFontFace = jest.fn((options) => options.success({ status: 'loaded' }));
    expect(await loader()({ loadFontFace })).toBe(true);
    expect(loadFontFace).toHaveBeenCalledWith(expect.objectContaining({
      family: 'OperatorPdfDisplay', global: false,
      source: expect.stringMatching(/^url\("data:font\/woff;base64,/),
      desc: { style: 'normal', weight: 'normal' }, scopes: ['webview'],
    }));
  });

  it('waits for native completion and reports failure without throwing', async () => {
    let options!: WechatMiniprogram.LoadFontFaceOption;
    let settled = false;
    const pending = loader()({ loadFontFace: (value) => { options = value; } });
    void pending.then(() => { settled = true; });
    await flush();
    expect(settled).toBe(false);
    options.fail!({ status: 'error' });
    expect(await pending).toBe(false);
  });

  it('supports promise completion, rejection, missing support and synchronous errors', async () => {
    const load = loader();
    expect(await load({ loadFontFace: () => Promise.resolve({}) })).toBe(true);
    expect(await load({ loadFontFace: () => Promise.reject(new Error('unsupported')) })).toBe(false);
    expect(await load({ loadFontFace: () => { throw new Error('unsupported'); } })).toBe(false);
    expect(await load({})).toBe(false);
  });

  it('ships the licensed WOFF matching its embedded source within the existing font limit', () => {
    const directory = path.join(role, 'assets/fonts');
    const font = require(path.join(directory, 'pdf-display-font.ts'));
    const bytes = fs.readFileSync(path.join(directory, 'pdf-display-subset.woff'));
    expect(bytes.subarray(0, 4).toString()).toBe('wOFF');
    expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
    expect(Buffer.from(font.OPERATOR_PDF_DISPLAY_FONT_SOURCE.split(',')[1], 'base64')).toEqual(bytes);
    expect(fs.readFileSync(path.join(directory, 'pdf-OFL.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe(
      fs.readFileSync(path.resolve(root, '../.tools-automation/ZCOOLKuaiLe-OFL.txt'), 'utf8').replace(/\r\n/g, '\n'),
    );
  });

  it('covers current static and dynamic Chinese from this role, fixtures and seed', () => {
    const font = require(path.join(role, 'assets/fonts/pdf-display-font.ts'));
    const corpus = font.OPERATOR_PDF_DISPLAY_FONT_CHARACTERS as string;
    const files = sourceFiles(role).filter((file) => /\.(ts|wxml)$/.test(file));
    for (const directory of ['components', 'services', 'data', 'types', 'utils', 'mock/fixtures']) {
      files.push(...sourceFiles(path.join(root, directory)).filter((file) =>
        path.basename(file).startsWith('operator') && /\.(ts|wxml)$/.test(file)));
    }
    files.push(...sourceFiles(path.resolve(root, '../docs/verification/fixtures')).filter((file) =>
      /^operator-.*\.json$/.test(path.basename(file))));
    files.push(path.resolve(root, '../backend/prisma/seed.ts'));
    const required = new Set(files.flatMap((file) => [...fs.readFileSync(file, 'utf8')]
      .filter((character) => /[\u3400-\u9fff]/.test(character))));
    expect([...required].filter((character) => !corpus.includes(character))).toEqual([]);
    for (const character of '0123456789待处理请假审批事项已处理启明东校区周园长陈晨') {
      expect(corpus).toContain(character);
    }
  });

  it('loads the PDF face on home and on directly opened role pages through the shell', () => {
    const file = path.join(role, 'runtime/operator-pdf-font.wxss');
    expect(fs.existsSync(file)).toBe(true);
    const css = fs.readFileSync(file, 'utf8');
    expect(css).toMatch(/page\s*\{[^}]*--operator-font-display:\s*"OperatorPdfDisplay",\s*var\(--parent-font-display\)/s);
    expect(css).not.toMatch(/font-size|font-weight|line-height|font-body/);
    expect(fs.readFileSync(path.join(role, 'home/index.wxss'), 'utf8'))
      .toContain('@import "../runtime/operator-pdf-font.wxss";');
    const consumers = sourceFiles(role).filter((entry) => /index\.(ts|wxss)$/.test(entry))
      .filter((entry) => fs.readFileSync(entry, 'utf8').includes('operator-pdf-font'))
      .map((entry) => path.relative(role, entry).replace(/\\/g, '/')).sort();
    expect(consumers).toEqual(['home/index.ts', 'home/index.wxss', 'schedule-editor/index.ts']);
    const shell = fs.readFileSync(path.join(role, 'runtime/components/operator-page-shell/operator-page-shell.ts'), 'utf8');
    expect(shell).toContain('void loadOperatorPdfDisplayFont();');
    expect(fs.readFileSync(path.join(role, 'runtime/operator-tokens.wxss'), 'utf8'))
      .toContain('--operator-font-display: "OperatorPdfDisplay", var(--parent-font-display)');
    expect(fs.readFileSync(path.join(root, 'styles/tokens.wxss'), 'utf8')).not.toContain('OperatorPdfDisplay');
    expect(fs.readFileSync(path.join(root, 'app.ts'), 'utf8')).not.toContain('operator-pdf-font');
  });

  it('reads home without waiting for the font and keeps its content on native failure', async () => {
    const env = capture();
    let options!: WechatMiniprogram.LoadFontFaceOption;
    const loadFontFace = jest.fn((value: WechatMiniprogram.LoadFontFaceOption) => { options = value; });
    Object.assign(env.platform, { loadFontFace });
    try {
      const page = env.instantiate();
      page.onLoad(); page.onShow(); await flush();
      expect(loadFontFace).toHaveBeenCalledTimes(1);
      expect(env.calls).toHaveLength(1);
      env.reply(0, { data: fixture.dashboard }); await flush();
      expect(page.data).toMatchObject({ viewState: 'ready', pendingCount: '2' });
      const data = structuredClone(page.data);
      const writes = page.setData.mock.calls.length;
      options.fail!({ status: 'error' }); await flush();
      expect(page.data).toEqual(data);
      expect(page.setData).toHaveBeenCalledTimes(writes);
      page.onMenuToggle();
      expect(page.data.menuExpanded).toBe(true);
    } finally { env.close(); }
  });

  it.each(['hide', 'unload', 'owner'] as const)(
    'does not write home when font success arrives after %s',
    async (change) => {
      const env = capture();
      let options!: WechatMiniprogram.LoadFontFaceOption;
      Object.assign(env.platform, { loadFontFace: jest.fn((value) => { options = value; }) });
      try {
        const page = env.instantiate();
        page.onLoad(); page.onShow(); await flush();
        expect(options).toBeDefined();
        env.reply(0, { data: fixture.dashboard }); await flush();
        if (change === 'hide') page.onHide();
        else if (change === 'unload') page.onUnload();
        else env.change({ accessToken: 'synthetic-new-font-owner' });
        const writes = page.setData.mock.calls.length;
        options.success!({ status: 'loaded' }); await flush();
        expect(page.setData).toHaveBeenCalledTimes(writes);
        if (change === 'hide') {
          page.onShow(); await flush();
          env.reply(1, { data: { ...fixture.dashboard, pendingLeaveCount: 0, latestPendingLeave: null } });
          await flush();
          expect(page.data.pendingCount).toBe('0');
        } else if (change === 'owner') {
          page.onShow(); await flush();
          expect(page.data).toMatchObject({ viewState: 'forbidden', campusName: '', stats: [] });
        }
      } finally { env.close(); }
    },
  );
});
