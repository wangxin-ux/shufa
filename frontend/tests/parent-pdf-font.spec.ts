import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const pages = ['home', 'courses', 'hours', 'leave', 'profile', 'updates', 'profile-setup'];

function loader() {
  const file = path.join(root, 'pages/parent/runtime/parent-pdf-font.ts');
  expect(fs.existsSync(file)).toBe(true);
  return require(file).loadParentPdfDisplayFont as (
    api: { loadFontFace?: (options: WechatMiniprogram.LoadFontFaceOption) => unknown },
  ) => Promise<boolean>;
}

describe('parent PDF font isolation', () => {
  it('uses a licensed embedded face in this page rather than replacing the global face', async () => {
    const loadFontFace = jest.fn((options) => options.success({ status: 'loaded' }));
    expect(await loader()({ loadFontFace })).toBe(true);
    expect(loadFontFace).toHaveBeenCalledWith(expect.objectContaining({
      family: 'ParentPdfDisplay', global: false,
      source: expect.stringMatching(/^url\("data:font\/woff;base64,/),
      scopes: ['webview'],
    }));
  });

  it('waits for native success and reports native failure as fallback', async () => {
    let options!: WechatMiniprogram.LoadFontFaceOption;
    let settled = false;
    const pending = loader()({ loadFontFace: (value) => { options = value; } });
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    options.fail!({ status: 'error' });
    expect(await pending).toBe(false);
  });

  it('handles promise runtimes, synchronous failure and missing native support', async () => {
    const load = loader();
    expect(await load({ loadFontFace: () => Promise.resolve({}) })).toBe(true);
    expect(await load({ loadFontFace: () => Promise.reject(new Error('unsupported')) })).toBe(false);
    expect(await load({ loadFontFace: () => { throw new Error('unsupported'); } })).toBe(false);
    expect(await load({})).toBe(false);
  });

  it('ships the exact WOFF represented by the generated source within the existing limit', () => {
    const directory = path.join(root, 'pages/parent/assets/fonts');
    expect(fs.existsSync(path.join(directory, 'pdf-display-font.ts'))).toBe(true);
    const font = require(path.join(directory, 'pdf-display-font.ts'));
    const bytes = fs.readFileSync(path.join(directory, 'pdf-display-subset.woff'));
    expect(bytes.subarray(0, 4).toString()).toBe('wOFF');
    expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
    expect(Buffer.from(font.PARENT_PDF_DISPLAY_FONT_SOURCE.split(',')[1], 'base64')).toEqual(bytes);
    expect(fs.readFileSync(path.join(directory, 'pdf-OFL.txt'), 'utf8')).toContain('Copyright 2018 The ZCOOL KuaiLe Project Authors');
  });

  it('covers current dynamic Chinese in the parent fixtures and seed', () => {
    const source = path.join(root, 'pages/parent/assets/fonts/pdf-display-font.ts');
    expect(fs.existsSync(source)).toBe(true);
    const corpus = require(source).PARENT_PDF_DISPLAY_FONT_CHARACTERS as string;
    const fixtures = path.resolve(root, '../docs/verification/fixtures');
    const files = fs.readdirSync(fixtures).filter((name) => /^parent-.*\.json$/.test(name))
      .map((name) => path.join(fixtures, name));
    const mock = path.join(root, 'mock/fixtures');
    files.push(...fs.readdirSync(mock).filter((name) => name.startsWith('parent') && name.endsWith('.ts'))
      .map((name) => path.join(mock, name)));
    files.push(path.resolve(root, '../backend/prisma/seed.ts'));
    const required = new Set(files.flatMap((file) => [...fs.readFileSync(file, 'utf8')]
      .filter((character) => /[\u3400-\u9fff]/.test(character))));
    expect([...required].filter((character) => !corpus.includes(character))).toEqual([]);
  });

  it('loads and selects the private font on every affected parent page', () => {
    for (const page of pages) {
      const base = path.join(root, 'pages/parent', page, 'index');
      expect(fs.readFileSync(`${base}.ts`, 'utf8')).toContain('void loadParentPdfDisplayFont();');
      expect(fs.readFileSync(`${base}.wxss`, 'utf8').includes('@import "../styles/pdf-typography.wxss";')).toBe(true);
    }
    const file = path.join(root, 'pages/parent/styles/pdf-typography.wxss');
    expect(fs.existsSync(file.replace(/\.wxss$/, '.ts'))).toBe(false);
    const css = fs.readFileSync(file, 'utf8');
    expect(css).toContain('--parent-font-display: "ParentPdfDisplay"');
    expect(css).not.toContain('"ParentDisplay"');
    expect(fs.readFileSync(path.join(root, 'app.ts'), 'utf8')).not.toContain('parent-pdf-font');
    expect(fs.readFileSync(path.join(root, 'styles/tokens.wxss'), 'utf8')).not.toContain('ParentPdfDisplay');
  });
});
