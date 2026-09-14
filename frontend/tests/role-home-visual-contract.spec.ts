import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('shared visual contract for current role clients', () => {
  it('defines the parent-approved shared control and home material tokens', () => {
    const tokens = read('styles/tokens.wxss');

    expect(tokens).toContain('--role-back-size: 88rpx');
    expect(tokens).toContain('--role-back-background: rgba(255, 255, 255, 0.92)');
    expect(tokens).toContain('--role-back-icon-size: 68rpx');
    expect(tokens).toContain('--role-home-glass-height: 176rpx');
    expect(tokens).toContain('--role-home-glass-background: rgba(255, 255, 255, 0.9)');
    expect(tokens).toContain('--role-home-glass-radius: 32rpx');
    expect(tokens).toContain('--role-home-nav-background: rgba(170, 170, 170, 0.8)');
    expect(tokens).toContain('--role-home-nav-item-width: 80rpx');
    expect(tokens).toContain('--role-home-nav-active-size: 136rpx');
    expect(tokens).toContain('--role-home-more-height: 44rpx');
    expect(tokens).toContain('--role-home-more-font-size: 20rpx');
    expect(tokens).toContain('--role-page-mark-size: 92rpx');
    expect(tokens).toContain('--role-page-mark-icon-size: 32rpx');
    expect(tokens).toContain('--role-page-mark-title-font-size: 18rpx');
    expect(tokens).toContain('--role-page-mark-background: #ffffff');
    expect(tokens).toContain('--role-page-mark-shadow: var(--role-back-shadow)');
    expect(tokens).toContain('--role-page-mark-ink: var(--parent-ink)');
    expect(tokens).toContain('--role-profile-mark-width: 72rpx');
    expect(tokens).toContain('--role-profile-mark-height: 86rpx');
    expect(tokens).toContain('--role-profile-mark-icon-size: 38rpx');
    expect(tokens).toContain('--role-profile-mark-font-size: 18rpx');
  });

  it('uses one exact home page-mark treatment across all five role clients', () => {
    const parent = read('components/parent-page-mark/parent-page-mark.wxss');
    const teacher = read('components/teacher-page-mark/teacher-page-mark.wxss');
    const manager = read('components/campus-manager-page-shell/campus-manager-page-shell.wxss');
    const partner = read('components/partner-page-shell/partner-page-shell.wxss');
    const superAdmin = read('components/super-admin-page-shell/super-admin-page-shell.wxss');

    for (const styles of [parent, teacher, manager, partner, superAdmin]) {
      expect(styles).toContain('var(--role-page-mark-size)');
      expect(styles).toContain('var(--role-page-mark-icon-size)');
      expect(styles).toContain('var(--role-page-mark-title-font-size)');
      expect(styles).toContain('var(--role-page-mark-background)');
      expect(styles).toContain('var(--role-page-mark-shadow)');
      expect(styles).toContain('var(--role-page-mark-ink)');
    }
  });

  it('lets manager-style home characters continue behind the footer navigation', () => {
    for (const role of ['campus-manager', 'partner', 'super-admin']) {
      const styles = read(`pages/${role}/home/index.wxss`);
      expect(styles).toMatch(
        /\.home__stage\s*\{[^}]*overflow:\s*visible/s,
      );
      expect(styles).toMatch(/\.home__footer\s*\{[^}]*z-index:\s*3/s);
    }
  });

  it('uses the teacher profile mark geometry for manager-style profile pages', () => {
    const teacherMark = read('components/teacher-page-mark/teacher-page-mark.wxss');

    expect(teacherMark).toMatch(
      /\.mark--plain\s*\{[^}]*width:\s*var\(--role-profile-mark-width\)[^}]*height:\s*var\(--role-profile-mark-height\)/s,
    );
    expect(teacherMark).toMatch(
      /\.mark--plain \.mark__icon\s*\{[^}]*width:\s*var\(--role-profile-mark-icon-size\)[^}]*height:\s*var\(--role-profile-mark-icon-size\)/s,
    );
    expect(teacherMark).toMatch(
      /\.mark--plain \.mark__title\s*\{[^}]*font-size:\s*var\(--role-profile-mark-font-size\)/s,
    );

    for (const role of ['campus-manager', 'partner']) {
      const shell = read(`components/${role}-page-shell/${role}-page-shell.wxss`);
      expect(shell).toMatch(
        /\.shell__mark--plain\s*\{[^}]*width:\s*var\(--role-profile-mark-width\)[^}]*min-width:\s*var\(--role-profile-mark-width\)[^}]*height:\s*var\(--role-profile-mark-height\)/s,
      );
      expect(shell).toMatch(
        /\.shell__mark-icon--plain\s*\{[^}]*width:\s*var\(--role-profile-mark-icon-size\)[^}]*height:\s*var\(--role-profile-mark-icon-size\)/s,
      );
      expect(shell).toMatch(
        /\.shell__mark--plain \.shell__mark-title\s*\{[^}]*font-size:\s*var\(--role-profile-mark-font-size\)/s,
      );
    }
  });

  it('uses the same back control without changing role-specific navigation behavior', () => {
    for (const role of ['parent', 'teacher', 'campus-manager', 'partner', 'super-admin']) {
      const markup = read(`components/${role}-page-shell/${role}-page-shell.wxml`);
      const styles = read(`components/${role}-page-shell/${role}-page-shell.wxss`);

      expect(markup).toContain('<text class="shell__back-icon">‹</text>');
      expect(styles).toMatch(/\.shell__back\s*\{[^}]*width:\s*var\(--role-back-size\)[^}]*height:\s*var\(--role-back-size\)[^}]*background:\s*var\(--role-back-background\)[^}]*box-shadow:\s*var\(--role-back-shadow\)/s);
      expect(styles).toMatch(/\.shell__back-icon\s*\{[^}]*margin-top:\s*var\(--role-back-icon-offset-y\)[^}]*font-size:\s*var\(--role-back-icon-size\)[^}]*line-height:\s*1/s);
    }
  });

  it('keeps each role artwork but uses one translucent glass frame', () => {
    const parent = read('components/parent-metric-card/parent-metric-card.wxss');
    const teacher = read('components/teacher-stat-strip/teacher-stat-strip.wxss');
    const manager = read('components/campus-manager-stat-strip/campus-manager-stat-strip.wxss');
    const managerMarkup = read('components/campus-manager-stat-strip/campus-manager-stat-strip.wxml');
    const partner = read('components/partner-stat-strip/partner-stat-strip.wxss');

    for (const styles of [parent, teacher, manager, partner]) {
      expect(styles).toMatch(/(?:\.metric-card|\.stats)\s*\{[^}]*min-height:\s*var\(--role-home-glass-height\)[^}]*background:\s*var\(--role-home-glass-background\)[^}]*border-radius:\s*var\(--role-home-glass-radius\)[^}]*box-shadow:\s*var\(--role-home-glass-shadow\)/s);
    }
    expect(teacher).not.toContain('.stats::after');
    expect(managerMarkup).not.toContain('stats__wash');
    expect(read('components/partner-stat-strip/partner-stat-strip.wxml')).not.toContain('stats__wash');
  });

  it('uses explicit pure black for every role home statistic value and unit', () => {
    const parent = read('components/parent-metric-card/parent-metric-card.wxss');
    const roleStats = [
      'teacher',
      'campus-manager',
      'partner',
      'super-admin',
    ].map((role) =>
      read(`components/${role}-stat-strip/${role}-stat-strip.wxss`),
    );

    expect(parent).toMatch(
      /\.metric-card__value\s*\{[^}]*color:\s*#000000/s,
    );
    expect(parent).toMatch(
      /\.metric-card__unit\s*\{[^}]*color:\s*#000000/s,
    );

    for (const styles of roleStats) {
      expect(styles).toMatch(/\.stats__value\s*\{[^}]*color:\s*#000000/s);
      expect(styles).toMatch(/\.stats__unit\s*\{[^}]*color:\s*#000000/s);
    }
  });

  it('uses the parent navigation geometry and more-button treatment on all three homes', () => {
    const parent = read('pages/parent/home/index.wxss');
    const teacher = read('pages/teacher/home/index.wxss');
    const manager = read('pages/campus-manager/home/index.wxss');
    const partner = read('pages/partner/home/index.wxss');

    expect(parent).toMatch(/\.quickbar__capsule\s*\{[^}]*background:\s*var\(--role-home-nav-background\)[^}]*box-shadow:\s*var\(--role-home-nav-shadow\)/s);
    expect(parent).toMatch(/\.quickbar__item\s*\{[^}]*min-width:\s*var\(--role-home-nav-item-width\)/s);
    expect(parent).toMatch(/\.quickbar__remind\s*\{[^}]*width:\s*var\(--role-home-nav-active-size\)[^}]*height:\s*var\(--role-home-nav-active-size\)[^}]*background:\s*var\(--role-home-nav-active-background\)/s);

    for (const styles of [teacher, manager, partner]) {
      expect(styles).toMatch(/\.quick-actions\s*\{[^}]*width:\s*var\(--role-home-nav-width\)[^}]*height:\s*var\(--role-home-nav-active-size\)/s);
      expect(styles).toMatch(/\.quick-actions::before\s*\{[^}]*background:\s*var\(--role-home-nav-background\)[^}]*box-shadow:\s*var\(--role-home-nav-shadow\)/s);
      expect(styles).toMatch(/\.quick-action\s*\{[^}]*min-width:\s*var\(--role-home-nav-item-width\)/s);
      expect(styles).toMatch(/\.quick-action--active\s*\{[^}]*width:\s*var\(--role-home-nav-active-size\)[^}]*height:\s*var\(--role-home-nav-active-size\)[^}]*background:\s*var\(--role-home-nav-active-background\)/s);
    }

    expect(parent).toMatch(/\.course__more,[^{]*\.quickbar__more\s*\{[^}]*min-height:\s*var\(--role-home-more-height\)[^}]*padding:\s*0 var\(--role-home-more-padding-x\)[^}]*border:\s*var\(--role-home-more-border\)[^}]*font-size:\s*var\(--role-home-more-font-size\)/s);
    expect(teacher).toMatch(/\.home__more,[^{]*\.home__footer-more\s*\{[^}]*min-height:\s*var\(--role-home-more-height\)[^}]*padding:\s*0 var\(--role-home-more-padding-x\)[^}]*border:\s*var\(--role-home-more-border\)[^}]*font-size:\s*var\(--role-home-more-font-size\)/s);
    expect(manager).toMatch(/\.home__more,[^{]*\.home__students\s*\{[^}]*min-height:\s*var\(--role-home-more-height\)[^}]*padding:\s*0 var\(--role-home-more-padding-x\)[^}]*border:\s*var\(--role-home-more-border\)[^}]*font-size:\s*var\(--role-home-more-font-size\)/s);
  });

  it('aligns the teacher and campus manager home controls to the parent 375px baseline', () => {
    const teacher = read('pages/teacher/home/index.wxss');
    const manager = read('pages/campus-manager/home/index.wxss');

    expect(teacher).toMatch(/\.home__identity\s*\{[^}]*bottom:\s*232rpx/s);
    expect(teacher).toMatch(/\.home__stats\s*\{[^}]*bottom:\s*68rpx/s);
    expect(teacher).toMatch(/\.home__footer-actions\s*\{[^}]*margin-top:\s*-32rpx/s);

    expect(manager).toMatch(/\.home__stage\s*\{[^}]*height:\s*752rpx/s);
    expect(manager).toMatch(/\.home__identity-row\s*\{[^}]*bottom:\s*238rpx[^}]*z-index:\s*3/s);
    expect(manager).toMatch(/\.home__settings\s*\{[^}]*transform:\s*translateY\(-24rpx\)/s);
    expect(manager).toMatch(/\.home__stats\s*\{[^}]*bottom:\s*42rpx/s);
    expect(manager).toMatch(/\.home__footer\s*\{[^}]*margin-top:\s*8rpx/s);
  });
});
