import * as fs from 'fs';
import * as path from 'path';
import {
  ApiSuperAdminDataSource,
  SuperAdminHttpRequest,
} from '../data/api-super-admin-data-source';
import { MockSuperAdminDataSource } from '../data/mock-super-admin-data-source';

describe('super admin complete workspace', () => {
  it('persists mock lesson adjustments into package and student balances', async () => {
    const source = new MockSuperAdminDataSource();
    const before = await source.getStudent('student-1');
    const packageBefore = before.coursePackages[0];
    const key = 'mock-adjust-persist-1';

    const first = await source.adjustLessonLedger(
      {
        coursePackageId: packageBefore.id,
        bucket: 'MAIN',
        deltaUnits: 100,
        reason: '演示调整后余额应立即生效',
      },
      key,
    );
    const replay = await source.adjustLessonLedger(
      {
        coursePackageId: packageBefore.id,
        bucket: 'MAIN',
        deltaUnits: 100,
        reason: '演示调整后余额应立即生效',
      },
      key,
    );
    const after = await source.getStudent('student-1');

    expect(replay).toEqual(first);
    expect(after.coursePackages[0]).toMatchObject({
      mainBalanceUnits: packageBefore.mainBalanceUnits + 100,
      totalBalanceUnits: packageBefore.totalBalanceUnits + 100,
    });
    expect(after).toMatchObject({
      mainBalanceUnits: before.mainBalanceUnits + 100,
      totalBalanceUnits: before.totalBalanceUnits + 100,
    });
  });

  it('uses global management routes and idempotency for lesson adjustments', async () => {
    const requests: Parameters<SuperAdminHttpRequest>[0][] = [];
    const source = new ApiSuperAdminDataSource({
      baseUrl: 'https://example.test/api/',
      accessToken: 'super-token',
      request: (options) => {
        requests.push(options);
        options.success({
          statusCode: 200,
          data: options.url.includes('adjustments')
            ? {
                data: {
                  id: 'entry-1',
                  entryType: 'ADJUSTMENT',
                  coursePackageId: 'package-1',
                },
                requestId: 'request-1',
              }
            : { data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } },
        });
      },
    });

    await source.listCampuses({ page: 1, pageSize: 20 });
    await source.listLessonLedger({ page: 1, pageSize: 20 });
    await source.adjustLessonLedger(
      {
        coursePackageId: 'package-1',
        bucket: 'MAIN',
        deltaUnits: 100,
        reason: '后台核对调整',
      },
      'adjust-key-1',
    );

    expect(requests.map(({ url }) => url)).toEqual([
      'https://example.test/api/management/campuses?page=1&pageSize=20',
      'https://example.test/api/management/lesson-ledger?page=1&pageSize=20',
      'https://example.test/api/management/lesson-ledger/adjustments',
    ]);
    expect(requests[2]).toMatchObject({
      method: 'POST',
      header: {
        Authorization: 'Bearer super-token',
        'Idempotency-Key': 'adjust-key-1',
      },
    });
  });

  it('registers every agreed total-client page and keeps brand restoration disabled', () => {
    const root = path.resolve(__dirname, '..');
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
      pages: string[];
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const superAdminPages =
      app.subPackages.find((item) => item.root === 'pages/super-admin')?.pages ??
      [];
    const pages = [
      'dashboard',
      'students',
      'student-detail',
      'campuses',
      'campus-detail',
      'lesson-ledger',
      'lesson-adjust',
      'earnings',
      'withdrawals',
      'earning-rules',
      'partner-earning-rules',
      'partner-earnings',
      'withdrawal-policies',
      'profile',
      'settings',
      'role-permissions',
      'audit-logs',
      'brand',
    ];
    for (const page of pages) {
      const route = `pages/super-admin/${page}/index`;
      expect(superAdminPages).toContain(`${page}/index`);
      for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
        expect(fs.existsSync(path.join(root, `${route}.${extension}`))).toBe(true);
      }
    }
    const brand = fs.readFileSync(
      path.join(root, 'pages/super-admin/brand/index.wxml'),
      'utf8',
    );
    expect(brand).toContain('独立 Logo 与品牌文字已停用');
    expect(brand).not.toMatch(/chooseImage|uploadFile|恢复Logo|上传Logo/i);
  });

  it('uses the colored total-client workspace on derived business pages', () => {
    const root = path.resolve(__dirname, '..');
    const workPages = [
      'dashboard',
      'students',
      'student-detail',
      'campuses',
      'campus-detail',
      'lesson-adjust',
      'earnings',
      'withdrawals',
      'earning-rules',
      'partner-earning-rules',
      'partner-earnings',
      'withdrawal-policies',
      'settings',
      'role-permissions',
      'audit-logs',
      'brand',
    ];

    for (const page of workPages) {
      const markup = fs.readFileSync(
        path.join(root, `pages/super-admin/${page}/index.wxml`),
        'utf8',
      );
      expect(markup).not.toContain('surface-page');
    }

    for (const page of ['profile', 'lesson-ledger']) {
      const markup = fs.readFileSync(
        path.join(root, `pages/super-admin/${page}/index.wxml`),
        'utf8',
      );
      expect(markup).toContain('surface-page');
    }

    const styles = fs.readFileSync(
      path.join(root, 'styles/super-admin-workspace.wxss'),
      'utf8',
    );
    expect(styles).toMatch(
      /\.workspace__head\s*\{[^}]*background:\s*var\(--super-admin-accent\)[^}]*box-shadow:/s,
    );
    expect(styles).toMatch(
      /\.row\s*\{[^}]*border-left:\s*8rpx solid var\(--super-admin-accent\)[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.92\)/s,
    );
    expect(styles).toMatch(
      /\.form\s*\{[^}]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.84\)/s,
    );
  });

  it('aligns total-client page marks and profile artwork with the teacher baseline', () => {
    const root = path.resolve(__dirname, '..');
    const shellMarkup = fs.readFileSync(
      path.join(root, 'components/super-admin-page-shell/super-admin-page-shell.wxml'),
      'utf8',
    );
    const shellStyles = fs.readFileSync(
      path.join(root, 'components/super-admin-page-shell/super-admin-page-shell.wxss'),
      'utf8',
    );
    const profileMarkup = fs.readFileSync(
      path.join(root, 'pages/super-admin/profile/index.wxml'),
      'utf8',
    );
    const profileStyles = fs.readFileSync(
      path.join(root, 'pages/super-admin/profile/index.wxss'),
      'utf8',
    );

    expect(
      fs.existsSync(
        path.join(root, 'pages/super-admin/assets/home-mark-glyph.png'),
      ),
    ).toBe(true);
    expect(shellMarkup).toContain("plainMark ? 'shell__mark--plain' : ''");
    expect(shellStyles).toMatch(
      /\.shell__mark\s*\{[^}]*width:\s*var\(--role-page-mark-size\)[^}]*height:\s*var\(--role-page-mark-size\)/s,
    );
    expect(shellStyles).toMatch(
      /\.shell__mark--plain\s*\{[^}]*width:\s*var\(--role-profile-mark-width\)[^}]*height:\s*var\(--role-profile-mark-height\)/s,
    );
    expect(profileMarkup).toContain('plain-mark="{{true}}"');
    expect(profileMarkup).toContain('/pages/super-admin/assets/profile-mark-glyph.png');
    expect(profileStyles).not.toMatch(/\.profile\s*\{[^}]*overflow:\s*hidden/s);
    expect(profileStyles).toMatch(
      /\.profile__character\s*\{[^}]*right:\s*-32rpx[^}]*width:\s*462rpx/s,
    );
    expect(profileStyles).toMatch(
      /\.profile__lower\s*\{[^}]*left:\s*-32rpx[^}]*width:\s*573rpx/s,
    );
  });

  it('restores the total-client profile composition from its PSD', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/super-admin/profile/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/super-admin/profile/index.wxss'),
      'utf8',
    );

    expect(markup).toContain('class="profile__identity-card"');
    expect(markup).toContain('class="profile__menu-card"');
    expect(markup).toContain('class="profile__menu-bullet"');
    expect(markup).toContain('class="profile__menu-command">查看</text>');
    expect(markup).toContain('/pages/super-admin/assets/profile-top-character.png');
    expect(markup).toContain('/pages/super-admin/assets/profile-lower-character.png');
    expect(markup).toContain('/pages/super-admin/assets/profile-mark-glyph.png');
    expect(
      fs.existsSync(
        path.join(root, 'pages/super-admin/assets/profile-mark-glyph.png'),
      ),
    ).toBe(true);
    expect(markup).toContain('bindtap="onNavigate"');
    expect(styles).toMatch(
      /\.profile__identity-card\s*\{[^}]*width:\s*653rpx[^}]*min-height:\s*265rpx[^}]*background:\s*#fe8419/s,
    );
    expect(styles).toMatch(
      /\.profile__menu-card\s*\{[^}]*width:\s*653rpx[^}]*background:\s*rgba\(255,\s*215,\s*94,\s*0\.84\)/s,
    );
    expect(styles).toMatch(
      /\.profile__menu-bullet\s*\{[^}]*background:\s*#2fbd82/s,
    );
    expect(styles).toMatch(
      /\.profile__menu-row\s*\{[^}]*border-bottom:\s*3rpx solid rgba\(255,\s*255,\s*255,\s*0\.94\)/s,
    );
    expect(styles).toMatch(
      /\.profile::after\s*\{[^}]*background:\s*var\(--super-admin-yellow\)/s,
    );
  });

  it('restores the total-client lesson account composition without dropping controls', () => {
    const root = path.resolve(__dirname, '..');
    const markup = fs.readFileSync(
      path.join(root, 'pages/super-admin/lesson-ledger/index.wxml'),
      'utf8',
    );
    const styles = fs.readFileSync(
      path.join(root, 'pages/super-admin/lesson-ledger/index.wxss'),
      'utf8',
    );

    expect(markup).toContain('class="lesson-account__hero"');
    expect(markup).toContain('class="lesson-account__bucket-grid"');
    expect(markup).toContain('class="lesson-account__flow-panel"');
    expect(markup).toContain('/pages/super-admin/assets/ledger-top-character.png');
    expect(markup).toContain('/pages/super-admin/assets/ledger-flow-character.png');
    expect(markup).toContain('/pages/super-admin/assets/ledger-mark-glyph.png');
    expect(
      fs.existsSync(
        path.join(root, 'pages/super-admin/assets/ledger-mark-glyph.png'),
      ),
    ).toBe(true);
    expect(markup).toContain('bindtap="onFilterTap"');
    expect(markup).toContain('bindtap="onAdjustTap"');
    const pageScript = fs.readFileSync(
      path.join(root, 'pages/super-admin/lesson-ledger/index.ts'),
      'utf8',
    );
    expect(pageScript).toMatch(/onShow\(\)\s*\{\s*void this\.load\(\);\s*\}/);
    expect(pageScript).toContain("REFUND: '退课扣回'");
    expect(pageScript).toContain("GRANT: '课时发放'");
    expect(pageScript).toContain("CORRECTION: '收款纠错冲正'");
    expect(markup).toContain('data-type="GRANT"');
    expect(markup).toContain(`wx:if="{{item.entryType !== 'CORRECTION'}}"`);
    expect(styles).toMatch(
      /\.lesson-account__hero\s*\{[^}]*width:\s*653rpx[^}]*min-height:\s*320rpx[^}]*background:\s*#fe8419/s,
    );
    expect(styles).toMatch(
      /\.lesson-account__hero\s*\{[^}]*overflow:\s*visible/s,
    );
    expect(styles).toMatch(
      /\.lesson-account__bucket-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(styles).toMatch(
      /\.lesson-account__bucket-card\s*\{[^}]*background:\s*#ffd75e/s,
    );
    expect(styles).toMatch(
      /\.lesson-account__bucket-card\s*\{[^}]*min-height:\s*190rpx/s,
    );
    expect(styles).toMatch(
      /\.lesson-account::before\s*\{[^}]*top:\s*490rpx/s,
    );
    expect(styles).toMatch(
      /\.lesson-account__flow-stage\s*\{[^}]*margin-top:\s*54rpx/s,
    );
    expect(styles).toMatch(
      /\.lesson-account__flow-panel\s*\{[^}]*background:\s*rgba\(255,\s*215,\s*94,\s*0\.84\)/s,
    );
  });

  it('lets super admins configure all three teacher earning bases', () => {
    const root = path.resolve(__dirname, '..');
    const script = fs.readFileSync(
      path.join(root, 'pages/super-admin/earning-rules/index.ts'),
      'utf8',
    );
    const markup = fs.readFileSync(
      path.join(root, 'pages/super-admin/earning-rules/index.wxml'),
      'utf8',
    );

    expect(script).toContain("value: 'PER_COMPLETED_SESSION'");
    expect(script).toContain("value: 'PER_LESSON_UNIT'");
    expect(script).toContain("value: 'PER_PRESENT_ATTENDEE'");
    expect(script).toContain('每有效到课人次金额（元）');
    expect(script).toContain('basisType: basis.value');
    expect(markup).toContain('bindchange="onBasisChange"');
    expect(markup).toContain('{{basisOptions[basisIndex].amountLabel}}');
  });

  it('exposes teacher earning rules before teacher earning review on the dashboard', () => {
    const root = path.resolve(__dirname, '..');
    const dashboard = fs.readFileSync(
      path.join(root, 'pages/super-admin/dashboard/index.wxml'),
      'utf8',
    );
    const ruleRoute = '/pages/super-admin/earning-rules/index';
    const reviewRoute = '/pages/super-admin/earnings/index';

    expect(dashboard).toContain('教师课时费规则');
    expect(dashboard).toContain(`data-url="${ruleRoute}"`);
    expect(dashboard.indexOf(ruleRoute)).toBeLessThan(
      dashboard.indexOf(reviewRoute),
    );
  });

  it('exposes the personnel management workspace on the dashboard', () => {
    const root = path.resolve(__dirname, '..');
    const dashboard = fs.readFileSync(
      path.join(root, 'pages/super-admin/dashboard/index.wxml'),
      'utf8',
    );
    expect(dashboard).toContain('人员管理');
    expect(dashboard).toContain('跨校区管理学员、教师及课包信息');
    expect(dashboard).toContain(
      'data-url="/pages/super-admin/students/index"',
    );
  });
});
