import * as fs from 'fs';
import * as path from 'path';

const FRONTEND_ROOT = path.resolve(__dirname, '..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(FRONTEND_ROOT, relPath), 'utf-8');
}

describe('parent visual polish anchors', () => {
  it('uses the vivid source yellows and visibly translucent home overlays', () => {
    const tokens = read('styles/tokens.wxss');
    const home = read('pages/parent/home/index.wxss');
    const homeMarkup = read('pages/parent/home/index.wxml');
    const metrics = read('components/parent-metric-card/parent-metric-card.wxss');
    const metricMarkup = read('components/parent-metric-card/parent-metric-card.wxml');
    const metricLogic = read('components/parent-metric-card/parent-metric-card.ts');
    const profile = read('pages/parent/profile/index.wxss');

    expect(tokens).toMatch(/--parent-yellow:\s*#f6d468/);
    expect(tokens).toMatch(/--parent-frosted:\s*rgba\(170,\s*170,\s*170,\s*0\.8\)/);
    expect(tokens).toMatch(
      /--role-home-yellow-gradient:\s*linear-gradient\(180deg,\s*#ebac0f 0%,\s*#f8c948 48%,\s*#ebac11 100%\)/,
    );
    expect(home).toMatch(
      /parent-page-shell\s*\{[^}]*--parent-yellow:\s*var\(--role-home-yellow-gradient\)/s,
    );
    expect(fs.existsSync(path.join(FRONTEND_ROOT, 'pages/parent/assets/home-metric-glass.png'))).toBe(true);
    expect(homeMarkup).toContain('glassSrc="/pages/parent/assets/home-metric-glass.png"');
    expect(metricMarkup).toContain('class="metric-card__glass"');
    expect(metricLogic).toMatch(/glassSrc:\s*\{\s*type:\s*String,\s*value:\s*''\s*\}/s);
    expect(metrics).toMatch(/\.metric-card\s*\{[^}]*background:\s*var\(--role-home-glass-background\)/s);
    expect(metrics).toMatch(/\.metric-card\s*\{[^}]*overflow:\s*hidden/s);
    expect(metrics).toMatch(/\.metric-card__glass\s*\{[^}]*position:\s*absolute/s);
    expect(metrics).toMatch(/\.metric-card__glass\s*\{[^}]*inset:\s*0/s);
    expect(metrics).toMatch(
      /\.metric-card\s*\{[^}]*box-shadow:\s*var\(--role-home-glass-shadow\)/s,
    );
    expect(metrics).toMatch(/\.metric-card__label\s*\{[^}]*font-size:\s*15rpx/s);
    expect(metrics).toMatch(/\.metric-card__label\s*\{[^}]*color:\s*#fb6c3f/s);
    expect(metrics).toMatch(/\.metric-card__value\s*\{[^}]*font-size:\s*49rpx/s);
    expect(metrics).toMatch(/\.metric-card__value\s*\{[^}]*color:\s*#000000/s);
    expect(metrics).toMatch(/\.metric-card__unit\s*\{[^}]*font-size:\s*15rpx/s);
    expect(metricMarkup).toContain("item.unit === '%' ? 'metric-card__unit--percent' : ''");
    expect(metrics).toMatch(/\.metric-card__unit--percent\s*\{[^}]*font-size:\s*49rpx/s);
    expect(metrics).toMatch(/\.metric-card__unit--percent\s*\{[^}]*font-family:\s*var\(--parent-font-display\)/s);
    expect(metrics).toMatch(/\.metric-card__unit--percent\s*\{[^}]*font-weight:\s*700/s);
    expect(metrics).toMatch(/\.metric-card__sub\s*\{[^}]*font-size:\s*15rpx/s);
    expect(metrics).toMatch(/\.metric-card__sub\s*\{[^}]*color:\s*#a0aaa8/s);
    expect(metrics).toMatch(/\.metric-card__divider\s*\{[^}]*top:\s*26%/s);
    expect(metrics).toMatch(/\.metric-card__divider\s*\{[^}]*height:\s*56%/s);
    expect(metrics).toMatch(/\.metric-card__divider\s*\{[^}]*background:\s*#ffffff/s);
    expect(home).toMatch(
      /\.quickbar__capsule\s*\{[^}]*box-shadow:\s*var\(--role-home-nav-shadow\)/s,
    );
    expect(home).toMatch(/\.quickbar__remind\s*\{[^}]*background:\s*var\(--role-home-nav-active-background\)/s);
    expect(home).toMatch(
      /\.quickbar__remind\s*\{[^}]*box-shadow:\s*var\(--role-home-nav-active-shadow\)/s,
    );
    expect(profile).toMatch(
      /\.profile parent-action-card\s*\{[^}]*--parent-yellow-card:\s*rgba\(255,\s*215,\s*94,\s*0\.84\)/s,
    );
  });

  it('aligns the home composition to the source artboard coordinates', () => {
    const styles = read('pages/parent/home/index.wxss');
    const metrics = read('components/parent-metric-card/parent-metric-card.wxss');

    expect(styles).toMatch(/\.course\s*\{[^}]*margin-top:\s*106rpx/s);
    expect(styles).toMatch(/\.course__title\s*\{[^}]*font-size:\s*64rpx/s);
    expect(styles).toMatch(/\.course__day\s*\{[^}]*font-size:\s*150rpx/s);
    const courseNameStyle = styles.match(/\.course__name\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(courseNameStyle).toMatch(/font-size:\s*82rpx/);
    expect(courseNameStyle).toMatch(/white-space:\s*normal/);
    expect(courseNameStyle).toMatch(/overflow-wrap:\s*anywhere/);
    expect(courseNameStyle).not.toContain('text-overflow: ellipsis');
    expect(styles).toMatch(/\.course__date\s*\{[^}]*z-index:\s*2/s);
    expect(styles).not.toContain('.course__date::before');
    expect(styles).toMatch(/\.stage\s*\{[^}]*height:\s*720rpx/s);
    expect(styles).toMatch(/\.stage__mascot\s*\{[^}]*width:\s*750rpx/s);
    expect(styles).toMatch(/\.stage__mascot\s*\{[^}]*top:\s*-144rpx/s);
    expect(styles).toMatch(/\.stage__mascot\s*\{[^}]*right:\s*-40rpx/s);
    expect(styles).toMatch(/\.stage__student\s*\{[^}]*bottom:\s*189rpx/s);
    expect(styles).toMatch(/\.stage__student-name\s*\{[^}]*color:\s*#000000/s);
    expect(styles).toMatch(/\.stage__student-age\s*\{[^}]*color:\s*#000000/s);
    expect(styles).toMatch(/\.stage__metrics\s*\{[^}]*left:\s*7rpx/s);
    expect(styles).toMatch(/\.stage__metrics\s*\{[^}]*right:\s*9rpx/s);
    expect(metrics).toMatch(/\.metric-card\s*\{[^}]*padding:\s*35rpx 0/s);
    expect(styles).toMatch(/\.quickbar\s*\{[^}]*margin-top:\s*27rpx/s);
    expect(styles).toMatch(/\.quickbar__item\s*\{[^}]*min-width:\s*var\(--role-home-nav-item-width\)/s);
    expect(styles).toMatch(/\.quickbar__remind-icon\s*\{[^}]*width:\s*64rpx/s);
    expect(styles).toMatch(/\.quickbar__remind-icon\s*\{[^}]*height:\s*64rpx/s);
    expect(styles).toMatch(/\.quickbar\s*\{[^}]*z-index:\s*4/s);
  });

  it('lets the hours mascot overlap a compact balance card and uses a round renewal control', () => {
    const markup = read('pages/parent/hours/index.wxml');
    const hours = read('pages/parent/hours/index.wxss');
    const buttonMarkup = read('components/parent-primary-button/parent-primary-button.wxml');
    const button = read('components/parent-primary-button/parent-primary-button.wxss');
    const tokens = read('styles/tokens.wxss');

    expect(hours).toContain('.hours::before');
    expect(hours).toMatch(/\.balance-card\s*\{[^}]*min-height:\s*364rpx/s);
    expect(hours).toMatch(/\.balance-card\s*\{[^}]*margin:\s*14rpx 10rpx 0 8rpx/s);
    expect(hours).toMatch(/\.balance-card\s*\{[^}]*overflow:\s*visible/s);
    expect(hours).toMatch(/\.balance-card\s*\{[^}]*background:\s*rgba\(255,\s*123,\s*16,\s*0\.9\)/s);
    expect(hours).toMatch(
      /\.balance-card\s*\{[^}]*box-shadow:\s*0 8rpx 6rpx 1rpx rgba\(24,\s*18,\s*14,\s*0\.33\)/s,
    );
    expect(hours).toMatch(/\.balance-card__value\s*\{[^}]*color:\s*#000000/s);
    expect(hours).toMatch(/\.balance-card__unit\s*\{[^}]*color:\s*#000000/s);
    expect(hours).toMatch(/\.balance-card__mascot-frame\s*\{[^}]*right:\s*-16rpx/s);
    expect(hours).toMatch(/\.balance-card__mascot-frame\s*\{[^}]*bottom:\s*-3rpx/s);
    expect(hours).toMatch(/\.balance-card__mascot-frame\s*\{[^}]*width:\s*495rpx/s);
    expect(hours).toMatch(/\.balance-card__mascot-frame\s*\{[^}]*height:\s*526rpx/s);
    expect(hours).toMatch(/\.balance-card__renew\s*\{[^}]*width:\s*117rpx/s);
    expect(hours).toMatch(/\.hour-cards--single \.hour-card\s*\{[^}]*max-width:\s*276rpx/s);
    expect(hours).toMatch(/\.hour-card\s*\{[^}]*min-height:\s*212rpx/s);
    expect(hours).toMatch(/\.hour-card\s*\{[^}]*background:\s*var\(--parent-yellow-bright\)/s);
    expect(hours).toMatch(
      /\.hour-card\s*\{[^}]*box-shadow:\s*0 7rpx 9rpx rgba\(24,\s*18,\s*14,\s*0\.28\)/s,
    );
    expect(hours).toMatch(/\.hour-card__value\s*\{[^}]*color:\s*#000000/s);
    expect(markup).toContain("item.remaining >= 100 ? 'hour-card__value--compact' : ''");
    expect(hours).toMatch(/\.hour-card__value-row\s*\{[^}]*justify-content:\s*flex-start/s);
    expect(hours).toMatch(/\.hour-card__value\s*\{[^}]*flex:\s*none/s);
    expect(hours).toMatch(/\.hour-card__value--compact\s*\{[^}]*font-size:\s*100rpx/s);
    expect(hours).toMatch(/\.hour-card__unit\s*\{[^}]*color:\s*#000000/s);
    expect(hours).toMatch(/\.hour-card__unit\s*\{[^}]*flex:\s*none/s);
    expect(hours).toMatch(/\.hour-card__unit\s*\{[^}]*margin-left:\s*12rpx/s);
    expect(markup).not.toContain('报名金额');
    expect(markup).toContain('class="balance-card__meta-row"');
    expect(markup).toContain('class="balance-card__meta-label"');
    expect(markup).toContain('class="balance-card__meta-value"');
    expect(hours).toMatch(/\.balance-card__meta-label\s*\{[^}]*font-size:\s*21rpx/s);
    expect(hours).toMatch(/\.balance-card__meta-value\s*\{[^}]*font-size:\s*23rpx/s);
    expect(hours).toMatch(/\.hour-card__label\s*\{[^}]*font-size:\s*24rpx/s);
    expect(markup).not.toContain('hour-card__sub');
    expect(hours).toContain('--parent-record-card-subtitle-size: 22rpx');
    expect(markup).toContain('class="ledger__detail"');
    expect(hours).toMatch(/\.ledger\s*\{[^}]*padding:\s*47rpx 49rpx 80rpx/s);
    expect(hours).toMatch(/\.ledger\s*\{[^}]*margin:\s*0 -40rpx -72rpx/s);
    expect(hours).toMatch(/\.ledger__panel\s*\{[^}]*background:\s*rgba\(246,\s*212,\s*104,\s*0\.9\)/s);
    expect(hours).toMatch(
      /\.ledger__panel\s*\{[^}]*box-shadow:\s*0 7rpx 9rpx rgba\(24,\s*18,\s*14,\s*0\.28\)/s,
    );
    expect(markup).toContain('class="balance-card__mascot-frame"');
    expect(hours).toMatch(/\.balance-card__mascot-frame\s*\{[^}]*overflow:\s*hidden/s);
    expect(button).toMatch(/\.primary-btn--deep\s*\{[^}]*border-radius:\s*50%/s);
    expect(button).toMatch(/\.primary-btn--deep\s*\{[^}]*display:\s*flex/s);
    expect(button).toMatch(/\.primary-btn--deep\s*\{[^}]*align-items:\s*center/s);
    expect(button).toMatch(/\.primary-btn--deep\s*\{[^}]*justify-content:\s*center/s);
    expect(button).toMatch(/\.primary-btn--deep\s*\{[^}]*box-sizing:\s*border-box/s);
    expect(markup).toContain('topText="立即"');
    expect(markup).toContain('bottomText="续费"');
    expect(markup).not.toContain('text="立即续费"');
    expect(buttonMarkup).toContain('class="primary-btn__line"');
    expect(button).toContain('--parent-primary-deep-height');
    expect(tokens).toMatch(/--parent-orange-deep:\s*#fe8419/);
    expect(hours).toMatch(/\.balance-card__value-row\s*\{[^}]*margin:\s*18rpx 0 10rpx/s);
    expect(hours).toMatch(/\.balance-card__meta-row\s*\{[^}]*gap:\s*10rpx/s);
    expect(hours).toMatch(/\.balance-card__meta-label\s*\{[^}]*width:\s*auto/s);
    expect(hours).toContain('--parent-primary-deep-font-size: 34rpx');
  });

  it('uses one coherent student profile card without repeating the learner name', () => {
    const markup = read('pages/parent/student-profile/index.wxml');
    const styles = read('pages/parent/student-profile/index.wxss');

    expect(markup).toContain('class="student-profile__card"');
    expect(markup).toContain('class="student-profile__header"');
    expect(markup).toContain('class="student-profile__details"');
    expect(markup).toContain('资料概览');
    expect(markup.match(/\{\{studentName\}\}/g)).toHaveLength(1);
    expect(markup).not.toContain('student-profile__age');
    expect(markup).toContain('家庭住址');
    expect(markup).toContain('暂未填写');
    expect(markup.indexOf('家庭住址')).toBeGreaterThan(markup.indexOf('年龄'));
    expect(markup.indexOf('家庭住址')).toBeLessThan(markup.indexOf('绑定关系'));
    expect(styles).toMatch(
      /\.student-profile__card\s*\{[^}]*box-shadow:\s*0 18rpx 36rpx/s,
    );
    expect(styles).toMatch(
      /\.student-profile__header\s*\{[^}]*background:\s*linear-gradient\(145deg,/s,
    );
    expect(styles).toMatch(/\.student-profile__details\s*\{[^}]*background:\s*rgba\(255,\s*252,\s*242,\s*0\.98\)/s);
  });

  it('uses warm elevated cards for updates and group orders', () => {
    const updatesMarkup = read('pages/parent/updates/index.wxml');
    const updates = read('pages/parent/updates/index.wxss');
    const ordersMarkup = read('pages/parent/group-orders/index.wxml');
    const orders = read('pages/parent/group-orders/index.wxss');

    expect(updates).toMatch(/\.update-card\s*\{[^}]*border-left:\s*8rpx solid var\(--parent-orange\)/s);
    expect(updates).toMatch(/\.update-card\s*\{[^}]*border-radius:\s*18rpx/s);
    expect(updates).toMatch(/\.update-card\s*\{[^}]*background:\s*linear-gradient\(145deg,/s);
    expect(updates).toMatch(/\.update-card\s*\{[^}]*box-shadow:\s*0 14rpx 26rpx/s);
    expect(updates).not.toContain('backdrop-filter');
    expect(updatesMarkup).toContain('class="update-card__attendance"');
    expect(orders).toMatch(/\.order-card\s*\{[^}]*border-left:\s*8rpx solid var\(--parent-orange\)/s);
    expect(orders).toMatch(/\.order-card\s*\{[^}]*border-radius:\s*18rpx/s);
    expect(orders).toMatch(/\.order-card\s*\{[^}]*background:\s*linear-gradient\(145deg,/s);
    expect(orders).toMatch(/\.order-card\s*\{[^}]*box-shadow:\s*0 14rpx 26rpx/s);
    expect(ordersMarkup).toContain('class="order-card__summary"');
    expect(ordersMarkup).toContain('class="order-card__metric-label"');
  });

  it('renders one leave mascot across the form and records transition', () => {
    const markup = read('pages/parent/leave/index.wxml');
    const styles = read('pages/parent/leave/index.wxss');
    const actionCard = read('components/parent-action-card/parent-action-card.wxss');
    const primaryButton = read('components/parent-primary-button/parent-primary-button.wxss');
    const recordCard = read('components/parent-record-card/parent-record-card.wxss');
    const mascotMatches = markup.match(/leave-mascot\.png/g) ?? [];

    expect(mascotMatches).toHaveLength(1);
    expect(markup).toContain('class="leave__mascot"');
    expect(markup).toContain('class="leave__mascot-frame"');
    expect(styles).toMatch(/\.leave\s*\{[^}]*padding:\s*64rpx 0 80rpx/s);
    expect(styles).toMatch(/\.form-card\s*\{[^}]*min-height:\s*692rpx/s);
    expect(styles).toMatch(/\.form-card__title,[\s\S]*?font-size:\s*64rpx/s);
    expect(styles).toMatch(/\.form-card__head \+ \.field\s*\{[^}]*margin-top:\s*55rpx/s);
    expect(styles).toMatch(/\.field__textarea\s*\{[^}]*height:\s*131rpx/s);
    expect(styles).toMatch(/\.form-card__submit\s*\{[^}]*width:\s*294rpx/s);
    expect(styles).toMatch(/\.leave__mascot-frame\s*\{[^}]*top:\s*624rpx/s);
    expect(styles).toMatch(/\.leave__mascot-frame\s*\{[^}]*right:\s*-13rpx/s);
    expect(styles).toMatch(/\.leave__mascot-frame\s*\{[^}]*width:\s*360rpx/s);
    expect(styles).toMatch(/\.leave__mascot-frame\s*\{[^}]*height:\s*404rpx/s);
    expect(styles).toMatch(/\.leave__mascot-frame\s*\{[^}]*overflow:\s*hidden/s);
    expect(styles).toMatch(/\.records\s*\{[^}]*margin-top:\s*64rpx/s);
    expect(styles).toContain('--parent-record-card-padding: 48rpx 32rpx');
    expect(styles).toMatch(/\.leave parent-action-card\s*\{[^}]*--parent-action-card-shadow:\s*0 8rpx 9rpx rgba\(24,\s*18,\s*14,\s*0\.1\)/s);
    expect(styles).toMatch(/\.form-card__title\s*\{[^}]*color:\s*#000000/s);
    expect(styles).toMatch(/\.form-card__cutoff\s*\{[^}]*font-size:\s*15rpx/s);
    expect(styles).toMatch(/\.form-card__submit\s*\{[^}]*--parent-primary-color:\s*#000000/s);
    expect(styles).toMatch(/\.form-card__submit\s*\{[^}]*--parent-primary-shadow:\s*0 8rpx 9rpx rgba\(24,\s*18,\s*14,\s*0\.1\)/s);
    expect(styles).toMatch(/\.records__title\s*\{[^}]*color:\s*#29220e/s);
    expect(styles).toMatch(/\.leave parent-record-card\s*\{[^}]*--parent-record-card-background:\s*#f6d469/s);
    expect(styles).toMatch(/\.leave parent-record-card\s*\{[^}]*--parent-record-card-border:\s*4rpx dashed #ffc97d/s);
    expect(styles).toMatch(/\.leave parent-record-card\s*\{[^}]*--parent-record-card-shadow:\s*none/s);
    expect(styles).toMatch(/\.leave parent-record-card\s*\{[^}]*--parent-record-card-subtitle-color:\s*#2c453f/s);
    expect(actionCard).toContain('--parent-action-card-shadow');
    expect(primaryButton).toContain('--parent-primary-color');
    expect(primaryButton).toContain('--parent-primary-shadow');
    expect(recordCard).toContain('--parent-record-card-background');
    expect(recordCard).toContain('--parent-record-card-border');
    expect(recordCard).toContain('--parent-record-card-shadow');
    expect(recordCard).toContain('--parent-record-card-subtitle-color');
  });

  it('matches the asymmetric profile hero composition from the source artwork', () => {
    const styles = read('pages/parent/profile/index.wxss');
    const markup = read('pages/parent/profile/index.wxml');

    expect(styles).toMatch(/\.profile__backdrop\s*\{[^}]*top:\s*370rpx/s);
    expect(styles).toMatch(/\.profile__backdrop\s*\{[^}]*z-index:\s*0/s);
    expect(styles).toMatch(/\.profile__backdrop\s*\{[^}]*width:\s*1050rpx/s);
    expect(styles).toMatch(/\.profile__backdrop\s*\{[^}]*transform:\s*translateX\(-61%\)/s);
    expect(styles).toMatch(/\.profile__hero\s*\{[^}]*height:\s*507rpx/s);
    expect(styles).toMatch(/\.profile__hero\s*\{[^}]*z-index:\s*1/s);
    expect(styles).toMatch(/\.profile__mascot\s*\{[^}]*top:\s*-68rpx/s);
    expect(styles).toMatch(/\.profile__mascot\s*\{[^}]*z-index:\s*1/s);
    expect(styles).toMatch(/\.profile__mascot\s*\{[^}]*width:\s*496rpx/s);
    expect(styles).toMatch(/\.profile__mascot\s*\{[^}]*transform:\s*translateX\(-31%\)/s);
    expect(markup).toContain('class="profile__student-card-bg"');
    expect(styles).toMatch(/\.profile__student-card-bg,[\s\S]*?left:\s*14rpx/s);
    expect(styles).toMatch(/\.profile__student-card-bg,[\s\S]*?width:\s*653rpx/s);
    expect(styles).toMatch(/\.profile__student-card-bg,[\s\S]*?min-height:\s*265rpx/s);
    expect(styles).toMatch(/\.profile__student-card-bg,[\s\S]*?bottom:\s*0/s);
    expect(styles).toMatch(/\.profile__student-card-bg\s*\{[^}]*background:\s*#fe8419/s);
    expect(styles).toMatch(
      /\.profile__student-card-bg\s*\{[^}]*box-shadow:\s*0 13rpx 24rpx rgba\(24,\s*18,\s*14,\s*0\.19\)/s,
    );
    expect(styles).toMatch(/\.profile__student-card\s*\{[^}]*z-index:\s*2/s);
    expect(styles).not.toMatch(/\.profile__student-card\s*\{[^}]*right:/s);
    expect(styles).toMatch(/\.profile__student-name\s*\{[^}]*font-size:\s*100rpx/s);
    expect(styles).toMatch(/\.profile__student-age\s*\{[^}]*font-size:\s*50rpx/s);
  });

  it('keeps the profile action panel narrow, translucent, and vertically compact', () => {
    const styles = read('pages/parent/profile/index.wxss');

    expect(styles).toMatch(/\.profile parent-action-card\s*\{[^}]*display:\s*block/s);
    expect(styles).toMatch(/\.profile parent-action-card\s*\{[^}]*z-index:\s*2/s);
    expect(styles).toMatch(/\.profile parent-action-card\s*\{[^}]*width:\s*653rpx/s);
    expect(styles).toMatch(/\.profile parent-action-card\s*\{[^}]*margin-top:\s*54rpx/s);
    expect(styles).toMatch(/\.profile parent-action-card\s*\{[^}]*margin-left:\s*14rpx/s);
    expect(styles).toMatch(/\.profile parent-action-card\s*\{[^}]*--parent-yellow-card:\s*rgba\(255,\s*215,\s*94,\s*0\.84\)/s);
    expect(styles).toMatch(
      /\.profile parent-action-card\s*\{[^}]*--parent-action-card-shadow:\s*0 13rpx 24rpx rgba\(24,\s*18,\s*14,\s*0\.19\)/s,
    );
    expect(styles).toMatch(/\.actions__row\s*\{[^}]*min-height:\s*74rpx/s);
    expect(styles).toMatch(/\.actions__row\s*\{[^}]*border-bottom:\s*4rpx solid #ffffff/s);
    expect(styles).toMatch(/\.actions__dot\s*\{[^}]*margin-right:\s*40rpx/s);
    expect(styles).toMatch(/\.actions__label\s*\{[^}]*font-size:\s*36rpx/s);
    expect(styles).toMatch(/\.actions__button\s*\{[^}]*min-width:\s*108rpx/s);
    expect(styles).toMatch(/\.actions__button\s*\{[^}]*min-height:\s*55rpx/s);
    expect(styles).toMatch(/\.actions__button\s*\{[^}]*font-size:\s*24rpx/s);
    expect(styles).toMatch(/\.actions__button\s*\{[^}]*background:\s*#fe8419/s);
  });

  it('uses the display face for the prominent repeated labels', () => {
    const records = read('components/parent-record-card/parent-record-card.wxss');
    const profile = read('pages/parent/profile/index.wxss');

    expect(records).toMatch(/\.record-card__title\s*\{[^}]*font-family:\s*var\(--parent-font-display\)/s);
    expect(profile).toMatch(/\.actions__label\s*\{[^}]*font-family:\s*var\(--parent-font-display\)/s);
  });
});
