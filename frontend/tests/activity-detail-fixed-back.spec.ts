import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '..');
const read = (relativePath: string): string =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('activity detail fixed navigation', () => {
  it.each(['parent', 'teacher', 'partner'] as const)(
    'keeps the %s back button and activity label visible while posters scroll',
    (role) => {
      const page = read(`pages/${role}/group-detail/index.wxml`);
      const shellMarkup = read(`components/${role}-page-shell/${role}-page-shell.wxml`);
      const shellStyles = read(`components/${role}-page-shell/${role}-page-shell.wxss`);
      const shellLogic = read(`components/${role}-page-shell/${role}-page-shell.ts`);

      expect(page).toContain('fixedHeader="{{true}}"');
      expect(shellLogic).toMatch(
        /fixedHeader:\s*\{\s*type:\s*Boolean,\s*value:\s*false\s*\}/,
      );
      expect(shellMarkup).toContain("fixedHeader ? 'shell__leading--fixed' : ''");
      expect(shellMarkup).toContain("fixedHeader ? 'shell__header--fixed' : ''");
      expect(shellMarkup).toContain('top: {{headerTopPx}}px;');
      expect(shellStyles).toMatch(
        /\.shell__leading--fixed\s*\{[^}]*position:\s*fixed[^}]*left:\s*24rpx[^}]*z-index:\s*32/s,
      );
      expect(shellStyles).toMatch(
        /\.shell__header--fixed\s*\{[^}]*z-index:\s*31/s,
      );
    },
  );
});
