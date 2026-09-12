import * as fs from 'fs';
import * as path from 'path';

describe('super admin project structure', () => {
  it('registers the home route and its role components', () => {
    const root = path.resolve(__dirname, '..');
    const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')) as {
      pages: string[];
      subPackages: Array<{ root: string; pages: string[] }>;
    };
    expect(
      app.subPackages
        .find((item) => item.root === 'pages/super-admin')
        ?.pages,
    ).toContain('home/index');
    for (const file of [
      'pages/super-admin/home/index.ts',
      'pages/super-admin/home/index.wxml',
      'pages/super-admin/home/index.wxss',
      'pages/super-admin/home/index.json',
      'components/super-admin-page-shell/super-admin-page-shell.wxml',
      'components/super-admin-stat-strip/super-admin-stat-strip.wxml',
    ]) {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
    }
  });
});
