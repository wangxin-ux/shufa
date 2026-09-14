import * as fs from 'fs';
import * as path from 'path';

function pngSize(filePath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(filePath);
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('partner PSD assets', () => {
  const sharedAssetDir = path.resolve(__dirname, '../assets/partner');
  const packageAssetDir = path.resolve(__dirname, '../pages/partner/assets');

  it('exports a complete tall character and dedicated glass crop', () => {
    const character = path.join(packageAssetDir, 'home-character.png');
    const glass = path.join(sharedAssetDir, 'home-stat-glass.png');
    expect(fs.existsSync(character)).toBe(true);
    expect(fs.existsSync(glass)).toBe(true);
    const size = pngSize(character);
    expect(size.width).toBeGreaterThanOrEqual(600);
    expect(size.height).toBeGreaterThan(size.width);
    expect(pngSize(glass).width).toBeGreaterThanOrEqual(600);
  });

  it('exports the home mark and four PSD shortcut icons under budget', () => {
    for (const name of [
      'home-mark.png',
      'home-mark-glyph.png',
      'icon-warnings.png',
      'icon-attendance.png',
      'icon-teachers.png',
      'icon-students.png',
    ]) {
      const filePath = path.join(packageAssetDir, name);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(512);
      expect(fs.statSync(filePath).size).toBeLessThanOrEqual(500 * 1024);
    }
  });

  it('exports transparent glyphs and uses teacher mark geometry throughout', () => {
    for (const name of [
      'home-mark-glyph.png',
      'lesson-account-mark-glyph.png',
      'profile-mark-glyph.png',
    ]) {
      const filePath = path.join(packageAssetDir, name);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(256);
      expect(fs.statSync(filePath).size).toBeLessThanOrEqual(500 * 1024);
    }

    const root = path.resolve(__dirname, '..');
    const script = fs.readFileSync(
      path.join(root, 'scripts/extract-partner-assets.py'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'components/partner-page-shell/partner-page-shell.wxss'),
      'utf8',
    );
    const home = fs.readFileSync(
      path.join(root, 'pages/partner/home/index.wxml'),
      'utf8',
    );
    const lessonAccount = fs.readFileSync(
      path.join(root, 'pages/partner/lesson-account/index.wxml'),
      'utf8',
    );
    const profile = fs.readFileSync(
      path.join(root, 'pages/partner/profile/index.wxml'),
      'utf8',
    );

    expect(script).toContain('build_mark_glyph');
    expect(styles).toMatch(/\.shell__mark\s*{[^}]*width:\s*var\(--role-page-mark-size\)[^}]*min-width:\s*var\(--role-page-mark-size\)[^}]*height:\s*var\(--role-page-mark-size\)/s);
    expect(styles).toMatch(/\.shell__mark-icon--glyph\s*{[^}]*width:\s*var\(--role-page-mark-icon-size\)[^}]*height:\s*var\(--role-page-mark-icon-size\)/s);
    expect(styles).toMatch(/\.shell__mark-title\s*{[^}]*font-size:\s*var\(--role-page-mark-title-font-size\)/s);
    expect(home).toContain('/pages/partner/assets/home-mark-glyph.png');
    expect(lessonAccount).toContain('/pages/partner/assets/lesson-account-mark-glyph.png');
    expect(profile).toContain('/pages/partner/assets/profile-mark-glyph.png');
    expect(profile).toContain('plainMark="{{true}}"');
    for (const source of [home, lessonAccount, profile]) {
      expect(source).not.toContain('markIconHasDisc="{{true}}"');
      expect(source).not.toContain('markIconOffsetY=');
    }
  });

  it('pins the source PSD and never selects the independent logo group', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../scripts/extract-partner-assets.py'),
      'utf8',
    );
    expect(script).toContain('46_200_283');
    expect(script).toContain('图层 20');
    expect(script).toContain('sha256');
    expect(script).not.toMatch(/select_layer\([^)]*["']logo["']/s);
  });
});
