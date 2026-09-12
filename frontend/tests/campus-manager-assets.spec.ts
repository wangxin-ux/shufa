import * as fs from 'fs';
import * as path from 'path';

function pngSize(filePath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(filePath);
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('campus manager PSD assets', () => {
  const sharedAssetDir = path.resolve(__dirname, '../assets/campus-manager');
  const packageAssetDir = path.resolve(
    __dirname,
    '../pages/campus-manager/assets',
  );

  it('exports one complete tall character and a dedicated stat glass layer', () => {
    const character = path.join(packageAssetDir, 'home-character.png');
    const glass = path.join(sharedAssetDir, 'home-stat-glass.png');
    expect(fs.existsSync(character)).toBe(true);
    expect(fs.existsSync(glass)).toBe(true);
    expect(pngSize(character)).toMatchObject({ width: expect.any(Number), height: expect.any(Number) });
    const characterSize = pngSize(character);
    expect(characterSize.width).toBeGreaterThanOrEqual(600);
    expect(characterSize.height).toBeGreaterThan(characterSize.width);
    expect(pngSize(glass).width).toBeGreaterThanOrEqual(600);
    expect(fs.statSync(glass).size).toBeGreaterThan(1024);
  });

  it('exports the PSD home mark and four shortcut icons under the asset budget', () => {
    for (const name of [
      'home-mark.png',
      'home-mark-glyph.png',
      'icon-schedule.png',
      'icon-approvals.png',
      'icon-warnings.png',
      'icon-student-create.png',
    ]) {
      const filePath = path.join(packageAssetDir, name);
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBeLessThanOrEqual(500 * 1024);
      expect(fs.statSync(filePath).size).toBeGreaterThan(1024);
    }
  });

  it('exports transparent mark glyphs for the home and profile headers', () => {
    for (const name of ['home-mark-glyph.png', 'profile-mark-glyph.png']) {
      const glyph = path.join(packageAssetDir, name);
      expect(fs.existsSync(glyph)).toBe(true);
      expect(fs.statSync(glyph).size).toBeGreaterThan(256);
      expect(fs.statSync(glyph).size).toBeLessThanOrEqual(500 * 1024);
    }

    const script = fs.readFileSync(
      path.resolve(__dirname, '../scripts/extract-campus-manager-assets.py'),
      'utf8',
    );
    expect(script).toContain('build_mark_glyph');
  });

  it('never selects the independent PSD logo group for export', () => {
    const script = fs.readFileSync(
      path.resolve(__dirname, '../scripts/extract-campus-manager-assets.py'),
      'utf8',
    );
    expect(script).toContain('图层 20');
    expect(script).toContain('sha256');
    expect(script).not.toMatch(/select_layer\([^)]*["']logo["']/s);
  });

  it('uses the teacher default mark geometry without framed bitmap compensation', () => {
    const root = path.resolve(__dirname, '..');
    const shellDir = path.join(root, 'components/campus-manager-page-shell');
    const markup = fs.readFileSync(
      path.join(shellDir, 'campus-manager-page-shell.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(shellDir, 'campus-manager-page-shell.wxss'),
      'utf8',
    );
    const logic = fs.readFileSync(
      path.join(shellDir, 'campus-manager-page-shell.ts'),
      'utf8',
    );
    const home = fs.readFileSync(
      path.join(root, 'pages/campus-manager/home/index.wxml'),
      'utf8',
    );
    const profile = fs.readFileSync(
      path.join(root, 'pages/campus-manager/profile/index.wxml'),
      'utf8',
    );

    expect(logic).toContain('markIconHasDisc');
    expect(markup).toContain('shell__mark-disc--{{markIconHasDisc ? \'framed\' : \'glyph\'}}');
    expect(markup).toContain('shell__mark-icon--{{markIconHasDisc ? \'framed\' : \'glyph\'}}');
    expect(styles).toMatch(/\.shell__mark\s*{[^}]*width:\s*var\(--role-page-mark-size\)[^}]*min-width:\s*var\(--role-page-mark-size\)[^}]*height:\s*var\(--role-page-mark-size\)/s);
    expect(styles).toMatch(/\.shell__mark-icon--glyph\s*{[^}]*width:\s*var\(--role-page-mark-icon-size\)[^}]*height:\s*var\(--role-page-mark-icon-size\)/s);
    expect(styles).toMatch(/\.shell__mark-title\s*{[^}]*font-size:\s*var\(--role-page-mark-title-font-size\)/s);
    expect(home).toContain('/pages/campus-manager/assets/home-mark-glyph.png');
    expect(home).not.toContain('/pages/campus-manager/assets/home-mark.png');
    expect(home).not.toContain('markIconHasDisc="{{true}}"');
    expect(home).not.toContain('markIconOffsetY=');
    expect(profile).not.toContain('markIconHasDisc="{{true}}"');
    expect(profile).toContain('profile-mark-glyph.png');
  });

  it('supports a white profile surface with a plain secondary mark', () => {
    const root = path.resolve(__dirname, '..');
    const shellDir = path.join(root, 'components/campus-manager-page-shell');
    const markup = fs.readFileSync(
      path.join(shellDir, 'campus-manager-page-shell.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(shellDir, 'campus-manager-page-shell.wxss'),
      'utf8',
    );
    const logic = fs.readFileSync(
      path.join(shellDir, 'campus-manager-page-shell.ts'),
      'utf8',
    );

    expect(logic).toContain('surfacePage');
    expect(logic).toContain('plainMark');
    expect(markup).toContain('shell--surface');
    expect(markup).toContain('wx:if="{{!surfacePage}}"');
    expect(markup).toContain('shell__mark-disc--plain');
    expect(styles).toMatch(
      /\.shell--surface\s*\{[^}]*background:\s*var\(--campus-manager-surface\)/s,
    );
    expect(styles).toMatch(
      /\.shell__mark-disc--plain\s*\{[^}]*background:\s*transparent[^}]*box-shadow:\s*none/s,
    );
  });
});
