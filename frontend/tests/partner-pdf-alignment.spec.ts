import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { buildPartnerHomePageModel } from '../services/partner-home.presenter';
import { PARTNER_VISUAL_DASHBOARD_FIXTURE } from '../mock/fixtures/partner-visual.fixture';

const read = (relative: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

describe('partner P1 measured reference composition', () => {
  it('uses the existing teacher fact for the third reference statistic', () => {
    expect(buildPartnerHomePageModel(PARTNER_VISUAL_DASHBOARD_FIXTURE).stats[2]).toEqual({
      key: 'teachers', label: '授课教师', value: '18', unit: '人', compact: false,
    });
  });

  it('scopes the reference curve and complete figure to this page', () => {
    const markup = read('pages/partner/home/index.wxml');
    const styles = read('pages/partner/home/index.wxss');
    expect(markup).toContain('waveImage="/pages/partner/assets/top-wave.png"');
    expect(markup).toContain('/pages/partner/assets/top-wave.png');
    expect(styles).toMatch(/\.home__character\s*\{[^}]*width:\s*658rpx/s);
    expect(styles).toMatch(/\.home__character\s*\{[^}]*left:\s*91rpx/s);
    expect(styles).not.toContain('@media (min-width: 420px)');
    expect(styles).toMatch(/\.focus__student-row\s*\{[^}]*display:\s*flex/s);
    expect(styles).toContain('min-height: var(--partner-body-height');
    expect(styles).toMatch(/\.focus__courses\s*\{[^}]*max-height:\s*64rpx/s);
    expect(styles).toMatch(/\.focus\s*\{[^}]*overflow:\s*visible/s);
    expect(styles).toMatch(/\.focus__summary,\s*\.focus__class\s*\{[^}]*white-space:\s*nowrap/s);
    expect(markup).toContain('class="focus__student-row"');
    expect(markup).toMatch(/<scroll-view[^>]*class="focus__courses"[^>]*scroll-y="\{\{true\}\}"/);
  });

  it('keeps growing highlight details below the actions and above the figure', () => {
    const styles = read('pages/partner/home/index.wxss');
    const detail = styles.match(/(?:^|}\s*)\.focus__detail\s*\{([^}]+)\}/)![1];
    const stage = styles.match(/\.home__stage\s*\{([^}]+)\}/)![1];
    const character = styles.match(/\.home__character\s*\{([^}]+)\}/)![1];
    const rpx = (block: string, property: string) =>
      Number(block.match(new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)rpx`))?.[1]);

    expect(detail).toMatch(/align-self:\s*start/);
    expect(detail).not.toMatch(/transform:/);
    expect(rpx(detail, 'margin-top')).toBeGreaterThanOrEqual(-22);
    expect(
      rpx(detail, 'margin-bottom') + rpx(stage, 'margin') + rpx(character, 'top'),
    ).toBeGreaterThanOrEqual(12);
  });

  it('fits the full no-warning label in the existing student column', () => {
    const markup = read('pages/partner/home/index.wxml');
    const styles = read('pages/partner/home/index.wxss');
    expect(markup).toContain(
      'class="focus__student {{highlightEnrollment ? \'\' : \'focus__student--empty\'}}"',
    );
    const fallback = styles.match(/\.focus__student--empty\s*\{([^}]+)\}/)?.[1] ?? '';
    const fontSize = Number(fallback.match(/font-size:\s*(\d+)rpx/)?.[1]);
    const columnWidth = (750 - 64 - 230 - 4 - 34) * 0.62;
    expect(fontSize).toBeGreaterThanOrEqual(32);
    expect(fontSize * Array.from('暂无课时预警').length).toBeLessThanOrEqual(columnWidth);
  });

  it('reuses only the original non-character curve bytes', () => {
    const asset = (role: string) => fs.readFileSync(
      path.resolve(__dirname, `../pages/${role}/assets/top-wave.png`),
    );
    expect(asset('partner')).toEqual(asset('parent'));
    expect(read('pages/partner/home/index.wxml')).not.toContain('/pages/parent/');
  });

  it('casts a contour shadow from the reference wave without adding a phone border', () => {
    const shell = read('components/partner-page-shell/partner-page-shell.wxss');
    const home = read('pages/partner/home/index.wxss');
    expect(shell).toMatch(
      /\.shell__wave-image\s*\{[^}]*filter:\s*var\(--partner-shell-wave-filter,\s*none\)/s,
    );
    expect(home).toContain(
      '--partner-shell-wave-filter: drop-shadow(0 5rpx 17rpx rgba(24, 18, 14, 0.28))',
    );
    expect(home).not.toMatch(/border(?:-top)?:[^;]*(?:black|#000000)/);
  });

  it('uses the PDF application illustration instead of the old campaign command', () => {
    const markup = read('pages/partner/home/index.wxml');
    const styles = read('pages/partner/home/index.wxss');
    expect(markup).toContain('data-key="application"');
    expect(markup).toContain('aria-label="申请入驻"');
    expect(markup).toContain('/pages/partner/assets/icon-application.png');
    expect(markup).not.toContain('class="home__campaigns"');
    expect(styles).toMatch(/\.home__application\s*\{[^}]*width:\s*140rpx[^}]*height:\s*140rpx/s);
    expect(styles).toContain('env(safe-area-inset-bottom)');
  });

  it('pins the isolated P8 original artwork as an RGBA subpackage asset', () => {
    const asset = fs.readFileSync(path.resolve(
      __dirname, '../pages/partner/assets/icon-application.png',
    ));
    expect(asset.readUInt32BE(16)).toBe(161);
    expect(asset.readUInt32BE(20)).toBe(160);
    expect(asset[25]).toBe(6);
    expect(createHash('sha256').update(asset).digest('hex')).toBe(
      '263a76493def2cb9410680de386884186e79df470599c48ed376866ce8abc5b5',
    );
  });
});
