import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('super admin staff accounts page', () => {
  it('offers headquarters roles without a campus picker while retaining campus roles', () => {
    const script = read('pages/super-admin/staff-accounts/index.ts');
    const markup = read('pages/super-admin/staff-accounts/index.wxml');
    expect(script).toContain("{ value: 'HR', label: '总部人力' }");
    expect(script).toContain("{ value: 'FINANCE', label: '总部财务' }");
    expect(markup).toContain('wx:if="{{!createHeadquarters}}"');
    expect(script).toContain('campusId: headquarters ? null : campus.id');
  });
  it('registers one account manager page in the existing super-admin subpackage', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    expect(
      app.subPackages.find(({ root }) => root === 'pages/super-admin')?.pages,
    ).toContain('staff-accounts/index');
    for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
      expect(
        fs.existsSync(
          path.join(
            ROOT,
            `pages/super-admin/staff-accounts/index.${extension}`,
          ),
        ),
      ).toBe(true);
    }
  });

  it('exposes account management from profile and the home navigation', () => {
    const profile = read('pages/super-admin/profile/index.wxml');
    const homePresenter = read('services/super-admin-home.presenter.ts');
    expect(profile).toContain('账号管理');
    expect(profile).toContain('/pages/super-admin/staff-accounts/index');
    expect(homePresenter).toContain('全局看板');
    expect(homePresenter).toContain('账号管理');
    expect(homePresenter).toContain('/pages/super-admin/staff-accounts/index');
    expect(homePresenter).not.toContain("label: '课时账本'");
  });

  it('renders complete request and mutation states with a compact single-page form', () => {
    const script = read('pages/super-admin/staff-accounts/index.ts');
    const markup = read('pages/super-admin/staff-accounts/index.wxml');
    expect(markup).toContain('super-admin-page-shell');
    expect(markup).toContain("viewState === 'loading'");
    expect(markup).toContain("viewState === 'empty'");
    expect(markup).toContain("viewState === 'error'");
    expect(markup).toContain("viewState === 'forbidden'");
    expect(markup).toContain('submitting');
    expect(markup).toContain('停用');
    expect(markup).toContain('启用');
    expect(markup).toContain('解除绑定');
    expect(markup).not.toContain('删除账号');
    expect(markup).toContain('新建登录账号');
    expect(markup).not.toContain('教师名册');
    expect(script).not.toContain("{ value: 'TEACHER', label: '授课老师' }");
    expect(script).toContain("{ value: 'CAMPUS_MANAGER', label: '分校区管理员' }");
    expect(script).toContain("{ value: 'PARTNER', label: '合作方' }");
    expect(script).toContain('loadStaffAccounts');
    expect(script).toContain('createStaffAccount');
    expect(script).toContain('updateStaffAccountStatus');
    expect(script).toContain('unbindStaffWechat');
    expect(script).toContain('wx.showModal');
  });

  it('keeps command text centered in stable touch targets', () => {
    const styles = read('pages/super-admin/staff-accounts/index.wxss');
    expect(styles).toMatch(/\.account-action[\s\S]*?display:\s*flex/);
    expect(styles).toMatch(/\.account-action[\s\S]*?align-items:\s*center/);
    expect(styles).toMatch(/\.account-action[\s\S]*?justify-content:\s*center/);
    expect(styles).toMatch(/\.account-action[\s\S]*?min-height:\s*72rpx/);
    expect(styles).toContain('@media (max-width: 380px)');
  });

  it('accepts the 11-digit mainland mobile number allowed by the form', () => {
    const script = read('pages/super-admin/staff-accounts/index.ts');
    const markup = read('pages/super-admin/staff-accounts/index.wxml');
    expect(markup).toContain('type="number" maxlength="11"');
    expect(script).toContain("/^1[3-9]\\d{9}$/.test(phone)");
    expect(script).not.toContain("/^\\+?861[3-9]\\d{9}$/.test(phone)");
  });
});
