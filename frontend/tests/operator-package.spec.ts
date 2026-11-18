import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveRoleBootstrap } from '../services/session.service';

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(root, 'pages/operator');
export const operatorRoutes = [
  'home', 'profile', 'leave-requests', 'students', 'student-detail',
  'teachers', 'student-form', 'schedule', 'schedule-editor', 'warnings',
  'campus-settings', 'teacher-archives',
];
const walk = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);

it('registers all operator routes in an ordinary subpackage and uses the OPERATOR bootstrap identity', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const operator = app.subPackages.find((item: { root: string }) => item.root === 'pages/operator');
  expect(operator.pages).toEqual(expect.arrayContaining(operatorRoutes.map((route) => `${route}/index`)));
  expect(operator.independent).not.toBe(true);
  expect(resolveRoleBootstrap({ userId: 'synthetic-operator', displayName: '测试运营',
    roles: [{ code: 'OPERATOR', campusId: 'synthetic-campus' }] }))
    .toEqual({ kind: 'navigate', url: '/pages/operator/home/index' });
});

it('provides the complete operator page copy and role-private dependencies', () => {
  expect(fs.existsSync(packageRoot)).toBe(true);
  for (const route of operatorRoutes) {
    for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
      expect(fs.existsSync(path.join(packageRoot, route, `index.${extension}`))).toBe(true);
    }
  }
  const violations: string[] = [];
  for (const file of walk(packageRoot).filter((item) => /\.(ts|json|wxml|wxss)$/.test(item))) {
    const text = fs.readFileSync(file, 'utf8');
    if (/campus-manager|CAMPUS_MANAGER|CampusManager|campusManager|\/partners\/me/.test(text)) {
      violations.push(path.relative(root, file));
    }
    for (const match of text.matchAll(/(?:from\s+|require\()['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      expect(fs.existsSync(target) || fs.existsSync(`${target}.ts`)).toBe(true);
      if (target.includes(`${path.sep}pages${path.sep}`) && !target.startsWith(packageRoot + path.sep)) {
        violations.push(path.relative(root, file));
      }
    }
    if (file.endsWith('.json')) {
      const components = JSON.parse(text).usingComponents ?? {};
      for (const component of Object.values(components) as string[]) {
        expect(fs.existsSync(path.join(root, `${component}.json`))).toBe(true);
      }
    }
    for (const match of text.matchAll(/["'](\/pages\/[^"'${}]+\.(?:png|woff))["']/g)) {
      expect(fs.existsSync(path.join(root, match[1]))).toBe(true);
    }
    for (const match of text.matchAll(/@import\s+["']([^"']+)["']/g)) {
      expect(fs.existsSync(path.resolve(path.dirname(file), match[1]))).toBe(true);
    }
  }
  expect(violations).toEqual([]);
});
