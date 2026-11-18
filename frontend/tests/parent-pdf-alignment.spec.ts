import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const read = (file: string): string => {
  const target = path.join(root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
};
const pages = ['home', 'courses', 'hours', 'leave', 'profile', 'updates'];

describe('parent PDF swatches and layout isolation', () => {
  it('imports the new palette only in the six PDF pages', () => {
    for (const page of pages) {
      expect(read(`pages/parent/${page}/index.wxss`))
        .toContain('@import "../../../styles/parent-pdf.wxss";');
    }
    expect(read('app.wxss')).not.toContain('parent-pdf.wxss');
    for (const page of ['home', 'profile']) {
      expect(read(`pages/teacher/${page}/index.wxss`))
        .not.toContain('parent-pdf.wxss');
    }
  });

  it('defines the sampled swatches without rewriting shared role tokens', () => {
    const palette = read('styles/parent-pdf.wxss');
    for (const declaration of [
      '--parent-orange: #fe8319;',
      '--parent-yellow: #f6d468;',
      '--parent-yellow-card: #f6d468;',
      '--parent-yellow-bright: #f6d468;',
      '--parent-ink: #2c4240;',
      '--parent-date-red: #8c0003;',
      '--parent-pdf-plus: #fe0000;',
      '--parent-pdf-metric-label: #f66b40;',
    ]) expect(palette).toContain(declaration);
    expect(palette).not.toMatch(/--role-[\w-]+\s*:/);
    expect(read('styles/tokens.wxss'))
      .toContain('--parent-orange: #fe8419;');
  });

  it('opts home into its own gradient and overridable wave geometry', () => {
    const home = read('pages/parent/home/index.wxss');
    const shell = read('components/parent-page-shell/parent-page-shell.wxss');
    expect(home).toContain('--parent-yellow: var(--parent-pdf-home-gradient)');
    expect(home).not.toContain('--parent-yellow: var(--role-home-yellow-gradient)');
    expect(shell).toContain('top: var(--parent-shell-wave-top, -520rpx)');
    expect(shell).toContain('transform: var(--parent-shell-wave-transform, none)');
    expect(read('pages/parent/home/index.wxml'))
      .toContain('waveSrc="/pages/parent/assets/top-wave.png"');
    expect(home).toContain('--parent-shell-wave-height: 240rpx');
    expect(home).toContain('--parent-shell-wave-transform: none');
    expect(read('pages/parent/updates/index.wxml'))
      .toContain('waveSrc="/pages/parent/assets/top-wave.png"');
    expect(read('components/parent-page-shell/parent-page-shell.ts'))
      .toContain("waveSrc: { type: String, value: '' }");
    expect(shell).toMatch(/\.shell__wave--asset\s*\{[^}]*background:\s*transparent/s);
    expect(shell).toMatch(/\.shell--white\s*\{\s*background:\s*#ffffff;\s*\}/s);
    for (const page of ['courses', 'hours', 'leave', 'profile']) {
      expect(read(`pages/parent/${page}/index.wxml`)).not.toContain('waveSrc=');
    }
    expect(read('components/parent-page-shell/parent-page-shell.wxml'))
      .toContain('<view wx:else class="shell__wave"');
    expect(home).toMatch(/\.stage\s*\{[^}]*height:\s*704rpx/s);
    expect(home).toMatch(/\.stage__mascot\s*\{[^}]*top:\s*-122rpx/s);
    expect(home).toMatch(/\.quickbar\s*\{[^}]*margin-top:\s*29rpx/s);
    expect(home).toMatch(/\.quickbar\s*\{[^}]*margin-left:\s*9rpx/s);
    expect(home).toMatch(/\.home\s*\{[^}]*padding-bottom:\s*calc\(48rpx \+ env\(safe-area-inset-bottom\)\)/s);
    expect(read('components/parent-metric-card/parent-metric-card.wxss'))
      .toContain('var(--parent-metric-label-color, #fb6c3f)');
  });

  it('adds the source curve shadow only to the two asset-wave pages without moving the wave', () => {
    const shell = read('components/parent-page-shell/parent-page-shell.wxss');
    expect(shell).toMatch(/\.shell__wave--asset\s*\{[^}]*filter:\s*var\(--parent-shell-wave-filter,\s*none\)/s);
    for (const page of ['home', 'updates']) {
      const styles = read(`pages/parent/${page}/index.wxss`);
      expect(styles).toContain('--parent-shell-wave-filter: drop-shadow(0 5rpx 17rpx rgba(24, 18, 14, 0.28))');
      expect(styles).toContain('--parent-shell-wave-top: 0');
      expect(styles).toContain('--parent-shell-wave-height: 240rpx');
    }
    for (const page of ['courses', 'hours', 'leave', 'profile']) {
      expect(read(`pages/parent/${page}/index.wxss`)).not.toContain('--parent-shell-wave-filter:');
    }
    expect(read('styles/tokens.wxss')).not.toContain('--parent-shell-wave-filter:');
  });

  it('uses regular private home text with source-standard date and weekday sizes', () => {
    const styles = read('pages/parent/home/index.wxss');
    for (const [selector, size] of [
      ['course__title', 64], ['course__day', 172], ['course__weekday', 32],
      ['course__name', 82], ['stage__student-name', 64], ['stage__student-age', 42],
    ] as const) {
      const block = styles.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`, 's'))?.[1] ?? '';
      expect(block).toContain('font-family: var(--parent-font-display)');
      expect(block).toContain('font-weight: 400');
      expect(block).toContain(`font-size: ${size}rpx`);
    }
  });

  it.each([
    'hours__title', 'ledger__title', 'balance-card__value', 'balance-card__unit',
    'hour-card__value', 'hour-card__unit',
  ])('uses the regular private font for hours %s', (selector) => {
    const styles = read('pages/parent/hours/index.wxss');
    const rule = styles.match(new RegExp(`\\.${selector}(?:\\s*,[^\\{]+)?\\s*\\{([^}]+)\\}`, 's'))?.[1] ?? '';
    expect(rule).toContain('font-family: var(--parent-font-display)');
    expect(rule).toContain('font-weight: 400');
  });

  it('uses regular parent-only metric text without adding shared typography configuration', () => {
    const styles = read('pages/parent/home/index.wxss');
    const card = read('components/parent-metric-card/parent-metric-card.wxss');
    expect(styles).not.toContain('--parent-metric-value-weight:');
    expect(styles).not.toContain('--parent-metric-unit-family:');
    expect(card).toMatch(/\.metric-card__value\s*\{[^}]*font-weight:\s*400/s);
    expect(card).toMatch(/\.metric-card__unit--percent\s*\{[^}]*font-weight:\s*400/s);
    expect(card).toMatch(/\.metric-card__unit\s*\{[^}]*font-family:\s*var\(--parent-font-display\)/s);
    expect(card).not.toContain('--parent-metric-value-weight');
    expect(card).not.toContain('--parent-metric-unit-family');
    for (const page of ['courses', 'hours', 'leave', 'profile', 'updates']) {
      expect(read(`pages/parent/${page}/index.wxss`)).not.toContain('--parent-metric-value-weight:');
      expect(read(`pages/parent/${page}/index.wxss`)).not.toContain('--parent-metric-unit-family:');
    }
    expect(read('styles/tokens.wxss')).not.toContain('--parent-metric-value-weight:');
    expect(read('styles/tokens.wxss')).not.toContain('--parent-metric-unit-family:');
  });

  it('limits the parent metric component to its sole current home consumer', () => {
    const directory = path.join(root, 'pages');
    const consumers = fs.readdirSync(directory, { recursive: true })
      .filter((file): file is string => typeof file === 'string' && file.endsWith('.json'))
      .filter((file) => {
        const config = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        return Object.values(config.usingComponents ?? {})
          .includes('/components/parent-metric-card/parent-metric-card');
      })
      .map((file) => file.replace(/\\/g, '/'));
    expect(consumers).toEqual(['parent/home/index.json']);
  });

  it.each(['value', 'unit--percent'])('removes synthetic bold from the home metric %s', (kind) => {
    const styles = read('components/parent-metric-card/parent-metric-card.wxss');
    const rule = styles.match(new RegExp(`\\.metric-card__${kind}\\s*\\{([^}]+)\\}`, 's'))?.[1] ?? '';
    expect(rule).toContain('font-weight: 400');
    expect(rule).toContain('font-size: 49rpx');
    const colorRule = kind === 'value' ? rule
      : styles.match(/\.metric-card__unit\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(colorRule).toContain('color: #000000');
  });

  it('lets both small and percent units inherit the same private display family', () => {
    const styles = read('components/parent-metric-card/parent-metric-card.wxss');
    const markup = read('components/parent-metric-card/parent-metric-card.wxml');
    const unit = styles.match(/\.metric-card__unit\s*\{([^}]+)\}/s)?.[1] ?? '';
    const percent = styles.match(/\.metric-card__unit--percent\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(unit).toContain('font-size: 15rpx');
    expect(unit).toContain('font-family: var(--parent-font-display)');
    expect(percent).not.toContain('font-family:');
    expect(percent).toContain('line-height: 1');
    expect(markup).toContain("metric-card__unit {{item.unit === '%' ? 'metric-card__unit--percent' : ''}}");
  });

  it('uses a page-local compact size for long course names while retaining natural full-text wrapping', () => {
    const styles = read('pages/parent/home/index.wxss');
    const markup = read('pages/parent/home/index.wxml');
    expect(markup).toContain('class="course__name {{hasShortCourseName ? \'course__name--short\' : hasLongCourseName ? \'course__name--long\' : \'\'}}"');
    expect(markup).toContain('<block wx:else>{{course.name}}</block>');
    expect(markup).toContain('{{courseNamePrefix}}<text class="course__name-tail">{{courseNameTail}}</text>');
    expect(markup).toContain('<block wx:if="{{courseNameTail !== \'\'}}">');
    expect(styles).toMatch(/\.course__name--long\s*\{\s*font-size:\s*64rpx;\s*\}/s);
    expect(styles).toMatch(/\.course__name-tail\s*\{[^}]*display:\s*inline-block;[^}]*white-space:\s*nowrap/s);
    const block = styles.match(/\.course__name\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(block).toContain('font-size: 82rpx');
    expect(block).toContain('white-space: normal');
    expect(block).toContain('overflow-wrap: anywhere');
    expect(block).not.toMatch(/text-overflow|line-clamp|max-height|overflow:\s*hidden/);
    expect(read('styles/tokens.wxss')).not.toContain('course__name--long');
  });

  it('limits the larger source-standard course size to a page-local short-name modifier', () => {
    const styles = read('pages/parent/home/index.wxss');
    expect(styles).toMatch(/\.course__name--short\s*\{\s*font-size:\s*101rpx;\s*\}/s);
    expect(styles).toMatch(/\.course__name\s*\{[^}]*font-size:\s*82rpx/s);
    expect(styles).toMatch(/\.course__date\s*\{[^}]*width:\s*190rpx/s);
    expect(styles).toMatch(/\.course__day\s*\{[^}]*line-height:\s*1;/s);
    expect(styles).toMatch(/\.course__name\s*\{[^}]*line-height:\s*1\.1;/s);
    for (const file of ['styles/tokens.wxss', 'styles/parent-pdf.wxss']) {
      expect(read(file)).not.toContain('course__name--short');
    }
  });

  it('uses explicit home-sheet presence flags instead of ambiguous negated length bindings', () => {
    const markup = read('pages/parent/home/index.wxml');
    expect(markup).toContain('wx:if="{{!hasTeachers}}" class="home-sheet__empty"');
    expect(markup).toContain('wx:if="{{!hasReminders}}" class="home-sheet__empty"');
    expect(markup).not.toContain('!teachers.length');
    expect(markup).not.toContain('!reminders.length');
  });

  it('binds private home name sizing without changing the ordinary face or the age', () => {
    const markup = read('pages/parent/home/index.wxml');
    const styles = read('pages/parent/home/index.wxss');
    expect(markup).toContain('class="stage__student-name" style="font-size: {{studentNameFontSize}}rpx;"');
    expect(markup).toContain('{{student.name}}</text>');
    const name = styles.match(/\.stage__student-name\s*\{([^}]+)\}/s)?.[1] ?? '';
    const age = styles.match(/\.stage__student-age\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(name).toContain('max-width: 480rpx');
    expect(name).toContain('font-size: 64rpx');
    expect(name).toContain('text-overflow: ellipsis');
    expect(age).toContain('font-size: 42rpx');
    expect(age).toContain('flex: none');
  });

  it('protects the final pair only for long campus names while preserving full natural wrapping', () => {
    const markup = read('pages/parent/home/index.wxml');
    const styles = read('pages/parent/home/index.wxss');
    expect(markup).toContain('wx:if="{{hasLongCampusName}}"');
    expect(markup).toContain('{{campusNamePrefix}}<text class="course__campus-tail">{{campusNameTail}}</text>');
    expect(markup).toContain('<block wx:else>{{course.campus}}</block>');
    expect(styles).toMatch(/\.course__campus-tail\s*\{[^}]*display:\s*inline-block;[^}]*white-space:\s*nowrap/s);
    const campus = styles.match(/\.course__campus\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(campus).toContain('font-size: 29rpx');
    expect(campus).not.toMatch(/text-overflow|line-clamp|max-height|overflow:\s*hidden/);
    expect(read('styles/tokens.wxss')).not.toContain('course__campus-tail');
  });

  it.each(['campus', 'time'])('uses the new source body size for home %s without clipping facts', (kind) => {
    const styles = read('pages/parent/home/index.wxss');
    const block = styles.match(new RegExp(`\\.course__${kind}\\s*\\{([^}]+)\\}`, 's'))?.[1] ?? '';
    expect(block).toContain('font-size: 29rpx');
    expect(block).toContain('color: var(--parent-on-color)');
    expect(block).not.toMatch(/font-family|font-weight|line-height|text-overflow|line-clamp|max-height|overflow:\s*hidden/);
    expect(read('pages/parent/styles/pdf-typography.wxss'))
      .toContain('font-family: var(--parent-font-body)');
  });

  it('lets growth content determine page length without nested vertical scrollers', () => {
    const styles = read('pages/parent/updates/index.wxss');
    const markup = read('pages/parent/updates/index.wxml');
    const growth = styles.match(/\.growth\s*\{([^}]+)\}/s)?.[1] ?? '';
    const feedback = styles.match(/\.growth-feedback\s*\{([^}]+)\}/s)?.[1] ?? '';
    const note = styles.match(/\.growth-review__note\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(styles).toMatch(/\.growth\s*\{[^}]*box-sizing:\s*border-box/s);
    expect(growth).not.toMatch(/(?:^|[;\s])(?:height|max-height):/);
    expect(growth).toContain('padding-bottom: calc(16rpx + env(safe-area-inset-bottom))');
    expect(markup).not.toContain('contentHeight');
    expect(markup).not.toContain('<scroll-view');
    expect(feedback).not.toMatch(/(?:^|[;\s])(?:height|max-height|flex):/);
    expect(styles).not.toContain('growth-feedback__scroll');
    expect(styles).toMatch(/\.growth-feedback__inner\s*\{[^}]*padding-right:\s*16rpx/s);
    expect(markup).toMatch(/<view class="growth-feedback">\s*<view class="growth-feedback__inner">/s);
    expect(markup).toContain('id="growth-feedback-{{current.lessonSessionId}}"');
    expect(markup).toMatch(/<view[^>]*class="growth-review__note growth-review__note--readonly"/s);
    expect(markup).toContain('auto-height="{{true}}"');
    expect(note).toContain('min-height: 88rpx');
    expect(note).not.toMatch(/(?:^|[;\s])(?:height|max-height):/);
    expect(note).toContain('white-space: pre-wrap');
    expect(styles).not.toMatch(/\.growth-notices\s*\{[^}]*max-height:/s);
    expect(styles).toMatch(/\.growth-feedback__content\s*\{[^}]*line-height:\s*1\.4/s);
    expect(styles).toMatch(/\.growth-review__row\s*\{[^}]*min-height:\s*64rpx/s);
    expect(styles).toMatch(/\.growth-identity\s*\{[^}]*height:\s*216rpx/s);
    expect(styles).toMatch(/\.growth-identity__empty\s*\{[^}]*box-sizing:\s*border-box/s);
    expect(styles).toMatch(/\.growth-identity__empty\s*\{[^}]*padding-bottom:\s*100rpx/s);
    expect(styles).toMatch(/\.growth-feedback\s*\{[^}]*background:\s*var\(--parent-orange\)/s);
    expect(styles).toContain('--parent-yellow: var(--parent-pdf-home-gradient)');
    expect(styles).toMatch(/\.growth-review\s*\{[^}]*background:\s*linear-gradient\(/s);
    expect(styles).toMatch(/\.growth-review\s*\{[^}]*#fd8d29/s);
    expect(styles).toMatch(/\.growth-star__base\s*\{[^}]*opacity:\s*0\.6/s);
    expect(markup).toContain('src="{{student.photo.accessUrl}}"');
    expect(markup).toContain('id="parent-review-submit"');
    expect(markup).toContain('style="width: {{fill}}%;"');
  });

  it('uses a white catalog with a bottom wave and the intact camera mascot', () => {
    const markup = read('pages/parent/courses/index.wxml');
    const styles = read('pages/parent/courses/index.wxss');
    expect(markup).not.toContain('backgroundColor="linear-gradient');
    expect(styles).toContain('.catalog::before');
    expect(styles).toMatch(/\.catalog\s*\{[^}]*padding:\s*64rpx 9rpx 8rpx/s);
    expect(styles).toMatch(/\.catalog__list\s*\{[^}]*height:\s*calc\(46% \+ 8rpx\)/s);
    expect(styles).toMatch(/\.catalog::before\s*\{[^}]*pointer-events:\s*none/s);
    expect(styles).toMatch(/\.course-row__name\s*\{[^}]*font-size:\s*38rpx/s);
    expect(styles).toMatch(/\.catalog__mascot\s*\{[^}]*width:\s*300rpx/s);
    expect(markup).toContain('/pages/parent/assets/profile-mascot.png');
  });

  it('matches the new source quote typography without changing scroll or touch geometry', () => {
    const styles = read('pages/parent/courses/index.wxss');
    const details = styles.match(/\.quote-row__details\s*\{([^}]+)\}/s)?.[1] ?? '';
    expect(details).toContain('font-family: var(--parent-font-display)');
    expect(details).toContain('font-size: 18.66667rpx');
    expect(details).toContain('font-weight: 400');
    expect(details).toContain('line-height: 1.4');
    expect(details).toContain('min-width: 0');
    expect(details).toContain('overflow-wrap: anywhere');
    expect(styles).toMatch(/\.catalog__quote-scroll\s*\{[^}]*max-height:\s*390rpx/s);
    expect(styles).toMatch(/\.quote-row__map\s*\{[^}]*width:\s*44rpx;[^}]*height:\s*44rpx/s);
    expect(styles).toMatch(/\.catalog__close\s*\{[^}]*width:\s*48rpx;[^}]*height:\s*48rpx/s);
  });

  it('exposes both dynamic quote text nodes for native layout measurements', () => {
    const markup = read('pages/parent/courses/index.wxml');
    expect(markup.match(/class="quote-row__text"/g) ?? []).toHaveLength(2);
    expect(markup).toContain('<text class="quote-row__text">{{quote.campus.name}}</text>');
    expect(markup).toContain('<text class="quote-row__text">{{quote.priceLabel}} / {{quote.unitsLabel}}</text>');
  });

  it('keeps native dashed records while raising leave text hierarchy', () => {
    const styles = read('pages/parent/leave/index.wxss');
    expect(styles).toContain('--parent-record-card-subtitle-size: 20rpx');
    expect(styles).toContain('--parent-record-card-plain-tag-size: 32rpx');
    expect(styles).toMatch(/\.records__item\s*\{[^}]*background-clip:\s*padding-box/s);
    expect(styles).toMatch(/\.records__item\s*\{[^}]*border:\s*4rpx dashed rgba\(254,\s*131,\s*25,\s*0\.4\)/s);
    expect(styles).toMatch(/\.field__control,[\s\S]*?font-size:\s*28rpx/s);
  });

  it('scopes the brighter leave form and darker labels to this page', () => {
    const styles = read('pages/parent/leave/index.wxss');
    expect(styles).toMatch(/\.leave parent-action-card\s*\{[^}]*--parent-yellow-bright:\s*#ffd75e/s);
    expect(styles).toMatch(/\.field__label\s*\{[^}]*color:\s*var\(--parent-ink\)/s);
    expect(styles).toMatch(/\.field__control,[\s\S]*?background:\s*#fbd45d/s);
    expect(styles).toMatch(/\.records__title\s*\{[^}]*color:\s*#000000/s);
    expect(read('styles/parent-pdf.wxss')).toContain('--parent-yellow-bright: #f6d468;');
  });

  it('uses the display face for the leave result line without restyling other record subtitles', () => {
    const styles = read('pages/parent/leave/index.wxss');
    const card = read('components/parent-record-card/parent-record-card.wxss');
    const markup = read('pages/parent/leave/index.wxml');
    expect(styles).toContain('--parent-record-card-subtitle-family: var(--parent-font-display)');
    expect(styles).toContain('--parent-record-card-subtitle-weight: 600');
    expect(card).toContain('font-family: var(--parent-record-card-subtitle-family, inherit)');
    expect(card).toContain('font-weight: var(--parent-record-card-subtitle-weight, inherit)');
    expect(markup).toMatch(/<text wx:if="\{\{item.reviewNote\}\}" class="records__review-note">\{\{item.reviewNote\}\}<\/text>/);
    expect(markup).toMatch(/tagText="\{\{item.statusLabel\}\}"[\s\S]*?<text wx:if="\{\{item.reviewNote\}\}"/);
    expect(styles).toMatch(/\.records__review-note\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });

  it('adds a passive bottom wave without shrinking profile cards or removing logout', () => {
    const styles = read('pages/parent/profile/index.wxss');
    const markup = read('pages/parent/profile/index.wxml');
    expect(styles).toContain('.profile::before');
    expect(styles).toMatch(/\.profile::before\s*\{[^}]*pointer-events:\s*none/s);
    expect(styles).toMatch(/\.profile::before\s*\{[^}]*bottom:\s*-180rpx/s);
    expect(styles).toMatch(/\.actions__row\s*\{[^}]*min-height:\s*82rpx/s);
    expect(styles).toMatch(/\.profile__student-name\s*\{[^}]*font-size:\s*95rpx/s);
    expect(markup).toContain('<session-logout');
    expect(markup).toContain('id="profile-identity"');
  });

  it('removes only the hours top wave and scopes the ledger tag radius', () => {
    const styles = read('pages/parent/hours/index.wxss');
    expect(read('pages/parent/hours/index.wxml')).toContain('showWave="{{false}}"');
    expect(styles).toContain('--parent-record-card-tag-radius: 16rpx');
    expect(styles).toMatch(/\.hour-cards__plus\s*\{[^}]*color:\s*var\(--parent-pdf-plus\)/s);
    expect(styles).toMatch(/\.ledger__card--filtered\s*\{[^}]*margin-top:\s*148rpx/s);
    expect(styles).toMatch(/\.ledger__mascot\s*\{[^}]*top:\s*-126rpx/s);
    expect(read('components/parent-record-card/parent-record-card.wxss'))
      .toContain('border-radius: var(--parent-record-card-tag-radius, 999rpx)');
  });

  it('restores the bright hours cards and dark display subtitles without changing the shared palette', () => {
    const styles = read('pages/parent/hours/index.wxss');
    expect(styles).toMatch(/\.hour-card\s*\{[^}]*background:\s*#ffd75e/s);
    expect(styles).toContain('--parent-record-card-subtitle-family: var(--parent-font-display)');
    expect(styles).toContain('--parent-record-card-subtitle-weight: 600');
    expect(styles).toContain('--parent-record-card-subtitle-color: var(--parent-ink)');
    expect(read('styles/parent-pdf.wxss')).toContain('--parent-yellow-bright: #f6d468;');
  });
});
