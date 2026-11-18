import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

describe('teacher source-artboard page guards', () => {
  it('keeps the teacher home materials aligned with the source artboard', () => {
    const tokens = read('styles/tokens.wxss');
    const shellMarkup = read('components/teacher-page-shell/teacher-page-shell.wxml');
    const shellStyles = read('components/teacher-page-shell/teacher-page-shell.wxss');
    const homeMarkup = read('pages/teacher/home/index.wxml');
    const homeStyles = read('pages/teacher/home/index.wxss');
    const statsStyles = read('components/teacher-stat-strip/teacher-stat-strip.wxss');

    expect(tokens).toContain(
      '--role-home-yellow-gradient: linear-gradient(180deg, #ebac0f 0%, #f8c948 48%, #ebac11 100%)',
    );
    expect(homeMarkup).toContain('tone="home"');
    expect(shellMarkup).toContain("tone === 'home'");
    expect(shellStyles).toMatch(
      /\.shell--home\s*\{[^}]*background:\s*var\(--teacher-gradient\)/s,
    );
    expect(homeStyles).toMatch(
      /\.home__identity\s*\{[^}]*flex-direction:\s*row[^}]*background:\s*transparent/s,
    );
    expect(homeStyles).toMatch(
      /\.lesson-card\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1[^}]*grid-template-columns:\s*231rpx 4rpx minmax\(0, 1fr\)/s,
    );
    expect(homeStyles).toMatch(
      /\.lesson-card__clock,[^{]*\.lesson-card__detail\s*\{[^}]*transform:\s*translateY\(-25rpx\)/s,
    );
    expect(homeStyles).toMatch(
      /\.lesson-card__divider\s*\{[^}]*align-self:\s*start[^}]*width:\s*4rpx[^}]*height:\s*127rpx[^}]*margin-top:\s*37rpx/s,
    );
    expect(homeStyles).toMatch(/\.lesson-card__detail\s*\{[^}]*padding-left:\s*32rpx/s);
    expect(homeStyles).toMatch(/\.lesson-card__time\s*\{[^}]*font-size:\s*95rpx/s);
    expect(homeStyles).toMatch(/\.lesson-card__course\s*\{[^}]*font-size:\s*76rpx/s);
    expect(homeStyles).toMatch(
      /\.home__schedule-head\s*\{[^}]*justify-content:\s*flex-start[^}]*gap:\s*18rpx[^}]*margin-left:\s*8rpx/s,
    );
    expect(homeStyles).toMatch(
      /\.home__more,[^{]*\.home__footer-more\s*\{[^}]*min-height:\s*var\(--role-home-more-height\)[^}]*border:\s*var\(--role-home-more-border\)/s,
    );
    expect(homeMarkup).toContain('{{nextLesson.statusPrefix}}');
    expect(homeMarkup).toContain('>{{nextLesson.statusLabel}}</text>');
    expect(homeStyles).toMatch(
      /\.lesson-card__status-line\s*\{[^}]*transform:\s*translateY\(0\)/s,
    );
    expect(homeStyles).toMatch(
      /\.home__footer-actions\s*\{[^}]*align-items:\s*flex-start[^}]*margin-top:\s*-32rpx/s,
    );
    expect(homeStyles).toMatch(
      /\.quick-actions\s*\{[^}]*width:\s*var\(--role-home-nav-width\)[^}]*height:\s*var\(--role-home-nav-active-size\)/s,
    );
    expect(homeStyles).toMatch(
      /\.quick-action__icon\s*\{[^}]*width:\s*38rpx[^}]*height:\s*38rpx/s,
    );
    expect(homeStyles).toMatch(
      /\.quick-action--active \.quick-action__icon\s*\{[^}]*width:\s*54rpx[^}]*height:\s*56rpx/s,
    );
    expect(homeStyles).toMatch(
      /\.quick-action__label\s*\{[^}]*font-size:\s*16rpx/s,
    );
    expect(homeStyles).toMatch(
      /\.quick-action--active \.quick-action__label\s*\{[^}]*font-size:\s*16rpx/s,
    );
    const statsMarkup = read('components/teacher-stat-strip/teacher-stat-strip.wxml');
    expect(statsMarkup).toContain('/assets/teacher/home-stat-glass.png');
    expect(statsMarkup).not.toContain('/assets/parent/');
    expect(statsStyles).toMatch(
      /\.stats__glass\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0/s,
    );
    expect(statsStyles).toMatch(
      /\.stats__item \+ \.stats__item\s*\{[^}]*border-left:\s*3rpx solid rgba\(255, 255, 255, 0\.88\)/s,
    );
    expect(statsStyles).toMatch(
      /\.stats__value\s*\{[^}]*color:\s*#000000/s,
    );
    expect(statsStyles).toMatch(
      /\.stats__unit\s*\{[^}]*color:\s*#000000/s,
    );
  });

  it('keeps the shared login neutral instead of showing a role mascot', () => {
    const markup = read('pages/bootstrap/index.wxml');
    const styles = read('pages/bootstrap/index.wxss');

    expect(markup).not.toContain('/assets/teacher/home-mascot.png');
    expect(markup).not.toContain('bootstrap__mascot');
    expect(markup).not.toContain('bootstrap__sun');
    expect(markup).not.toContain('bootstrap__role');
    expect(markup).toContain('class="bootstrap__state bootstrap__state--login"');
    expect(markup).not.toContain('class="bootstrap__top"');
    expect(styles).toMatch(/\.bootstrap\s*\{[^}]*background:\s*#f6f7f9/s);
    expect(styles).toMatch(
      /\.bootstrap__content\s*\{[^}]*align-items:\s*center[^}]*justify-content:\s*flex-start/s,
    );
    expect(styles).toMatch(
      /\.bootstrap__state--login\s*\{[^}]*align-items:\s*center[^}]*width:\s*100%[^}]*text-align:\s*center/s,
    );
  });

  it('uses the teacher theme on the schedule review sample', () => {
    const scheduleMarkup = read('pages/teacher/schedule/index.wxml');
    const scheduleStyles = read('pages/teacher/schedule/index.wxss');

    expect(scheduleMarkup).toContain('tone="yellow"');
    // PSD 课表屏没有右上角日期/状态筛选入口，折叠态筛选条也不在屏上。
    expect(scheduleMarkup).not.toContain('class="schedule-tools"');
    expect(scheduleMarkup).not.toContain('class="status-filter"');
    expect(scheduleStyles).toMatch(
      /\.lesson-row__toggle\s*\{[^}]*border-radius:\s*38rpx[^}]*background:\s*var\(--teacher-orange\)/s,
    );
    expect(scheduleStyles).toMatch(
      /\.lesson-row--today\s+\.lesson-row__toggle\s*\{[^}]*background:\s*#2dc02d/s,
    );
    expect(scheduleStyles).toMatch(
      /\.lesson-row__time-value\s*\{[^}]*font-size:\s*95rpx[^}]*color:\s*#ffffff/s,
    );
  });

  it('extends the approved workspace theme across every derived teacher page', () => {
    const bannerPages = [
      'lesson',
      'records',
      'ledger',
    ];
    const derivedPages = ['schedule', 'students', ...bannerPages, 'settings'];

    for (const page of derivedPages) {
      const markup = read(`pages/teacher/${page}/index.wxml`);
      expect(markup).toContain('tone="yellow"');
    }

    // PSD 学员档案屏没有工作区摘要条，卡片自带上屏标题。
    const studentsMarkup = read('pages/teacher/students/index.wxml');
    expect(studentsMarkup).not.toContain('teacher-workspace-banner');
    expect(
      (JSON.parse(read('pages/teacher/students/index.json')) as {
        usingComponents: Record<string, string>;
      }).usingComponents['teacher-workspace-banner'],
    ).toBeUndefined();

    // PSD a3 课时账户屏同样没有摘要条：屏标题 + 内部预计说明 + 三个区块。
    const earningsMarkup = read('pages/teacher/earnings/index.wxml');
    expect(earningsMarkup).toContain('tone="account"');
    expect(earningsMarkup).toContain('/pages/teacher/assets/account-mascot.png');
    expect(earningsMarkup).not.toContain('teacher-workspace-banner');
    expect(earningsMarkup).toContain('<text class="section-title">课时流水</text>');
    expect(earningsMarkup).toContain('>筛选</button>');
    expect(earningsMarkup).toContain('<text class="section-title">教师贡献度排名</text>');
    expect(earningsMarkup).toContain('查看更多</button>');
    expect(earningsMarkup).not.toContain('rule-card');

    for (const page of bannerPages) {
      const markup = read(`pages/teacher/${page}/index.wxml`);
      const config = JSON.parse(read(`pages/teacher/${page}/index.json`)) as {
        usingComponents: Record<string, string>;
      };
      expect(markup).toContain('<teacher-workspace-banner');
      expect(config.usingComponents['teacher-workspace-banner']).toBe(
        '/components/teacher-workspace-banner/teacher-workspace-banner',
      );
    }

    expect(read('pages/teacher/settings/index.wxml')).toContain(
      'class="settings-identity"',
    );
    expect(read('pages/teacher/settings/index.wxss')).toMatch(
      /\.settings-identity__mascot\s*\{[^}]*right:\s*-24rpx[^}]*top:\s*-10rpx[^}]*width:\s*300rpx/s,
    );
  });

  it('keeps teacher earnings commands Chinese, numeric, and duplicate-safe', () => {
    const markup = read('pages/teacher/earnings/index.wxml');
    const logic = read('pages/teacher/earnings/index.ts');

    expect(markup).toContain('showBack="{{true}}"');
    expect(markup).toContain('收益明细');
    expect(markup).toContain('提现记录');
    expect(markup).toContain('内部预计');
    expect(markup).toContain('type="digit"');
    expect(markup).toContain('disabled="{{submitting');
    expect(markup).not.toMatch(
      /凯曼|KAIMAN|EDUCATION|brand-dog-head|brand-logo/i,
    );
    // 提现走页面持有的 runtime 适配器（teacherService 已下沉），重复保护由
    // canAct/withdrawalReady/recovery.inflight 组合守卫承担，见 2026-11 收益页重构。
    expect(logic).toMatch(
      /if \(!this\.canAct\(\) \|\| !this\.data\.withdrawalReady \|\| !this\.recovery \|\|\s*this\.recovery\.inflight \|\| \(this\.recovery\.command[\s\S]*?return Promise\.resolve\(\);/,
    );
    expect(logic).toContain('runtime.createWithdrawal');
    expect(logic).toContain('runtime.cancelWithdrawal');
  });

  it('keeps prohibited branding and design-example values out of both pages', () => {
    for (const page of ['home', 'profile']) {
      const markup = read(`pages/teacher/${page}/index.wxml`);
      expect(markup).not.toMatch(
        /凯曼|KAIMAN|EDUCATION|brand-dog-head|brand-logo|王老师|专业美术A|35人/i,
      );
    }
  });

  it('renders PSD mascots and functional icons as separate asset layers', () => {
    const home = read('pages/teacher/home/index.wxml');
    const homePresenter = read('services/teacher-home.presenter.ts');
    const profile = read('pages/teacher/profile/index.wxml');

    expect(home).toContain('/assets/teacher/home-mascot.png');
    for (const icon of [
      'icon-student-record.png',
      'icon-confirm.png',
      'icon-students.png',
      'icon-schedule.png',
    ]) {
      expect(homePresenter).toContain(`/pages/teacher/assets/${icon}`);
    }
    expect(home).toContain('src="{{item.icon}}"');
    expect(profile).toContain('/pages/teacher/assets/profile-card-mascot.png');
    expect(profile).toContain('/pages/teacher/assets/profile-footer-mascot.png');
  });

  it('keeps the teacher profile composition aligned with the source artboard', () => {
    const profileMarkup = read('pages/teacher/profile/index.wxml');
    const profileStyles = read('pages/teacher/profile/index.wxss');
    const actionMarkup = read('components/teacher-action-row/teacher-action-row.wxml');
    const actionStyles = read('components/teacher-action-row/teacher-action-row.wxss');
    const actionLogic = read('components/teacher-action-row/teacher-action-row.ts');

    expect(profileMarkup).toContain('showBack="{{true}}"');
    expect(profileMarkup).not.toContain('profile__campus');
    expect(profileMarkup).toContain('bullet="{{true}}"');
    expect(profileMarkup).not.toContain('class="profile__subject-label">授课</text>');
    expect(profileMarkup).toContain('wx:for="{{subjectLines}}"');
    expect(profileMarkup).toMatch(
      /profile__student-count[^>]*>{{studentCount}}人<\/text>/,
    );
    expect(profileStyles).toMatch(
      /\.profile\s*\{[^}]*padding-top:\s*84rpx[^}]*padding-bottom:\s*0/s,
    );
    expect(profileStyles).toMatch(/\.profile__hero\s*\{[^}]*height:\s*456rpx/s);
    // PDF P23 为左侧姓名、右侧完整人物；不存在独立圆头像。
    expect(profileMarkup).not.toContain('class="profile__avatar"');
    expect(profileStyles).toMatch(
      /\.profile__identity-card\s*\{[^}]*flex-direction:\s*column[^}]*min-height:\s*263rpx/s,
    );
    expect(profileStyles).toMatch(
      /\.profile__card-mascot\s*\{[^}]*right:\s*-32rpx[^}]*width:\s*462rpx/s,
    );
    expect(profileStyles).toMatch(/\.profile__name\s*\{[^}]*font-size:\s*95rpx/s);
    expect(profileStyles).toMatch(
      /\.profile__subject\s*\{[^}]*font-size:\s*63rpx/s,
    );
    expect(profileStyles).toMatch(
      /\.profile__student-count\s*\{[^}]*font-size:\s*63rpx/s,
    );
    expect(profileStyles).toMatch(
      /\.profile__actions-stage\s*\{[^}]*margin-top:\s*54rpx/s,
    );
    expect(profileStyles).toMatch(
      /\.profile__footer-mascot\s*\{[^}]*top:\s*100rpx[^}]*left:\s*-32rpx[^}]*width:\s*573rpx[^}]*opacity:\s*1/s,
    );
    expect(profileStyles).toMatch(
      /\.profile-actions\s*\{[^}]*width:\s*653rpx/s,
    );
    expect(actionMarkup).toContain('wx:if="{{bullet}}"');
    expect(actionLogic).toContain("bullet: { type: Boolean, value: false }");
    expect(actionStyles).toMatch(
      /\.row__bullet\s*\{[^}]*width:\s*18rpx[^}]*height:\s*18rpx[^}]*border-radius:\s*50%/s,
    );
    expect(actionStyles).toMatch(
      /\.row__label\s*\{[^}]*font-family:\s*var\(--teacher-action-label-font,\s*var\(--teacher-font-body\)\)/s,
    );
  });

  it('exposes loading, empty, error, forbidden and retry behavior', () => {
    const homeMarkup = read('pages/teacher/home/index.wxml');
    const profileMarkup = read('pages/teacher/profile/index.wxml');
    const homeLogic = read('pages/teacher/home/index.ts');
    const profileLogic = read('pages/teacher/profile/index.ts');

    expect(homeMarkup).toContain("viewState === 'loading'");
    expect(homeMarkup).toContain("viewState === 'empty'");
    expect(homeMarkup).toContain("viewState === 'error'");
    expect(homeMarkup).toContain("viewState === 'forbidden'");
    expect(profileMarkup).toContain("viewState === 'loading'");
    expect(profileMarkup).toContain("viewState === 'error'");
    expect(profileMarkup).toContain("viewState === 'forbidden'");
    expect(homeLogic).toMatch(/onRetry\(\)\s*\{\s*void this\.loadHome\(\)/s);
    expect(profileLogic).toMatch(/onRetry\(\)\s*\{\s*void this\.loadProfile\(\)/s);
  });

  it('keeps all command targets at or above the shared touch minimum', () => {
    const home = read('pages/teacher/home/index.wxss');
    const actionRow = read('components/teacher-action-row/teacher-action-row.wxss');

    expect(home).toMatch(/\.page-state__retry\s*\{[^}]*min-height:\s*var\(--teacher-touch-min\)/s);
    expect(home).toMatch(/\.quick-action\s*\{[^}]*min-height:\s*var\(--teacher-touch-min\)/s);
    expect(actionRow).toMatch(/\.row\s*\{[^}]*min-height:\s*var\(--teacher-touch-min\)/s);
  });

  it('keeps decorative teacher artwork out of mouse hit testing and exposes broad home targets', () => {
    const homeMarkup = read('pages/teacher/home/index.wxml');
    const homeStyles = read('pages/teacher/home/index.wxss');
    const profileStyles = read('pages/teacher/profile/index.wxss');

    expect(homeMarkup).toMatch(
      /class="lesson-card"[^>]*data-key="schedule"[^>]*bindtap="onActionTap"/s,
    );
    expect(homeMarkup).toMatch(
      /class="home__profile-hit"[^>]*bindtap="onProfileTap"/s,
    );
    expect(homeStyles).toMatch(
      /\.home__mascot\s*\{[^}]*pointer-events:\s*none/s,
    );
    expect(homeStyles).toMatch(
      /\.home__profile-hit\s*\{[^}]*position:\s*absolute[^}]*z-index:\s*1/s,
    );
    expect(profileStyles).toMatch(
      /\.profile__card-mascot,[^{]*\.profile__footer-mascot\s*\{[^}]*pointer-events:\s*none/s,
    );
  });

  it('centers labels inside teacher lesson, feedback, and earnings buttons', () => {
    const lessonStyles = read('pages/teacher/lesson/index.wxss');
    const feedbackDetailStyles = read(
      'pages/teacher/feedback-detail/index.wxss',
    );
    const earningsStyles = read('pages/teacher/earnings/index.wxss');

    expect(lessonStyles).toMatch(
      /\.attendance-option,[^{]*\.feedback-command\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1\.2/s,
    );
    expect(feedbackDetailStyles).toMatch(
      /\.feedback-card__save,[^{]*\.page-command\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1\.2/s,
    );
    expect(earningsStyles).toMatch(
      /\.segment__item,[^{]*\.dialog-command\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center[^}]*justify-content:\s*center[^}]*line-height:\s*1\.2/s,
    );
  });
});
