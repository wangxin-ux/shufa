import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const rule = (source: string, selector: string) =>
  source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]+)\\}`, 's'))?.[1] ?? '';

describe('parent five annotated visual details', () => {
  it('extends the catalog mascot to the safe-area bottom without moving its button', () => {
    const styles = read('pages/parent/courses/index.wxss');
    expect(rule(styles, '.catalog__mascot')).toContain('bottom: calc(-8rpx - env(safe-area-inset-bottom))');
    expect(rule(styles, '.catalog__mascot')).toContain('width: 300rpx');
    expect(rule(styles, '.catalog__offers')).toContain('height: 108rpx');
    expect(rule(styles, '.catalog__offers')).toContain('0 7rpx 6rpx 1rpx rgba(24, 18, 14, 0.28)');
  });

  it('uses quieter translucent white for all three balance-card text roles', () => {
    const styles = read('pages/parent/hours/index.wxss');
    for (const selector of ['.balance-card__label', '.balance-card__meta-label', '.balance-card__meta-value']) {
      expect(rule(styles, selector)).toContain('color: rgba(255, 255, 255, 0.65)');
    }
    expect(rule(styles, '.balance-card__renew')).toContain('right: 9rpx');
  });

  it('centers a fixed bold chevron instead of relying on a text baseline', () => {
    const styles = read('pages/parent/leave/index.wxss');
    const markup = read('pages/parent/leave/index.wxml');
    expect(markup.match(/<view class="field__arrow" aria-hidden="true"><\/view>/g) ?? []).toHaveLength(2);
    expect(markup).not.toContain('>⌄</text>');
    expect(rule(styles, '.field__arrow')).toContain('align-items: center');
    expect(rule(styles, '.field__arrow')).toContain('justify-content: center');
    expect(rule(styles, '.field__arrow')).toContain('height: 28rpx');
    expect(rule(styles, '.field__arrow::before')).toContain('border-right: 4rpx solid currentColor');
    expect(rule(styles, '.field__arrow::before')).toContain('border-bottom: 4rpx solid currentColor');
  });

  it('adds saturation only to the profile menu while preserving its full translucent artwork', () => {
    const styles = read('pages/parent/profile/index.wxss');
    expect(rule(styles, '.profile parent-action-card')).toContain('background-color: #ffd650');
    expect(rule(styles, '.profile__menu-surface::after')).toContain('background: rgba(255, 214, 80, 0.84)');
    expect(rule(styles, '.profile__menu-backdrop')).toContain('width: 1050rpx');
    expect(read('styles/parent-pdf.wxss')).toContain('--parent-yellow-card: #f6d468');
  });

  it('removes extra growth-page controls while retaining photo and history interactions', () => {
    const markup = read('pages/parent/updates/index.wxml');
    expect(markup).not.toContain('growth-identity__camera');
    expect(markup).not.toContain('class="growth-history"');
    expect(markup).toMatch(/class="growth-identity__photo"[^>]*bindtap="onPreviewPhoto"[^>]*bindlongpress="onPhotoLongPress"/);
    expect(markup).toMatch(/<picker[^>]*class="growth-feedback__lesson-picker"[^>]*bindchange="onLessonChange"[^>]*>\s*<view class="growth-feedback__meta">/s);
    expect(markup).toContain('id="parent-review-submit"');
  });

  it('uses a compact neutral dark lower shadow for both growth panels', () => {
    const styles = read('pages/parent/updates/index.wxss');
    expect(styles).toMatch(/\.growth-feedback,\s*\.growth-review\s*\{[^}]*box-shadow:\s*0 7rpx 6rpx 1rpx rgba\(24,\s*18,\s*14,\s*0\.33\)/s);
    expect(rule(styles, '.growth-review__note')).toContain('min-height: 88rpx');
    expect(rule(styles, '.growth-review__submit')).toContain('height: 72rpx');
  });
});
