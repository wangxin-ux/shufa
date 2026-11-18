import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const pagesWithOwnLoad = [
  'earnings', 'feedback-detail', 'group-campaigns', 'group-detail', 'home',
  'lesson', 'profile', 'schedule', 'settings', 'student-detail', 'students',
];
const factoryPages = ['feedback', 'ledger', 'records'];

function loader() {
  const file = path.join(root, 'pages/teacher/runtime/teacher-display-font.ts');
  expect(fs.existsSync(file)).toBe(true);
  return require(file).loadTeacherDisplayFont as (
    api: { loadFontFace?: (options: WechatMiniprogram.LoadFontFaceOption) => unknown },
  ) => Promise<boolean>;
}

describe('teacher display font isolation', () => {
  it('loads the licensed face in this page rather than relying on the global face', async () => {
    const loadFontFace = jest.fn((options) => options.success({ status: 'loaded' }));
    expect(await loader()({ loadFontFace })).toBe(true);
    expect(loadFontFace).toHaveBeenCalledWith(expect.objectContaining({
      family: 'TeacherDisplay', global: false,
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

  it('ships the approved PDF face in the teacher subpackage with its full license', () => {
    const directory = path.join(root, 'pages/teacher/assets/fonts');
    const font = require(path.join(directory, 'pdf-display-font.ts'));
    const bytes = fs.readFileSync(path.join(directory, 'pdf-display-subset.woff'));
    expect(bytes.subarray(0, 4).toString()).toBe('wOFF');
    expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
    expect(Buffer.from(font.TEACHER_PDF_DISPLAY_FONT_SOURCE.split(',')[1], 'base64')).toEqual(bytes);
    expect(fs.readFileSync(path.join(directory, 'pdf-OFL.txt'), 'utf8'))
      .toContain('Copyright 2018 The ZCOOL KuaiLe Project Authors');
    expect(fs.readFileSync(path.join(root, 'pages/teacher/runtime/teacher-display-font.ts'), 'utf8'))
      .toContain("from '../assets/fonts/pdf-display-font'");
  });

  it('loads the private face on every teacher page', () => {
    for (const page of pagesWithOwnLoad) {
      const base = path.join(root, 'pages/teacher', page, 'index');
      expect(fs.readFileSync(`${base}.ts`, 'utf8')).toContain('void loadTeacherDisplayFont();');
    }
    for (const page of factoryPages) {
      const base = path.join(root, 'pages/teacher', page, 'index');
      const source = fs.readFileSync(`${base}.ts`, 'utf8');
      expect(source).toContain('createTeacherRecordPage(');
      expect(source).not.toContain('void loadTeacherDisplayFont();');
    }
    expect(fs.readFileSync(path.join(root, 'pages/teacher/runtime/teacher-record-page.ts'), 'utf8'))
      .toContain('void loadTeacherDisplayFont();');
  });

  it('selects the private face through the teacher display token', () => {
    const tokens = fs.readFileSync(path.join(root, 'styles/tokens.wxss'), 'utf8');
    expect(tokens).toContain('--teacher-font-display: "TeacherDisplay", "Microsoft YaHei", sans-serif');
  });
});
