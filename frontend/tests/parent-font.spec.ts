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

    await expect(loadParentDisplayFont({ loadFontFace })).resolves.toBe(false);
  });

  it('keeps the system fallback when loadFontFace is unavailable', async () => {
    await expect(loadParentDisplayFont({})).resolves.toBe(false);
  });

  it('ships the OFL Long Zhu Ti subset selected for the parent display face', () => {
    const readme = fs.readFileSync(
      path.join(FRONTEND_ROOT, 'assets', 'fonts', 'README.md'),
      'utf-8',
    );
    const generatedSource = fs.readFileSync(
      path.join(FRONTEND_ROOT, 'assets', 'fonts', 'parent-display-font.ts'),
      'utf-8',
    );

    expect(readme).toContain('Long Zhu Ti');
    expect(readme).toContain('SIL Open Font License 1.1');
    expect(readme).not.toContain('ZCOOL KuaiLe');
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
});
