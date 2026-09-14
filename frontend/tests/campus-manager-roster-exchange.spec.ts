import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('campus manager roster exchange pages', () => {
  it('registers customer and teacher roster pages in the manager subpackage', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    const pages =
      app.subPackages.find(({ root }) => root === 'pages/campus-manager')
        ?.pages ?? [];
    expect(pages).toContain('teachers/index');
    for (const page of ['students', 'teachers']) {
      for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
        expect(
          fs.existsSync(
            path.join(ROOT, `pages/campus-manager/${page}/index.${extension}`),
          ),
        ).toBe(true);
      }
    }
  });

  it('offers scoped customer import, export and quick entry without a campus field', () => {
    const customerForm = read('pages/campus-manager/students/index.wxml');
    const script = read('pages/campus-manager/students/index.ts');

    expect(customerForm).toContain('快捷录入');
    expect(customerForm).toContain('Excel 导入');
    expect(customerForm).toContain('导出 Excel');
    expect(customerForm).toContain('学员姓名');
    expect(customerForm).toContain('家长手机号');
    expect(customerForm).not.toContain('所属校区');
    expect(script).toContain(
      "const ROSTER_PREFIX = '/campus-managers/me/rosters'",
    );
    expect(script).not.toMatch(/campusId|roleCode/);
  });

  it('offers a scoped teacher roster without role or campus inputs', () => {
    const teacherForm = read('pages/campus-manager/teachers/index.wxml');
    const script = read('pages/campus-manager/teachers/index.ts');
    const styles = read('pages/campus-manager/teachers/index.wxss');

    expect(teacherForm).toContain('教师名册');
    expect(teacherForm).toContain('markTitle="人员"');
    expect(teacherForm).toContain('人员管理');
    expect(teacherForm).toContain('class="roster-tabs"');
    expect(teacherForm).toContain('学员名册');
    expect(teacherForm).toContain('教师姓名');
    expect(teacherForm).toContain('手机号');
    expect(teacherForm).not.toContain('所属校区');
    expect(teacherForm).not.toContain('角色');
    expect(script).toContain(
      "const ROSTER_PREFIX = '/campus-managers/me/rosters'",
    );
    expect(script).not.toMatch(/campusId|roleCode/);
    expect(script).toContain("wx.redirectTo({ url: '/pages/campus-manager/students/index' })");
    expect(styles).toMatch(
      /\.roster-action[\s\S]*align-items:\s*center[\s\S]*justify-content:\s*center/,
    );
  });
});
