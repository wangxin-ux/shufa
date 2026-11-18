import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const pages = [
  'home', 'students', 'student-detail', 'warnings', 'attendance', 'teachers',
  'profile', 'earnings', 'lesson-account', 'operations', 'group-campaigns',
  'group-detail', 'application', 'login', 'campaign-editor',
];

function loader() {
  const file = path.join(root, 'pages/partner/runtime/partner-pdf-font.ts');
  expect(fs.existsSync(file)).toBe(true);
  return require(file).loadPartnerPdfDisplayFont as (
    api: { loadFontFace?: (options: WechatMiniprogram.LoadFontFaceOption) => unknown },
  ) => Promise<boolean>;
}

describe('partner PDF font isolation', () => {
  it('loads a page-scoped face with no network or parent-subpackage dependency', async () => {
    const loadFontFace = jest.fn((options) => options.success({ status: 'loaded' }));
    expect(await loader()({ loadFontFace })).toBe(true);
    expect(loadFontFace).toHaveBeenCalledWith(expect.objectContaining({
      family: 'PartnerPdfDisplay', global: false,
      source: expect.stringMatching(/^url\("data:font\/woff;base64,/),
      scopes: ['webview'],
    }));
  });

  it('waits for the native callback and preserves fallback on failure', async () => {
    let options!: WechatMiniprogram.LoadFontFaceOption;
    let settled = false;
    const pending = loader()({ loadFontFace: (value) => { options = value; } });
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    options.fail!({ status: 'error' });
    expect(await pending).toBe(false);
  });

  it('supports promise completion, missing support and synchronous exceptions', async () => {
    const load = loader();
    expect(await load({ loadFontFace: () => Promise.resolve({}) })).toBe(true);
    expect(await load({ loadFontFace: () => Promise.reject(new Error('unsupported')) })).toBe(false);
    expect(await load({ loadFontFace: () => { throw new Error('unsupported'); } })).toBe(false);
    expect(await load({})).toBe(false);
  });

  it('ships the exact licensed WOFF and includes the application heading in the larger corpus', () => {
    const directory = path.join(root, 'pages/partner/assets/fonts');
    expect(fs.existsSync(path.join(directory, 'pdf-display-font.ts'))).toBe(true);
    const font = require(path.join(directory, 'pdf-display-font.ts'));
    const bytes = fs.readFileSync(path.join(directory, 'pdf-display-subset.woff'));
    expect(bytes.subarray(0, 4).toString()).toBe('wOFF');
    expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
    expect(Buffer.from(font.PARTNER_PDF_DISPLAY_FONT_SOURCE.split(',')[1], 'base64')).toEqual(bytes);
    for (const character of '申请入驻合作方课时账户收益学员教师校区月榜排名上升下降持平截至') {
      expect(font.PARTNER_PDF_DISPLAY_FONT_CHARACTERS).toContain(character);
    }
    expect(fs.readFileSync(path.join(directory, 'pdf-OFL.txt'), 'utf8')).toContain('Copyright 2018 The ZCOOL KuaiLe Project Authors');
    expect(fs.readFileSync(path.join(directory, 'OFL.txt'), 'utf8')).toContain('Long Zhu Ti Project Authors');
  });

  it('covers current dynamic Chinese in the partner fixtures and seed', () => {
    const source = path.join(root, 'pages/partner/assets/fonts/pdf-display-font.ts');
    expect(fs.existsSync(source)).toBe(true);
    const corpus = require(source).PARTNER_PDF_DISPLAY_FONT_CHARACTERS as string;
    const fixtures = path.resolve(root, '../docs/verification/fixtures');
    const files = fs.readdirSync(fixtures).filter((name) => /^partner-.*\.json$/.test(name))
      .map((name) => path.join(fixtures, name));
    const mock = path.join(root, 'mock/fixtures');
    files.push(...fs.readdirSync(mock).filter((name) => name.startsWith('partner') && name.endsWith('.ts'))
      .map((name) => path.join(mock, name)));
    files.push(path.resolve(root, '../backend/prisma/seed.ts'));
    files.push(
      path.join(root, 'pages/partner/campaign-editor/index.ts'),
      path.join(root, 'pages/partner/campaign-editor/index.wxml'),
      path.join(root, 'pages/partner/runtime/campaign-image.ts'),
    );
    const required = new Set(files.flatMap((file) => [...fs.readFileSync(file, 'utf8')]
      .filter((character) => /[\u3400-\u9fff]/.test(character))));
    expect([...required].filter((character) => !corpus.includes(character))).toEqual([]);
  });

  it('selects the isolated font on the partner pages without changing other roles', () => {
    for (const page of pages) {
      const base = path.join(root, 'pages/partner', page, 'index');
      expect(fs.readFileSync(`${base}.ts`, 'utf8')).toContain('void loadPartnerPdfDisplayFont();');
      expect(fs.readFileSync(`${base}.wxss`, 'utf8').includes('@import "../styles/pdf-typography.wxss";')).toBe(true);
    }
    const file = path.join(root, 'pages/partner/styles/pdf-typography.wxss');
    expect(fs.existsSync(file.replace(/\.wxss$/, '.ts'))).toBe(false);
    const css = fs.readFileSync(file, 'utf8');
    expect(css).toContain('--partner-font-display: "PartnerPdfDisplay"');
    expect(css).not.toContain('"ParentDisplay"');
    expect(css).toMatch(/session-logout\s*\{\s*--parent-font-display:\s*var\(--partner-font-display\)/);
    expect(fs.readFileSync(path.join(root, 'pages/partner/application/index.ts'), 'utf8')).not.toContain('loadApplicationDisplayFont');
    expect(fs.readFileSync(path.join(root, 'pages/partner/application/index.wxss'), 'utf8')).not.toContain('PartnerApplicationDisplay');
    expect(fs.readFileSync(path.join(root, 'styles/tokens.wxss'), 'utf8')).not.toContain('PartnerPdfDisplay');
  });
});
