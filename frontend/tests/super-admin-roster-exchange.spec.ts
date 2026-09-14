import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('super admin roster exchange pages', () => {
  it('registers customer and teacher roster workflows without changing the home dashboard', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const pages =
      app.subPackages.find(({ root }) => root === 'pages/super-admin')?.pages ??
      [];
    expect(pages).toContain('teachers/index');

    const studentPage = read('pages/super-admin/students/index.wxml');
    const teacherPage = read('pages/super-admin/teachers/index.wxml');
    expect(studentPage).toContain('快捷录入');
    expect(studentPage).toContain('Excel 导入');
    expect(studentPage).toContain('导出 Excel');
    expect(teacherPage).toContain('教师名册');
    expect(teacherPage).toContain('所属校区');
    expect(teacherPage).not.toContain('角色');

    const home = read('pages/super-admin/home/index.wxml');
    const homePresenter = read('services/super-admin-home.presenter.ts');
    expect(homePresenter).toContain('全局看板');
    expect(home).not.toContain('/pages/super-admin/teachers/index');
  });

  it('keeps global campus filters and full-phone confirmation on both rosters', () => {
    const studentScript = read('pages/super-admin/students/index.ts');
    const teacherScript = read('pages/super-admin/teachers/index.ts');
    const teacherMarkup = read('pages/super-admin/teachers/index.wxml');
    const teacherStyles = read('pages/super-admin/teachers/index.wxss');

    expect(studentScript).toContain("const ROSTER_PREFIX = '/management/rosters'");
    expect(studentScript).toContain('campusId: campus.id');
    expect(teacherScript).toContain("const ROSTER_PREFIX = '/management/rosters'");
    expect(teacherScript).toContain('campusId: campus.id');
    expect(teacherScript).toContain('confirmRosterExport');
    expect(teacherMarkup).toContain('maskedPhone');
    expect(teacherMarkup).toContain('loading');
    expect(teacherMarkup).toContain('empty');
    expect(teacherMarkup).toContain('error');
    expect(teacherStyles).toMatch(
      /\.roster-action[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/,
    );
  });

  it('presents student and teacher rosters as peer tabs outside account management', () => {
    const markup = read('pages/super-admin/staff-accounts/index.wxml');
    const studentMarkup = read('pages/super-admin/students/index.wxml');
    const teacherMarkup = read('pages/super-admin/teachers/index.wxml');
    const studentScript = read('pages/super-admin/students/index.ts');
    const teacherScript = read('pages/super-admin/teachers/index.ts');
    const sharedStyles = read('styles/super-admin-workspace.wxss');

    expect(markup).not.toContain('教师名册');
    expect(markup).toContain('新建登录账号');
    expect(markup).toContain('解除绑定');
    expect(studentMarkup).toContain('roster-tabs');
    expect(teacherMarkup).toContain('roster-tabs');
    expect(studentMarkup).toContain('学员名册');
    expect(studentMarkup).toContain('教师名册');
    expect(teacherMarkup).toContain('学员名册');
    expect(teacherMarkup).toContain('教师名册');
    expect(studentScript).toContain("wx.redirectTo({ url: '/pages/super-admin/teachers/index' })");
    expect(teacherScript).toContain("wx.redirectTo({ url: '/pages/super-admin/students/index' })");
    expect(sharedStyles).toMatch(/\.roster-tabs[\s\S]*grid-template-columns:\s*repeat\(2/);
  });
});
