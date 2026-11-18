import * as fs from 'fs';
import * as path from 'path';
import { PARENT_DISPLAY_FONT_CHARACTERS } from '../assets/fonts/parent-display-font';
import { loadParentDisplayFont } from '../utils/parent-font';

const FRONTEND_ROOT = path.resolve(__dirname, '..');

describe('parent display font loader', () => {
  it('loads the embedded font globally through a Data URL', async () => {
    const loadFontFace = jest.fn().mockResolvedValue({ status: 'loaded' });

    await expect(loadParentDisplayFont({ loadFontFace })).resolves.toBe(true);

    expect(loadFontFace).toHaveBeenCalledTimes(1);
    expect(loadFontFace).toHaveBeenCalledWith(
      expect.objectContaining({
        family: 'ParentDisplay',
        global: true,
        source: expect.stringMatching(/^url\("data:font\/woff;base64,/),
      }),
    );
  });

  it('keeps the system fallback when the runtime rejects the font', async () => {
    const loadFontFace = jest.fn().mockRejectedValue(new Error('unsupported'));

    await expect(
      loadParentDisplayFont({ loadFontFace }, { retryDelaysMs: [0, 0] }),
    ).resolves.toBe(false);
    expect(loadFontFace).toHaveBeenCalledTimes(2);
  });

  it('retries after a transient failure and then succeeds', async () => {
    const loadFontFace = jest.fn()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce({ status: 'loaded' });

    await expect(
      loadParentDisplayFont({ loadFontFace }, { retryDelaysMs: [0, 0] }),
    ).resolves.toBe(true);
    expect(loadFontFace).toHaveBeenCalledTimes(2);
  });

  it('times out a hung attempt and retries with callbacks', async () => {
    const loadFontFace = jest.fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce((options: { success?: () => void }) => {
        options.success?.();
        return undefined;
      });

    await expect(
      loadParentDisplayFont(
        { loadFontFace },
        { retryDelaysMs: [0, 0], timeoutMs: 20 },
      ),
    ).resolves.toBe(true);
    expect(loadFontFace).toHaveBeenCalledTimes(2);
  });

  it('keeps the system fallback when loadFontFace is unavailable', async () => {
    await expect(loadParentDisplayFont({})).resolves.toBe(false);
  });

  it('ships the OFL Long Zhu Ti subset selected for the parent display face', () => {
    const readme = fs.readFileSync(
      path.join(FRONTEND_ROOT, '..', 'README.md'),
      'utf-8',
    );
    const generatedSource = fs.readFileSync(
      path.join(FRONTEND_ROOT, 'assets', 'fonts', 'parent-display-font.ts'),
      'utf-8',
    );

    expect(readme).toContain('Long Zhu Ti');
    expect(readme).toContain('SIL Open Font License 1.1');
    expect(generatedSource).not.toContain('Source font: ZCOOL KuaiLe');
    expect(generatedSource).toContain('Source font: Long Zhu Ti');
  });

  it('includes current dynamic names in the display-font subset', () => {
    for (const character of '陈晨安然林老师王老师朱元璋一诺启明东校区合作方') {
      expect(PARENT_DISPLAY_FONT_CHARACTERS).toContain(character);
    }
  });

  it('includes the finance receipt workspace display labels', () => {
    for (const character of '财务收款登记赠送课包凭证长期有效确认发放') {
      expect(PARENT_DISPLAY_FONT_CHARACTERS).toContain(character);
    }
  });

  it('includes compact parent hours summaries in the existing display subset', () => {
    for (const character of '课时发放扣除撤销调整退费纠错变动待核对月日') {
      expect(PARENT_DISPLAY_FONT_CHARACTERS).toContain(character);
    }
  });

  it('covers the first-time profile heading and native field labels', () => {
    for (const character of '完善资料孩子姓名出生日期照片保存选择上传更换退出登录') {
      expect(PARENT_DISPLAY_FONT_CHARACTERS).toContain(character);
    }
  });

  it('includes PDF course names and keeps the existing per-font budget', () => {
    for (const character of '专业美术硬笔规范字软笔书法演讲与口才第一乐章班型更多优惠活动') {
      expect(PARENT_DISPLAY_FONT_CHARACTERS).toContain(character);
    }
    expect(fs.statSync(path.join(FRONTEND_ROOT, 'assets/fonts/parent-display-subset.woff')).size)
      .toBeLessThanOrEqual(128 * 1024);
  });

  it('covers Chinese characters in the current PDF visual fixtures and seed', () => {
    const fixtureRoot = path.resolve(FRONTEND_ROOT, '../docs/verification/fixtures');
    const files = fs.readdirSync(fixtureRoot)
      .filter((name) => /^parent-.*\.json$/.test(name))
      .map((name) => path.join(fixtureRoot, name));
    files.push(path.resolve(FRONTEND_ROOT, '../backend/prisma/seed.ts'));
    const required = new Set(files.flatMap((file) =>
      Array.from(fs.readFileSync(file, 'utf8')).filter((character) => /[\u3400-\u9fff]/.test(character)),
    ));
    expect([...required].filter((character) => !PARENT_DISPLAY_FONT_CHARACTERS.includes(character))).toEqual([]);
  });
});
