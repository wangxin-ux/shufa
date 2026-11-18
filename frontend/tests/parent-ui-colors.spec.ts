import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('parent phone artwork colors', () => {
  it('uses the sampled vertical gold gradient without changing other role palettes', () => {
    const palette = read('styles/parent-pdf.wxss');
    expect(palette).toMatch(/--parent-pdf-home-gradient:\s*linear-gradient\(\s*180deg,\s*#e1ab20 0%,\s*#f1c958 48%,\s*#e4af25 100%\s*\)/s);
    expect(palette).toMatch(/--parent-pdf-bottom-gradient:\s*linear-gradient\(\s*180deg,\s*#e6b22e 0%,\s*#e4af25 100%\s*\)/s);
    expect(read('pages/parent/updates/index.wxss')).toContain('--parent-yellow: var(--parent-pdf-home-gradient)');
    expect(read('styles/tokens.wxss')).not.toContain('--parent-pdf-bottom-gradient');
    for (const page of ['courses', 'profile']) {
      expect(read(`pages/parent/${page}/index.wxss`)).toMatch(/::before\s*\{[^}]*background:\s*var\(--parent-pdf-bottom-gradient\)/s);
    }
  });

  it('matches the final orange card color and preserves dimensional shadow and geometry', () => {
    const hours = read('pages/parent/hours/index.wxss');
    expect(hours).toMatch(/\.balance-card\s*\{[^}]*background:\s*rgba\(255,\s*123,\s*16,\s*0\.9\)/s);
    expect(hours).toMatch(/\.balance-card\s*\{[^}]*min-height:\s*364rpx/s);
    expect(hours).toMatch(/\.balance-card__renew\s*\{[^}]*right:\s*9rpx/s);
    expect(hours).toMatch(/\.hour-cards\s*\{[^}]*z-index:\s*2/s);
  });

  it('places an opaque yellow base below the full ledger mascot and translucent surface', () => {
    const hours = read('pages/parent/hours/index.wxss');
    expect(hours).toMatch(/\.ledger__card::before\s*\{[^}]*background:\s*var\(--parent-yellow-card\)/s);
    expect(hours).toMatch(/\.ledger__card::before\s*\{[^}]*pointer-events:\s*none/s);
    expect(hours).toMatch(/\.ledger__panel\s*\{[^}]*background:\s*rgba\(246,\s*212,\s*104,\s*0\.84\)/s);
    expect(hours).toMatch(/\.ledger__mascot\s*\{[^}]*top:\s*-126rpx/s);
    expect(read('pages/parent/hours/index.wxml')).toContain('/pages/parent/assets/hours-ledger-mascot.png');
  });

  it('composites the profile menu over bright yellow instead of whitening it against the page', () => {
    const profile = read('pages/parent/profile/index.wxss');
    const menu = profile.match(/\.profile parent-action-card\s*\{([^}]+)\}/s)?.[1] ?? '';
    const markup = read('pages/parent/profile/index.wxml');
    expect(menu).toContain('--parent-yellow-card: transparent');
    expect(menu).toContain('background-color: #ffd650');
    expect(menu).not.toContain('background-image:');
    expect(markup).toMatch(/<image class="profile__menu-backdrop" src="\/pages\/parent\/assets\/profile-backdrop\.png" mode="widthFix"/);
    expect(profile).toMatch(/\.profile__menu-backdrop\s*\{[^}]*width:\s*1050rpx/s);
    expect(profile).toMatch(/\.profile__menu-backdrop\s*\{[^}]*left:\s*calc\(50% - 646rpx\)/s);
    expect(profile).toMatch(/\.profile__menu-backdrop\s*\{[^}]*top:\s*-215rpx/s);
    expect(profile).toMatch(/\.profile__menu-surface::after\s*\{[^}]*background:\s*rgba\(255,\s*214,\s*80,\s*0\.84\)/s);
    expect(profile).toMatch(/\.profile__menu-surface\s*\{[^}]*pointer-events:\s*none/s);
    expect(menu).toContain('margin-top: 54rpx');
    expect(menu).toContain('width: 653rpx');
  });

  it('keeps the matching leave form and adds only its subtle input fill', () => {
    const leave = read('pages/parent/leave/index.wxss');
    expect(leave).toContain('--parent-yellow-bright: #ffd75e');
    expect(leave).toMatch(/\.field__control,\s*\.field__textarea\s*\{[^}]*background:\s*#fbd45d/s);
  });

  it('retains a mild warm review gradient instead of fading back to saturated orange', () => {
    const growth = read('pages/parent/updates/index.wxss');
    expect(growth).toMatch(/\.growth-review\s*\{[^}]*background:\s*linear-gradient\(180deg,\s*#fd8c2c 0%,\s*#fd8d29 100%\)/s);
    expect(growth).toMatch(/\.growth-feedback\s*\{[^}]*background:\s*var\(--parent-orange\)/s);
  });
});
